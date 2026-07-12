package calc

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/xuri/excelize/v2"
)

// TestLegacyCFBlobOracle locks legacy_cf.go's fidelity bar with
// excelize as the transition oracle: for every legacy blob type, the
// synthesized <cfRule> must be semantically identical to what
// excelize's SetConditionalFormat wrote for the same options.
//
// Per case:
//  1. ORACLE: write the options through excelize onto the fixture,
//     re-open with excelize, extract the parsed options.
//  2. LEGACY PATH: json-roundtrip the same options into the PascalCase
//     blob shape old Y.Docs persist, run it through the production
//     save (serializeSnapshotToXLSX → legacyOpaqueToCFRule), re-open
//     with excelize, extract the parsed options.
//  3. Compare the two extractions (Format dxf indices zeroed — the
//     stored index is meaningless post-migration and deliberately
//     dropped; styled rules are covered separately below).
func TestLegacyCFBlobOracle(t *testing.T) {
	cases := []struct {
		name string
		opts excelize.ConditionalFormatOptions
		// needsDxf marks types excelize refuses to write without a
		// Format pointer; the oracle mints a throwaway dxf for them.
		needsDxf bool
	}{
		{
			name:     "top rank 3",
			opts:     excelize.ConditionalFormatOptions{Type: "top", Criteria: "=", Value: "3"},
			needsDxf: true,
		},
		{
			name:     "bottom percent",
			opts:     excelize.ConditionalFormatOptions{Type: "bottom", Criteria: "=", Value: "20", Percent: true},
			needsDxf: true,
		},
		{
			name:     "duplicate",
			opts:     excelize.ConditionalFormatOptions{Type: "duplicate", Criteria: "="},
			needsDxf: true,
		},
		{
			name:     "unique stopIfTrue",
			opts:     excelize.ConditionalFormatOptions{Type: "unique", Criteria: "=", StopIfTrue: true},
			needsDxf: true,
		},
		{
			name:     "above average",
			opts:     excelize.ConditionalFormatOptions{Type: "average", Criteria: "=", AboveAverage: true},
			needsDxf: true,
		},
		{
			name:     "below average",
			opts:     excelize.ConditionalFormatOptions{Type: "average", Criteria: "=", AboveAverage: false},
			needsDxf: true,
		},
		{
			name:     "errors",
			opts:     excelize.ConditionalFormatOptions{Type: "errors"},
			needsDxf: true,
		},
		{
			name:     "no errors",
			opts:     excelize.ConditionalFormatOptions{Type: "no_errors"},
			needsDxf: true,
		},
		{
			name: "2 color scale",
			opts: excelize.ConditionalFormatOptions{
				Type:     "2_color_scale",
				Criteria: "=", MinType: "min", MaxType: "max",
				MinColor: "#F8696B", MaxColor: "#63BE7B",
			},
		},
		{
			name: "3 color scale",
			opts: excelize.ConditionalFormatOptions{
				Type:     "3_color_scale",
				Criteria: "=", MinType: "min", MidType: "percentile", MaxType: "max",
				MinColor: "#F8696B", MidColor: "#FFEB84", MaxColor: "#63BE7B",
				MidValue: "50",
			},
		},
		{
			name: "data bar",
			opts: excelize.ConditionalFormatOptions{
				Type:     "data_bar",
				Criteria: "=", MinType: "min", MaxType: "max", BarColor: "#638EC6",
			},
		},
		{
			name: "data bar icons only",
			opts: excelize.ConditionalFormatOptions{
				Type:     "data_bar",
				Criteria: "=", MinType: "num", MinValue: "1", MaxType: "num", MaxValue: "9",
				BarColor: "#638EC6", BarOnly: true,
			},
		},
		{
			name: "icon set reversed",
			opts: excelize.ConditionalFormatOptions{
				Type: "icon_set", IconStyle: "3Arrows", ReverseIcons: true,
			},
		},
		{
			name: "icon set 5 icons only",
			opts: excelize.ConditionalFormatOptions{
				Type: "icon_set", IconStyle: "5Rating", IconsOnly: true,
			},
		},
		{
			name:     "time period last 7 days",
			opts:     excelize.ConditionalFormatOptions{Type: "time_period", Criteria: "last 7 days"},
			needsDxf: true,
		},
	}

	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	const rangeRef = "A2:A8"

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			oracle := extractOracleCF(t, original, rangeRef, tc.opts, tc.needsDxf)
			got := extractLegacyPathCF(t, original, rangeRef, tc.opts)

			// The stored dxf index is dropped by design; styled rules
			// are asserted in TestLegacyCFBlobStyledRuleMintsDxf.
			oracle.Format = nil
			got.Format = nil
			if !reflect.DeepEqual(oracle, got) {
				t.Errorf("legacy conversion diverges from the excelize oracle:\noracle: %+v\n   got: %+v", oracle, got)
			}
		})
	}
}

