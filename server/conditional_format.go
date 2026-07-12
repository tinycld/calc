package calc

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/nathanstitt/doctaculous/pkg/xlsx"
)

// Conditional formatting between the xlsx file and the doc-side rule
// model.
//
// READ: the raw OOXML rule vocabulary maps onto ours:
//   - "cellIs" + operator                    => our number* family
//   - "containsText" / "notContainsText" /
//     "beginsWith" / "endsWith"              => our text* family
//   - "containsBlanks" / "notContainsBlanks" => isEmpty / isNotEmpty
//   - "expression"                           => customFormula
//   - everything else (colorScale, dataBar, iconSet, top10,
//     duplicateValues, timePeriod, ...)      => 'xlsxOpaque' carrying
//     the verbatim <cfRule> XML for lossless passthrough
//
// WRITE: one wholesale SetConditionalFormats per sheet — the doc's
// rules ARE the sheet's rules, in doc order, priorities renumbered
// 1..N by the editor. Typed rules synthesize the OOXML attributes PLUS
// the <formula> operands Excel requires (excelize used to build these;
// doctaculous does not). Opaque rules in the rawXml form re-emit
// verbatim via CFRule{Raw}; legacy excelize-JSON blobs persisted in
// old Y.Docs convert through legacy_cf.go.

// readConditionalFormats maps a doctaculous sheet's conditional-
// formatting blocks onto ConditionalFormatRule. Rules surface in FILE
// order (block order, then rule order within each block). That order
// is deterministic per file, so the bootstrap output is stable across
// runs without the excelize-era sort-by-range — and it preserves the
// author's priority stacking, which the sort discarded.
//
// The xlsx side is "range-set owns rules" while the doc side is "rule
// owns ranges": each rule becomes its own ConditionalFormatRule
// carrying the whole block's ranges. We deliberately do NOT merge
// rules with identical conditions across blocks — the inverse mapping
// would lose information.
func readConditionalFormats(sheet *xlsx.Sheet) []ConditionalFormatRule {
	if len(sheet.CondFmts) == 0 {
		return nil
	}
	var out []ConditionalFormatRule
	for _, block := range sheet.CondFmts {
		baseID := "xlsx:" + strings.Join(block.Ranges, "+")
		for i := range block.Rules {
			r := &block.Rules[i]
			rule := ConditionalFormatRule{
				ID:        baseID,
				Ranges:    append([]string(nil), block.Ranges...),
				Condition: cfRuleCondition(r),
				// The dxf style attaches for every rule — opaque
				// included — so the client can preview the formatting
				// even for rule kinds it doesn't model.
				Style: styleToCellStyle(r.Style),
			}
			if i > 0 {
				rule.ID = baseID + ":" + strconv.Itoa(i)
			}
			out = append(out, rule)
		}
	}
	return out
}

// cfRuleCondition maps one OOXML <cfRule> onto the doc-side condition
// vocabulary. Anything outside the modelled subset rides through as
// xlsxOpaque carrying the verbatim rule XML.
func cfRuleCondition(r *xlsx.CFRule) ConditionalCondition {
	switch r.Type {
	case "cellIs":
		return cellIsCondition(r)
	case "containsText":
		return textCondition("textContains", r)
	case "notContainsText":
		return textCondition("textDoesNotContain", r)
	case "beginsWith":
		return textCondition("textStartsWith", r)
	case "endsWith":
		return textCondition("textEndsWith", r)
	case "containsBlanks":
		return ConditionalCondition{Type: "isEmpty"}
	case "notContainsBlanks":
		return ConditionalCondition{Type: "isNotEmpty"}
	case "expression":
		if len(r.Formulas) == 0 {
			return opaqueCondition(r)
		}
		formula := strings.TrimPrefix(r.Formulas[0], "=")
		return ConditionalCondition{Type: "customFormula", Formula: &formula}
	}
	return opaqueCondition(r)
}

// cellIsCondition maps a cellIs rule's operator + formula operands to
// the number* family. A rule missing its operands (structurally
// invalid, but files exist) falls back to opaque passthrough rather
// than fabricating an empty comparison.
func cellIsCondition(r *xlsx.CFRule) ConditionalCondition {
	var typ string
	operands := 1
	switch r.Operator {
	case "equal":
		typ = "numberEquals"
	case "notEqual":
		typ = "numberNotEquals"
	case "greaterThan":
		typ = "numberGreater"
	case "greaterThanOrEqual":
		typ = "numberGreaterOrEqual"
	case "lessThan":
		typ = "numberLess"
	case "lessThanOrEqual":
		typ = "numberLessOrEqual"
	case "between":
		typ, operands = "numberBetween", 2
	case "notBetween":
		typ, operands = "numberNotBetween", 2
	default:
		return opaqueCondition(r)
	}
	if len(r.Formulas) < operands {
		return opaqueCondition(r)
	}
	cond := ConditionalCondition{Type: typ, Value1: ptr(r.Formulas[0])}
	if operands == 2 {
		cond.Value2 = ptr(r.Formulas[1])
	}
	return cond
}

