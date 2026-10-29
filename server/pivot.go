package calc

import (
	"context"
	"fmt"
	"strings"

	"github.com/nathanstitt/omnidoc/pkg/xlsx"
	ycrdt "github.com/skyterra/y-crdt"
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

	// CacheFields are the pivot cache's field names as the source file
	// named them, in source-column order. Calc does not show them; the
	// save hands them back to AddPivotTable so a re-add keeps the
	// producer's names (Google numbers repeated blank headers " ", " 2",
	// ...) instead of renaming them.
	CacheFields []string `json:"cacheFields,omitempty"`

	// The layout facts below come from the file and go back to it on
	// save; calc's engine ignores them. The client's writePivot rewrites
	// the whole pivot entry without them, so an edit in calc drops them
	// (CacheFields stays until the source range changes) and the save
	// falls back to omnidoc's defaults, which is right for a layout calc
	// changed. ValuesAxis/ValuesPosition place the "Values" placeholder;
	// AxisSort maps an axis field to "ascending" / "descending"; the
	// captions and HideMissing/ShowError are the table's display text
	// settings.
	ValuesAxis        string            `json:"valuesAxis,omitempty"`
	ValuesPosition    int               `json:"valuesPosition,omitempty"`
	AxisSort          map[string]string `json:"axisSort,omitempty"`
	DataCaption       string            `json:"dataCaption,omitempty"`
	RowHeaderCaption  string            `json:"rowHeaderCaption,omitempty"`
	ColHeaderCaption  string            `json:"colHeaderCaption,omitempty"`
	GrandTotalCaption string            `json:"grandTotalCaption,omitempty"`
	MissingCaption    string            `json:"missingCaption,omitempty"`
	HideMissing       bool              `json:"hideMissing,omitempty"`
	ErrorCaption      string            `json:"errorCaption,omitempty"`
	ShowError         bool              `json:"showError,omitempty"`

	// RelocatedFrom is the sheet the source file placed the pivot on,
	// set only when ensureDistinctTargets moved it to a sheet of its own.
	// The Y.Doc bootstrap uses it to insert that new sheet right after
	// the original in tab order. Import-only, so it never goes on the
	// wire.
	RelocatedFrom string `json:"-"`
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
// NumFmt is the value cells' Excel format pattern (e.g. "#,##0.00").
// On import it is the dataField's numFmtId (else its pivotField's),
// resolved to the pattern by omnidoc; on save omnidoc writes it back as
// the dataField numFmtId, adding a custom format record when needed.
type PivotValueFieldDTO struct {
	SourceColumn string `json:"sourceColumn"`
	DisplayName  string `json:"displayName,omitempty"`
	Aggregation  string `json:"aggregation"`
	NumFmt       string `json:"numFmt,omitempty"`
}

// readPivots pulls every pivot definition out of the workbook bytes
// and maps them onto PivotDefinitionDTOs. The omnidoc read
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
func readPivots(ctx context.Context, xlsxBytes []byte) ([]PivotDefinitionDTO, error) {
	ed, err := xlsx.Edit(ctx, xlsxBytes)
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

			CacheFields:       pt.CacheFields,
			ValuesAxis:        pt.ValuesAxis,
			ValuesPosition:    pt.ValuesPosition,
			AxisSort:          pt.AxisSort,
			DataCaption:       pt.DataCaption,
			RowHeaderCaption:  pt.RowHeaderCaption,
			ColHeaderCaption:  pt.ColHeaderCaption,
			GrandTotalCaption: pt.GrandTotalCaption,
			MissingCaption:    pt.MissingCaption,
			HideMissing:       pt.HideMissing,
			ErrorCaption:      pt.ErrorCaption,
			ShowError:         pt.ShowError,
		})
	}
	return out, nil
}

// mapAxisFields converts axis field names (rows/cols/filters) to the
// DTO shape. omnidoc surfaces only the source-column name for axis
// fields; the per-field DisplayName the excelize reader carried
// best-effort is not available (accepted loss — Excel-authored files
// leave it empty in practice).
//
// Empty names are dropped: an axis entry <field x="-2"/> is Excel's
// "Values" placeholder marking where the data fields sit when a pivot
// has more than one, not a source column. omnidoc surfaces it as a
// field named "", which the engine would treat as a real (always-blank)
// grouping column.
func mapAxisFields(in []string) []PivotFieldDTO {
	out := make([]PivotFieldDTO, 0, len(in))
	for _, name := range in {
		if name == "" {
			continue
		}
		out = append(out, PivotFieldDTO{SourceColumn: name})
	}
	return out
}

// pivotSheetKey is the sheet meta key marking a sheet as a pivot's
// output sheet; its value is the pivot ID. Mirrors PIVOT_SHEET_KEY
// (tinycld/calc/lib/pivot/keys.ts).
const pivotSheetKey = "pivotId"

