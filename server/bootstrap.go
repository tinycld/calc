package calc

import (
	"context"
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/nathanstitt/omnidoc/pkg/xlsx"
	ycrdt "github.com/skyterra/y-crdt"
)

// WorkbookModel mirrors the TS WorkbookModel
// (tinycld/calc/lib/workbook-types.ts). It is the same shape returned
// by the /api/calc/render/{id} endpoint and consumed by the YDoc
// bootstrap path on first joiner. Field names use camelCase JSON tags
// so the wire shape matches the TS interface byte-for-byte.
type WorkbookModel struct {
	Sheets []WorksheetModel     `json:"sheets"`
	Pivots []PivotDefinitionDTO `json:"pivots,omitempty"`
	// DefaultFont is the workbook's Normal-style font: the font a cell
	// with no font name or size of its own draws in. Nil when the file
	// has no styles part.
	DefaultFont *WorkbookFontDTO `json:"defaultFont,omitempty"`
}

// WorkbookFontDTO is the workbook default font (Size in points).
type WorkbookFontDTO struct {
	Name string  `json:"name,omitempty"`
	Size float64 `json:"size,omitempty"`
}

type WorksheetModel struct {
	Name     string                  `json:"name"`
	RowCount int                     `json:"rowCount"`
	ColCount int                     `json:"colCount"`
	Cells    map[string]CellValueDTO `json:"cells"`
	// Color is the imported tab color as a "#RRGGBB" hex string.
	// Empty when the source xlsx has no tab color set.
	Color string `json:"color,omitempty"`
	// Hidden mirrors the source xlsx's per-sheet visibility flag.
	// Hidden sheets still get fully read (so peers who unhide them
	// see the data) but the client filters them from the default
	// sheet list — see useYSheets.
	Hidden bool `json:"hidden,omitempty"`
	// Merges enumerates merged-cell rectangles imported from the
	// source xlsx's <mergeCells> entries.
	Merges []MergeRangeDTO `json:"merges,omitempty"`
	// FrozenRows / FrozenCols mirror the xlsx <pane> ySplit /
	// xSplit when state="frozen". Zero on either axis means "no
	// freeze on this axis"; the doc bootstrap omits the meta key
	// rather than writing 0 so a freeze-less sheet adds no bytes.
	FrozenRows int `json:"frozenRows,omitempty"`
	FrozenCols int `json:"frozenCols,omitempty"`
	// RowHeights / ColWidths / RowStyles seed the Y.Doc's sparse
	// per-row / per-column customization maps from the imported
	// xlsx. Without this seed the Y.Doc has no knowledge of the
	// original sizing, so the serializer's snapshot-is-authoritative
	// contract for these fields would silently wipe legitimate
	// external customizations on first save. Keys are 1-based row
	// or column numbers; values are CSS pixels (matching the TS
	// side's storage unit).
	RowHeights map[int]int        `json:"rowHeights,omitempty"`
	ColWidths  map[int]int        `json:"colWidths,omitempty"`
	RowStyles  map[int]*CellStyle `json:"rowStyles,omitempty"`
	// ConditionalFormats enumerates rules imported from the source
	// xlsx's <conditionalFormatting> blocks, in file order. Bootstrap
	// seeds them into the per-sheet conditionalFormats Y.Array so the
	// doc-side authoring UI sees them on first open. Empty/nil when
	// the source has no rules.
	ConditionalFormats []ConditionalFormatRule `json:"conditionalFormats,omitempty"`
	// DefaultRowHeight / DefaultColWidth are the sheet's own
	// sheetFormatPr defaults in CSS pixels, converted with the same
	// Excel point / character-width rules as RowHeights / ColWidths.
	// DefaultRowHeight is zero when the sheet declares none, so the
	// client keeps its own built-in default. DefaultColWidth is never
	// zero: a sheet that declares none has the width Excel derives from
	// baseColWidth and the default font (69 px for Calibri 11).
	DefaultRowHeight int `json:"defaultRowHeight,omitempty"`
	DefaultColWidth  int `json:"defaultColWidth,omitempty"`
	// HideGridLines mirrors the sheet view's showGridLines="0".
	HideGridLines bool `json:"hideGridLines,omitempty"`
	// FilterView is the sheet's autoFilter as calc's filter view (see
	// readFilterView), or nil when the sheet has none.
	FilterView *FilterView `json:"filterView,omitempty"`
}

// MergeRangeDTO mirrors the TS MergeRangeModel: a merged cell anchor
// (top-left) plus span dimensions.
type MergeRangeDTO struct {
	AnchorRow int `json:"anchorRow"`
	AnchorCol int `json:"anchorCol"`
	RowSpan   int `json:"rowSpan"`
	ColSpan   int `json:"colSpan"`
}

// CellValueDTO mirrors the TS CellValue. `raw` is one of
// string|number|boolean|null (Yjs-friendly scalar). `formula` is
// emitted only for formula cells; `style` only for cells with a
// tracked attribute.
type CellValueDTO struct {
	Kind    string     `json:"kind"`
	Raw     any        `json:"raw"`
	Display string     `json:"display"`
	Formula string     `json:"formula,omitempty"`
	Style   *CellStyle `json:"style,omitempty"`
	// Link is the cell's hyperlink target (see hyperlinkTarget).
	Link string `json:"link,omitempty"`
}