func textCondition(typ string, r *xlsx.CFRule) ConditionalCondition {
	return ConditionalCondition{Type: typ, Value1: ptr(r.Text)}
}

// opaqueCondition wraps the verbatim <cfRule> XML under the "rawXml"
// key. This replaces the excelize-era opaque representation (a JSON
// round-trip of excelize.ConditionalFormatOptions with PascalCase
// keys); the TS side treats opaqueXlsx as opaque either way. The save
// path re-emits rawXml via CFRule{Raw}; legacy PascalCase blobs
// persisted in old Y.Docs are converted by legacy_cf.go.
func opaqueCondition(r *xlsx.CFRule) ConditionalCondition {
	return ConditionalCondition{
		Type:       "xlsxOpaque",
		OpaqueXlsx: map[string]interface{}{"rawXml": string(r.Raw)},
	}
}

// writeConditionalFormats replaces a sheet's conditional formatting
// wholesale with the doc-side rules. Called from persist.go's
// serializeSnapshotToXLSX after the per-cell value/style writes and
// before pivots.
//
// Each doc rule becomes ONE <conditionalFormatting> block carrying all
// of the rule's ranges (the doc side is "rule owns ranges"), in doc
// order; the editor renumbers priorities 1..N. Rules the writer cannot
// express (unknown native types authored by a newer client) are
// skipped; when nothing survives, the sheet's on-disk rules are left
// untouched (the caller already skips sheets whose docs carry no
// rules, so legacy docs bootstrapped before CF seeding keep their
// file-side rules).
func writeConditionalFormats(sh *xlsx.SheetEdit, rules []ConditionalFormatRule) error {
	blocks := make([]xlsx.ConditionalFormatting, 0, len(rules))
	for i := range rules {
		rule := &rules[i]
		ranges := make([]string, 0, len(rule.Ranges))
		for _, r := range rule.Ranges {
			if r != "" {
				ranges = append(ranges, r)
			}
		}
		if len(ranges) == 0 {
			continue
		}
		cfRule, ok, err := ruleToCFRule(rule, ranges)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		blocks = append(blocks, xlsx.ConditionalFormatting{
			Ranges: ranges,
			Rules:  []xlsx.CFRule{cfRule},
		})
	}
	if len(blocks) == 0 {
		return nil
	}
	return sh.SetConditionalFormats(blocks)
}

