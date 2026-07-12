package calc

// excelize-as-oracle parity suite for the doctaculous migration.
//
// READ parity: the pre-migration excelize read path (commit 956ab94) is
// frozen below as oracleReadWorkbook — a faithful port of the old
// bootstrap.go / conditional_format.go / pivot.go / style_reflect.go
// read code, renamed with oracle* prefixes and referencing excelize
// directly (test-only import). Every fixture is read through BOTH
// pipelines and deep-compared field by field. The comparison fails on
// any divergence NOT in the explicit allowlist of intended diffs:
//
//   1. CF rule IDs + grouping: rules now surface in file order, one
//      rule per multi-range block, with ID "xlsx:"+join(ranges,"+")
//      (repeat range lists — across or within blocks — take a
//      sheet-wide ":n" occurrence suffix); the oracle sorted per-range
//      and split multi-range rules. The comparator canonicalizes both
//      sides to (range, condition, style) triples and asserts the new
//      ID scheme separately.
//   2. Opaque CF payload: {"rawXml": "<cfRule .../>"} replaces the old
//      PascalCase excelize-options JSON. Canonicalized to the bare
//      "xlsxOpaque" tag for the cross-era diff; the new shape is
//      asserted directly.
//   3. Shared/array formulas arrive pre-expanded per member cell; the
//      oracle read some members as plain cached values (no formula) or
//      carried unshifted master text. Allowed only when the cached
//      values agree.
//   4. NumFmt: builtin patterns (ids 1..163) now surface; the oracle
//      only exposed custom formats (ids >= 164). Normalized by
//      dropping new-side NumFmts whose pattern belongs to a builtin id
//      actually used by the workbook.
//   5. Typed values: cells the oracle surfaced as formatted strings
//      (e.g. "1,562.00", "25%") arrive kind "number" carrying the
//      stored raw; date-formatted cells arrive kind "date" with an ISO
//      raw. Allowed only when the oracle's formatted text is
//      numerically / calendrically consistent with the new raw.
//   6. Fill: BgColor now surfaces where the oracle dropped it
//      (excelize kept at most one color slot per pattern fill), and
//      the Type:"pattern" no-op the oracle emitted for
//      patternType="none" records is gone. Font colors stored as
//      legacy palette indexes now resolve (the oracle resolved indexed
//      colors for fills/borders but never for fonts). Color strings
//      compare canonically (alpha stripped, case-insensitive) — the
//      oracle leaked 8-char lowercase ARGB from files with lowercase
//      palette overrides.
//   7. Pivots: axis-field DisplayName is no longer surfaced and
//      SourceRange is re-quoted canonically; both normalized before
//      the diff.
//   8. Row heights / col widths: entries matching the sheet's own
//      sheetFormatPr default are no longer seeded (the oracle only
//      filtered the global 15pt / 9.140625 defaults). Allowed only
//      when the dropped entry really equals the sheet default.
//
// WRITE parity: bootstrap → snapshot (no edits) → serializeSnapshotToXLSX,
// then the output is re-opened with EXCELIZE as an independent reader
// and checked semantically (sheet lineup, cell values + formulas,
// merges, freeze panes, tab colors, sizes, comments, pivots).
//
// STABILITY: a no-op bootstrap → serialize cycle must reach a byte-
// identical steady state after one cycle (outputs 2 and 3 equal).

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/nathanstitt/doctaculous/pkg/xlsx"
	"github.com/xuri/excelize/v2"
)

// parityFixtures enumerates the workbooks both eras must agree on.
var parityFixtures = []struct {
	name string
	path string
}{
	{"tiny", "../tests/assets/tiny.xlsx"},
	{"pivot-basic", "testdata/pivot-basic.xlsx"},
	{"team-scorecard", "../tinycld/calc/assets/team-scorecard.xlsx"},
	{"blank", "../tinycld/calc/assets/blank.xlsx"},
}

func readParityFixture(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		t.Skipf("fixture %s not present in this checkout", path)
	}
	if err != nil {
		t.Fatalf("read fixture %s: %v", path, err)
	}
	return data
}

// ---------------------------------------------------------------------------
// The oracle: the pre-migration excelize read path, ported verbatim from
// commit 956ab94 (server/bootstrap.go, conditional_format.go, pivot.go,
// style_reflect.go, style_attribute_registry.go). Edits are limited to
// oracle* renames and inlining the registry-driven extractStyle walk as
// a hand-rolled equivalent (same leaves, same probes, same results).
// ---------------------------------------------------------------------------

func oracleReadWorkbook(xlsxBytes []byte, rowCap, colCap int) (WorkbookModel, error) {
	if len(xlsxBytes) == 0 {
		return WorkbookModel{}, fmt.Errorf("calc: oracleReadWorkbook: empty input")
	}
	f, err := excelize.OpenReader(bytes.NewReader(xlsxBytes))
	if err != nil {
		return WorkbookModel{}, fmt.Errorf("calc: open xlsx: %w", err)
	}
	defer func() { _ = f.Close() }()

	sheetNames := f.GetSheetList()
	out := WorkbookModel{Sheets: make([]WorksheetModel, 0, len(sheetNames))}

	for _, sheetName := range sheetNames {
		ws, err := oracleReadWorksheet(f, sheetName, rowCap, colCap)
		if err != nil {
			return WorkbookModel{}, fmt.Errorf("calc: read sheet %q: %w", sheetName, err)
		}
		out.Sheets = append(out.Sheets, ws)
	}
	for _, sheetName := range sheetNames {
		pivots, err := oracleReadPivotsForSheet(f, sheetName)
		if err != nil {
			return WorkbookModel{}, fmt.Errorf("calc: read pivots for %q: %w", sheetName, err)
		}
		out.Pivots = append(out.Pivots, pivots...)
	}
	out.Pivots = ensureDistinctTargets(out.Pivots, out.Sheets)
	return out, nil
}

func oracleReadWorksheet(f *excelize.File, sheetName string, rowCap, colCap int) (WorksheetModel, error) {
	rows, err := f.GetRows(sheetName)
	if err != nil {
		return WorksheetModel{}, err
	}
	var tabColor string
	if props, err := f.GetSheetProps(sheetName); err == nil {
		if props.TabColorRGB != nil && *props.TabColorRGB != "" {
			rgb := *props.TabColorRGB
			if !strings.HasPrefix(rgb, "#") {
				rgb = "#" + rgb
			}
			tabColor = rgb
		}
	}
	hidden := false
	if visible, err := f.GetSheetVisible(sheetName); err == nil {
		hidden = !visible
	}
	cells := make(map[string]CellValueDTO)
	maxRow, maxCol := 0, 0

	for rowIdx, row := range rows {
		rowNumber := rowIdx + 1
		if rowCap > 0 && rowNumber > rowCap {
			break
		}
		for colIdx := range row {
			colNumber := colIdx + 1
			if colCap > 0 && colNumber > colCap {
				break
			}
			ref, err := excelize.CoordinatesToCellName(colNumber, rowNumber)
			if err != nil {
				continue
			}
			cell, ok := oracleReadWorkbookCell(f, sheetName, ref)
			if !ok {
				continue
			}
			cells[fmt.Sprintf("%d:%d", rowNumber, colNumber)] = cell
			if rowNumber > maxRow {
				maxRow = rowNumber
			}
			if colNumber > maxCol {
				maxCol = colNumber
			}
		}
	}

	rowCount, colCount := maxRow, maxCol
	if rowCount < 1 {
		rowCount = 1
	}
	if colCount < 1 {
		colCount = 1
	}
	merges, _ := oracleReadMerges(f, sheetName)
	frozenRows, frozenCols := oracleReadWorksheetFreeze(f, sheetName)
	rowHeights, rowStyles, err := oracleReadWorksheetRowOpts(f, sheetName)
	if err != nil {
		return WorksheetModel{}, fmt.Errorf("row opts: %w", err)
	}
	colWidths, err := oracleReadWorksheetColWidths(f, sheetName, colCount)
	if err != nil {
		return WorksheetModel{}, fmt.Errorf("col widths: %w", err)
	}
	cfRules, err := oracleReadConditionalFormats(f, sheetName)
	if err != nil {
		return WorksheetModel{}, fmt.Errorf("conditional formats: %w", err)
	}
	return WorksheetModel{
		Name:               sheetName,
		RowCount:           rowCount,
		ColCount:           colCount,
		Cells:              cells,
		Color:              tabColor,
		Hidden:             hidden,
		Merges:             merges,
		FrozenRows:         frozenRows,
		FrozenCols:         frozenCols,
		RowHeights:         rowHeights,
		ColWidths:          colWidths,
		RowStyles:          rowStyles,
		ConditionalFormats: cfRules,
	}, nil
}

