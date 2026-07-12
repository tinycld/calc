package calc

import (
	"bytes"
	"os"
	"strings"
	"testing"

	"github.com/nathanstitt/doctaculous/pkg/xlsx"
	"github.com/xuri/excelize/v2"
)

// readSheetConditionalFormats runs the production CF read path over
// raw xlsx bytes: doctaculous OpenBytes, find the sheet, map its
// blocks through readConditionalFormats.
func readSheetConditionalFormats(t *testing.T, data []byte, sheetName string) []ConditionalFormatRule {
	t.Helper()
	wb, err := xlsx.OpenBytes(data)
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	for i := range wb.Sheets {
		if wb.Sheets[i].Name == sheetName {
			return readConditionalFormats(&wb.Sheets[i])
		}
	}
	t.Fatalf("sheet %q not found", sheetName)
	return nil
}

// TestConditionalFormatRoundtripNumberGreater verifies that a doc-side
// numberGreater rule maps to a "cell" + "greater than" excelize rule
// and that re-parsing the saved file produces an equivalent rule.
func TestConditionalFormatRoundtripNumberGreater(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	op := "50"
	color := "#FF0000"
	rule := ConditionalFormatRule{
		ID:     "test-1",
		Ranges: []string{"A1:A10"},
		Condition: ConditionalCondition{
			Type:   "numberGreater",
			Value1: &op,
		},
		Style: &CellStyle{
			Fill: &CellFill{
				Type:    strPtr("pattern"),
				Pattern: strPtr("solid"),
				FgColor: &color,
				BgColor: &color,
			},
		},
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID:                 "sheet1",
				Name:               "People",
				Position:           0,
				ConditionalFormats: []ConditionalFormatRule{rule},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	// Re-parse and confirm excelize sees the rule.
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = f.Close() }()

	got, err := f.GetConditionalFormats("People")
	if err != nil {
		t.Fatalf("GetConditionalFormats: %v", err)
	}
	opts, ok := got["A1:A10"]
	if !ok {
		t.Fatalf("expected CF on A1:A10; got map %v", got)
	}
	if len(opts) != 1 {
		t.Fatalf("expected 1 rule on A1:A10; got %d", len(opts))
	}
	if opts[0].Type != "cell" {
		t.Errorf("type: want cell, got %q", opts[0].Type)
	}
	// excelize accepts both textual and symbolic criteria; assert
	// either form is OK here.
	if c := opts[0].Criteria; c != "greater than" && c != ">" {
		t.Errorf("criteria: want greater than, got %q", c)
	}
	if opts[0].Value != "50" {
		t.Errorf("value: want %q, got %q", "50", opts[0].Value)
	}

	// And confirm our reader maps it back to numberGreater.
	rules := readSheetConditionalFormats(t, out, "People")
	if len(rules) != 1 {
		t.Fatalf("expected 1 rule on re-parse; got %d", len(rules))
	}
	if rules[0].Condition.Type != "numberGreater" {
		t.Errorf("re-parse condition type: want numberGreater, got %q", rules[0].Condition.Type)
	}
	if rules[0].Condition.Value1 == nil || *rules[0].Condition.Value1 != "50" {
		t.Errorf("re-parse value: want %q, got %v", "50", rules[0].Condition.Value1)
	}
}

