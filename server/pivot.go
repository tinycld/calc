package calc

import (
	"fmt"
	"strings"

	"github.com/nathanstitt/doctaculous/pkg/xlsx"
)

// PivotDefinitionDTO mirrors the TS PivotDefinition (see
// tinycld/calc/lib/workbook-types.ts). It is the wire shape for the
// preview endpoint and the YDoc bootstrap path. Field tags are
// camelCase JSON so it decodes byte-for-byte into the TS interface.
type PivotDefinitionDTO struct {
	ID               string               `json:"id"`
	SourceRange      string               `json:"sourceRange"`
	TargetSheetName  string               `json:"targetSheetName"`
	Rows             []PivotFieldDTO      `json:"rows"`
	Cols             []PivotFieldDTO      `json:"cols"`
	Values           []PivotValueFieldDTO `json:"values"`
	Filters          []PivotFieldDTO      `json:"filters"`
	FilterSelections map[string][]string  `json:"filterSelections,omitempty"`
	RowGrandTotals   bool                 `json:"rowGrandTotals"`
	ColGrandTotals   bool                 `json:"colGrandTotals"`
	RowSubtotals     bool                 `json:"rowSubtotals"`
	ColSubtotals     bool                 `json:"colSubtotals"`
	StyleName        string               `json:"styleName,omitempty"`
}

// PivotFieldDTO is the Rows/Cols/Filters per-field shape.
type PivotFieldDTO struct {
	SourceColumn string `json:"sourceColumn"`
	DisplayName  string `json:"displayName,omitempty"`
}

// PivotValueFieldDTO extends PivotFieldDTO with aggregation + numFmt.
// `Aggregation` values: sum, average, count, countNums, max, min,
// product, stdDev, stdDevp, var, varp (matches the TS PivotAggregation
// union).
//
// NumFmt is a free-form Excel format pattern (e.g. "#,##0.00") used by
// the TS-side render engine. It deliberately does NOT round-trip
// through xlsx: the dataField numFmt slot is a built-in numFmt ID and
// only accepts that catalog, so a custom string pattern has nowhere
// to land. We carry the field on the DTO so the preview endpoint and
// Y.Doc bootstrap can ferry it from xlsx import (always empty today)
// to engine render, but the export path drops it. See docs/pivot.md
// for the divergence note.
type PivotValueFieldDTO struct {
	SourceColumn string `json:"sourceColumn"`
	DisplayName  string `json:"displayName,omitempty"`
	Aggregation  string `json:"aggregation"`
	NumFmt       string `json:"numFmt,omitempty"`
}

// readPivots pulls every pivot definition out of the workbook bytes
// and maps them onto PivotDefinitionDTOs. The doctaculous read
// Workbook doesn't expose pivots, so we open an editor handle purely
// for PivotTables() — reads don't dirty any part, and the handle is
// discarded without Save.
//
// PivotTables walks sheets in workbook order, so the per-target-sheet
// index — and with it the deterministic "p_<sheet>_<n>" ID scheme —
// is stable per import, matching the excelize-era per-anchor-sheet
// numbering.
//
// The function does not promote in-sheet pivots to dedicated sheets;
// that is the caller's job (ensureDistinctTargets) so the collision
// rule can see the full sheet list, not just one target at a time.
func readPivots(xlsxBytes []byte) ([]PivotDefinitionDTO, error) {
	ed, err := xlsx.Edit(xlsxBytes)
	if err != nil {
		return nil, err
	}
	pts := ed.PivotTables()
	if len(pts) == 0 {
		return nil, nil
	}
	perTarget := map[string]int{}
	out := make([]PivotDefinitionDTO, 0, len(pts))
	for _, pt := range pts {
		perTarget[pt.TargetSheet]++
		out = append(out, PivotDefinitionDTO{
			ID:              fmt.Sprintf("p_%s_%d", sanitizeID(pt.TargetSheet), perTarget[pt.TargetSheet]),
			SourceRange:     combineSourceRange(pt.SourceSheet, pt.SourceRange),
			TargetSheetName: pt.TargetSheet,
			Rows:            mapAxisFields(pt.Rows),
			Cols:            mapAxisFields(pt.Cols),
			Values:          mapPivotValues(pt.Values),
			Filters:         mapAxisFields(pt.Filters),
			RowGrandTotals:  pt.RowGrandTotals,
			ColGrandTotals:  pt.ColGrandTotals,
			StyleName:       pt.StyleName,
		})
	}
	return out, nil
}

