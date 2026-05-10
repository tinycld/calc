package calc

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"
	"time"

	ycrdt "github.com/skyterra/y-crdt"
	"github.com/xuri/excelize/v2"
)

// WorkbookModel mirrors the TS WorkbookModel
// (tinycld/calc/lib/workbook-types.ts). It is the same shape returned
// by the /api/calc/preview/:id endpoint and consumed by the YDoc
// bootstrap path on first joiner. Field names use camelCase JSON tags
// so the wire shape matches the TS interface byte-for-byte.
type WorkbookModel struct {
	Sheets []WorksheetModel `json:"sheets"`
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
	// source xlsx via excelize.GetMergeCells.
	Merges []MergeRangeDTO `json:"merges,omitempty"`
	// FrozenRows / FrozenCols mirror the xlsx <pane> ySplit /
	// xSplit when state="frozen". Zero on either axis means "no
	// freeze on this axis"; the doc bootstrap omits the meta key
	// rather than writing 0 so a freeze-less sheet adds no bytes.
	FrozenRows int `json:"frozenRows,omitempty"`
	FrozenCols int `json:"frozenCols,omitempty"`
}

// MergeRangeDTO mirrors the TS MergeRangeModel: a merged cell anchor
// (top-left) plus span dimensions. Round-trips through excelize.
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
	f, err := excelize.OpenReader(bytes.NewReader(xlsxBytes))
	if err != nil {
		return WorkbookModel{}, fmt.Errorf("calc: open xlsx: %w", err)
	}
	defer func() { _ = f.Close() }()

	sheetNames := f.GetSheetList()
	out := WorkbookModel{Sheets: make([]WorksheetModel, 0, len(sheetNames))}

	for _, sheetName := range sheetNames {
		ws, err := readWorksheet(f, sheetName, rowCap, colCap)
		if err != nil {
			return WorkbookModel{}, fmt.Errorf("calc: read sheet %q: %w", sheetName, err)
		}
		out.Sheets = append(out.Sheets, ws)
	}
	return out, nil
}

func readWorksheet(f *excelize.File, sheetName string, rowCap, colCap int) (WorksheetModel, error) {
	rows, err := f.GetRows(sheetName)
	if err != nil {
		return WorksheetModel{}, err
	}
	// Tab color + visibility live on the worksheet props. Errors here
	// are non-fatal (fall back to absent / visible) — older xlsx files
	// without sheet-level styling shouldn't break the import.
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
			cell, ok := readWorkbookCell(f, sheetName, ref)
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
	merges, _ := readMerges(f, sheetName)
	frozenRows, frozenCols := readWorksheetFreeze(f, sheetName)
	return WorksheetModel{
		Name:       sheetName,
		RowCount:   rowCount,
		ColCount:   colCount,
		Cells:      cells,
		Color:      tabColor,
		Hidden:     hidden,
		Merges:     merges,
		FrozenRows: frozenRows,
		FrozenCols: frozenCols,
	}, nil
}

