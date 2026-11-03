package calc

import (
	"errors"
	"strconv"
	"testing"

	"tinycld.org/core/automation"
)

func headerModel(headers ...string) WorkbookModel {
	cells := map[string]CellValueDTO{}
	for i, h := range headers {
		cells[cellKeyRC(1, i+1)] = CellValueDTO{Kind: "string", Raw: h, Display: h}
	}
	return WorkbookModel{Sheets: []WorksheetModel{{Name: "Sheet1", RowCount: 1, ColCount: len(headers), Cells: cells}}}
}

func cellKeyRC(row, col int) string { return strconv.Itoa(row) + ":" + strconv.Itoa(col) }

func display(t *testing.T, h *sheetsDocHandle, row, col int) string {
	t.Helper()
	snap, err := h.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	c, _ := findSnapshotCell(snap, "sheet1", row, col)
	return c.Display
}

func TestAppendRowWritesHeadersIntoAnEmptySheet(t *testing.T) {
	h, _ := bootstrapAndSnapshot(t, WorkbookModel{Sheets: []WorksheetModel{{Name: "Sheet1", RowCount: 1, ColCount: 1, Cells: map[string]CellValueDTO{}}}})
	row, err := appendRowToDoc(h.doc, "", []automation.RowValue{
		{Label: "Name", Type: "text", Value: "Ada"},
		{Label: "Age", Type: "number", Value: 36.5},
	})
	if err != nil || row != 2 {
		t.Fatalf("row %d err %v, want row 2", row, err)
	}
	if display(t, h, 1, 1) != "Name" || display(t, h, 1, 2) != "Age" || display(t, h, 2, 1) != "Ada" || display(t, h, 2, 2) != "36.5" {
		t.Fatal("headers from the labels, values under them")
	}
}

func TestAppendRowMatchesHeadersAndAddsNewOnes(t *testing.T) {
	h, _ := bootstrapAndSnapshot(t, headerModel(" email ", "Notes", "NAME"))
	row, err := appendRowToDoc(h.doc, "", []automation.RowValue{
		{Label: "Name", Type: "text", Value: "Ada"},
		{Label: "Email", Type: "text", Value: "a@b.example"},
		{Label: "Phone", Type: "text", Value: "555"},
	})
	if err != nil || row != 2 {
		t.Fatalf("row %d err %v", row, err)
	}
	if display(t, h, 2, 3) != "Ada" || display(t, h, 2, 1) != "a@b.example" || display(t, h, 2, 2) != "" {
		t.Fatal("each value goes under the header with its text, trimmed and case-blind")
	}
	if display(t, h, 1, 4) != "Phone" || display(t, h, 2, 4) != "555" {
		t.Fatal("a label with no header gets a new column after the last header")
	}
	if display(t, h, 1, 1) != " email " {
		t.Fatal("an existing header is never rewritten")
	}
}

func TestAppendRowGoesBelowTheLastRowWithAValue(t *testing.T) {
	m := headerModel("Name")
	m.Sheets[0].Cells[cellKeyRC(2, 1)] = CellValueDTO{Kind: "string", Raw: "first", Display: "first"}
	m.Sheets[0].Cells[cellKeyRC(5, 3)] = CellValueDTO{Kind: "number", Raw: float64(1), Display: "1"}
	m.Sheets[0].RowCount = 5
	h, _ := bootstrapAndSnapshot(t, m)
	row, err := appendRowToDoc(h.doc, "", []automation.RowValue{{Label: "Name", Type: "text", Value: "next"}})
	if err != nil || row != 6 {
		t.Fatalf("row %d err %v, want 6", row, err)
	}
}