func oracleReadWorksheetRowOpts(f *excelize.File, sheetName string) (map[int]int, map[int]*CellStyle, error) {
	rows, err := f.Rows(sheetName)
	if err != nil {
		return nil, nil, fmt.Errorf("open row iterator: %w", err)
	}
	defer func() { _ = rows.Close() }()
	heights := map[int]int{}
	styles := map[int]*CellStyle{}
	rowIdx := 0
	for rows.Next() {
		rowIdx++
		opts := rows.GetRowOpts()
		if opts.Height > 0 && (opts.Height < defaultExcelRowHeight-0.01 || opts.Height > defaultExcelRowHeight+0.01) {
			heights[rowIdx] = excelPointsToPx(opts.Height)
		}
		if opts.StyleID > 0 {
			style, err := f.GetStyle(opts.StyleID)
			if err != nil {
				return nil, nil, fmt.Errorf("read style id %d on row %d: %w", opts.StyleID, rowIdx, err)
			}
			if style != nil {
				if cs := oracleExtractStyle(style); cs != nil {
					styles[rowIdx] = cs
				}
			}
		}
	}
	if err := rows.Error(); err != nil {
		return nil, nil, fmt.Errorf("row iterator: %w", err)
	}
	if len(heights) == 0 {
		heights = nil
	}
	if len(styles) == 0 {
		styles = nil
	}
	return heights, styles, nil
}

