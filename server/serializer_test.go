package calc

import (
	"bytes"
	"os"
	"testing"

	"github.com/xuri/excelize/v2"
)

// readCell opens xlsx bytes via excelize and returns the value at
// (sheetName, row, col) as a stringified value, matching what the
// xlsx-adapter parser would emit on the client.
func readCell(t *testing.T, xlsx []byte, sheetName string, row, col int) string {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	v, err := f.GetCellValue(sheetName, ref)
	if err != nil {
		t.Fatalf("get cell %s!%s: %v", sheetName, ref, err)
	}
	return v
}

// readFormula returns the formula expression at the given cell, or
// the empty string if the cell has no formula.
func readFormula(t *testing.T, xlsx []byte, sheetName string, row, col int) string {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	formula, err := f.GetCellFormula(sheetName, ref)
	if err != nil {
		t.Fatalf("get formula %s!%s: %v", sheetName, ref, err)
	}
	return formula
}

// TestSerializerSingleCellChange round-trips tiny.xlsx through the
// snapshot → serializer pipeline with one cell edit, and asserts the
// edit lands while the rest of the workbook is untouched.
func TestSerializerSingleCellChange(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Two-sheet workbook: People (sheet1) and Incomes (sheet2). We
	// just need sheet1 here.
	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{SheetID: "sheet1", Row: 2, Col: 2, Raw: "from-save", Display: "from-save"},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if !bytes.HasPrefix(out, []byte{0x50, 0x4B, 0x03, 0x04}) {
		t.Fatalf("output is not a valid xlsx (first 4 bytes = %x)", out[:4])
	}

	// The edit landed.
	if got := readCell(t, out, "People", 2, 2); got != "from-save" {
		t.Errorf("B2 after serialize: want %q, got %q", "from-save", got)
	}
	// Header row preserved.
	if got := readCell(t, out, "People", 1, 2); got != "First Name" {
		t.Errorf("B1 (header) after serialize: want %q, got %q", "First Name", got)
	}
	// Untouched data row preserved.
	if got := readCell(t, out, "People", 3, 2); got != "Mara" {
		t.Errorf("B3 (untouched) after serialize: want %q, got %q", "Mara", got)
	}
	// Other sheet preserved.
	if got := readCell(t, out, "Incomes", 1, 1); got == "" {
		t.Error("Incomes!A1 unexpectedly empty — second sheet may have been dropped")
	}
}

// TestSerializerAppendNewSheet verifies that a snapshot listing a
// third sheet causes serializeSnapshotToXLSX to NewSheet it onto the
// existing workbook.
func TestSerializerAppendNewSheet(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
			{ID: "sheet3", Name: "Notes", Position: 2},
		},
		Cells: []CellEntry{
			{SheetID: "sheet3", Row: 1, Col: 1, Raw: "hello", Display: "hello"},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("open output: %v", err)
	}
	defer func() { _ = f.Close() }()
	sheets := f.GetSheetList()
	if len(sheets) != 3 {
		t.Fatalf("sheet count after append: want 3, got %d (%v)", len(sheets), sheets)
	}
	if got := readCell(t, out, "Notes", 1, 1); got != "hello" {
		t.Errorf("Notes!A1: want %q, got %q", "hello", got)
	}
}

// TestSerializerRenameExistingSheet verifies that a snapshot with a
// new name for an existing-position sheet renames the worksheet.
func TestSerializerRenameExistingSheet(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "Roster", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{SheetID: "sheet1", Row: 2, Col: 2, Raw: "Renamed", Display: "Renamed"},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("open output: %v", err)
	}
	defer func() { _ = f.Close() }()
	sheets := f.GetSheetList()
	if len(sheets) != 2 {
		t.Fatalf("sheet count: want 2, got %d (%v)", len(sheets), sheets)
	}
	if sheets[0] != "Roster" {
		t.Errorf("sheet[0] name after rename: want %q, got %q", "Roster", sheets[0])
	}
	if got := readCell(t, out, "Roster", 2, 2); got != "Renamed" {
		t.Errorf("Roster!B2: want %q, got %q", "Renamed", got)
	}
}

// TestSerializerFormulaCell verifies that snapshot cells with a
// non-empty Formula land as actual formula cells in the output.
func TestSerializerFormulaCell(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			// A1 is the row index column; F2 is the Age column.
			// Put a formula somewhere unused: K1 = F2+F3.
			{
				SheetID: "sheet1",
				Row:     1,
				Col:     11,
				Raw:     "57",
				Display: "57",
				Formula: "F2+F3",
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readFormula(t, out, "People", 1, 11); got != "F2+F3" {
		t.Errorf("K1 formula: want %q, got %q", "F2+F3", got)
	}
	if got := readCell(t, out, "People", 1, 11); got != "57" {
		t.Errorf("K1 cached value: want %q, got %q", "57", got)
	}
}

// TestSerializerEmptySnapshot leaves the workbook structurally
// untouched if the snapshot has no cell entries.
func TestSerializerEmptySnapshot(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCell(t, out, "People", 2, 2); got != "Dulce" {
		t.Errorf("B2 after empty serialize: want %q, got %q", "Dulce", got)
	}
	if got := readCell(t, out, "People", 1, 2); got != "First Name" {
		t.Errorf("B1 after empty serialize: want %q, got %q", "First Name", got)
	}
}

// TestSerializerEmptyOriginal: zero-length input must error rather
// than silently produce an empty workbook.
func TestSerializerEmptyOriginal(t *testing.T) {
	if _, err := serializeSnapshotToXLSX(nil, YDocSnapshot{}); err == nil {
		t.Fatal("expected error for nil original bytes, got nil")
	}
}