// ReadWorkbookFromXLSX parses xlsx bytes into a WorkbookModel suitable
// for both the preview endpoint and the YDoc bootstrap. Mirrors the TS
// parseWorkbook (tinycld/calc/lib/xlsx-adapter.ts) so the resulting
// shape decodes identically on the client side.
//
// rowCap and colCap (when > 0) bound the per-sheet read for the
// preview endpoint; pass 0 for the bootstrap path which needs the
// full grid.
func ReadWorkbookFromXLSX(ctx context.Context, xlsxBytes []byte, rowCap, colCap int) (WorkbookModel, error) {
	if len(xlsxBytes) == 0 {
		return WorkbookModel{}, fmt.Errorf("calc: ReadWorkbookFromXLSX: empty input")
	}
	wb, err := xlsx.OpenBytes(ctx, xlsxBytes)
	if err != nil {
		return WorkbookModel{}, fmt.Errorf("calc: open xlsx: %w", err)
	}
	// Resolve legacy indexed palette colors to plain RGB before any
	// style conversion — see indexed_palette.go for scope and rationale.
	resolveWorkbookIndexedColors(wb, indexedPaletteFromStyles(xlsxBytes))

	out := WorkbookModel{Sheets: make([]WorksheetModel, 0, len(wb.Sheets))}
	if wb.DefaultFont.Name != "" || wb.DefaultFont.Size > 0 {
		out.DefaultFont = &WorkbookFontDTO{Name: wb.DefaultFont.Name, Size: wb.DefaultFont.Size}
	}
	for i := range wb.Sheets {
		out.Sheets = append(out.Sheets, readWorksheet(&wb.Sheets[i], rowCap, colCap, wb.Date1904))
	}
	pivots, err := readPivots(ctx, xlsxBytes)
	if err != nil {
		return WorkbookModel{}, fmt.Errorf("calc: read pivots: %w", err)
	}
	// Promote any pivot whose target sheet collides with an existing
	// non-empty data sheet by relocating it to a dedicated "<sheet>
	// pivot" sheet name (design §8). Excel-authored xlsx usually
	// already places the pivot on a dedicated sheet, so this is a
	// safety net for the in-sheet case where the user dropped the
	// pivot into a region that already holds data.
	out.Pivots = ensureDistinctTargets(pivots, out.Sheets)
	return out, nil
}

// ensureDistinctTargets walks the imported pivots and rewrites the
// target sheet name for any pivot whose target collides with an
// existing non-empty sheet. Naming follows "<sheet> pivot" then
// "<sheet> pivot (2)", "<sheet> pivot (3)", … until a free name is
// found. The collision rule is intentionally permissive: a pivot
// whose target sheet exists but is empty (e.g. excelize.NewSheet
// followed by AddPivotTable into PivotSheet!A1) stays put — the
// pivot can paint freely without clobbering anything. Only when the
// target already has data do we relocate.
//
// The relocated name is a sheet the workbook does not have yet; the
// Y.Doc bootstrap creates it (after the original, recorded in
// RelocatedFrom) and the save path writes it out.
func ensureDistinctTargets(pivots []PivotDefinitionDTO, sheets []WorksheetModel) []PivotDefinitionDTO {
	taken := make(map[string]bool, len(sheets))
	cellCount := make(map[string]int, len(sheets))
	for _, s := range sheets {
		taken[s.Name] = true
		cellCount[s.Name] = len(s.Cells)
	}
	for i, p := range pivots {
		if cellCount[p.TargetSheetName] > 0 {
			candidate := relocatedPivotSheetName(p.TargetSheetName, 1)
			for n := 2; taken[candidate]; n++ {
				candidate = relocatedPivotSheetName(p.TargetSheetName, n)
			}
			pivots[i].RelocatedFrom = p.TargetSheetName
			pivots[i].TargetSheetName = candidate
			taken[candidate] = true
		}
	}
	return pivots
}

// maxSheetNameLen is Excel's sheet-name limit; a longer name makes the
// saved file fail to open.
const maxSheetNameLen = 31

// relocatedPivotSheetName builds the n-th candidate name for a pivot
// moved off sheet: "<sheet> pivot", then "<sheet> pivot (n)". The sheet
// part is shortened so the whole name fits maxSheetNameLen.
func relocatedPivotSheetName(sheet string, n int) string {
	suffix := " pivot"
	if n > 1 {
		suffix = fmt.Sprintf(" pivot (%d)", n)
	}
	base := []rune(strings.TrimSpace(sheet))
	if room := maxSheetNameLen - len([]rune(suffix)); len(base) > room {
		base = []rune(strings.TrimSpace(string(base[:room])))
	}
	return string(base) + suffix
}

