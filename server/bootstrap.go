package calc

import (
	"fmt"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/nathanstitt/doctaculous/pkg/xlsx"
	ycrdt "github.com/skyterra/y-crdt"
)

// WorkbookModel mirrors the TS WorkbookModel
// (tinycld/calc/lib/workbook-types.ts). It is the same shape returned
// by the /api/calc/preview/:id endpoint and consumed by the YDoc
// bootstrap path on first joiner. Field names use camelCase JSON tags
// so the wire shape matches the TS interface byte-for-byte.
type WorkbookModel struct {
	Sheets []WorksheetModel     `json:"sheets"`
	Pivots []PivotDefinitionDTO `json:"pivots,omitempty"`
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
}

// ReadWorkbookFromXLSX parses xlsx bytes into a WorkbookModel suitable
// for both the preview endpoint and the YDoc bootstrap. Mirrors the TS
// parseWorkbook (tinycld/calc/lib/xlsx-adapter.ts) so the resulting
// shape decodes identically on the client side.
//
// rowCap and colCap (when > 0) bound the per-sheet read for the
// preview endpoint; pass 0 for the bootstrap path which needs the
// full grid.
func ReadWorkbookFromXLSX(xlsxBytes []byte, rowCap, colCap int) (WorkbookModel, error) {
	if len(xlsxBytes) == 0 {
		return WorkbookModel{}, fmt.Errorf("calc: ReadWorkbookFromXLSX: empty input")
	}
	wb, err := xlsx.OpenBytes(xlsxBytes)
	if err != nil {
		return WorkbookModel{}, fmt.Errorf("calc: open xlsx: %w", err)
	}
	// Resolve legacy indexed palette colors to plain RGB before any
	// style conversion — see indexed_palette.go for scope and rationale.
	resolveWorkbookIndexedColors(wb, indexedPaletteFromStyles(xlsxBytes))

	out := WorkbookModel{Sheets: make([]WorksheetModel, 0, len(wb.Sheets))}
	for i := range wb.Sheets {
		out.Sheets = append(out.Sheets, readWorksheet(&wb.Sheets[i], rowCap, colCap))
	}
	pivots, err := readPivots(xlsxBytes)
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
func ensureDistinctTargets(pivots []PivotDefinitionDTO, sheets []WorksheetModel) []PivotDefinitionDTO {
	taken := make(map[string]bool, len(sheets))
	cellCount := make(map[string]int, len(sheets))
	for _, s := range sheets {
		taken[s.Name] = true
		cellCount[s.Name] = len(s.Cells)
	}
	for i, p := range pivots {
		if cellCount[p.TargetSheetName] > 0 {
			n := 2
			base := fmt.Sprintf("%s pivot", strings.TrimSpace(p.TargetSheetName))
			candidate := base
			for taken[candidate] {
				candidate = fmt.Sprintf("%s (%d)", base, n)
				n++
			}
			pivots[i].TargetSheetName = candidate
			taken[candidate] = true
		}
	}
	return pivots
}

// readWorksheet converts one parsed doctaculous sheet into the
// WorksheetModel wire shape. The doctaculous grid is dense over the
// used range and 0-BASED; every index converts to calc's 1-based
// convention immediately inside this function so no 0-based index
// escapes the seam.
func readWorksheet(sheet *xlsx.Sheet, rowCap, colCap int) WorksheetModel {
	tabColor := ""
	if sheet.TabColorRGB != "" {
		tabColor = "#" + sheet.TabColorRGB
	}
	cells := make(map[string]CellValueDTO)
	maxRow, maxCol := 0, 0

	// maxRow/maxCol track CONTRIBUTING cells only. The dense grid also
	// covers style-only cells (a border on an otherwise-empty cell
	// widens the used range), but the model's row/col counts follow the
	// excelize-era semantics: the extent of cells carrying a value or
	// formula.
	for r := range sheet.Cells {
		rowNumber := r + 1
		if rowCap > 0 && rowNumber > rowCap {
			break
		}
		for c := range sheet.Cells[r] {
			colNumber := c + 1
			if colCap > 0 && colNumber > colCap {
				break
			}
			cell, ok := readWorkbookCell(&sheet.Cells[r][c])
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
		Hidden:             sheet.Hidden,
		Merges:             readMerges(sheet.Merges),
		FrozenRows:         frozenRows,
		FrozenCols:         frozenCols,
		RowHeights:         readRowHeights(sheet),
		ColWidths:          readColWidths(sheet, colCount),
		RowStyles:          readRowStyles(sheet),
		ConditionalFormats: readConditionalFormats(sheet),
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
// Returns ok=false for cells that don't contribute — no formula and no
// typed value (an empty-string value counts as no value) — so the
// caller can skip them, keeping the on-wire JSON small and matching
// the TS parser which skips includeEmpty=false cells. Style-only cells
// are therefore invisible to the doc, same as the excelize era.
//
// Classification comes straight off the typed cached value; formulas
// arrive without the leading "=" and with shared formulas already
// expanded per member cell.
func readWorkbookCell(cell *xlsx.Cell) (CellValueDTO, bool) {
	if cell.Formula == "" && !cellHasValue(cell.Value) {
		return CellValueDTO{}, false
	}
	// Cells on the DEFAULT xf (StyleID 0) are untracked, matching the
	// excelize-era reader. doctaculous resolves xf 0 like any other, so
	// without this guard every unstyled cell would seed the workbook's
	// default font (e.g. Calibri 11) into the Y.Doc as a per-cell style
	// — bloating the doc and stamping explicit styles back on every
	// save.
	var style *CellStyle
	if cell.StyleID != 0 {
		style = styleToCellStyle(cell.Style)
	}

	if cell.Formula != "" {
		raw := classifyScalar(cell.Value)
		display := formatDisplay("formula", raw, cell.Formula)
		return CellValueDTO{
			Kind:    "formula",
			Raw:     raw,
			Display: display,
			Formula: cell.Formula,
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
func classifyScalar(v xlsx.Value) any {
	switch v.Kind {
	case xlsx.KindNumber:
		return v.F
	case xlsx.KindBool:
		return v.B
	case xlsx.KindDate:
		return dateRawString(v.T)
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

// BootstrapYDocFromWorkbook seeds an empty server-side Y.Doc from a
// WorkbookModel. Mirrors bootstrapYDocFromWorkbook (TS) so the wire
// shape clients see in their first SyncReply is identical to what the
// pre-removal client-side bootstrap would have written.
//
// Sheet IDs follow the same `sheet${i+1}` convention as the TS
// version. Each cell is its own nested YMap; styles land under the
// cell's `style` key as a YMap of group YMaps + flat scalars.
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
	doc.GetMap("pivots")
	sheetsMap, ok := sheetsAny.(*ycrdt.YMap)
	if !ok {
		return fmt.Errorf("calc: bootstrap: sheets map is not a YMap")
	}
	cellsMap, ok := cellsAny.(*ycrdt.YMap)
	if !ok {
		return fmt.Errorf("calc: bootstrap: cells map is not a YMap")
	}

	doc.Transact(func(_ *ycrdt.Transaction) {
		for i, sheet := range model.Sheets {
			sheetID := fmt.Sprintf("sheet%d", i+1)
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
				if value.Style != nil {
					if styleMap := buildStyleYMapFromStyle(value.Style); styleMap != nil {
						cell.Set("style", styleMap)
					}
				}
				cellsMap.Set(fmt.Sprintf("%s:%d:%d", sheetID, row, col), cell)
			}
		}
	}, nil)
	return nil
}

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
	arr := ycrdt.NewYArray()
	wroteAny := false
	for _, rule := range rules {
		if rule.ID == "" {
			continue
		}
		m := ycrdt.NewYMap(nil)
		m.Set("id", rule.ID)
		rangesArr := ycrdt.NewYArray()
		for _, r := range rule.Ranges {
			if r == "" {
				continue
			}
			rangesArr.Push(ycrdt.ArrayAny{r})
		}
		m.Set("ranges", rangesArr)
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
		arr.Push(ycrdt.ArrayAny{m})
		wroteAny = true
	}
	if !wroteAny {
		return nil
	}
	return arr
}