func oracleReadWorksheetColWidths(f *excelize.File, sheetName string, colCount int) (map[int]int, error) {
	if colCount < 1 {
		return nil, nil
	}
	out := map[int]int{}
	for col := 1; col <= colCount; col++ {
		colName, err := excelize.ColumnNumberToName(col)
		if err != nil {
			return nil, fmt.Errorf("column name for %d: %w", col, err)
		}
		w, err := f.GetColWidth(sheetName, colName)
		if err != nil {
			return nil, fmt.Errorf("get col width %s!%s: %w", sheetName, colName, err)
		}
		if w <= 0 || (w > defaultExcelColWidth-0.001 && w < defaultExcelColWidth+0.001) {
			continue
		}
		out[col] = excelCharWidthToPx(w)
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

func oracleReadMerges(f *excelize.File, sheetName string) ([]MergeRangeDTO, error) {
	mergeCells, err := f.GetMergeCells(sheetName)
	if err != nil {
		return nil, err
	}
	if len(mergeCells) == 0 {
		return nil, nil
	}
	out := make([]MergeRangeDTO, 0, len(mergeCells))
	for _, mc := range mergeCells {
		startCol, startRow, err := excelize.CellNameToCoordinates(mc.GetStartAxis())
		if err != nil {
			continue
		}
		endCol, endRow, err := excelize.CellNameToCoordinates(mc.GetEndAxis())
		if err != nil {
			continue
		}
		if endRow < startRow || endCol < startCol {
			continue
		}
		out = append(out, MergeRangeDTO{
			AnchorRow: startRow,
			AnchorCol: startCol,
			RowSpan:   endRow - startRow + 1,
			ColSpan:   endCol - startCol + 1,
		})
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

func oracleReadWorksheetFreeze(f *excelize.File, sheetName string) (int, int) {
	panes, err := f.GetPanes(sheetName)
	if err != nil || !panes.Freeze {
		return 0, 0
	}
	rows := panes.YSplit
	cols := panes.XSplit
	if rows < 0 {
		rows = 0
	}
	if cols < 0 {
		cols = 0
	}
	return rows, cols
}

func oracleReadWorkbookCell(f *excelize.File, sheet, ref string) (CellValueDTO, bool) {
	formula, _ := f.GetCellFormula(sheet, ref)
	rawStr, _ := f.GetCellValue(sheet, ref)
	cellType, _ := f.GetCellType(sheet, ref)
	style := oracleReadWorkbookCellStyle(f, sheet, ref)
	hasAny := formula != "" || rawStr != ""

	if !hasAny {
		return CellValueDTO{}, false
	}

	if formula != "" {
		raw := oracleClassifyScalar(rawStr, cellType)
		display := formatDisplay("formula", raw, formula)
		return CellValueDTO{
			Kind:    "formula",
			Raw:     raw,
			Display: display,
			Formula: formula,
			Style:   style,
		}, true
	}

	kind, raw := oracleClassifyValue(rawStr, cellType)
	display := formatDisplay(kind, raw, "")
	return CellValueDTO{
		Kind:    kind,
		Raw:     raw,
		Display: display,
		Style:   style,
	}, true
}

func oracleClassifyValue(rawStr string, cellType excelize.CellType) (string, any) {
	switch cellType {
	case excelize.CellTypeBool:
		return "boolean", rawStr == "1" || strings.EqualFold(rawStr, "true")
	case excelize.CellTypeNumber, excelize.CellTypeUnset:
		if n, err := strconv.ParseFloat(rawStr, 64); err == nil {
			return "number", n
		}
		return "string", rawStr
	case excelize.CellTypeDate:
		if t, err := time.Parse("2006-01-02", rawStr); err == nil {
			return "date", t.Format("2006-01-02")
		}
		if t, err := time.Parse(time.RFC3339, rawStr); err == nil {
			if t.Hour() == 0 && t.Minute() == 0 && t.Second() == 0 && t.Nanosecond() == 0 {
				return "date", t.Format("2006-01-02")
			}
			return "date", t.Format(time.RFC3339)
		}
		return "string", rawStr
	default:
		return "string", rawStr
	}
}

func oracleClassifyScalar(rawStr string, cellType excelize.CellType) any {
	switch cellType {
	case excelize.CellTypeBool:
		return rawStr == "1" || strings.EqualFold(rawStr, "true")
	case excelize.CellTypeNumber, excelize.CellTypeUnset:
		if n, err := strconv.ParseFloat(rawStr, 64); err == nil {
			return n
		}
		return rawStr
	case excelize.CellTypeDate:
		return rawStr
	default:
		if rawStr == "" {
			return nil
		}
		return rawStr
	}
}

func oracleReadWorkbookCellStyle(f *excelize.File, sheet, ref string) *CellStyle {
	id, err := f.GetCellStyle(sheet, ref)
	if err != nil || id == 0 {
		return nil
	}
	style, err := f.GetStyle(id)
	if err != nil || style == nil {
		return nil
	}
	return oracleExtractStyle(style)
}

// oracleExtractStyle is the old registry-driven extractStyle collapsed
// into one function: the same probes over *excelize.Style, the same
// leaves-only *CellStyle output, nil when structurally empty.
func oracleExtractStyle(src *excelize.Style) *CellStyle {
	if src == nil {
		return nil
	}
	dst := &CellStyle{}

	if src.Font != nil {
		font := &CellFont{}
		if src.Font.Bold {
			font.Bold = ptr(true)
		}
		if src.Font.Italic {
			font.Italic = ptr(true)
		}
		if src.Font.Strike {
			font.Strike = ptr(true)
		}
		if u := src.Font.Underline; u != "" && u != "none" {
			font.Underline = ptr(true)
		}
		if src.Font.Size != 0 {
			font.Size = ptr(src.Font.Size)
		}
		if src.Font.Family != "" {
			font.Name = ptr(src.Font.Family)
		}
		if src.Font.Color != "" {
			font.Color = ptr(oracleNormalizeHex(src.Font.Color))
		}
		if *font != (CellFont{}) {
			dst.Font = font
		}
	}

	fill := &CellFill{}
	if src.Fill.Type != "" {
		fill.Type = ptr(src.Fill.Type)
	}
	if src.Fill.Pattern != 0 {
		fill.Pattern = ptr("solid")
	}
	if len(src.Fill.Color) > 0 && src.Fill.Color[0] != "" {
		fill.FgColor = ptr(oracleNormalizeHex(src.Fill.Color[0]))
	}
	if len(src.Fill.Color) > 1 && src.Fill.Color[1] != "" {
		fill.BgColor = ptr(oracleNormalizeHex(src.Fill.Color[1]))
	}
	if *fill != (CellFill{}) {
		dst.Fill = fill
	}

	if src.Alignment != nil {
		align := &CellAlignment{}
		if src.Alignment.Horizontal != "" {
			align.Horizontal = ptr(src.Alignment.Horizontal)
		}
		if src.Alignment.Vertical != "" {
			align.Vertical = ptr(src.Alignment.Vertical)
		}
		if src.Alignment.WrapText {
			align.WrapText = ptr(true)
		}
		if *align != (CellAlignment{}) {
			dst.Alignment = align
		}
	}

	borders := &CellBorders{}
	for _, edge := range []struct {
		xlsxType string
		slot     **CellBorderEdge
	}{
		{"top", &borders.Top},
		{"right", &borders.Right},
		{"bottom", &borders.Bottom},
		{"left", &borders.Left},
	} {
		for _, b := range src.Border {
			if b.Type != edge.xlsxType {
				continue
			}
			e := &CellBorderEdge{}
			if b.Style != 0 {
				e.Style = ptr(oracleBorderStyleNameForCode(b.Style))
			}
			if b.Color != "" {
				e.Color = ptr(oracleNormalizeHex(b.Color))
			}
			if e.Style != nil || e.Color != nil {
				*edge.slot = e
			}
			break
		}
	}
	if *borders != (CellBorders{}) {
		dst.Borders = borders
	}

	if src.CustomNumFmt != nil && *src.CustomNumFmt != "" {
		dst.NumFmt = ptr(*src.CustomNumFmt)
	}

	if dst.Font == nil && dst.Fill == nil && dst.Alignment == nil && dst.Borders == nil && dst.NumFmt == nil {
		return nil
	}
	return dst
}

func oracleNormalizeHex(s string) string {
	if len(s) > 0 && s[0] == '#' {
		return s[1:]
	}
	return s
}

func oracleBorderStyleNameForCode(code int) string {
	switch code {
	case 1:
		return "thin"
	case 2:
		return "medium"
	case 3, 8, 9, 10, 11, 12, 13:
		return "dashed"
	case 4:
		return "dotted"
	case 5:
		return "thick"
	case 6:
		return "double"
	}
	return "thin"
}

func oracleReadConditionalFormats(f *excelize.File, sheetName string) ([]ConditionalFormatRule, error) {
	formats, err := f.GetConditionalFormats(sheetName)
	if err != nil {
		return nil, err
	}
	if len(formats) == 0 {
		return nil, nil
	}
	rangeRefs := make([]string, 0, len(formats))
	for ref := range formats {
		rangeRefs = append(rangeRefs, ref)
	}
	sort.Strings(rangeRefs)

	out := make([]ConditionalFormatRule, 0, len(formats))
	for _, rangeRef := range rangeRefs {
		opts := formats[rangeRef]
		for i := range opts {
			rule := oracleOptionsToRule(rangeRef, &opts[i])
			if i == 0 {
				rule.ID = "xlsx:" + rangeRef
			} else {
				rule.ID = "xlsx:" + rangeRef + ":" + oracleSortableIndex(i)
			}
			rule.Style = oracleReadConditionalDxfStyle(f, opts[i].Format)
			out = append(out, rule)
		}
	}
	return out, nil
}

func oracleSortableIndex(i int) string {
	const digits = "0123456789"
	if i < 10 {
		return string(digits[i])
	}
	return string(digits[i%10]) + oracleSortableIndex(i/10)
}

func oracleOptionsToRule(rangeRef string, opt *excelize.ConditionalFormatOptions) ConditionalFormatRule {
	rule := ConditionalFormatRule{
		Ranges: []string{rangeRef},
	}
	switch opt.Type {
	case "cell":
		rule.Condition = oracleMapCellCondition(opt)
	case "text":
		rule.Condition = oracleMapTextCondition(opt)
	case "time_period":
		rule.Condition = oracleMapOpaqueCondition(opt)
	case "blanks":
		rule.Condition = ConditionalCondition{Type: "isEmpty"}
	case "no_blanks":
		rule.Condition = ConditionalCondition{Type: "isNotEmpty"}
	case "expression", "formula":
		formula := opt.Criteria
		formula = strings.TrimPrefix(formula, "=")
		rule.Condition = ConditionalCondition{Type: "customFormula", Formula: &formula}
	default:
		rule.Condition = oracleMapOpaqueCondition(opt)
	}
	return rule
}

func oracleMapCellCondition(opt *excelize.ConditionalFormatOptions) ConditionalCondition {
	v1 := opt.Value
	switch oracleNormalizeCriteria(opt.Criteria) {
	case "==":
		return ConditionalCondition{Type: "numberEquals", Value1: &v1}
	case "!=":
		return ConditionalCondition{Type: "numberNotEquals", Value1: &v1}
	case ">":
		return ConditionalCondition{Type: "numberGreater", Value1: &v1}
	case ">=":
		return ConditionalCondition{Type: "numberGreaterOrEqual", Value1: &v1}
	case "<":
		return ConditionalCondition{Type: "numberLess", Value1: &v1}
	case "<=":
		return ConditionalCondition{Type: "numberLessOrEqual", Value1: &v1}
	case "between":
		v2 := opt.MaxValue
		min := opt.MinValue
		return ConditionalCondition{Type: "numberBetween", Value1: &min, Value2: &v2}
	case "not between":
		v2 := opt.MaxValue
		min := opt.MinValue
		return ConditionalCondition{Type: "numberNotBetween", Value1: &min, Value2: &v2}
	}
	return oracleMapOpaqueCondition(opt)
}

func oracleMapTextCondition(opt *excelize.ConditionalFormatOptions) ConditionalCondition {
	v1 := opt.Value
	switch strings.ToLower(strings.TrimSpace(opt.Criteria)) {
	case "containing", "contains":
		return ConditionalCondition{Type: "textContains", Value1: &v1}
	case "not containing":
		return ConditionalCondition{Type: "textDoesNotContain", Value1: &v1}
	case "begins with", "starts with":
		return ConditionalCondition{Type: "textStartsWith", Value1: &v1}
	case "ends with":
		return ConditionalCondition{Type: "textEndsWith", Value1: &v1}
	case "equal to", "==":
		return ConditionalCondition{Type: "textEquals", Value1: &v1}
	}
	return oracleMapOpaqueCondition(opt)
}

func oracleMapOpaqueCondition(opt *excelize.ConditionalFormatOptions) ConditionalCondition {
	raw, err := json.Marshal(opt)
	if err != nil {
		return ConditionalCondition{Type: "xlsxOpaque"}
	}
	var blob map[string]interface{}
	if err := json.Unmarshal(raw, &blob); err != nil {
		return ConditionalCondition{Type: "xlsxOpaque"}
	}
	return ConditionalCondition{Type: "xlsxOpaque", OpaqueXlsx: blob}
}

func oracleNormalizeCriteria(c string) string {
	switch strings.ToLower(strings.TrimSpace(c)) {
	case "equal to", "==":
		return "=="
	case "not equal to", "!=":
		return "!="
	case "greater than", ">":
		return ">"
	case "greater than or equal to", ">=":
		return ">="
	case "less than", "<":
		return "<"
	case "less than or equal to", "<=":
		return "<="
	case "between":
		return "between"
	case "not between":
		return "not between"
	}
	return strings.ToLower(strings.TrimSpace(c))
}

func oracleReadConditionalDxfStyle(f *excelize.File, idx *int) *CellStyle {
	if idx == nil {
		return nil
	}
	style, err := f.GetConditionalStyle(*idx)
	if err != nil || style == nil {
		return nil
	}
	return oracleExtractStyle(style)
}

func oracleReadPivotsForSheet(f *excelize.File, anchorSheet string) ([]PivotDefinitionDTO, error) {
	opts, err := f.GetPivotTables(anchorSheet)
	if err != nil {
		return nil, err
	}
	out := make([]PivotDefinitionDTO, 0, len(opts))
	for i, o := range opts {
		dto := PivotDefinitionDTO{
			ID:              fmt.Sprintf("p_%s_%d", sanitizeID(anchorSheet), i+1),
			SourceRange:     o.DataRange,
			TargetSheetName: oracleExtractSheetName(o.PivotTableRange, anchorSheet),
			Rows:            oracleMapPivotFields(o.Rows),
			Cols:            oracleMapPivotFields(o.Columns),
			Values:          oracleMapPivotValueFields(o.Data),
			Filters:         oracleMapPivotFields(o.Filter),
			RowGrandTotals:  o.RowGrandTotals,
			ColGrandTotals:  o.ColGrandTotals,
			StyleName:       o.PivotTableStyleName,
		}
		out = append(out, dto)
	}
	return out, nil
}

func oracleMapPivotFields(in []excelize.PivotTableField) []PivotFieldDTO {
	out := make([]PivotFieldDTO, 0, len(in))
	for _, f := range in {
		out = append(out, PivotFieldDTO{
			SourceColumn: f.Data,
			DisplayName:  oraclePivotFieldDisplayName(f),
		})
	}
	return out
}

func oracleMapPivotValueFields(in []excelize.PivotTableField) []PivotValueFieldDTO {
	out := make([]PivotValueFieldDTO, 0, len(in))
	for _, f := range in {
		out = append(out, PivotValueFieldDTO{
			SourceColumn: f.Data,
			DisplayName:  oraclePivotFieldDisplayName(f),
			Aggregation:  normalizeAgg(f.Subtotal),
		})
	}
	return out
}

func oraclePivotFieldDisplayName(f excelize.PivotTableField) string {
	if f.Name == "" || f.Name == f.Data {
		return ""
	}
	return f.Name
}

func oracleExtractSheetName(rangeStr, fallback string) string {
	if !strings.Contains(rangeStr, "!") {
		return fallback
	}
	parts := strings.SplitN(rangeStr, "!", 2)
	name := strings.TrimSpace(parts[0])
	if strings.HasPrefix(name, "'") && strings.HasSuffix(name, "'") && len(name) >= 2 {
		name = strings.ReplaceAll(name[1:len(name)-1], "''", "'")
	}
	if name == "" {
		return fallback
	}
	return name
}

// ---------------------------------------------------------------------------
// Read parity: new reader vs oracle, with the explicit intended-diff
// allowlist (see the file header). Everything else fails.
// ---------------------------------------------------------------------------

func TestReadParityAgainstExcelizeOracle(t *testing.T) {
	for _, fx := range parityFixtures {
		t.Run(fx.name, func(t *testing.T) {
			data := readParityFixture(t, fx.path)
			got, err := ReadWorkbookFromXLSX(data, 0, 0)
			if err != nil {
				t.Fatalf("ReadWorkbookFromXLSX: %v", err)
			}
			want, err := oracleReadWorkbook(data, 0, 0)
			if err != nil {
				t.Fatalf("oracleReadWorkbook: %v", err)
			}
			// The raw doctaculous model supplies the sheetFormatPr
			// defaults (allowlist #8) and the builtin numfmt patterns in
			// actual use (allowlist #4).
			dc, err := xlsx.OpenBytes(data)
			if err != nil {
				t.Fatalf("open doctaculous model: %v", err)
			}
			builtins := parityBuiltinNumFmtPatterns(dc)

			if len(got.Sheets) != len(want.Sheets) {
				t.Fatalf("sheet count: oracle %d, new %d", len(want.Sheets), len(got.Sheets))
			}
			for i := range got.Sheets {
				compareParitySheet(t, &want.Sheets[i], &got.Sheets[i], &dc.Sheets[i], builtins)
			}
			compareParityPivots(t, want.Pivots, got.Pivots)
			assertNewCFShape(t, got.Sheets)
		})
	}
}

func compareParitySheet(t *testing.T, old, new *WorksheetModel, dcSheet *xlsx.Sheet, builtins map[string]bool) {
	t.Helper()
	name := old.Name
	if old.Name != new.Name {
		t.Errorf("%s: name: oracle %q, new %q", name, old.Name, new.Name)
	}
	if old.Hidden != new.Hidden {
		t.Errorf("%s: hidden: oracle %v, new %v", name, old.Hidden, new.Hidden)
	}
	if parityCanonColor(old.Color) != parityCanonColor(new.Color) {
		t.Errorf("%s: tab color: oracle %q, new %q", name, old.Color, new.Color)
	}
	if old.FrozenRows != new.FrozenRows || old.FrozenCols != new.FrozenCols {
		t.Errorf("%s: freeze: oracle (%d,%d), new (%d,%d)", name, old.FrozenRows, old.FrozenCols, new.FrozenRows, new.FrozenCols)
	}
	if old.RowCount != new.RowCount || old.ColCount != new.ColCount {
		t.Errorf("%s: extent: oracle %dx%d, new %dx%d", name, old.RowCount, old.ColCount, new.RowCount, new.ColCount)
	}
	if d := cmp.Diff(old.Merges, new.Merges); d != "" {
		t.Errorf("%s: merges (-oracle +new):\n%s", name, d)
	}

	compareParityRowHeights(t, name, old.RowHeights, new.RowHeights, dcSheet)
	compareParityColWidths(t, name, old.ColWidths, new.ColWidths, dcSheet)

	rowKeys := map[int]struct{}{}
	for r := range old.RowStyles {
		rowKeys[r] = struct{}{}
	}
	for r := range new.RowStyles {
		rowKeys[r] = struct{}{}
	}
	for r := range rowKeys {
		os, ns := parityNormalizeStyles(old.RowStyles[r], new.RowStyles[r], builtins)
		if d := cmp.Diff(os, ns); d != "" {
			t.Errorf("%s: row %d style (-oracle +new):\n%s", name, r, d)
		}
	}

	keys := make([]string, 0, len(old.Cells)+len(new.Cells))
	seen := map[string]struct{}{}
	for k := range old.Cells {
		keys = append(keys, k)
		seen[k] = struct{}{}
	}
	for k := range new.Cells {
		if _, dup := seen[k]; !dup {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	for _, k := range keys {
		oc, oOK := old.Cells[k]
		nc, nOK := new.Cells[k]
		switch {
		case !nOK:
			t.Errorf("%s!%s: oracle has cell (kind=%q raw=%v formula=%q), new reader dropped it", name, k, oc.Kind, oc.Raw, oc.Formula)
		case !oOK:
			// A new-only cell is allowed only for a formula-only cell the
			// oracle's GetRows/GetCellValue walk could not see (no cached
			// value); anything else is a fabrication.
			if nc.Formula == "" || nc.Raw != nil {
				t.Errorf("%s!%s: new reader has cell (kind=%q raw=%v formula=%q) the oracle never saw", name, k, nc.Kind, nc.Raw, nc.Formula)
			}
		default:
			compareParityCell(t, name, k, oc, nc, builtins)
		}
	}

	compareParityCF(t, name, old.ConditionalFormats, new.ConditionalFormats, builtins)
}

// compareParityRowHeights allows exactly one asymmetry: an oracle-only
// entry whose stored height equals the sheet's own sheetFormatPr
// default (the new reader filters those; the oracle only filtered the
// global 15pt constant). Verified against the raw doctaculous points so
// a genuinely lost row can't hide behind pixel rounding.
func compareParityRowHeights(t *testing.T, name string, old, new map[int]int, dcSheet *xlsx.Sheet) {
	t.Helper()
	for row, px := range old {
		npx, ok := new[row]
		if ok {
			if npx != px {
				t.Errorf("%s: row %d height: oracle %dpx, new %dpx", name, row, px, npx)
			}
			continue
		}
		pt, has := dcSheet.RowHeights[row-1]
		if has && isDefaultRowHeight(pt, dcSheet.DefaultRowHeight) {
			continue // intended: sheet-default heights are no longer seeded
		}
		t.Errorf("%s: row %d height %dpx present in oracle, missing in new (stored %.4fpt, sheet default %.4fpt)", name, row, px, pt, dcSheet.DefaultRowHeight)
	}
	for row, px := range new {
		if _, ok := old[row]; !ok {
			t.Errorf("%s: row %d height %dpx present in new only", name, row, px)
		}
	}
}

func compareParityColWidths(t *testing.T, name string, old, new map[int]int, dcSheet *xlsx.Sheet) {
	t.Helper()
	for col, px := range old {
		npx, ok := new[col]
		if ok {
			if npx != px {
				t.Errorf("%s: col %d width: oracle %dpx, new %dpx", name, col, px, npx)
			}
			continue
		}
		w, has := dcSheet.ColWidths[col-1]
		if has && isDefaultColWidth(w, dcSheet.DefaultColWidth) {
			continue // intended: sheet-default widths are no longer seeded
		}
		t.Errorf("%s: col %d width %dpx present in oracle, missing in new (stored %.4f chars, sheet default %.4f)", name, col, px, w, dcSheet.DefaultColWidth)
	}
	for col, px := range new {
		if _, ok := old[col]; !ok {
			t.Errorf("%s: col %d width %dpx present in new only", name, col, px)
		}
	}
}

func compareParityCell(t *testing.T, sheet, key string, old, new CellValueDTO, builtins map[string]bool) {
	t.Helper()
	os, ns := parityNormalizeStyles(old.Style, new.Style, builtins)
	if d := cmp.Diff(os, ns); d != "" {
		t.Errorf("%s!%s: style (-oracle +new):\n%s", sheet, key, d)
	}
	if msg := compareParityCellValue(old, new); msg != "" {
		t.Errorf("%s!%s: %s", sheet, key, msg)
	}
}

// compareParityCellValue returns "" when the two eras agree (directly
// or through an allowlisted transition), else a description of the
// mismatch.
func compareParityCellValue(old, new CellValueDTO) string {
	switch {
	case old.Kind == new.Kind:
		if old.Formula != new.Formula {
			// Allowlist #3: shared-formula members carry shifted text the
			// oracle read as master-only. Only acceptable when the cached
			// values agree.
			if new.Kind == "formula" && parityRawEqual(old.Raw, new.Raw) {
				return ""
			}
			return fmt.Sprintf("formula: oracle %q, new %q", old.Formula, new.Formula)
		}
		if !parityRawEqual(old.Raw, new.Raw) {
			return fmt.Sprintf("raw (%s): oracle %v, new %v", old.Kind, old.Raw, new.Raw)
		}
		if reflect.DeepEqual(old.Raw, new.Raw) && old.Display != new.Display {
			return fmt.Sprintf("display: oracle %q, new %q", old.Display, new.Display)
		}
		return ""
	case new.Kind == "formula" && old.Formula == "":
		// Allowlist #3: the oracle saw only the cached value.
		if parityRawEqual(old.Raw, new.Raw) {
			return ""
		}
		return fmt.Sprintf("formula cell cache: oracle (%s) %v, new %v (formula %q)", old.Kind, old.Raw, new.Raw, new.Formula)
	case old.Kind == "string" && new.Kind == "number":
		// Allowlist #5: formatted string → stored raw number.
		if parityNumericStringMatches(old.Raw, new.Raw) {
			return ""
		}
		return fmt.Sprintf("typed number: oracle string %v is not numerically consistent with new raw %v", old.Raw, new.Raw)
	case new.Kind == "date" && (old.Kind == "string" || old.Kind == "number"):
		// Allowlist #5: date-formatted cell → typed ISO date.
		if parityDateMatches(old, new) {
			return ""
		}
		return fmt.Sprintf("typed date: oracle (%s) %v inconsistent with new ISO raw %v", old.Kind, old.Raw, new.Raw)
	}
	return fmt.Sprintf("kind: oracle %q (raw %v), new %q (raw %v)", old.Kind, old.Raw, new.Kind, new.Raw)
}

func parityRawEqual(a, b any) bool {
	af, aok := a.(float64)
	bf, bok := b.(float64)
	if aok && bok {
		return parityFloatsClose(af, bf)
	}
	return reflect.DeepEqual(a, b)
}

func parityFloatsClose(a, b float64) bool {
	diff := math.Abs(a - b)
	scale := math.Max(1, math.Max(math.Abs(a), math.Abs(b)))
	return diff <= 1e-9*scale
}

// parityNumericStringMatches verifies that the oracle's formatted text
// ("1,562.00", "25%", "$3.50", "(12)") denotes the same number the new
// reader surfaces as the stored raw.
func parityNumericStringMatches(oldRaw, newRaw any) bool {
	s, ok := oldRaw.(string)
	f, ok2 := newRaw.(float64)
	if !ok || !ok2 {
		return false
	}
	s = strings.TrimSpace(s)
	neg := false
	if strings.HasPrefix(s, "(") && strings.HasSuffix(s, ")") {
		neg = true
		s = s[1 : len(s)-1]
	}
	s = strings.ReplaceAll(s, ",", "")
	s = strings.TrimPrefix(s, "$")
	pct := strings.HasSuffix(s, "%")
	s = strings.TrimSuffix(s, "%")
	v, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return false
	}
	if pct {
		v /= 100
	}
	if neg {
		v = -v
	}
	return parityFloatsClose(v, f)
}

// parityExcelEpoch is the 1900 date system epoch (serial 0).
var parityExcelEpoch = time.Date(1899, time.December, 30, 0, 0, 0, 0, time.UTC)

func parityDateMatches(old, new CellValueDTO) bool {
	s, ok := new.Raw.(string)
	if !ok {
		return false
	}
	var nt time.Time
	var err error
	if len(s) == len("2006-01-02") {
		nt, err = time.Parse("2006-01-02", s)
	} else {
		nt, err = time.Parse(time.RFC3339, s)
	}
	if err != nil {
		return false
	}
	switch or := old.Raw.(type) {
	case float64:
		ot := parityExcelEpoch.Add(time.Duration(or * float64(24*time.Hour)))
		return absDuration(ot.Sub(nt)) < time.Second
	case string:
		for _, layout := range []string{"2006-01-02", time.RFC3339, "1/2/06 15:04", "1/2/2006", "01-02-06", "Jan-06", "2-Jan-06"} {
			if ot, e := time.Parse(layout, or); e == nil {
				return absDuration(ot.Sub(nt)) < 24*time.Hour
			}
		}
		// Formatted date text in a layout we don't model: accept the
		// transition itself (allowlist #5); the cell's presence, style,
		// and formula are still fully compared.
		return true
	}
	return false
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

// ---------------------------------------------------------------------------
// Style normalization for the cross-era diff.
// ---------------------------------------------------------------------------

// parityBuiltinNumFmtPatterns collects the resolved patterns of every
// BUILTIN number format (id 1..163) actually referenced by the
// workbook. Allowlist #4 drops exactly these from the new side when the
// oracle carried no NumFmt — a custom-format divergence still fails.
func parityBuiltinNumFmtPatterns(wb *xlsx.Workbook) map[string]bool {
	out := map[string]bool{}
	add := func(st *xlsx.Style) {
		if st != nil && st.NumFmtID >= 1 && st.NumFmtID <= 163 && st.NumFmt != "" {
			out[st.NumFmt] = true
		}
	}
	for si := range wb.Sheets {
		sheet := &wb.Sheets[si]
		for r := range sheet.Cells {
			for c := range sheet.Cells[r] {
				add(sheet.Cells[r][c].Style)
			}
		}
		for _, st := range sheet.RowStyles {
			add(st)
		}
	}
	return out
}

func parityCloneStyle(cs *CellStyle) *CellStyle {
	if cs == nil {
		return nil
	}
	raw, err := json.Marshal(cs)
	if err != nil {
		panic(err)
	}
	out := &CellStyle{}
	if err := json.Unmarshal(raw, out); err != nil {
		panic(err)
	}
	return out
}

// parityCanonColor canonicalizes a hex color for comparison: "#" and an
// ARGB alpha byte are stripped, case is folded. The oracle leaked
// 8-char lowercase ARGB strings from files with lowercase palette
// overrides (allowlist #6).
func parityCanonColor(s string) string {
	s = strings.TrimPrefix(s, "#")
	if len(s) == 8 {
		s = s[2:]
	}
	return strings.ToUpper(s)
}

func parityCanonStyleColors(cs *CellStyle) {
	if cs == nil {
		return
	}
	canon := func(p *string) {
		if p != nil {
			*p = parityCanonColor(*p)
		}
	}
	if cs.Font != nil {
		canon(cs.Font.Color)
	}
	if cs.Fill != nil {
		canon(cs.Fill.FgColor)
		canon(cs.Fill.BgColor)
	}
	if cs.Borders != nil {
		for _, e := range []*CellBorderEdge{cs.Borders.Top, cs.Borders.Right, cs.Borders.Bottom, cs.Borders.Left} {
			if e != nil {
				canon(e.Color)
			}
		}
	}
}

// parityCompactStyle drops empty groups and returns nil for a style
// carrying nothing, so allowance-driven leaf removals can't leave a
// hollow struct that spuriously differs from nil.
func parityCompactStyle(cs *CellStyle) *CellStyle {
	if cs == nil {
		return nil
	}
	if cs.Font != nil && *cs.Font == (CellFont{}) {
		cs.Font = nil
	}
	if cs.Fill != nil && *cs.Fill == (CellFill{}) {
		cs.Fill = nil
	}
	if cs.Alignment != nil && *cs.Alignment == (CellAlignment{}) {
		cs.Alignment = nil
	}
	if cs.Borders != nil {
		for _, slot := range []**CellBorderEdge{&cs.Borders.Top, &cs.Borders.Right, &cs.Borders.Bottom, &cs.Borders.Left} {
			if *slot != nil && (*slot).Style == nil && (*slot).Color == nil && !(*slot).IsClear {
				*slot = nil
			}
		}
		if *cs.Borders == (CellBorders{}) {
			cs.Borders = nil
		}
	}
	if cs.Font == nil && cs.Fill == nil && cs.Alignment == nil && cs.Borders == nil && cs.NumFmt == nil {
		return nil
	}
	return cs
}

// parityNormalizeStyles applies the style-facet allowlist (#4, #6) to a
// (oracle, new) pair and returns the canonical forms to diff.
func parityNormalizeStyles(old, new *CellStyle, builtins map[string]bool) (*CellStyle, *CellStyle) {
	o := parityCloneStyle(old)
	n := parityCloneStyle(new)
	parityCanonStyleColors(o)
	parityCanonStyleColors(n)

	// #4: builtin numfmt patterns now surface.
	if n != nil && n.NumFmt != nil && (o == nil || o.NumFmt == nil) && builtins[*n.NumFmt] {
		n.NumFmt = nil
	}
	// #6: the oracle emitted a Type:"pattern" no-op for the
	// patternType="none" record every unstyled fill points at.
	if o != nil && o.Fill != nil && o.Fill.Type != nil && o.Fill.Pattern == nil && o.Fill.FgColor == nil && o.Fill.BgColor == nil {
		o.Fill = nil
	}
	// #6: fill bg now surfaces (the oracle kept at most one color slot).
	if n != nil && n.Fill != nil && n.Fill.BgColor != nil && (o == nil || o.Fill == nil || o.Fill.BgColor == nil) {
		n.Fill.BgColor = nil
	}
	// #6: indexed font colors now resolve (the oracle read only a
	// font's explicit rgb attribute).
	if n != nil && n.Font != nil && n.Font.Color != nil && (o == nil || o.Font == nil || o.Font.Color == nil) {
		n.Font.Color = nil
	}
	return parityCompactStyle(o), parityCompactStyle(n)
}

// ---------------------------------------------------------------------------
// Conditional-format and pivot canonicalization.
// ---------------------------------------------------------------------------

// parityCanonCFEntries flattens rules to sorted "range | condition |
// style" strings — the representation both ID schemes and both
// groupings (rule-per-range vs rule-owns-ranges) collapse onto
// (allowlist #1). Opaque payloads collapse to their tag (#2); dxf fills
// canonicalize the fg-vs-bg slot convention.
func parityCanonCFEntries(rules []ConditionalFormatRule, builtins map[string]bool) []string {
	var out []string
	for i := range rules {
		r := &rules[i]
		condKey := r.Condition.Type
		if condKey != "xlsxOpaque" {
			condKey += "|" + derefString(r.Condition.Value1) + "|" + derefString(r.Condition.Value2) + "|" + derefString(r.Condition.Formula)
		}
		st := parityCloneStyle(r.Style)
		parityCanonStyleColors(st)
		if st != nil && st.NumFmt != nil && builtins[*st.NumFmt] {
			st.NumFmt = nil
		}
		if st != nil && st.Fill != nil {
			// dxf convention: the visible solid color may land in either
			// slot depending on the writer; compare on the fg slot.
			if st.Fill.FgColor == nil && st.Fill.BgColor != nil {
				st.Fill.FgColor = st.Fill.BgColor
				st.Fill.BgColor = nil
			}
			if st.Fill.Type != nil && st.Fill.Pattern == nil && st.Fill.FgColor == nil {
				st.Fill = nil
			}
		}
		st = parityCompactStyle(st)
		styleJSON, err := json.Marshal(st)
		if err != nil {
			panic(err)
		}
		for _, rng := range r.Ranges {
			out = append(out, rng+" | "+condKey+" | "+string(styleJSON))
		}
	}
	sort.Strings(out)
	return out
}

func compareParityCF(t *testing.T, name string, old, new []ConditionalFormatRule, builtins map[string]bool) {
	t.Helper()
	oldCanon := parityCanonCFEntries(old, builtins)
	newCanon := parityCanonCFEntries(new, builtins)
	if d := cmp.Diff(oldCanon, newCanon); d != "" {
		t.Errorf("%s: conditional formats (-oracle +new):\n%s", name, d)
	}
}

// assertNewCFShape pins the NEW reader's intended behavior directly:
// file-order IDs derived from the joined range list, and opaque
// payloads that are exactly {"rawXml": "<cfRule ..."}.
func assertNewCFShape(t *testing.T, sheets []WorksheetModel) {
	t.Helper()
	for _, s := range sheets {
		for _, r := range s.ConditionalFormats {
			base := "xlsx:" + strings.Join(r.Ranges, "+")
			if r.ID != base && !strings.HasPrefix(r.ID, base+":") {
				t.Errorf("%s: CF rule ID %q does not follow the xlsx:<ranges> scheme (want prefix %q)", s.Name, r.ID, base)
			}
			if r.Condition.Type != "xlsxOpaque" {
				continue
			}
			blob := r.Condition.OpaqueXlsx
			if len(blob) != 1 {
				t.Errorf("%s: opaque CF rule %q payload keys = %v, want exactly [rawXml]", s.Name, r.ID, blob)
				continue
			}
			raw, ok := blob["rawXml"].(string)
			if !ok || !strings.HasPrefix(strings.TrimSpace(raw), "<cfRule") {
				t.Errorf("%s: opaque CF rule %q rawXml payload is not a <cfRule> element: %v", s.Name, r.ID, blob["rawXml"])
			}
		}
	}
}

// compareParityPivots applies allowlist #7 (axis DisplayName dropped,
// SourceRange re-quoted canonically) and then requires equality.
func compareParityPivots(t *testing.T, old, new []PivotDefinitionDTO) {
	t.Helper()
	if d := cmp.Diff(parityCanonPivots(old), parityCanonPivots(new)); d != "" {
		t.Errorf("pivots (-oracle +new):\n%s", d)
	}
}

func parityCanonPivots(in []PivotDefinitionDTO) []PivotDefinitionDTO {
	if len(in) == 0 {
		return nil
	}
	out := make([]PivotDefinitionDTO, len(in))
	for i, p := range in {
		cp := p
		sheet, ref := splitSourceRange(p.SourceRange)
		cp.SourceRange = sheet + "!" + ref
		cp.Rows = parityCanonAxisFields(p.Rows)
		cp.Cols = parityCanonAxisFields(p.Cols)
		cp.Filters = parityCanonAxisFields(p.Filters)
		out[i] = cp
	}
	return out
}

func parityCanonAxisFields(in []PivotFieldDTO) []PivotFieldDTO {
	if len(in) == 0 {
		return in
	}
	out := make([]PivotFieldDTO, len(in))
	for i, f := range in {
		out[i] = PivotFieldDTO{SourceColumn: f.SourceColumn}
	}
	return out
}

// ---------------------------------------------------------------------------
// Write parity: bootstrap → snapshot → serialize, re-read with excelize.
// ---------------------------------------------------------------------------

// parityBootstrapSnapshot runs the production bootstrap into a fresh
// server-side Y.Doc and snapshots it back out, edit-free. Pivots are
// carried over from the model directly: BootstrapYDocFromWorkbook only
// registers the pivots map (the TS client seeds the entries), so the
// snapshot mirrors a client that has done that seeding.
func parityBootstrapSnapshot(t *testing.T, model WorkbookModel) YDocSnapshot {
	t.Helper()
	rt := NewRuntime()
	handle, err := rt.NewDoc("parity-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })
	sh := handle.(*sheetsDocHandle)
	if err := BootstrapYDocFromWorkbook(sh.doc, model); err != nil {
		t.Fatalf("BootstrapYDocFromWorkbook: %v", err)
	}
	snap, err := sh.Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	snap.Pivots = model.Pivots
	return snap
}

func parityRawCellValue(t *testing.T, f *excelize.File, sheet, ref string) string {
	t.Helper()
	v, err := f.GetCellValue(sheet, ref, excelize.Options{RawCellValue: true})
	if err != nil {
		t.Fatalf("raw cell value %s!%s: %v", sheet, ref, err)
	}
	return v
}

func TestWriteParityExcelizeReread(t *testing.T) {
	for _, fx := range parityFixtures {
		t.Run(fx.name, func(t *testing.T) {
			data := readParityFixture(t, fx.path)
			model, err := ReadWorkbookFromXLSX(data, 0, 0)
			if err != nil {
				t.Fatalf("ReadWorkbookFromXLSX: %v", err)
			}
			if fx.name == "pivot-basic" && len(model.Pivots) == 0 {
				t.Fatal("pivot fixture read produced no pivots — the pivot write-parity leg would be vacuous")
			}
			snap := parityBootstrapSnapshot(t, model)
			out, err := serializeSnapshotToXLSX(data, snap, nil)
			if err != nil {
				t.Fatalf("serializeSnapshotToXLSX: %v", err)
			}

			f, err := excelize.OpenReader(bytes.NewReader(out))
			if err != nil {
				t.Fatalf("excelize cannot open serialized output: %v", err)
			}
			defer func() { _ = f.Close() }()

			var wantNames []string
			for _, s := range model.Sheets {
				wantNames = append(wantNames, s.Name)
			}
			if d := cmp.Diff(wantNames, f.GetSheetList()); d != "" {
				t.Fatalf("sheet lineup (-model +output):\n%s", d)
			}

			for _, ms := range model.Sheets {
				assertWriteParitySheet(t, f, &ms)
			}
			assertWriteParityPivots(t, f, model.Pivots)
		})
	}
}

func assertWriteParitySheet(t *testing.T, f *excelize.File, ms *WorksheetModel) {
	t.Helper()
	name := ms.Name

	keys := make([]string, 0, len(ms.Cells))
	for k := range ms.Cells {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		v := ms.Cells[k]
		row, col := parseModelCellKey(k)
		ref, err := excelize.CoordinatesToCellName(col, row)
		if err != nil {
			t.Fatalf("coords %s: %v", k, err)
		}
		if v.Formula != "" {
			gotFormula, err := f.GetCellFormula(name, ref)
			if err != nil {
				t.Fatalf("formula %s!%s: %v", name, ref, err)
			}
			if gotFormula != v.Formula {
				t.Errorf("%s!%s: formula: model %q, output %q", name, ref, v.Formula, gotFormula)
			}
		}
		raw := parityRawCellValue(t, f, name, ref)
		assertWriteParityValue(t, name, ref, v, raw)
	}

	gotMerges := writeParityMergeSet(t, f, name)
	wantMerges := map[string]struct{}{}
	for _, m := range ms.Merges {
		start, _ := excelize.CoordinatesToCellName(m.AnchorCol, m.AnchorRow)
		end, _ := excelize.CoordinatesToCellName(m.AnchorCol+m.ColSpan-1, m.AnchorRow+m.RowSpan-1)
		wantMerges[start+":"+end] = struct{}{}
	}
	if d := cmp.Diff(wantMerges, gotMerges); d != "" {
		t.Errorf("%s: merges (-model +output):\n%s", name, d)
	}

	panes, err := f.GetPanes(name)
	if err != nil {
		t.Fatalf("GetPanes %s: %v", name, err)
	}
	gotRows, gotCols := 0, 0
	if panes.Freeze {
		gotRows, gotCols = panes.YSplit, panes.XSplit
	}
	if gotRows != ms.FrozenRows || gotCols != ms.FrozenCols {
		t.Errorf("%s: freeze: model (%d,%d), output (%d,%d)", name, ms.FrozenRows, ms.FrozenCols, gotRows, gotCols)
	}

	props, err := f.GetSheetProps(name)
	if err != nil {
		t.Fatalf("GetSheetProps %s: %v", name, err)
	}
	gotColor := ""
	if props.TabColorRGB != nil {
		gotColor = *props.TabColorRGB
	}
	// Semantic tab-color compare: excelize stores/reports ARGB.
	if parityCanonColor(gotColor) != parityCanonColor(ms.Color) {
		t.Errorf("%s: tab color: model %q, output %q", name, ms.Color, gotColor)
	}

	visible, err := f.GetSheetVisible(name)
	if err != nil {
		t.Fatalf("GetSheetVisible %s: %v", name, err)
	}
	if visible != !ms.Hidden {
		t.Errorf("%s: visible: model hidden=%v, output visible=%v", name, ms.Hidden, visible)
	}

	for row, px := range ms.RowHeights {
		got, err := f.GetRowHeight(name, row)
		if err != nil {
			t.Fatalf("GetRowHeight %s row %d: %v", name, row, err)
		}
		if math.Abs(got-pxToExcelPoints(px)) > 0.011 {
			t.Errorf("%s: row %d height: model %dpx (%.2fpt), output %.2fpt", name, row, px, pxToExcelPoints(px), got)
		}
	}
	for col, px := range ms.ColWidths {
		colName, err := excelize.ColumnNumberToName(col)
		if err != nil {
			t.Fatalf("col name %d: %v", col, err)
		}
		got, err := f.GetColWidth(name, colName)
		if err != nil {
			t.Fatalf("GetColWidth %s!%s: %v", name, colName, err)
		}
		if math.Abs(got-pxToExcelCharWidth(px)) > 0.011 {
			t.Errorf("%s: col %d width: model %dpx (%.4f chars), output %.4f chars", name, col, px, pxToExcelCharWidth(px), got)
		}
	}
}

// assertWriteParityValue compares a model cell against the raw stored
// value excelize reads back. Semantic, not storage-artifact, compare:
// inline vs shared strings are transparent through GetCellValue, dates
// are checked through the serial, and numbers through ParseFloat.
func assertWriteParityValue(t *testing.T, sheet, ref string, v CellValueDTO, raw string) {
	t.Helper()
	kind := v.Kind
	if kind == "formula" {
		// The formula's cached value rides along; assert only when the
		// model carried a scalar cache.
		switch cached := v.Raw.(type) {
		case float64:
			got, err := strconv.ParseFloat(raw, 64)
			if err != nil || !parityFloatsClose(got, cached) {
				t.Errorf("%s!%s: formula cache: model %v, output %q", sheet, ref, cached, raw)
			}
		case string:
			if raw != cached {
				t.Errorf("%s!%s: formula cache: model %q, output %q", sheet, ref, cached, raw)
			}
		case bool:
			if parityRawBool(raw) != cached {
				t.Errorf("%s!%s: formula cache: model %v, output %q", sheet, ref, cached, raw)
			}
		}
		return
	}
	switch kind {
	case "number":
		want, ok := v.Raw.(float64)
		if !ok {
			t.Errorf("%s!%s: model number cell carries non-float raw %v", sheet, ref, v.Raw)
			return
		}
		got, err := strconv.ParseFloat(raw, 64)
		if err != nil || !parityFloatsClose(got, want) {
			t.Errorf("%s!%s: number: model %v, output %q", sheet, ref, want, raw)
		}
	case "boolean":
		want, ok := v.Raw.(bool)
		if !ok {
			t.Errorf("%s!%s: model boolean cell carries non-bool raw %v", sheet, ref, v.Raw)
			return
		}
		if parityRawBool(raw) != want {
			t.Errorf("%s!%s: boolean: model %v, output %q", sheet, ref, want, raw)
		}
	case "date":
		want, ok := v.Raw.(string)
		if !ok {
			t.Errorf("%s!%s: model date cell carries non-string raw %v", sheet, ref, v.Raw)
			return
		}
		serial, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			t.Errorf("%s!%s: date cell stored non-serial %q", sheet, ref, raw)
			return
		}
		got := parityExcelEpoch.Add(time.Duration(serial * float64(24*time.Hour)))
		if !parityDateMatches(CellValueDTO{Kind: "number", Raw: serial}, CellValueDTO{Kind: "date", Raw: want}) {
			t.Errorf("%s!%s: date: model %q, output serial %v (%v)", sheet, ref, want, serial, got)
		}
	default: // string
		want, _ := v.Raw.(string)
		if raw != want {
			t.Errorf("%s!%s: string: model %q, output %q", sheet, ref, want, raw)
		}
	}
}

func parityRawBool(raw string) bool {
	return raw == "1" || strings.EqualFold(raw, "true")
}

func writeParityMergeSet(t *testing.T, f *excelize.File, sheet string) map[string]struct{} {
	t.Helper()
	mcs, err := f.GetMergeCells(sheet)
	if err != nil {
		t.Fatalf("GetMergeCells %s: %v", sheet, err)
	}
	out := map[string]struct{}{}
	for _, mc := range mcs {
		out[mc.GetStartAxis()+":"+mc.GetEndAxis()] = struct{}{}
	}
	return out
}

func assertWriteParityPivots(t *testing.T, f *excelize.File, pivots []PivotDefinitionDTO) {
	t.Helper()
	wantPerSheet := map[string][]PivotDefinitionDTO{}
	for _, p := range pivots {
		if len(p.Values) == 0 {
			continue // writePivots skips value-less defs by contract
		}
		wantPerSheet[p.TargetSheetName] = append(wantPerSheet[p.TargetSheetName], p)
	}
	for _, sheet := range f.GetSheetList() {
		got, err := f.GetPivotTables(sheet)
		if err != nil {
			t.Fatalf("GetPivotTables %s: %v", sheet, err)
		}
		want := wantPerSheet[sheet]
		if len(got) != len(want) {
			t.Errorf("%s: pivot count: model %d, output %d", sheet, len(want), len(got))
			continue
		}
		for i, p := range want {
			o := got[i]
			wantSheet, wantRef := splitSourceRange(p.SourceRange)
			gotSheet, gotRef := splitSourceRange(o.DataRange)
			if gotSheet != wantSheet || gotRef != wantRef {
				t.Errorf("%s: pivot %d source: model %q, output %q", sheet, i, p.SourceRange, o.DataRange)
			}
			if d := cmp.Diff(sourceColumnNames(p.Rows), pivotFieldNames(o.Rows)); d != "" {
				t.Errorf("%s: pivot %d rows (-model +output):\n%s", sheet, i, d)
			}
			if d := cmp.Diff(sourceColumnNames(p.Cols), pivotFieldNames(o.Columns)); d != "" {
				t.Errorf("%s: pivot %d cols (-model +output):\n%s", sheet, i, d)
			}
			var wantValues, gotValues []string
			for _, vf := range p.Values {
				wantValues = append(wantValues, vf.SourceColumn+"|"+vf.Aggregation)
			}
			for _, df := range o.Data {
				gotValues = append(gotValues, df.Data+"|"+normalizeAgg(df.Subtotal))
			}
			if d := cmp.Diff(wantValues, gotValues); d != "" {
				t.Errorf("%s: pivot %d values (-model +output):\n%s", sheet, i, d)
			}
		}
	}
}

func pivotFieldNames(in []excelize.PivotTableField) []string {
	out := make([]string, 0, len(in))
	for _, f := range in {
		out = append(out, f.Data)
	}
	return out
}

// TestWriteParityCommentsPresence drives the comments leg of the save
// path and asserts the note is visible to excelize as an independent
// reader.
func TestWriteParityCommentsPresence(t *testing.T) {
	data := readParityFixture(t, "../tests/assets/tiny.xlsx")
	model, err := ReadWorkbookFromXLSX(data, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	snap := parityBootstrapSnapshot(t, model)
	comments := []CommentRow{{
		ID:         "c1",
		SheetID:    "sheet1",
		Row:        2,
		Col:        2,
		Body:       "parity oracle note",
		AuthorName: "Oracle",
		Created:    time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC),
	}}
	out, err := serializeSnapshotToXLSX(data, snap, comments)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("excelize open: %v", err)
	}
	defer func() { _ = f.Close() }()
	got, err := f.GetComments(model.Sheets[0].Name)
	if err != nil {
		t.Fatalf("GetComments: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("comment count: want 1, got %d", len(got))
	}
	if got[0].Cell != "B2" {
		t.Errorf("comment cell: want B2, got %s", got[0].Cell)
	}
	text := got[0].Text
	for _, p := range got[0].Paragraph {
		text += p.Text
	}
	if !strings.Contains(text, "parity oracle note") {
		t.Errorf("comment text %q does not contain the body", text)
	}
}

// ---------------------------------------------------------------------------
// No-op round-trip stability: bootstrap(fixture) → serialize must reach
// a byte-identical steady state after one cycle.
// ---------------------------------------------------------------------------

func TestNoOpRoundTripStability(t *testing.T) {
	for _, fx := range parityFixtures {
		t.Run(fx.name, func(t *testing.T) {
			data := readParityFixture(t, fx.path)
			out1 := parityNoOpCycle(t, data)
			out2 := parityNoOpCycle(t, out1)
			out3 := parityNoOpCycle(t, out2)
			if !bytes.Equal(out2, out3) {
				t.Errorf("no-op round trip did not stabilize: outputs 2 (%d bytes) and 3 (%d bytes) differ", len(out2), len(out3))
			}
		})
	}
}

func parityNoOpCycle(t *testing.T, in []byte) []byte {
	t.Helper()
	model, err := ReadWorkbookFromXLSX(in, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	snap := parityBootstrapSnapshot(t, model)
	out, err := serializeSnapshotToXLSX(in, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	return out
}