// extractOracleCF writes opts through excelize and returns the parsed
// options excelize reads back from its own output.
func extractOracleCF(t *testing.T, original []byte, rangeRef string, opts excelize.ConditionalFormatOptions, needsDxf bool) excelize.ConditionalFormatOptions {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("oracle open: %v", err)
	}
	defer func() { _ = f.Close() }()
	if needsDxf {
		idx, err := f.NewConditionalStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
		if err != nil {
			t.Fatalf("oracle dxf: %v", err)
		}
		opts.Format = &idx
	}
	if err := f.SetConditionalFormat("People", rangeRef, []excelize.ConditionalFormatOptions{opts}); err != nil {
		t.Fatalf("oracle SetConditionalFormat: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("oracle write: %v", err)
	}
	return readBackCF(t, buf.Bytes(), rangeRef)
}

// extractLegacyPathCF runs the same options through the production
// legacy-blob path: the PascalCase JSON blob shape old Y.Docs hold, an
// xlsxOpaque snapshot rule, and a real serializeSnapshotToXLSX save.
func extractLegacyPathCF(t *testing.T, original []byte, rangeRef string, opts excelize.ConditionalFormatOptions) excelize.ConditionalFormatOptions {
	t.Helper()
	raw, err := json.Marshal(opts)
	if err != nil {
		t.Fatalf("marshal options: %v", err)
	}
	blob := map[string]interface{}{}
	if err := json.Unmarshal(raw, &blob); err != nil {
		t.Fatalf("unmarshal blob: %v", err)
	}
	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID: "sheet1", Name: "People", Position: 0,
				ConditionalFormats: []ConditionalFormatRule{{
					ID:        "legacy-1",
					Ranges:    []string{rangeRef},
					Condition: ConditionalCondition{Type: "xlsxOpaque", OpaqueXlsx: blob},
				}},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}
	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	return readBackCF(t, out, rangeRef)
}

// readBackCF re-opens xlsx bytes with excelize and returns the single
// conditional-format option on the given range.
func readBackCF(t *testing.T, data []byte, rangeRef string) excelize.ConditionalFormatOptions {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("re-open: %v", err)
	}
	defer func() { _ = f.Close() }()
	got, err := f.GetConditionalFormats("People")
	if err != nil {
		t.Fatalf("GetConditionalFormats: %v", err)
	}
	opts, ok := got[rangeRef]
	if !ok || len(opts) != 1 {
		t.Fatalf("want 1 rule on %s, got %v", rangeRef, got)
	}
	return opts[0]
}

// TestLegacyCFBlobStyledRuleMintsDxf: a legacy blob whose doc rule
// carries a Style gets a freshly minted dxf attached to the
// synthesized rule (the blob's stored Format index is dropped — it
// pointed into a dxfs table the excelize writer rebuilt per save).
func TestLegacyCFBlobStyledRuleMintsDxf(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	staleIdx := 7 // deliberately bogus stored dxf index
	raw, err := json.Marshal(excelize.ConditionalFormatOptions{Type: "duplicate", Criteria: "=", Format: &staleIdx})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	blob := map[string]interface{}{}
	if err := json.Unmarshal(raw, &blob); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID: "sheet1", Name: "People", Position: 0,
				ConditionalFormats: []ConditionalFormatRule{{
					ID:        "legacy-styled",
					Ranges:    []string{"A1:A10"},
					Condition: ConditionalCondition{Type: "xlsxOpaque", OpaqueXlsx: blob},
					Style:     &CellStyle{Font: &CellFont{Bold: boolPtr(true)}},
				}},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}
	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	rules := readSheetConditionalFormats(t, out, "People")
	if len(rules) != 1 {
		t.Fatalf("want 1 rule, got %d", len(rules))
	}
	if rules[0].Condition.Type != "xlsxOpaque" {
		t.Errorf("type: want xlsxOpaque (duplicateValues is unmodeled), got %q", rules[0].Condition.Type)
	}
	rawXML, _ := rules[0].Condition.OpaqueXlsx["rawXml"].(string)
	if !contains(rawXML, `type="duplicateValues"`) {
		t.Errorf("converted rule XML: want duplicateValues, got %q", rawXML)
	}
	if rules[0].Style == nil || rules[0].Style.Font == nil || rules[0].Style.Font.Bold == nil || !*rules[0].Style.Font.Bold {
		t.Errorf("minted dxf did not resolve to the doc style: %+v", rules[0].Style)
	}
}

func contains(s, sub string) bool {
	return bytes.Contains([]byte(s), []byte(sub))
}