// ruleToCFRule maps one doc-side rule onto a doctaculous CFRule.
// Returns ok=false for rules outside the writable vocabulary (skipped
// rather than corrupting the file).
//
// Typed rules carry the OOXML type/operator/text attributes PLUS the
// <formula> operands Excel requires to evaluate them — the SEARCH /
// LEFT / RIGHT / LEN patterns excelize synthesized are reproduced here
// verbatim, anchored at the relative top-left of the rule's first
// range (Excel evaluates the formula per cell by relative shift).
func ruleToCFRule(rule *ConditionalFormatRule, ranges []string) (xlsx.CFRule, bool, error) {
	if rule.Condition.Type == "xlsxOpaque" {
		return opaqueToCFRule(rule, ranges)
	}

	anchor := ruleAnchor(ranges)
	v1 := derefString(rule.Condition.Value1)
	out := xlsx.CFRule{}
	switch rule.Condition.Type {
	case "isEmpty":
		out.Type = "containsBlanks"
		out.Formulas = []string{fmt.Sprintf("LEN(TRIM(%s))=0", anchor)}
	case "isNotEmpty":
		out.Type = "notContainsBlanks"
		out.Formulas = []string{fmt.Sprintf("LEN(TRIM(%s))>0", anchor)}
	case "textContains":
		out.Type = "containsText"
		out.Operator = "containsText"
		out.Text = v1
		out.Formulas = []string{fmt.Sprintf(`NOT(ISERROR(SEARCH("%s",%s)))`, cfQuote(v1), anchor)}
	case "textDoesNotContain":
		out.Type = "notContainsText"
		out.Operator = "notContains"
		out.Text = v1
		out.Formulas = []string{fmt.Sprintf(`ISERROR(SEARCH("%s",%s))`, cfQuote(v1), anchor)}
	case "textStartsWith":
		out.Type = "beginsWith"
		out.Operator = "beginsWith"
		out.Text = v1
		out.Formulas = []string{fmt.Sprintf(`LEFT(%[2]s,LEN("%[1]s"))="%[1]s"`, cfQuote(v1), anchor)}
	case "textEndsWith":
		out.Type = "endsWith"
		out.Operator = "endsWith"
		out.Text = v1
		out.Formulas = []string{fmt.Sprintf(`RIGHT(%[2]s,LEN("%[1]s"))="%[1]s"`, cfQuote(v1), anchor)}
	case "textEquals":
		// A quoted string literal against cellIs/equal — the same shape
		// excelize emitted for "text" + "equal to".
		out.Type = "cellIs"
		out.Operator = "equal"
		out.Formulas = []string{`"` + cfQuote(v1) + `"`}
	case "dateIs":
		// Date conditions round-trip as cell-value comparisons against
		// the operand interpreted as a date serial; the cell's number
		// format supplies the date rendering.
		out.Type = "cellIs"
		out.Operator = "equal"
		out.Formulas = []string{v1}
	case "dateBefore":
		out.Type = "cellIs"
		out.Operator = "lessThan"
		out.Formulas = []string{v1}
	case "dateAfter":
		out.Type = "cellIs"
		out.Operator = "greaterThan"
		out.Formulas = []string{v1}
	case "numberEquals":
		out.Type = "cellIs"
		out.Operator = "equal"
		out.Formulas = []string{v1}
	case "numberNotEquals":
		out.Type = "cellIs"
		out.Operator = "notEqual"
		out.Formulas = []string{v1}
	case "numberGreater":
		out.Type = "cellIs"
		out.Operator = "greaterThan"
		out.Formulas = []string{v1}
	case "numberGreaterOrEqual":
		out.Type = "cellIs"
		out.Operator = "greaterThanOrEqual"
		out.Formulas = []string{v1}
	case "numberLess":
		out.Type = "cellIs"
		out.Operator = "lessThan"
		out.Formulas = []string{v1}
	case "numberLessOrEqual":
		out.Type = "cellIs"
		out.Operator = "lessThanOrEqual"
		out.Formulas = []string{v1}
	case "numberBetween":
		out.Type = "cellIs"
		out.Operator = "between"
		out.Formulas = []string{v1, derefString(rule.Condition.Value2)}
	case "numberNotBetween":
		out.Type = "cellIs"
		out.Operator = "notBetween"
		out.Formulas = []string{v1, derefString(rule.Condition.Value2)}
	case "customFormula":
		formula := strings.TrimPrefix(derefString(rule.Condition.Formula), "=")
		if formula == "" {
			return out, false, nil
		}
		out.Type = "expression"
		out.Formulas = []string{formula}
	default:
		// Unknown native type — skip rather than corrupting the file.
		return out, false, nil
	}
	if rule.Style != nil {
		st := cellStyleToDxfStyle(rule.Style)
		out.Style = &st
	}
	return out, true, nil
}

// opaqueToCFRule re-emits an opaque-passthrough rule.
//
// The rawXml form (rules read since the doctaculous migration) hands
// the verbatim <cfRule> element back via CFRule{Raw}. Any dxfId inside
// stays valid INDUCTIVELY: the save always applies onto the same file
// the rule was read from, and the doctaculous editor only ever appends
// to <dxfs> (dedupe-or-append; never compacts), so an index that
// resolved at read time still resolves at save time. The doc-side
// Style attached at read time is for client previews only and is
// deliberately NOT passed here — passing it would mint a new (lossy)
// dxf and override the original.
//
// Legacy PascalCase excelize-JSON blobs (persisted before the
// migration; detected by the absence of the "rawXml" key) convert
// through legacy_cf.go into equivalent rule XML; those DO carry the
// doc-side Style so the editor can mint a dxf (the blob's stored
// Format index pointed into a dxfs table excelize used to rebuild —
// it is meaningless now).
func opaqueToCFRule(rule *ConditionalFormatRule, ranges []string) (xlsx.CFRule, bool, error) {
	blob := rule.Condition.OpaqueXlsx
	if blob == nil {
		return xlsx.CFRule{}, false, nil
	}
	if rawAny, ok := blob["rawXml"]; ok {
		raw, _ := rawAny.(string)
		if raw == "" {
			return xlsx.CFRule{}, false, nil
		}
		return xlsx.CFRule{Raw: []byte(raw)}, true, nil
	}
	return legacyOpaqueToCFRule(blob, rule.Style, ruleAnchor(ranges))
}

// ruleAnchor returns the relative top-left cell of the rule's first
// range — the reference the synthesized <formula> operands anchor on.
// Falls back to A1 when the range is malformed (matching where Excel
// anchors a rule with no better information).
func ruleAnchor(ranges []string) string {
	if len(ranges) > 0 {
		if r, err := xlsx.ParseRange(ranges[0]); err == nil {
			return xlsx.CellRef(r.StartRow, r.StartCol)
		}
	}
	return "A1"
}

// cfQuote doubles embedded double-quotes for use inside a quoted
// formula string literal.
func cfQuote(s string) string {
	return strings.ReplaceAll(s, `"`, `""`)
}

func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