// mapAxisFields converts axis field names (rows/cols/filters) to the
// DTO shape. doctaculous surfaces only the source-column name for axis
// fields; the per-field DisplayName the excelize reader carried
// best-effort is not available (accepted loss — Excel-authored files
// leave it empty in practice).
func mapAxisFields(in []string) []PivotFieldDTO {
	out := make([]PivotFieldDTO, 0, len(in))
	for _, name := range in {
		out = append(out, PivotFieldDTO{SourceColumn: name})
	}
	return out
}

func mapPivotValues(in []xlsx.PivotValueField) []PivotValueFieldDTO {
	out := make([]PivotValueFieldDTO, 0, len(in))
	for _, v := range in {
		display := v.DisplayName
		if display == v.Field {
			display = ""
		}
		out = append(out, PivotValueFieldDTO{
			SourceColumn: v.Field,
			DisplayName:  display,
			Aggregation:  normalizeAgg(v.Aggregation),
		})
	}
	return out
}

// combineSourceRange rebuilds the combined "<sheet>!<range>" form the
// DTO carries (and the TS side + write path consume). doctaculous
// surfaces the pivot cache's source sheet and ref separately;
// excelize's DataRange arrived pre-combined.
func combineSourceRange(sheet, ref string) string {
	if sheet == "" {
		return ref
	}
	return quoteSheetIfNeeded(sheet) + "!" + ref
}

// quoteSheetIfNeeded wraps a sheet name in single quotes (doubling any
// embedded quotes) when a bare "<sheet>!" prefix would be ambiguous —
// the inverse of the unquoting the excelize-era reader applied to
// PivotTableRange.
func quoteSheetIfNeeded(name string) string {
	if !sheetNameNeedsQuoting(name) {
		return name
	}
	return "'" + strings.ReplaceAll(name, "'", "''") + "'"
}

// sheetNameNeedsQuoting reports whether an A1-style reference needs
// the sheet name quoted: anything beyond letters, digits, and
// underscores, or a leading digit.
func sheetNameNeedsQuoting(name string) bool {
	for i, r := range name {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r == '_':
		case r >= '0' && r <= '9':
			if i == 0 {
				return true
			}
		default:
			return true
		}
	}
	return false
}

// sanitizeID maps an arbitrary sheet name to a stable, ASCII-only id
// component. Used so the synthetic pivot ID is deterministic per
// import and doesn't depend on time.
func sanitizeID(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'A' && r <= 'Z',
			r >= 'a' && r <= 'z',
			r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ':
			b.WriteRune('_')
		}
	}
	if b.Len() == 0 {
		return "sheet"
	}
	return b.String()
}

// normalizeAgg maps an OOXML dataField subtotal string (as surfaced
// raw by doctaculous, e.g. "average" / "countNums"; excelize's
// capitalized variants normalize identically) to the PivotAggregation
// union the TS side uses.
func normalizeAgg(s string) string {
	switch strings.ToLower(s) {
	case "sum", "":
		return "sum"
	case "average":
		return "average"
	case "count":
		return "count"
	case "countnums":
		return "countNums"
	case "max":
		return "max"
	case "min":
		return "min"
	case "product":
		return "product"
	case "stddev":
		return "stdDev"
	case "stddevp":
		return "stdDevp"
	case "var":
		return "var"
	case "varp":
		return "varp"
	}
	return "sum"
}
