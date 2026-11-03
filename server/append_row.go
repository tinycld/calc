package calc

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	ycrdt "github.com/skyterra/y-crdt"

	"tinycld.org/core/automation"
)

var errNoSheet = errors.New("the workbook has no sheet with that name")

// appendRowToDoc writes one row of values to a sheet of a workbook doc: the
// first sheet a person can see when sheetName is empty. Each value goes
// under the row-1 header with the same text (trimmed, case-blind); a label
// with no header gets a new header after the last one, so an empty sheet
// gets a header row from the labels. The row is the one below the last row
// that holds a value. Values are never formulas: a visitor's "=…" is text.
func appendRowToDoc(doc *ycrdt.Doc, sheetName string, values []automation.RowValue) (int, error) {
	sheetsMap, ok := doc.GetMap("sheets").(*ycrdt.YMap)
	if !ok {
		return 0, fmt.Errorf("calc: workbook has no sheets map")
	}
	cellsMap, ok := doc.GetMap("cells").(*ycrdt.YMap)
	if !ok {
		return 0, fmt.Errorf("calc: workbook has no cells map")
	}
	sheets, err := collectSheets(sheetsMap)
	if err != nil {
		return 0, err
	}
	sheetID, err := pickSheet(sheetsMap, sheets, sheetName)
	if err != nil {
		return 0, err
	}
	cells, err := collectCells(cellsMap)
	if err != nil {
		return 0, err
	}

	headers := map[string]int{}
	lastHeaderCol, lastRow := 0, 1
	for _, c := range cells {
		if c.SheetID != sheetID || !cellHasText(c) {
			continue
		}
		if c.Row == 1 {
			key := headerKey(c.Display)
			if _, seen := headers[key]; !seen {
				headers[key] = c.Col
			}
			lastHeaderCol = max(lastHeaderCol, c.Col)
		}
		lastRow = max(lastRow, c.Row)
	}
	row := lastRow + 1

	used := map[int]bool{}
	type placed struct {
		col   int
		value automation.RowValue
	}
	var writes []placed
	var newHeaders []placed
	for _, v := range uniqueLabels(values) {
		col, found := headers[headerKey(v.Label)]
		if !found || used[col] {
			lastHeaderCol++
			col = lastHeaderCol
			headers[headerKey(v.Label)] = col
			newHeaders = append(newHeaders, placed{col, v})
		}
		used[col] = true
		writes = append(writes, placed{col, v})
	}

	doc.Transact(func(_ *ycrdt.Transaction) {
		for _, h := range newHeaders {
			cellsMap.Set(cellKey(sheetID, 1, h.col), textCell(h.value.Label))
		}
		for _, w := range writes {
			if cell := cellForValue(w.value); cell != nil {
				cellsMap.Set(cellKey(sheetID, row, w.col), cell)
			}
		}
		growSheet(sheetsMap, sheetID, row, lastHeaderCol)
	}, nil)
	return row, nil
}

// pickSheet finds the sheet by name, or the first visible, non-pivot sheet.
func pickSheet(sheetsMap *ycrdt.YMap, sheets []SheetMeta, name string) (string, error) {
	want := headerKey(name)
	for _, s := range sheets {
		if want != "" {
			if headerKey(s.Name) == want {
				return s.ID, nil
			}
			continue
		}
		if s.Hidden || isPivotSheet(sheetsMap, s.ID) {
			continue
		}
		return s.ID, nil
	}
	if want == "" {
		return "", fmt.Errorf("%w: the workbook has no visible sheet", errNoSheet)
	}
	return "", fmt.Errorf("%w: %q", errNoSheet, strings.TrimSpace(name))
}

func isPivotSheet(sheetsMap *ycrdt.YMap, id string) bool {
	meta, ok := sheetsMap.Get(id).(*ycrdt.YMap)
	if !ok {
		return false
	}
	pivot, _ := meta.Get(pivotSheetKey).(string)
	return pivot != ""
}

// growSheet raises the sheet's grid extent so the new row and columns show.
func growSheet(sheetsMap *ycrdt.YMap, sheetID string, row, col int) {
	meta, ok := sheetsMap.Get(sheetID).(*ycrdt.YMap)
	if !ok {
		return
	}
	if numberFromAny(meta.Get("rowCount")) < row {
		meta.Set("rowCount", row)
	}
	if numberFromAny(meta.Get("colCount")) < col {
		meta.Set("colCount", col)
	}
}

func headerKey(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func cellHasText(c CellEntry) bool {
	return c.Display != "" || c.Formula != "" || c.RawString != "" || c.RawNumber != nil || c.RawBool != nil
}

func cellKey(sheetID string, row, col int) string {
	return sheetID + ":" + strconv.Itoa(row) + ":" + strconv.Itoa(col)
}

// uniqueLabels gives a repeated label a " (2)", " (3)" … suffix, so two
// answers labelled "Name" land in two columns rather than one overwriting
// the other.
func uniqueLabels(values []automation.RowValue) []automation.RowValue {
	seen := map[string]int{}
	out := make([]automation.RowValue, len(values))
	for i, v := range values {
		key := headerKey(v.Label)
		seen[key]++
		if n := seen[key]; n > 1 {
			v.Label = fmt.Sprintf("%s (%d)", v.Label, n)
		}
		out[i] = v
	}
	return out
}

func textCell(s string) *ycrdt.YMap {
	cell := ycrdt.NewYMap(nil)
	cell.Set("kind", "string")
	cell.Set("raw", s)
	cell.Set("display", s)
	return cell
}

// cellForValue is the doc cell for one value, or nil for an empty one.
func cellForValue(v automation.RowValue) *ycrdt.YMap {
	switch x := v.Value.(type) {
	case nil:
		return nil
	case float64:
		cell := ycrdt.NewYMap(nil)
		cell.Set("kind", "number")
		cell.Set("raw", normalizeCellRawForY(x))
		cell.Set("display", formatDisplay("number", x, ""))
		return cell
	case bool:
		cell := ycrdt.NewYMap(nil)
		cell.Set("kind", "boolean")
		cell.Set("raw", x)
		cell.Set("display", formatDisplay("boolean", x, ""))
		return cell
	case string:
		if x == "" {
			return nil
		}
		if v.Type == "date" {
			if t, ok := parseDateValue(x); ok {
				raw := dateRawString(t)
				cell := ycrdt.NewYMap(nil)
				cell.Set("kind", "date")
				cell.Set("raw", raw)
				cell.Set("display", formatDisplay("date", raw, ""))
				return cell
			}
		}
		return textCell(x)
	default:
		return textCell(fmt.Sprint(x))
	}
}

func parseDateValue(s string) (time.Time, bool) {
	for _, layout := range []string{"2006-01-02", time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