func TestAppendRowNeverWritesAFormula(t *testing.T) {
	h, _ := bootstrapAndSnapshot(t, headerModel("A", "B", "C", "D"))
	if _, err := appendRowToDoc(h.doc, "", []automation.RowValue{
		{Label: "A", Type: "text", Value: `=HYPERLINK("https://evil.example","x")`},
		{Label: "B", Type: "text", Value: "+1"},
		{Label: "C", Type: "text", Value: "-2"},
		{Label: "D", Type: "text", Value: "@SUM(A1)"},
	}); err != nil {
		t.Fatal(err)
	}
	snap, _ := h.Snapshot()
	for col := 1; col <= 4; col++ {
		c, _ := findSnapshotCell(snap, "sheet1", 2, col)
		if c.Kind != "string" || c.Formula != "" {
			t.Errorf("col %d: kind %q formula %q, want plain text", col, c.Kind, c.Formula)
		}
	}
}

func TestAppendRowTypesAndDuplicateLabels(t *testing.T) {
	h, _ := bootstrapAndSnapshot(t, headerModel())
	if _, err := appendRowToDoc(h.doc, "", []automation.RowValue{
		{Label: "Ok", Type: "boolean", Value: true},
		{Label: "Due", Type: "date", Value: "2026-11-04"},
		{Label: "Name", Type: "text", Value: "first"},
		{Label: "Name", Type: "text", Value: "second"},
		{Label: "Empty", Type: "text", Value: nil},
	}); err != nil {
		t.Fatal(err)
	}
	snap, _ := h.Snapshot()
	ok, _ := findSnapshotCell(snap, "sheet1", 2, 1)
	due, _ := findSnapshotCell(snap, "sheet1", 2, 2)
	if ok.Kind != "boolean" || due.Kind != "date" {
		t.Fatalf("kinds: %q %q", ok.Kind, due.Kind)
	}
	if display(t, h, 1, 4) != "Name (2)" || display(t, h, 2, 4) != "second" {
		t.Fatal("a second value with the same label gets its own column")
	}
	if display(t, h, 1, 5) != "Empty" {
		t.Fatal("an empty value still has its header")
	}
	if _, found := findSnapshotCell(snap, "sheet1", 2, 5); found {
		t.Fatal("an empty value writes no cell")
	}
}

func TestAppendRowSheetChoice(t *testing.T) {
	m := WorkbookModel{Sheets: []WorksheetModel{
		{Name: "Hidden", RowCount: 1, ColCount: 1, Hidden: true, Cells: map[string]CellValueDTO{}},
		{Name: "Leads", RowCount: 1, ColCount: 1, Cells: map[string]CellValueDTO{}},
	}}
	h, _ := bootstrapAndSnapshot(t, m)
	if _, err := appendRowToDoc(h.doc, "", []automation.RowValue{{Label: "A", Type: "text", Value: "x"}}); err != nil {
		t.Fatal(err)
	}
	snap, _ := h.Snapshot()
	if _, found := findSnapshotCell(snap, "sheet2", 2, 1); !found {
		t.Fatal("the default is the first sheet a person can see")
	}
	if _, err := appendRowToDoc(h.doc, "Nope", []automation.RowValue{{Label: "A", Type: "text", Value: "x"}}); !errors.Is(err, errNoSheet) {
		t.Fatalf("an unknown sheet name fails, got %v", err)
	}
	if _, err := appendRowToDoc(h.doc, " leads ", []automation.RowValue{{Label: "A", Type: "text", Value: "y"}}); err != nil {
		t.Fatalf("a sheet name matches trimmed and case-blind: %v", err)
	}
}

// With the same header in many columns, a value always goes under the
// leftmost one, so every row lands in the same column.
func TestAppendRowUsesTheFirstOfRepeatedHeaders(t *testing.T) {
	h, _ := bootstrapAndSnapshot(t, headerModel("Email", "Email", "Email", "Email", "Email", "Email", "Email", "Email"))
	if _, err := appendRowToDoc(h.doc, "", []automation.RowValue{{Label: "Email", Type: "text", Value: "a@b.example"}}); err != nil {
		t.Fatal(err)
	}
	if display(t, h, 2, 1) != "a@b.example" {
		t.Fatal("the value goes under the leftmost Email header")
	}
}