// readWorksheet converts one parsed omnidoc sheet into the
// WorksheetModel wire shape. The omnidoc grid is dense over the
// used range and 0-BASED; every index converts to calc's 1-based
// convention immediately inside this function so no 0-based index
// escapes the seam. date1904 is the workbook's date system (see
// classifyScalar).
func readWorksheet(sheet *xlsx.Sheet, rowCap, colCap int, date1904 bool) WorksheetModel {
	tabColor := ""
	if sheet.TabColorRGB != "" {
		tabColor = "#" + sheet.TabColorRGB
	}
	cells := make(map[string]CellValueDTO)
	maxRow, maxCol := 0, 0

	// maxRow/maxCol track CONTRIBUTING cells only: cells carrying a
	// value, a formula, or a visible decoration (see readWorkbookCell).
	// The dense grid also pads with empties that contribute nothing.
	for r := range sheet.Cells {
		rowNumber := r + 1
		if rowCap > 0 && rowNumber > rowCap {
			break
		}
		rowStyle := sheet.RowStyles[r]
		for c := range sheet.Cells[r] {
			colNumber := c + 1
			if colCap > 0 && colNumber > colCap {
				break
			}
			cell, ok := readWorkbookCell(&sheet.Cells[r][c], rowStyle, date1904)
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

	linkRow, linkCol := applyHyperlinks(cells, sheet.Hyperlinks, rowCap, colCap)
	maxRow, maxCol = max(maxRow, linkRow), max(maxCol, linkCol)

	rowCount, colCount := maxRow, maxCol
	if rowCount < 1 {
		rowCount = 1
	}
	if colCount < 1 {
		colCount = 1
	}
	frozenRows, frozenCols := sheet.FrozenRows, sheet.FrozenCols
	if frozenRows < 0 {
		frozenRows = 0
	}
	if frozenCols < 0 {
		frozenCols = 0
	}
	return WorksheetModel{
		Name:               sheet.Name,
		RowCount:           rowCount,
		ColCount:           colCount,
		Cells:              cells,
		Color:              tabColor,
		Hidden:             sheet.Visibility != xlsx.SheetVisible,
		Merges:             readMerges(sheet.Merges),
		FrozenRows:         frozenRows,
		FrozenCols:         frozenCols,
		RowHeights:         readRowHeights(sheet),
		ColWidths:          readColWidths(sheet, colCount),
		RowStyles:          readRowStyles(sheet),
		ConditionalFormats: readConditionalFormats(sheet),
		DefaultRowHeight:   excelPointsToPx(sheet.DefaultRowHeight),
		DefaultColWidth:    excelCharWidthToPx(sheet.DefaultColWidth),
		HideGridLines:      sheet.HideGridLines,
		FilterView:         readFilterView(sheet.AutoFilter),
	}
}

// readRowHeights converts the sheet's explicit per-row heights (points,
// 0-based keys) into the sparse 1-based pixel map the Y.Doc seeds from.
// Heights matching the workbook default stay out of the map so a
// workbook with no real customizations contributes no Y.Doc bytes —
// producers routinely stamp ht="<default>" on every row without the
// user having touched anything. Sparseness matters downstream: the
// serializer's snapshot-is-authoritative contract treats a seeded map
// as the complete set of customizations, so over-seeding bloats every
// subsequent save.
func readRowHeights(sheet *xlsx.Sheet) map[int]int {
	out := map[int]int{}
	for row, pt := range sheet.RowHeights {
		if row < 0 || pt <= 0 {
			continue
		}
		if isDefaultRowHeight(pt, sheet.DefaultRowHeight) {
			continue
		}
		out[row+1] = excelPointsToPx(pt)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// isDefaultRowHeight reports whether a stored row height is a workbook
// default: either the historical 15pt constant (kept for parity with
// the excelize-era filter, whose iterator seeded absent heights with
// it) or the sheet's own declared sheetFormatPr default. The 0.01pt
// epsilon catches round-trip rounding without dropping near-default
// custom heights.
func isDefaultRowHeight(pt, sheetDefault float64) bool {
	if pt > defaultExcelRowHeight-0.01 && pt < defaultExcelRowHeight+0.01 {
		return true
	}
	return sheetDefault > 0 && pt > sheetDefault-0.01 && pt < sheetDefault+0.01
}

// readColWidths emits every column whose stored width differs from the
// workbook default (the historical 9.140625 constant or the sheet's
// declared sheetFormatPr default). Bounded to colCount — the extent of
// contributing cells — matching the excelize-era walk: producers write
// blanket <col> ranges spanning thousands of trailing columns at a
// near-default width, and seeding those would bloat the Y.Doc while
// representing no real edit.
func readColWidths(sheet *xlsx.Sheet, colCount int) map[int]int {
	out := map[int]int{}
	for col, w := range sheet.ColWidths {
		if col < 0 || col+1 > colCount || w <= 0 {
			continue
		}
		if isDefaultColWidth(w, sheet.DefaultColWidth) {
			continue
		}
		out[col+1] = excelCharWidthToPx(w)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// isDefaultColWidth mirrors isDefaultRowHeight for column widths (char
// units, 0.001 epsilon — the excelize-era filter's tolerance).
func isDefaultColWidth(w, sheetDefault float64) bool {
	if w > defaultExcelColWidth-0.001 && w < defaultExcelColWidth+0.001 {
		return true
	}
	return sheetDefault > 0 && w > sheetDefault-0.001 && w < sheetDefault+0.001
}

// readRowStyles converts the sheet's row-level styles (0-based keys)
// through the standard read mapper. Rows whose style carries nothing
// the doc models are skipped, keeping the map sparse.
func readRowStyles(sheet *xlsx.Sheet) map[int]*CellStyle {
	out := map[int]*CellStyle{}
	for row, st := range sheet.RowStyles {
		if row < 0 {
			continue
		}
		if cs := styleToCellStyle(st); cs != nil {
			out[row+1] = cs
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// defaultExcelRowHeight and defaultExcelColWidth are the conventional
// xlsx defaults (15pt rows, 9.140625-char columns — the values Excel
// and excelize both assume when a sheet declares none). The import-side
// seeding uses them, alongside the sheet's own sheetFormatPr defaults,
// to detect "this row/col carries no real customization".
const (
	defaultExcelRowHeight = 15.0
	defaultExcelColWidth  = 9.140625
)

// excelPointsToPx is the inverse of pxToExcelPoints (persist.go). 72
// pt / inch / 96 px / inch = 0.75 ratio in the forward direction; the
// inverse divides. Rounds to the nearest integer pixel because the
// Y.Doc stores row heights as ints.
func excelPointsToPx(pt float64) int {
	if pt <= 0 {
		return 0
	}
	return int(pt/0.75 + 0.5)
}

// excelCharWidthToPx is the inverse of pxToExcelCharWidth (persist.go).
// Forward: chars = (px-5)/7 for px>12 else px/12. We pick the inverse
// branch by whether the result of the px>12 branch lands above 12 — i.e.
// `(chars*7)+5 > 12` ⇒ `chars > 1`. Rounds to the nearest integer pixel.
func excelCharWidthToPx(chars float64) int {
	if chars <= 0 {
		return 0
	}
	if chars > 1 {
		return int(chars*7 + 5 + 0.5)
	}
	return int(chars*12 + 0.5)
}

// readMerges converts the sheet's merged ranges (0-based anchors) to
// MergeRangeDTOs. Degenerate entries are skipped so a malformed range
// doesn't poison the whole sheet load.
func readMerges(merges []xlsx.Merge) []MergeRangeDTO {
	if len(merges) == 0 {
		return nil
	}
	out := make([]MergeRangeDTO, 0, len(merges))
	for _, m := range merges {
		if m.Row < 0 || m.Col < 0 || m.RowSpan < 1 || m.ColSpan < 1 {
			continue
		}
		out = append(out, MergeRangeDTO{
			AnchorRow: m.Row + 1,
			AnchorCol: m.Col + 1,
			RowSpan:   m.RowSpan,
			ColSpan:   m.ColSpan,
		})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// readWorkbookCell extracts a single cell into the typed CellValueDTO shape.
// Returns ok=false for cells that don't contribute — no formula, no
// typed value (an empty-string value counts as no value) and no visible
// decoration — so the caller can skip them, keeping the on-wire JSON
// small and matching the TS parser which skips includeEmpty=false cells.
//
// Classification comes straight off the typed cached value; formulas
// arrive without the leading "=" and with shared formulas already
// expanded per member cell.
//
// rowStyle is the cell's row style (nil when the row has none). omnidoc
// gives a padding cell (no <c> element) its row's style, else its
// column's; an empty cell sharing its row's style is such padding, and
// the row style already draws it through rowStyles, so it stays out.
func readWorkbookCell(cell *xlsx.Cell, rowStyle *xlsx.Style, date1904 bool) (CellValueDTO, bool) {
	// Cells on the DEFAULT xf (StyleID 0) are untracked, matching the
	// excelize-era reader. omnidoc resolves xf 0 like any other, so
	// without this guard every unstyled cell would seed the workbook's
	// default font (e.g. Calibri 11) into the Y.Doc as a per-cell style
	// — bloating the doc and stamping explicit styles back on every
	// save.
	var style *CellStyle
	if cell.StyleID != 0 {
		style = styleToCellStyle(cell.Style)
	}

	if cell.Formula == "" && !cellHasValue(cell.Value) {
		// An empty cell that draws something (a box border, a fill) is
		// kept as an empty string cell so the decoration renders. Font,
		// alignment and number-format-only empties show nothing and stay
		// out of the doc.
		if style == nil || cell.Style == rowStyle || !hasVisibleDecoration(cell.Style) {
			return CellValueDTO{}, false
		}
		return CellValueDTO{Kind: "string", Raw: "", Display: "", Style: style}, true
	}

	if cell.Formula != "" {
		// The client's formula engine only evaluates input that starts
		// with "=", and omnidoc strips it; the writer (SetFormula)
		// strips it again on save.
		formula := "=" + cell.Formula
		raw := classifyScalar(cell.Value, date1904)
		display := formatDisplay("formula", raw, formula)
		if cell.Value.Kind == xlsx.KindDate {
			// The raw is a serial for the engine; the cached display
			// stays a readable date for renderers that don't apply the
			// cell's numFmt.
			display = dateRawString(cell.Value.T)
		}
		return CellValueDTO{
			Kind:    "formula",
			Raw:     raw,
			Display: display,
			Formula: formula,
			Style:   style,
		}, true
	}

	kind, raw := classifyValue(cell.Value)
	display := formatDisplay(kind, raw, "")
	return CellValueDTO{
		Kind:    kind,
		Raw:     raw,
		Display: display,
		Style:   style,
	}, true
}

// hasVisibleDecoration reports whether a style paints something on an
// otherwise-empty cell: a declared fill pattern or a styled edge on one
// of the four sides the doc models.
func hasVisibleDecoration(st *xlsx.Style) bool {
	if st == nil {
		return false
	}
	if fillDeclared(st.Fill) {
		return true
	}
	b := st.Border
	return b.Top.Style != "" || b.Right.Style != "" || b.Bottom.Style != "" || b.Left.Style != ""
}

// cellHasValue reports whether a typed value contributes to the doc.
// KindEmpty is a padding cell; an empty string carries no information
// the doc models.
func cellHasValue(v xlsx.Value) bool {
	if v.Kind == xlsx.KindEmpty {
		return false
	}
	return !(v.Kind == xlsx.KindString && v.S == "")
}

// classifyValue maps a typed cached value to our (kind, raw) shape.
// Cached error values ("#DIV/0!") surface as strings — the doc has no
// error kind and the display text is what the user sees.
func classifyValue(v xlsx.Value) (string, any) {
	switch v.Kind {
	case xlsx.KindNumber:
		return "number", v.F
	case xlsx.KindBool:
		return "boolean", v.B
	case xlsx.KindDate:
		return "date", dateRawString(v.T)
	default: // KindString, KindError
		return "string", v.S
	}
}

// dateRawString renders a date value in the ISO-string convention the
// TS side stores in the Y.Doc: date-only "2006-01-02" when the value
// carries no time-of-day, full RFC3339 otherwise.
func dateRawString(t time.Time) string {
	if t.Hour() == 0 && t.Minute() == 0 && t.Second() == 0 && t.Nanosecond() == 0 {
		return t.Format("2006-01-02")
	}
	return t.Format(time.RFC3339)
}

// classifyScalar is the formula-cached-value variant — we know the
// cell IS a formula (handled separately) and only need to coerce the
// cached scalar into raw form. An empty cache reads as nil.
//
// A date-typed cache becomes its serial number, because the formula
// engine produces serials for date formulas and the display path
// formats numbers through the cell's numFmt. v.F is the serial as
// stored, in the workbook's own date system; the engine counts from
// 1900, so a 1904 workbook's serial is converted (date1904).
func classifyScalar(v xlsx.Value, date1904 bool) any {
	switch v.Kind {
	case xlsx.KindDate:
		return xlsx.Serial1900(v.F, date1904)
	case xlsx.KindNumber:
		return v.F
	case xlsx.KindBool:
		return v.B
	case xlsx.KindEmpty:
		return nil
	default: // KindString, KindError
		if v.S == "" {
			return nil
		}
		return v.S
	}
}

// formatDisplay mirrors formatCell (workbook-types.ts) for the
// limited set of kinds the parser emits. The Y.Doc carries the
// display string so non-formatter readers (server, alternate clients)
// can render without recomputing.
func formatDisplay(kind string, raw any, formula string) string {
	if kind == "formula" {
		if raw == nil {
			return formula
		}
		return scalarToString(raw)
	}
	if raw == nil {
		return ""
	}
	switch kind {
	case "number":
		if n, ok := raw.(float64); ok {
			return formatNumber(n)
		}
		return scalarToString(raw)
	case "boolean":
		if b, ok := raw.(bool); ok {
			if b {
				return "TRUE"
			}
			return "FALSE"
		}
		return scalarToString(raw)
	case "date":
		return scalarToString(raw)
	default:
		return scalarToString(raw)
	}
}

func formatNumber(n float64) string {
	if n == float64(int64(n)) {
		return strconv.FormatInt(int64(n), 10)
	}
	return strconv.FormatFloat(n, 'g', -1, 64)
}

func scalarToString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case bool:
		if x {
			return "TRUE"
		}
		return "FALSE"
	case float64:
		return formatNumber(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case nil:
		return ""
	default:
		return fmt.Sprintf("%v", x)
	}
}

// bootstrapSheet is one entry of the bootstrapped doc's tab order: an
// imported sheet, or the empty output sheet created for a pivot whose
// target sheet the workbook does not have.
type bootstrapSheet struct {
	id      string
	sheet   WorksheetModel
	pivotID string
}

// planBootstrapSheets lays out the doc's sheets in tab order. Imported
// sheets keep the `sheet${i+1}` ids. A pivot target missing from the
// workbook (ensureDistinctTargets moved the pivot off a sheet that
// holds data) becomes a new empty sheet placed right after the sheet it
// was moved off, or at the end when that is unknown; new sheets take
// the ids after the imported ones. Each pivot's target sheet records
// the pivot ID under pivotSheetKey; when several pivots share a target
// the last one wins, as in the TS writeBootstrapPivots.
func planBootstrapSheets(model WorkbookModel) []bootstrapSheet {
	imported := make(map[string]bool, len(model.Sheets))
	for _, s := range model.Sheets {
		imported[s.Name] = true
	}
	following := map[string][]string{}
	var trailing []string
	created := map[string]bool{}
	for _, p := range model.Pivots {
		name := p.TargetSheetName
		if name == "" || imported[name] || created[name] {
			continue
		}
		created[name] = true
		if imported[p.RelocatedFrom] {
			following[p.RelocatedFrom] = append(following[p.RelocatedFrom], name)
		} else {
			trailing = append(trailing, name)
		}
	}

	out := make([]bootstrapSheet, 0, len(model.Sheets)+len(created))
	nextID := len(model.Sheets)
	addPivotSheet := func(name string) {
		nextID++
		out = append(out, bootstrapSheet{id: fmt.Sprintf("sheet%d", nextID), sheet: WorksheetModel{Name: name}})
	}
	for i, s := range model.Sheets {
		out = append(out, bootstrapSheet{id: fmt.Sprintf("sheet%d", i+1), sheet: s})
		for _, name := range following[s.Name] {
			addPivotSheet(name)
		}
	}
	for _, name := range trailing {
		addPivotSheet(name)
	}

	indexByName := make(map[string]int, len(out))
	for i := range out {
		indexByName[out[i].sheet.Name] = i
	}
	for _, p := range model.Pivots {
		if i, ok := indexByName[p.TargetSheetName]; ok {
			out[i].pivotID = p.ID
		}
	}
	return out
}

// BootstrapYDocFromWorkbook seeds an empty server-side Y.Doc from a
// WorkbookModel. Mirrors bootstrapYDocFromWorkbook (TS) so the wire
// shape clients see in their first SyncReply is identical to what the
// pre-removal client-side bootstrap would have written.
//
// Sheet IDs follow the same `sheet${i+1}` convention as the TS
// version. Each cell is its own nested YMap; styles land under the
// cell's `style` key as a YMap of group YMaps + flat scalars. Pivots
// land in the top-level `pivots` map (see buildPivotYMap) and mark
// their target sheet; see planBootstrapSheets for pivot sheets the
// workbook does not have.
func BootstrapYDocFromWorkbook(doc *ycrdt.Doc, model WorkbookModel) error {
	sheetsAny := doc.GetMap("sheets")
	cellsAny := doc.GetMap("cells")
	// Register the pivots top-level map even on workbooks with no
	// pivots yet, so y-crdt knows about the type before any client
	// update arrives. Without this, a peer that adds the first pivot
	// has their update applied to the server doc, but the type is
	// only visible after an explicit GetMap call — and any
	// EncodeStateAsUpdate that happens before SaveRoom touches it
	// (e.g. a late-joiner's SyncReply, or the same client tearing
	// down and re-creating its doc on a route change) misses the
	// pivot in the encoded delta.
	pivotsMap, ok := doc.GetMap("pivots").(*ycrdt.YMap)
	if !ok {
		return fmt.Errorf("calc: bootstrap: pivots map is not a YMap")
	}
	// Registered for the same reason as pivots.
	workbookMap, ok := doc.GetMap(workbookMapName).(*ycrdt.YMap)
	if !ok {
		return fmt.Errorf("calc: bootstrap: workbook map is not a YMap")
	}
	sheetsMap, ok := sheetsAny.(*ycrdt.YMap)
	if !ok {
		return fmt.Errorf("calc: bootstrap: sheets map is not a YMap")
	}
	cellsMap, ok := cellsAny.(*ycrdt.YMap)
	if !ok {
		return fmt.Errorf("calc: bootstrap: cells map is not a YMap")
	}

	doc.Transact(func(_ *ycrdt.Transaction) {
		for i, entry := range planBootstrapSheets(model) {
			sheetID, sheet := entry.id, entry.sheet
			meta := ycrdt.NewYMap(nil)
			meta.Set("name", sheet.Name)
			meta.Set("position", i)
			meta.Set("rowCount", sheet.RowCount)
			meta.Set("colCount", sheet.ColCount)
			if sheet.Color != "" {
				meta.Set("color", sheet.Color)
			}
			if sheet.Hidden {
				meta.Set("hidden", true)
			}
			if sheet.FrozenRows > 0 {
				meta.Set("frozenRows", sheet.FrozenRows)
			}
			if sheet.FrozenCols > 0 {
				meta.Set("frozenCols", sheet.FrozenCols)
			}
			if sheet.DefaultRowHeight > 0 {
				meta.Set("defaultRowHeight", sheet.DefaultRowHeight)
			}
			if sheet.DefaultColWidth > 0 {
				meta.Set("defaultColWidth", sheet.DefaultColWidth)
			}
			if entry.pivotID != "" {
				meta.Set(pivotSheetKey, entry.pivotID)
			}
			if sheet.HideGridLines {
				meta.Set(hideGridLinesKey, true)
			}
			if sheet.FilterView != nil {
				meta.Set(filterViewKey, buildFilterViewYMap(sheet.FilterView))
			}
			sheetsMap.Set(sheetID, meta)

			if len(sheet.Merges) > 0 {
				mergesMap := ycrdt.NewYMap(nil)
				wroteAny := false
				for _, m := range sheet.Merges {
					if m.RowSpan < 1 || m.ColSpan < 1 {
						continue
					}
					if m.RowSpan == 1 && m.ColSpan == 1 {
						continue
					}
					entry := ycrdt.NewYMap(nil)
					entry.Set("rowSpan", m.RowSpan)
					entry.Set("colSpan", m.ColSpan)
					mergesMap.Set(fmt.Sprintf("%d:%d", m.AnchorRow, m.AnchorCol), entry)
					wroteAny = true
				}
				if wroteAny {
					meta.Set("merges", mergesMap)
				}
			}

			// Seed the sparse per-row / per-column customization maps
			// from the imported xlsx. Without this, the serializer's
			// snapshot-is-authoritative pass would clear legitimate
			// pre-existing customizations on the first save.
			//
			// Gotcha: y-crdt's YMap.GetSize() reads from the integrated
			// `Map` field, not from `PrelimContent`. A freshly-created
			// YMap that we've called Set on N times still reports
			// GetSize()==0 until it's attached to a Doc via the parent's
			// Set call. So we track whether we wrote any entry on a
			// plain Go bool (the same shape the merges block above
			// uses) instead of asking the YMap how many entries it
			// holds. Skipping this tripped a silent no-op for all three
			// fields and broke the bootstrap→serializer round-trip.
			if len(sheet.RowHeights) > 0 {
				heightsMap := ycrdt.NewYMap(nil)
				wroteAny := false
				for row, px := range sheet.RowHeights {
					if row < 1 || px <= 0 {
						continue
					}
					heightsMap.Set(strconv.Itoa(row), px)
					wroteAny = true
				}
				if wroteAny {
					meta.Set("rowHeights", heightsMap)
				}
			}
			if len(sheet.ColWidths) > 0 {
				widthsMap := ycrdt.NewYMap(nil)
				wroteAny := false
				for col, px := range sheet.ColWidths {
					if col < 1 || px <= 0 {
						continue
					}
					widthsMap.Set(strconv.Itoa(col), px)
					wroteAny = true
				}
				if wroteAny {
					meta.Set("colWidths", widthsMap)
				}
			}
			if len(sheet.ConditionalFormats) > 0 {
				cfArr := buildConditionalFormatsYArray(sheet.ConditionalFormats)
				if cfArr != nil {
					meta.Set("conditionalFormats", cfArr)
				}
			}

			if len(sheet.RowStyles) > 0 {
				stylesMap := ycrdt.NewYMap(nil)
				wroteAny := false
				for row, style := range sheet.RowStyles {
					if row < 1 || style == nil {
						continue
					}
					if built := buildStyleYMapFromStyle(style); built != nil {
						stylesMap.Set(strconv.Itoa(row), built)
						wroteAny = true
					}
				}
				if wroteAny {
					meta.Set("rowStyles", stylesMap)
				}
			}

			for localKey, value := range sheet.Cells {
				row, col, ok := parseLocalCellKey(localKey)
				if !ok {
					continue
				}
				cell := ycrdt.NewYMap(nil)
				cell.Set("kind", value.Kind)
				cell.Set("raw", normalizeCellRawForY(value.Raw))
				cell.Set("display", value.Display)
				if value.Formula != "" {
					cell.Set("formula", value.Formula)
				}
				if value.Link != "" {
					cell.Set(linkKey, value.Link)
				}
				if value.Style != nil {
					if styleMap := buildStyleYMapFromStyle(value.Style); styleMap != nil {
						cell.Set("style", styleMap)
					}
				}
				cellsMap.Set(fmt.Sprintf("%s:%d:%d", sheetID, row, col), cell)
			}
		}
		for _, p := range model.Pivots {
			pivotsMap.Set(p.ID, buildPivotYMap(p))
		}
		if model.DefaultFont != nil {
			font := ycrdt.NewYMap(nil)
			if model.DefaultFont.Name != "" {
				font.Set("name", model.DefaultFont.Name)
			}
			if model.DefaultFont.Size > 0 {
				font.Set("size", normalizeCellRawForY(model.DefaultFont.Size))
			}
			workbookMap.Set(defaultFontKey, font)
		}
		workbookMap.Set(sheetFactsSeededKey, true)
	}, nil)
	return nil
}

// Keys of the top-level workbook map (WORKBOOK_MAP in
// tinycld/calc/lib/workbook-default-font.ts) and the sheet meta keys the
// sheet facts use.
const (
	workbookMapName = "workbook"
	// defaultFontKey holds the workbook default font: a Y.Map {name,
	// size} with size in points. A fractional size is the single-element
	// array wrapper normalizeCellRawForY writes (read it with
	// numberFromYRaw); y-crdt cannot store a bare float.
	defaultFontKey = "defaultFont"
	// sheetFactsSeededKey marks a doc whose bootstrap seeded the sheet
	// facts — gridlines, filter views and hyperlinks — from the file.
	// Only such a doc is authoritative for them on save: a doc
	// bootstrapped earlier has none of those keys, and treating that
	// absence as "removed" would strip every link and filter from the
	// file on its first save.
	sheetFactsSeededKey = "sheetFactsSeeded"
	hideGridLinesKey    = "hideGridLines"
)

// parseLocalCellKey splits "row:col" (the TS local key, scoped to one
// sheet) into its two integers. Returns ok=false on malformed input;
// caller skips the cell.
func parseLocalCellKey(key string) (int, int, bool) {
	parts := strings.SplitN(key, ":", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	row, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, 0, false
	}
	col, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, 0, false
	}
	if row <= 0 || col <= 0 {
		return 0, 0, false
	}
	return row, col, true
}

// normalizeRawForY normalizes a parsed raw scalar into the form
// y-crdt's TypeMapSet accepts. The library's content_any path only
// recognizes a narrow set of types: string, bool, int (its `Number`
// alias), float32/float64 are NOT accepted by direct Set even though
// they ARE on the binary-update encode path.
//
// This is the STYLE/OPAQUE-leaf normalizer: fractional floats become a
// numeric string that the corresponding decoders (coerceNumericStringLeaves
// for style, JSON re-marshal for the opaque conditional-format blob)
// already parse back into a number. The cell-raw path uses
// normalizeCellRawForY instead, which keeps the value genuinely numeric.
//   - whole-number float64 → int (the only numeric Set supports)
//   - fractional float64 → numeric string (round-tripped by the leaf
//     decoders above)
//   - bool / string / nil pass through
func normalizeRawForY(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case bool:
		return x
	case float64:
		if x == float64(int(x)) {
			return int(x)
		}
		return formatNumber(x)
	case int:
		return x
	case string:
		return x
	default:
		return fmt.Sprintf("%v", x)
	}
}

// normalizeCellRawForY is the cell-`raw` variant of normalizeRawForY. It
// differs in exactly one case: a FRACTIONAL float64 is boxed into a
// single-element ArrayAny{float64} instead of being stringified.
//
// TypeMapSet's content_any path accepts a narrow set of top-level types
// (string, bool, int, Object, ArrayAny) and silently DROPS a bare
// float64 — its type switch has no float case, and the prelim value is
// re-Set through TypeMapSet on Integrate, so the key never lands. But
// float64 IS supported on the binary WriteAny/ReadAny path (type byte
// 123), and the contents of an ArrayAny go through WriteAny. So the
// single-element array is the smallest wrapper that keeps the number
// genuinely NUMERIC end-to-end — fixing a fractional numeric cell
// silently degrading to text on realtime bootstrap (which then reads
// back as a string and breaks SUM/arithmetic on the server snapshot).
// Read back with unwrapYRawNumber (server) / numberFromYRaw (client).
//
// A single-element array is chosen over an Object wrapper because it also
// coerces gracefully via JS `Number([13.5]) === 13.5` for any reader that
// predates the wrapper.
func normalizeCellRawForY(v any) any {
	if f, ok := v.(float64); ok && f != float64(int(f)) {
		return ycrdt.ArrayAny{f}
	}
	return normalizeRawForY(v)
}

// unwrapYRawNumber recovers a numeric value from a `raw` read out of the
// doc, returning (n, true) when the value is numeric. It handles both
// the wrapped fractional form written by normalizeCellRawForY (a
// single-element ArrayAny holding a float) and the bare int Set writes
// for whole numbers. It does NOT coerce numeric-looking strings — a
// string raw stays a string here so legacy-string handling continues to
// route through the existing kind-aware fallback in writeSnapshotCellValue.
func unwrapYRawNumber(raw any) (float64, bool) {
	switch v := raw.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int32:
		return float64(v), true
	case int64:
		return float64(v), true
	case ycrdt.ArrayAny:
		// ycrdt.ArrayAny is an alias for []any; this case matches both
		// the wrapper we write and any equivalent decoded slice.
		if len(v) == 1 {
			return unwrapYRawNumber(v[0])
		}
	}
	return 0, false
}

// buildStyleYMapFromStyle converts a *CellStyle (the JSON-tagged Go
// shape) into the nested YMap tree the runtime's collectCells
// decoder expects. Mirrors the TS buildStyleYMap (y-doc-bootstrap.ts).
//
// The walk is reflect-driven and follows the json tags on CellStyle /
// CellFont / CellFill / CellAlignment / CellBorders. Only non-nil
// pointer leaves are emitted; an entirely-empty style returns nil so
// callers can skip the `style` cell key.
//
// Adding a new CellStyle field is purely additive: declare the field
// (with a camelCase json tag) on the Go and TS sides, register it in
// styleAttributeRegistry if its overlay isn't structurally 1:1, and
// every path — overlay, extract, bootstrap emit, audit — picks it up.
func buildStyleYMapFromStyle(style *CellStyle) *ycrdt.YMap {
	if style == nil {
		return nil
	}
	root := ycrdt.NewYMap(nil)
	if !emitStyleYMap(reflect.ValueOf(style).Elem(), root) {
		return nil
	}
	return root
}

// emitStyleYMap walks the leaves of one CellStyle-shaped struct value
// onto a YMap. Pointer-to-struct fields recurse into a nested YMap
// keyed by the field's json tag. Pointer-to-scalar fields land as a
// leaf on the current YMap. Returns true when at least one leaf was
// written, so the caller can decide whether to attach this group to
// its parent at all.
//
// Float64 leaves (Font.Size today) go through normalizeRawForY before
// being Set on the YMap. y-crdt's Go TypeMapSet only accepts
// Number(=int)|Object|bool|ArrayAny|string and silently drops a
// float64. The TS side bootstrap stores numbers natively because Yjs
// has no integer/float split there; the Go side needs the same
// coercion the cell-raw path uses.
func emitStyleYMap(src reflect.Value, dst *ycrdt.YMap) bool {
	if src.Kind() != reflect.Struct {
		return false
	}
	srcType := src.Type()
	wrote := false
	for i := range src.NumField() {
		field := src.Field(i)
		if field.Kind() != reflect.Pointer || field.IsNil() {
			continue
		}
		key := jsonFieldKey(srcType.Field(i))
		if key == "" {
			continue
		}
		elem := field.Elem()
		if elem.Kind() == reflect.Struct {
			group := ycrdt.NewYMap(nil)
			if emitStyleYMap(elem, group) {
				dst.Set(key, group)
				wrote = true
			}
			continue
		}
		value := elem.Interface()
		if f, ok := value.(float64); ok {
			value = normalizeRawForY(f)
		}
		dst.Set(key, value)
		wrote = true
	}
	return wrote
}

// jsonFieldKey returns the camelCase wire key for a Go struct field,
// derived from its json tag. Tagless fields (none of our style structs
// have any) are skipped.
func jsonFieldKey(field reflect.StructField) string {
	tag := field.Tag.Get("json")
	if tag == "" {
		return ""
	}
	for i := 0; i < len(tag); i++ {
		if tag[i] == ',' {
			return tag[:i]
		}
	}
	return tag
}

// buildConditionalFormatsYArray seeds the per-sheet rules Y.Array
// from imported model rules. Shape MUST stay in sync with the TS
// y-binding writeRule (lib/conditional-format/y-binding.ts) — same
// field names and nesting so a peer joining mid-session via doc
// update sees a structurally identical tree.
//
// Returns nil when no rules pass the structural sanity check (id +
// at least one range, or an opaque blob), so callers can skip the
// meta key.
func buildConditionalFormatsYArray(rules []ConditionalFormatRule) *ycrdt.YArray {
	if len(rules) == 0 {
		return nil
	}
	items := ycrdt.ArrayAny{}
	for _, rule := range rules {
		if rule.ID == "" {
			continue
		}
		m := ycrdt.NewYMap(nil)
		m.Set("id", rule.ID)
		ranges := ycrdt.ArrayAny{}
		for _, r := range rule.Ranges {
			if r == "" {
				continue
			}
			ranges = append(ranges, r)
		}
		m.Set("ranges", newYArrayOf(ranges))
		condMap := ycrdt.NewYMap(nil)
		condMap.Set("type", rule.Condition.Type)
		if rule.Condition.Value1 != nil {
			condMap.Set("value1", *rule.Condition.Value1)
		}
		if rule.Condition.Value2 != nil {
			condMap.Set("value2", *rule.Condition.Value2)
		}
		if rule.Condition.Formula != nil && *rule.Condition.Formula != "" {
			condMap.Set("formula", *rule.Condition.Formula)
		}
		if rule.Condition.OpaqueXlsx != nil {
			opaqueMap := ycrdt.NewYMap(nil)
			for k, v := range rule.Condition.OpaqueXlsx {
				opaqueMap.Set(k, normalizeRawForY(v))
			}
			condMap.Set("opaqueXlsx", opaqueMap)
		}
		m.Set("condition", condMap)
		if rule.Style != nil {
			if styleMap := buildStyleYMapFromStyle(rule.Style); styleMap != nil {
				m.Set("style", styleMap)
			}
		}
		items = append(items, m)
	}
	if len(items) == 0 {
		return nil
	}
	return newYArrayOf(items)
}

// newYArrayOf returns a detached Y.Array holding items in order. y-crdt
// inserts a Push on a detached array at its integrated length, which is
// always 0 before the array joins a doc, so pushing items one at a time
// stores them reversed. A single push keeps the order.
func newYArrayOf(items ycrdt.ArrayAny) *ycrdt.YArray {
	arr := ycrdt.NewYArray()
	if len(items) > 0 {
		arr.Push(items)
	}
	return arr
}