func TestConditionalFormatRoundtripCustomFormula(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	formula := "$A1=\"Yes\""
	rule := ConditionalFormatRule{
		ID:     "test-2",
		Ranges: []string{"A1:B10"},
		Condition: ConditionalCondition{
			Type:    "customFormula",
			Formula: &formula,
		},
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID:                 "sheet1",
				Name:               "People",
				Position:           0,
				ConditionalFormats: []ConditionalFormatRule{rule},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer func() { _ = f.Close() }()

	got, err := f.GetConditionalFormats("People")
	if err != nil {
		t.Fatalf("GetConditionalFormats: %v", err)
	}
	opts := got["A1:B10"]
	if len(opts) == 0 {
		t.Fatalf("expected CF on A1:B10; got %v", got)
	}
	// Excelize labels custom-formula rules as either "expression" or
	// "formula" depending on the variant; both are acceptable.
	if got := opts[0].Type; got != "formula" && got != "expression" {
		t.Errorf("type: want formula/expression, got %q", got)
	}
	rules := readSheetConditionalFormats(t, out, "People")
	if len(rules) != 1 {
		t.Fatalf("expected 1 rule; got %d", len(rules))
	}
	if rules[0].Condition.Type != "customFormula" {
		t.Errorf("type: want customFormula, got %q", rules[0].Condition.Type)
	}
	if rules[0].Condition.Formula == nil || *rules[0].Condition.Formula != formula {
		t.Errorf("formula: want %q, got %v", formula, rules[0].Condition.Formula)
	}
}

func TestConditionalFormatOpaquePassthrough(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Stamp a "duplicateValues" rule via excelize directly so the
	// re-parse must round-trip it as xlsxOpaque (the authoring UI
	// doesn't model it in v1).
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	// "duplicate" rules require a Format pointer to a dxf index;
	// supply a minimal one so excelize accepts the seed.
	fmtIdx, err := f.NewConditionalStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	if err != nil {
		t.Fatalf("new dxf: %v", err)
	}
	if err := f.SetConditionalFormat("People", "A1:A10", []excelize.ConditionalFormatOptions{
		{Type: "duplicate", Criteria: "=", Format: &fmtIdx},
	}); err != nil {
		t.Fatalf("seed CF: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("write seeded: %v", err)
	}
	_ = f.Close()

	// Read it back via our reader: duplicateValues is outside the
	// modelled subset, so it must surface as xlsxOpaque carrying the
	// verbatim <cfRule> XML, with the dxf style attached for client
	// previews.
	rules := readSheetConditionalFormats(t, buf.Bytes(), "People")
	if len(rules) != 1 {
		t.Fatalf("expected 1 rule from seeded xlsx; got %d", len(rules))
	}
	if rules[0].Condition.Type != "xlsxOpaque" {
		t.Errorf("opaque type: want xlsxOpaque, got %q", rules[0].Condition.Type)
	}
	if rules[0].Condition.OpaqueXlsx == nil {
		t.Fatalf("opaque blob is nil; want rawXml payload")
	}
	rawXML, ok := rules[0].Condition.OpaqueXlsx["rawXml"].(string)
	if !ok || rawXML == "" {
		t.Fatalf("opaque rawXml missing: %v", rules[0].Condition.OpaqueXlsx)
	}
	if !strings.Contains(rawXML, `type="duplicateValues"`) {
		t.Errorf("rawXml should carry the verbatim cfRule, got %q", rawXML)
	}
	if rules[0].Style == nil || rules[0].Style.Font == nil || rules[0].Style.Font.Bold == nil || !*rules[0].Style.Font.Bold {
		t.Errorf("opaque rule dxf style not attached: %+v", rules[0].Style)
	}

	// Write-side half: the save is AUTHORITATIVE — the snapshot's rules
	// replace the sheet's conditional formatting wholesale, and the
	// rawXml opaque rule re-emits verbatim via CFRule{Raw}. To prove
	// the output comes from the SNAPSHOT (not incidental survival in
	// the original bytes), move the rule to a different range and add a
	// second typed styled rule: the output must carry the rule on the
	// NEW range, with the rawXml byte-comparable modulo the renumbered
	// priority attribute.
	//
	// The typed styled rule also grows the <dxfs> table — proving the
	// raw rule's embedded dxfId stays valid: the save applies onto the
	// same file the rule was read from and the editor only APPENDS to
	// <dxfs> (never compacts), so an index that resolved at read time
	// resolves at save time. The bold dxf re-reading below is that
	// induction's assertion.
	movedRule := rules[0]
	movedRule.Ranges = []string{"B2:B12"}
	typedRule := ConditionalFormatRule{
		ID:        "typed-1",
		Ranges:    []string{"C1:C5"},
		Condition: ConditionalCondition{Type: "numberGreater", Value1: strPtr("3")},
		Style:     &CellStyle{Font: &CellFont{Italic: boolPtr(true)}},
	}
	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID:                 "sheet1",
				Name:               "People",
				Position:           0,
				ConditionalFormats: []ConditionalFormatRule{typedRule, movedRule},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}
	out, err := serializeSnapshotToXLSX(buf.Bytes(), snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	got := readSheetConditionalFormats(t, out, "People")
	if len(got) != 2 {
		t.Fatalf("authoritative save: want 2 rules, got %d", len(got))
	}
	if got[0].Condition.Type != "numberGreater" {
		t.Errorf("typed rule: want numberGreater first, got %q", got[0].Condition.Type)
	}
	opaqueOut := got[1]
	if len(opaqueOut.Ranges) != 1 || opaqueOut.Ranges[0] != "B2:B12" {
		t.Errorf("opaque rule ranges: want snapshot's [B2:B12], got %v", opaqueOut.Ranges)
	}
	if opaqueOut.Condition.Type != "xlsxOpaque" {
		t.Errorf("opaque round-trip type: want xlsxOpaque, got %q", opaqueOut.Condition.Type)
	}
	roundTripped, _ := opaqueOut.Condition.OpaqueXlsx["rawXml"].(string)
	if stripPriorityAttr(roundTripped) != stripPriorityAttr(rawXML) {
		t.Errorf("opaque rawXml not byte-comparable (modulo priority):\nwant %q\n got %q", rawXML, roundTripped)
	}
	// The raw rule's original dxf (bold) still resolves after the save
	// minted a NEW dxf for the typed rule — the append-only induction.
	if opaqueOut.Style == nil || opaqueOut.Style.Font == nil || opaqueOut.Style.Font.Bold == nil || !*opaqueOut.Style.Font.Bold {
		t.Errorf("opaque rule's embedded dxfId no longer resolves to the bold dxf: %+v", opaqueOut.Style)
	}
	if got[0].Style == nil || got[0].Style.Font == nil || got[0].Style.Font.Italic == nil || !*got[0].Style.Font.Italic {
		t.Errorf("typed rule's minted dxf lost: %+v", got[0].Style)
	}
}

// stripPriorityAttr removes the priority="N" attribute so raw rule XML
// compares across the save's renumbering.
func stripPriorityAttr(s string) string {
	for {
		i := strings.Index(s, ` priority="`)
		if i < 0 {
			return s
		}
		j := strings.Index(s[i+len(` priority="`):], `"`)
		if j < 0 {
			return s
		}
		s = s[:i] + s[i+len(` priority="`)+j+1:]
	}
}

func strPtr(s string) *string { return &s }