// readMerges extracts the sheet's merged cell rectangles via
// excelize.GetMergeCells and converts each to a MergeRangeDTO. Returns
// nil (not error) on any individual parse failure so a malformed entry
// doesn't poison the whole sheet load.
func readMerges(f *excelize.File, sheetName string) ([]MergeRangeDTO, error) {
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

// readWorksheetFreeze pulls the xlsx <pane> ySplit/xSplit off the
// sheet via excelize.GetPanes when state="frozen". Returns (0, 0) for
// any sheet that isn't frozen — including split-pane sheets, which we
// don't surface to the doc today (split panes are a different UX
// affordance with no calc-side equivalent yet).
func readWorksheetFreeze(f *excelize.File, sheetName string) (int, int) {
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

// readWorkbookCell extracts a single cell into the typed CellValueDTO shape.
// Returns ok=false for empty cells (no value, no formula) so the
// caller can skip them — keeping the on-wire JSON small and matching
// the TS parser which skips includeEmpty=false cells.
//
// Classification rules:
//   - formula present → kind=formula, raw=cached scalar (best-effort)
//   - excelize cell type Bool/Number/Date/SharedString/InlineString/...
func readWorkbookCell(f *excelize.File, sheet, ref string) (CellValueDTO, bool) {
	formula, _ := f.GetCellFormula(sheet, ref)
	rawStr, _ := f.GetCellValue(sheet, ref)
	cellType, _ := f.GetCellType(sheet, ref)
	style := readWorkbookCellStyle(f, sheet, ref)
	hasAny := formula != "" || rawStr != ""

	if !hasAny {
		return CellValueDTO{}, false
	}

	if formula != "" {
		raw := classifyScalar(rawStr, cellType)
		display := formatDisplay("formula", raw, formula)
		return CellValueDTO{
			Kind:    "formula",
			Raw:     raw,
			Display: display,
			Formula: formula,
			Style:   style,
		}, true
	}

	kind, raw := classifyValue(rawStr, cellType)
	display := formatDisplay(kind, raw, "")
	return CellValueDTO{
		Kind:    kind,
		Raw:     raw,
		Display: display,
		Style:   style,
	}, true
}

// classifyValue maps an excelize (rawString, cellType) pair to our
// (kind, raw) shape. excelize returns the cell value as a string in
// every case — the cell type tells us what semantic interpretation to
// apply.
func classifyValue(rawStr string, cellType excelize.CellType) (string, any) {
	switch cellType {
	case excelize.CellTypeBool:
		return "boolean", rawStr == "1" || strings.EqualFold(rawStr, "true")
	case excelize.CellTypeNumber, excelize.CellTypeUnset:
		// CellTypeUnset is excelize's default for numeric cells with
		// no explicit type tag. Fall through to numeric coercion;
		// non-numeric strings land in the string branch below.
		if n, err := strconv.ParseFloat(rawStr, 64); err == nil {
			return "number", n
		}
		return "string", rawStr
	case excelize.CellTypeDate:
		// excelize formats date cells as their display string; carry
		// that through as a string raw to match the ISO-string
		// convention the TS side uses for dates in YDoc.
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

// classifyScalar is the formula-cached-value variant — we know the
// cell IS a formula (handled separately) and only need to coerce the
// cached scalar into raw form.
func classifyScalar(rawStr string, cellType excelize.CellType) any {
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

// readWorkbookCellStyle extracts the subset of cell styling we currently
// track — today only font.bold, mirroring extractCellStyle in
// xlsx-adapter.ts. New attributes land here additively as they're
// added to CellStyle.
func readWorkbookCellStyle(f *excelize.File, sheet, ref string) *CellStyle {
	id, err := f.GetCellStyle(sheet, ref)
	if err != nil || id == 0 {
		return nil
	}
	style, err := f.GetStyle(id)
	if err != nil || style == nil {
		return nil
	}
	if style.Font != nil && style.Font.Bold {
		bold := true
		return &CellStyle{Font: &CellFont{Bold: &bold}}
	}
	return nil
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

			for localKey, value := range sheet.Cells {
				row, col, ok := parseLocalCellKey(localKey)
				if !ok {
					continue
				}
				cell := ycrdt.NewYMap(nil)
				cell.Set("kind", value.Kind)
				cell.Set("raw", normalizeRawForY(value.Raw))
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
//   - whole-number float64 → int (the only numeric Set supports)
//   - fractional float64 → string (lossy display fallback; the
//     remaining float→int gap is rare in xlsx imports and a future
//     "go through binary update" rework is the right fix when it
//     starts mattering)
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

// buildStyleYMapFromStyle converts a *CellStyle (the JSON-tagged Go
// shape) into the nested YMap tree the runtime's collectCells
// decoder expects. Mirrors the TS buildStyleYMap (y-doc-bootstrap.ts).
//
// Only fields that are actually set are written; an entirely-empty
// style returns nil so callers can skip the `style` cell key.
func buildStyleYMapFromStyle(style *CellStyle) *ycrdt.YMap {
	if style == nil {
		return nil
	}
	root := ycrdt.NewYMap(nil)
	hasAny := false
	if style.Font != nil {
		group := ycrdt.NewYMap(nil)
		groupAny := false
		if style.Font.Bold != nil {
			group.Set("bold", *style.Font.Bold)
			groupAny = true
		}
		if style.Font.Italic != nil {
			group.Set("italic", *style.Font.Italic)
			groupAny = true
		}
		if style.Font.Underline != nil {
			group.Set("underline", *style.Font.Underline)
			groupAny = true
		}
		if style.Font.Size != nil {
			group.Set("size", *style.Font.Size)
			groupAny = true
		}
		if style.Font.Name != nil {
			group.Set("name", *style.Font.Name)
			groupAny = true
		}
		if style.Font.Color != nil {
			group.Set("color", *style.Font.Color)
			groupAny = true
		}
		if groupAny {
			root.Set("font", group)
			hasAny = true
		}
	}
	if style.NumFmt != nil {
		root.Set("numFmt", *style.NumFmt)
		hasAny = true
	}
	if !hasAny {
		return nil
	}
	return root
}