// buildPivotYMap encodes one pivot definition as the Y.Map the client's
// writePivot (tinycld/calc/lib/pivot/y-binding.ts) produces, so the
// client's readPivot and the server's collectPivots both decode it:
// scalars as keys, rows/cols/values/filters as Y.Arrays of Y.Maps,
// filterSelections as a Y.Map of Y.Arrays of strings. Optional strings
// (displayName, numFmt, styleName) are written only when non-empty, and
// so are the file-only facts (cacheFields, the layout keys): see
// PivotDefinitionDTO.
func buildPivotYMap(def PivotDefinitionDTO) *ycrdt.YMap {
	entry := ycrdt.NewYMap(nil)
	entry.Set("sourceRange", def.SourceRange)
	entry.Set("targetSheetName", def.TargetSheetName)
	entry.Set("rows", buildPivotFieldYArray(def.Rows))
	entry.Set("cols", buildPivotFieldYArray(def.Cols))
	entry.Set("values", buildPivotValueYArray(def.Values))
	entry.Set("filters", buildPivotFieldYArray(def.Filters))
	entry.Set("filterSelections", buildFilterSelectionsYMap(def.FilterSelections))
	entry.Set("rowGrandTotals", def.RowGrandTotals)
	entry.Set("colGrandTotals", def.ColGrandTotals)
	entry.Set("rowSubtotals", def.RowSubtotals)
	entry.Set("colSubtotals", def.ColSubtotals)
	if def.StyleName != "" {
		entry.Set("styleName", def.StyleName)
	}
	if len(def.CacheFields) > 0 {
		items := make(ycrdt.ArrayAny, 0, len(def.CacheFields))
		for _, name := range def.CacheFields {
			items = append(items, name)
		}
		entry.Set("cacheFields", newYArrayOf(items))
	}
	if len(def.AxisSort) > 0 {
		sorts := ycrdt.NewYMap(nil)
		for field, order := range def.AxisSort {
			sorts.Set(field, order)
		}
		entry.Set("axisSort", sorts)
	}
	if def.ValuesPosition != 0 {
		entry.Set("valuesPosition", def.ValuesPosition)
	}
	for key, value := range map[string]string{
		"valuesAxis":        def.ValuesAxis,
		"dataCaption":       def.DataCaption,
		"rowHeaderCaption":  def.RowHeaderCaption,
		"colHeaderCaption":  def.ColHeaderCaption,
		"grandTotalCaption": def.GrandTotalCaption,
		"missingCaption":    def.MissingCaption,
		"errorCaption":      def.ErrorCaption,
	} {
		if value != "" {
			entry.Set(key, value)
		}
	}
	if def.HideMissing {
		entry.Set("hideMissing", true)
	}
	if def.ShowError {
		entry.Set("showError", true)
	}
	return entry
}

func buildPivotFieldYArray(fields []PivotFieldDTO) *ycrdt.YArray {
	items := make(ycrdt.ArrayAny, 0, len(fields))
	for _, f := range fields {
		items = append(items, buildPivotFieldYMap(f.SourceColumn, f.DisplayName))
	}
	return newYArrayOf(items)
}

func buildPivotValueYArray(fields []PivotValueFieldDTO) *ycrdt.YArray {
	items := make(ycrdt.ArrayAny, 0, len(fields))
	for _, f := range fields {
		m := buildPivotFieldYMap(f.SourceColumn, f.DisplayName)
		m.Set("aggregation", f.Aggregation)
		if f.NumFmt != "" {
			m.Set("numFmt", f.NumFmt)
		}
		items = append(items, m)
	}
	return newYArrayOf(items)
}

func buildPivotFieldYMap(sourceColumn, displayName string) *ycrdt.YMap {
	m := ycrdt.NewYMap(nil)
	m.Set("sourceColumn", sourceColumn)
	if displayName != "" {
		m.Set("displayName", displayName)
	}
	return m
}

func buildFilterSelectionsYMap(sel map[string][]string) *ycrdt.YMap {
	m := ycrdt.NewYMap(nil)
	for col, vals := range sel {
		if len(vals) == 0 {
			continue
		}
		items := make(ycrdt.ArrayAny, 0, len(vals))
		for _, v := range vals {
			items = append(items, v)
		}
		m.Set(col, newYArrayOf(items))
	}
	return m
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
			NumFmt:       v.NumFmt,
		})
	}
	return out
}

// combineSourceRange rebuilds the combined "<sheet>!<range>" form the
// DTO carries (and the TS side + write path consume). omnidoc
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
// raw by omnidoc, e.g. "average" / "countNums"; excelize's
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
