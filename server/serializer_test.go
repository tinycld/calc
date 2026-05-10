package calc

import (
	"bytes"
	"fmt"
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

// readCellType opens xlsx bytes and returns the excelize CellType at
// (sheetName, row, col). Used by per-kind round-trip tests to verify
// that, e.g., a typed number cell really lands as a numeric cell on
// disk rather than a string-of-digits.
func readCellType(t *testing.T, xlsx []byte, sheetName string, row, col int) excelize.CellType {
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
	tp, err := f.GetCellType(sheetName, ref)
	if err != nil {
		t.Fatalf("get cell type %s!%s: %v", sheetName, ref, err)
	}
	return tp
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
			{SheetID: "sheet1", Row: 2, Col: 2, RawString: "from-save", Display: "from-save"},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
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
			{SheetID: "sheet3", Row: 1, Col: 1, RawString: "hello", Display: "hello"},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
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
			{SheetID: "sheet1", Row: 2, Col: 2, RawString: "Renamed", Display: "Renamed"},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
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
				SheetID:   "sheet1",
				Row:       1,
				Col:       11,
				RawString: "57",
				Display:   "57",
				Formula:   "F2+F3",
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
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

	out, err := serializeSnapshotToXLSX(original, snap, nil)
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
	if _, err := serializeSnapshotToXLSX(nil, YDocSnapshot{}, nil); err == nil {
		t.Fatal("expected error for nil original bytes, got nil")
	}
}

// readCellBold returns the font.bold flag for the given cell.
func readCellBold(t *testing.T, xlsx []byte, sheetName string, row, col int) bool {
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
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return false
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.Font == nil {
		return false
	}
	return style.Font.Bold
}

// readCellFontSize returns the font.size at the given cell, or 0 if
// no style is registered. Used to verify the overlay preserves
// existing font attributes the snapshot doesn't touch.
func readCellFontSize(t *testing.T, xlsx []byte, sheetName string, row, col int) float64 {
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
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return 0
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.Font == nil {
		return 0
	}
	return style.Font.Size
}

// readCellItalic returns the font.italic flag for the given cell.
func readCellItalic(t *testing.T, xlsx []byte, sheetName string, row, col int) bool {
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
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return false
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.Font == nil {
		return false
	}
	return style.Font.Italic
}

// stampFontSize pre-applies a font size on a cell and returns the new
// xlsx bytes. Used to seed an "existing style" we then test the
// overlay preserves.
func stampFontSize(t *testing.T, xlsx []byte, sheetName string, row, col int, size float64) []byte {
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
	id, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Size: size}})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle(sheetName, ref, ref, id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	return buf.Bytes()
}

// boolPtr is a tiny convenience for building *bool literals in tests.
func boolPtr(b bool) *bool { return &b }

// TestSerializerStyleSetsBold: a snapshot whose cell carries
// style.font.bold = true lands as a bold font on the resulting xlsx
// cell.
func TestSerializerStyleSetsBold(t *testing.T) {
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
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style:     &CellStyle{Font: &CellFont{Bold: boolPtr(true)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if !readCellBold(t, out, "People", 2, 2) {
		t.Errorf("B2 should be bold after style overlay, got non-bold")
	}
	if got := readCell(t, out, "People", 2, 2); got != "from-save" {
		t.Errorf("B2 value: want %q, got %q", "from-save", got)
	}
}

// TestSerializerStylePartialOverlay: an existing style attribute
// (font size) on a cell must survive when the snapshot only carries a
// different attribute (bold). This is the regression test for the
// "don't blow away existing styles" risk that motivated the partial
// overlay design.
func TestSerializerStylePartialOverlay(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pre-stamp B2 with size=14 so we can assert it survives.
	withSize := stampFontSize(t, original, "People", 2, 2, 14)
	if got := readCellFontSize(t, withSize, "People", 2, 2); got != 14 {
		t.Fatalf("seed font size: want 14, got %v", got)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style:     &CellStyle{Font: &CellFont{Bold: boolPtr(true)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(withSize, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if !readCellBold(t, out, "People", 2, 2) {
		t.Errorf("B2 should be bold after overlay")
	}
	if got := readCellFontSize(t, out, "People", 2, 2); got != 14 {
		t.Errorf("B2 font size: want 14 preserved, got %v", got)
	}
}

// TestSerializerStyleAbsentLeavesCellAlone: a snapshot cell with no
// Style must leave the cell's existing on-disk style intact.
func TestSerializerStyleAbsentLeavesCellAlone(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	withSize := stampFontSize(t, original, "People", 2, 2, 18)

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{SheetID: "sheet1", Row: 2, Col: 2, RawString: "from-save", Display: "from-save"},
		},
	}

	out, err := serializeSnapshotToXLSX(withSize, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellFontSize(t, out, "People", 2, 2); got != 18 {
		t.Errorf("B2 font size after styleless save: want 18 preserved, got %v", got)
	}
}

// TestSerializerStyleSetsItalic: a snapshot whose cell carries
// style.font.italic = true lands as italic on the resulting xlsx
// cell. Italic is structurally aligned with excelize.Font.Italic; this
// test guards against a future refactor breaking the reflect walk.
func TestSerializerStyleSetsItalic(t *testing.T) {
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
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style:     &CellStyle{Font: &CellFont{Italic: boolPtr(true)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if !readCellItalic(t, out, "People", 2, 2) {
		t.Errorf("B2 should be italic after style overlay")
	}
}

// readCellStrike returns the font.strike flag for the given cell.
func readCellStrike(t *testing.T, xlsx []byte, sheetName string, row, col int) bool {
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
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return false
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.Font == nil {
		return false
	}
	return style.Font.Strike
}

// readCellUnderline returns the font.underline string for the given
// cell ("" when no underline is set, "single"/"double"/etc otherwise).
func readCellUnderline(t *testing.T, xlsx []byte, sheetName string, row, col int) string {
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
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return ""
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.Font == nil {
		return ""
	}
	return style.Font.Underline
}

// TestSerializerStyleSetsUnderline: snapshot font.underline = true
// lands as "single" underline in the xlsx cell. Toolbar today is a
// boolean; the override translates true → excelize's "single" string.
func TestSerializerStyleSetsUnderline(t *testing.T) {
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
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style:     &CellStyle{Font: &CellFont{Underline: boolPtr(true)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellUnderline(t, out, "People", 2, 2); got != "single" {
		t.Errorf("B2 underline: want %q, got %q", "single", got)
	}
}

// TestSerializerStyleClearsUnderline: snapshot font.underline = false
// on a cell that already has an underline in the base xlsx must
// remove it. We pre-stamp B2 with single-underline, then save with
// the snapshot's Underline=false — the resulting xlsx must round-trip
// without underline (excelize round-trips "none" as "none", which
// readCellUnderline returns; what it must NOT return is "single").
func TestSerializerStyleClearsUnderline(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pre-stamp B2 with a single underline.
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	id, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Underline: "single"}})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle("People", "B2", "B2", id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	if got := readCellUnderline(t, seeded, "People", 2, 2); got != "single" {
		t.Fatalf("seed: want underline=single, got %q", got)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style:   &CellStyle{Font: &CellFont{Underline: boolPtr(false)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	if got := readCellUnderline(t, out, "People", 2, 2); got != "none" {
		t.Errorf("B2 underline: want %q (explicit OOXML cancel), got %q — underline not properly cleared", "none", got)
	}
}

// readCellFontFamily returns the font.family (font name) for the given cell.
func readCellFontFamily(t *testing.T, xlsx []byte, sheetName string, row, col int) string {
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
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return ""
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.Font == nil {
		return ""
	}
	return style.Font.Family
}

// stringPtr is a tiny convenience for building *string literals in tests.
func stringPtr(s string) *string { return &s }

// TestSerializerStyleSetsFontName: snapshot font.name = "Courier New"
// lands as Font.Family on the resulting xlsx cell.
func TestSerializerStyleSetsFontName(t *testing.T) {
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
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style:     &CellStyle{Font: &CellFont{Name: stringPtr("Courier New")}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellFontFamily(t, out, "People", 2, 2); got != "Courier New" {
		t.Errorf("B2 font family: want %q, got %q", "Courier New", got)
	}
}

// TestSerializerStyleClearsFontName: snapshot font.name = "" on a
// cell that already has a font family in the base xlsx — does the
// serializer clear it, or does excelize silently drop empty-string
// Family writes (the same trap that motivated TestSerializerStyleClearsUnderline)?
//
// If the YDoc never sends Name: stringPtr("") today the test simply
// documents the assumption: failure here means a real silent-drop
// gap that a future user action (clearing the font picker) could trip.
func TestSerializerStyleClearsFontName(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	id, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Family: "Courier New"}})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle("People", "B2", "B2", id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	if got := readCellFontFamily(t, seeded, "People", 2, 2); got != "Courier New" {
		t.Fatalf("seed: want family=Courier New, got %q", got)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style:   &CellStyle{Font: &CellFont{Name: stringPtr("")}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	if got := readCellFontFamily(t, out, "People", 2, 2); got == "Courier New" {
		t.Errorf("B2 font family: empty-string clear failed silently — got %q (existing family survived)", got)
	}
}

// readCellNumFmt returns the custom number format string applied to
// the cell, or "" if none is set.
func readCellNumFmt(t *testing.T, xlsx []byte, sheetName string, row, col int) string {
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
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return ""
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil || style.CustomNumFmt == nil {
		return ""
	}
	return *style.CustomNumFmt
}

// TestSerializerStyleSetsNumFmt: snapshot numFmt lands as
// CustomNumFmt on the xlsx cell.
func TestSerializerStyleSetsNumFmt(t *testing.T) {
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
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				Kind:      "number",
				RawNumber: func() *float64 { v := 1234.5; return &v }(),
				Display:   "1,234.50",
				Style:     &CellStyle{NumFmt: stringPtr("#,##0.00")},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellNumFmt(t, out, "People", 2, 2); got != "#,##0.00" {
		t.Errorf("B2 numFmt: want %q, got %q", "#,##0.00", got)
	}
}

// TestSerializerStyleClearsNumFmt: snapshot numFmt = "" on a cell
// that already carries a custom format must clear it (and must not
// fail the save). Excelize.NewStyle errors on CustomNumFmt = &""
// with ErrCustomNumFmt — the override has to translate empty-string
// patches into "remove custom format".
func TestSerializerStyleClearsNumFmt(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	seedFmt := "#,##0.00"
	id, err := f.NewStyle(&excelize.Style{CustomNumFmt: &seedFmt})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle("People", "B2", "B2", id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	if got := readCellNumFmt(t, seeded, "People", 2, 2); got != "#,##0.00" {
		t.Fatalf("seed: want numFmt=#,##0.00, got %q", got)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style:   &CellStyle{NumFmt: stringPtr("")},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	if got := readCellNumFmt(t, out, "People", 2, 2); got == "#,##0.00" {
		t.Errorf("B2 numFmt: clear failed silently — got %q (existing format survived)", got)
	}
}

// getCellStyle is the shared lookup-and-return helper for the fill /
// border / numFmt readers added in later tasks. Returns nil if the
// cell has no style.
func getCellStyle(t *testing.T, xlsx []byte, sheetName string, row, col int) *excelize.Style {
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
	id, err := f.GetCellStyle(sheetName, ref)
	if err != nil {
		t.Fatalf("get style %s!%s: %v", sheetName, ref, err)
	}
	if id == 0 {
		return nil
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	return style
}

// readCellFillType returns the cell's fill.type ("" / "pattern").
func readCellFillType(t *testing.T, xlsx []byte, sheetName string, row, col int) string {
	t.Helper()
	style := getCellStyle(t, xlsx, sheetName, row, col)
	if style == nil {
		return ""
	}
	return style.Fill.Type
}

// readCellFillPattern returns the cell's fill.pattern enum index (0 = none, 1 = solid).
func readCellFillPattern(t *testing.T, xlsx []byte, sheetName string, row, col int) int {
	t.Helper()
	style := getCellStyle(t, xlsx, sheetName, row, col)
	if style == nil {
		return 0
	}
	return style.Fill.Pattern
}

// readCellFillColors returns the fill.Color slice for the cell.
func readCellFillColors(t *testing.T, xlsx []byte, sheetName string, row, col int) []string {
	t.Helper()
	style := getCellStyle(t, xlsx, sheetName, row, col)
	if style == nil {
		return nil
	}
	return style.Fill.Color
}

// TestSerializerStyleSetsFill: snapshot fill.type=pattern + pattern=solid
// + fgColor=#FF0000 lands as a solid red fill on the xlsx cell.
func TestSerializerStyleSetsFill(t *testing.T) {
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
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style: &CellStyle{
					Fill: &CellFill{
						Type:    stringPtr("pattern"),
						Pattern: stringPtr("solid"),
						FgColor: stringPtr("#FF0000"),
					},
				},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if got := readCellFillType(t, out, "People", 2, 2); got != "pattern" {
		t.Errorf("B2 fill.type: want %q, got %q", "pattern", got)
	}
	if got := readCellFillPattern(t, out, "People", 2, 2); got != 1 {
		t.Errorf("B2 fill.pattern: want 1 (solid), got %d", got)
	}
	colors := readCellFillColors(t, out, "People", 2, 2)
	if len(colors) == 0 || colors[0] != "FF0000" {
		// excelize strips the leading # on read-back.
		t.Errorf("B2 fill.colors: want [\"FF0000\"...], got %v", colors)
	}
}

// TestSerializerStyleSetsStrike: snapshot font.strike = true lands as
// strikethrough on the xlsx cell.
func TestSerializerStyleSetsStrike(t *testing.T) {
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
			{
				SheetID:   "sheet1",
				Row:       2,
				Col:       2,
				RawString: "from-save",
				Display:   "from-save",
				Style:     &CellStyle{Font: &CellFont{Strike: boolPtr(true)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if !readCellStrike(t, out, "People", 2, 2) {
		t.Errorf("B2 should be strikethrough after style overlay")
	}
}

// stampFill pre-applies a solid red fill on a cell and returns the new
// xlsx bytes. Used to seed an "existing fill" that clearing tests can
// then attempt to remove.
func stampFill(t *testing.T, xlsx []byte, sheetName string, row, col int) []byte {
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
	id, err := f.NewStyle(&excelize.Style{
		Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"FF0000"}},
	})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle(sheetName, ref, ref, id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	return buf.Bytes()
}

// readCellBorder returns the excelize Border (Type matches edgeName,
// e.g. "top"/"right"/"bottom"/"left") at the given cell, or a
// zero-value Border if no such edge is set.
func readCellBorder(t *testing.T, xlsx []byte, sheetName string, row, col int, edgeName string) excelize.Border {
	t.Helper()
	style := getCellStyle(t, xlsx, sheetName, row, col)
	if style == nil {
		return excelize.Border{}
	}
	for _, b := range style.Border {
		if b.Type == edgeName {
			return b
		}
	}
	return excelize.Border{}
}

// TestSerializerStyleSetsBorders: snapshot borders.{top,bottom}=true
// lands as thin black borders on the corresponding edges.
// Uses K1 (row=1, col=11) which is outside the fixture's data range
// and carries no pre-existing borders, so nil edges stay absent.
func TestSerializerStyleSetsBorders(t *testing.T) {
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
			{
				SheetID:   "sheet1",
				Row:       1,
				Col:       11,
				RawString: "from-save",
				Display:   "from-save",
				Style: &CellStyle{
					Borders: &CellBorders{
						Top:    boolPtr(true),
						Bottom: boolPtr(true),
					},
				},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}

	top := readCellBorder(t, out, "People", 1, 11, "top")
	if top.Style != 1 {
		t.Errorf("K1 top border style: want 1 (thin), got %d", top.Style)
	}
	bottom := readCellBorder(t, out, "People", 1, 11, "bottom")
	if bottom.Style != 1 {
		t.Errorf("K1 bottom border style: want 1 (thin), got %d", bottom.Style)
	}
	// Edges not in the patch must not be set.
	left := readCellBorder(t, out, "People", 1, 11, "left")
	if left.Style != 0 {
		t.Errorf("K1 left border: want absent, got style=%d", left.Style)
	}
}

// TestSerializerStyleClearsBorder: snapshot borders.top=false on a cell
// that previously had a top border results in the top edge being
// cleared. Verifies the false-clears-edge semantics matching the TS
// `none` preset.
func TestSerializerStyleClearsBorder(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pre-stamp B2 with all four thin borders.
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	id, err := f.NewStyle(&excelize.Style{
		Border: []excelize.Border{
			{Type: "top", Color: "000000", Style: 1},
			{Type: "right", Color: "000000", Style: 1},
			{Type: "bottom", Color: "000000", Style: 1},
			{Type: "left", Color: "000000", Style: 1},
		},
	})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle("People", "B2", "B2", id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style:   &CellStyle{Borders: &CellBorders{Top: boolPtr(false)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	if got := readCellBorder(t, out, "People", 2, 2, "top"); got.Style != 0 {
		t.Errorf("top border should be cleared (style=0), got style=%d", got.Style)
	}
	// Other edges must survive.
	if got := readCellBorder(t, out, "People", 2, 2, "right"); got.Style != 1 {
		t.Errorf("right border survived: want style=1, got %d", got.Style)
	}
}

// TestSerializerStyleBordersPreservesDiagonals: a Borders patch must
// not drop diagonalUp / diagonalDown borders that exist in the base
// xlsx. Our schema only models the four orthogonal edges; anything
// else excelize understands has to round-trip verbatim. Today the
// toolbar can't author diagonals, but workbooks imported from Excel
// frequently contain them — losing them silently on save would
// corrupt the user's data.
func TestSerializerStyleBordersPreservesDiagonals(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pre-stamp B2 with both a top border and a diagonalUp border.
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	id, err := f.NewStyle(&excelize.Style{
		Border: []excelize.Border{
			{Type: "top", Color: "000000", Style: 1},
			{Type: "diagonalUp", Color: "FF0000", Style: 1},
		},
	})
	if err != nil {
		t.Fatalf("NewStyle: %v", err)
	}
	if err := f.SetCellStyle("People", "B2", "B2", id); err != nil {
		t.Fatalf("SetCellStyle: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	if got := readCellBorder(t, seeded, "People", 2, 2, "diagonalUp"); got.Style != 1 {
		t.Fatalf("seed: want diagonalUp style=1, got style=%d", got.Style)
	}

	// Patch the four orthogonal edges only — diagonals are not in
	// our schema and must survive untouched.
	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style:   &CellStyle{Borders: &CellBorders{Bottom: boolPtr(true)}},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	if got := readCellBorder(t, out, "People", 2, 2, "diagonalUp"); got.Style != 1 {
		t.Errorf("diagonalUp border was silently dropped: want style=1, got style=%d", got.Style)
	}
	// The patch's own bottom edge landed.
	if got := readCellBorder(t, out, "People", 2, 2, "bottom"); got.Style != 1 {
		t.Errorf("bottom border (in patch) lost: want style=1, got %d", got.Style)
	}
	// The seeded top edge survives (it's a schema edge not in the patch).
	if got := readCellBorder(t, out, "People", 2, 2, "top"); got.Style != 1 {
		t.Errorf("top border (preserved schema edge) lost: want style=1, got %d", got.Style)
	}
}

// readSheetDimension returns the <dimension ref="..."/> string for
// the given sheet, or "" if the workbook doesn't have one.
func readSheetDimension(t *testing.T, xlsx []byte, sheetName string) string {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	dim, err := f.GetSheetDimension(sheetName)
	if err != nil {
		t.Fatalf("get dimension %s: %v", sheetName, err)
	}
	return dim
}

// TestSerializerExpandsSheetDimension: a snapshot whose SheetMeta
// declares RowCount=50, ColCount=10 widens the workbook's <dimension>
// to A1:J50 even when no new cells are written.
func TestSerializerExpandsSheetDimension(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0, RowCount: 50, ColCount: 10},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	if got := readSheetDimension(t, out, "People"); got != "A1:J50" {
		t.Errorf("People dimension: want %q, got %q", "A1:J50", got)
	}
}

// TestSerializerDimensionDoesNotShrink: when the Y.Doc tracks a
// narrower extent than the workbook's existing <dimension>, the save
// must not truncate. Mirrors the discipline behind the clearing tests:
// catches the silent-truncate failure mode where a Y.Doc that only
// observed the scrolled-into region would shrink the saved file's
// dimension below its actual data extent.
func TestSerializerDimensionDoesNotShrink(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	// The fixture's natural dimension is wider than what we'll feed in
	// through the snapshot. Confirm the seed first so the assertion
	// below is meaningful.
	seedDim := readSheetDimension(t, original, "People")
	if seedDim == "" {
		t.Fatalf("fixture has no dimension; cannot test shrink behavior")
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			// Deliberately tiny: 2 rows x 2 cols.
			{ID: "sheet1", Name: "People", Position: 0, RowCount: 2, ColCount: 2},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	got := readSheetDimension(t, out, "People")
	if got != seedDim {
		t.Errorf("dimension shrank: seeded %q, got %q (snapshot's tiny RowCount/ColCount truncated the existing extent)", seedDim, got)
	}
}

// TestSerializerDimensionUntouchedWhenSheetMetaIsZero: a snapshot
// whose SheetMeta carries RowCount=0/ColCount=0 must leave the
// workbook's existing <dimension> alone. Pins the "zero is untracked"
// sentinel.
func TestSerializerDimensionUntouchedWhenSheetMetaIsZero(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	seedDim := readSheetDimension(t, original, "People")

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0}, // RowCount/ColCount default to 0
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	if got := readSheetDimension(t, out, "People"); got != seedDim {
		t.Errorf("dimension changed despite zero-count sentinel: seeded %q, got %q", seedDim, got)
	}
}

// readRowHeight returns the row's height in Excel points.
func readRowHeight(t *testing.T, xlsx []byte, sheetName string, row int) float64 {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	h, err := f.GetRowHeight(sheetName, row)
	if err != nil {
		t.Fatalf("get row height %s!%d: %v", sheetName, row, err)
	}
	return h
}

// readColWidth returns the column's width in Excel character units.
func readColWidth(t *testing.T, xlsx []byte, sheetName string, col int) float64 {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	colName, err := excelize.ColumnNumberToName(col)
	if err != nil {
		t.Fatalf("col name %d: %v", col, err)
	}
	w, err := f.GetColWidth(sheetName, colName)
	if err != nil {
		t.Fatalf("get col width %s!%s: %v", sheetName, colName, err)
	}
	return w
}

// TestSerializerPersistsRowHeights: a snapshot with RowHeights{2: 60}
// produces a sheet where row 2's height is 60px → 45pt.
func TestSerializerPersistsRowHeights(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID: "sheet1", Name: "People", Position: 0,
				RowHeights: map[int]int{2: 60},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	if got := readRowHeight(t, out, "People", 2); got != 45.0 {
		t.Errorf("row 2 height: want 45 (60px * 0.75), got %v", got)
	}
}

// TestSerializerPersistsColWidths: a snapshot with ColWidths{3: 96}
// produces a sheet where column C's width is the Excel-char
// equivalent of 96px (i.e. (96-5)/7 ≈ 13).
func TestSerializerPersistsColWidths(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID: "sheet1", Name: "People", Position: 0,
				ColWidths: map[int]int{3: 96},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	got := readColWidth(t, out, "People", 3)
	want := 13.0 // (96-5)/7
	if got < want-0.05 || got > want+0.05 {
		t.Errorf("col C width: want ≈ %v (96px → chars), got %v", want, got)
	}
}

// TestSerializerRowHeightsNilLeavesExistingAlone: a snapshot whose
// SheetMeta.RowHeights is nil must not touch the workbook's existing
// row heights. Mirrors the T8 sentinel-untouched discipline so a future
// loop refactor (e.g. switching the range over nil for an explicit
// nil-check) can't silently regress.
func TestSerializerRowHeightsNilLeavesExistingAlone(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	// Pre-stamp row 2 with a non-default height so we can detect changes.
	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := f.SetRowHeight("People", 2, 50); err != nil {
		t.Fatalf("seed SetRowHeight: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	if got := readRowHeight(t, seeded, "People", 2); got != 50 {
		t.Fatalf("seed: want row 2 height=50, got %v", got)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0}, // RowHeights nil
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	if got := readRowHeight(t, out, "People", 2); got != 50 {
		t.Errorf("row 2 height changed despite nil RowHeights: want 50 preserved, got %v", got)
	}
}

// TestSerializerColWidthsNilLeavesExistingAlone: same sentinel as
// above for the column-widths path.
func TestSerializerColWidthsNilLeavesExistingAlone(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(original))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := f.SetColWidth("People", "C", "C", 25); err != nil {
		t.Fatalf("seed SetColWidth: %v", err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	_ = f.Close()
	seeded := buf.Bytes()
	seedW := readColWidth(t, seeded, "People", 3)
	if seedW < 24.95 || seedW > 25.05 {
		t.Fatalf("seed: want col C width≈25, got %v", seedW)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0}, // ColWidths nil
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	got := readColWidth(t, out, "People", 3)
	if got < 24.95 || got > 25.05 {
		t.Errorf("col C width changed despite nil ColWidths: want ≈25 preserved, got %v", got)
	}
}

// readRowStyleFill returns the fill type/pattern/color of the row
// style for the given row, if one is set.
func readRowStyleFill(t *testing.T, xlsx []byte, sheetName string, row int) (string, int, []string) {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	// excelize reads row style from any cell on that row that has the
	// row-style applied; we read from the first column (which
	// SetRowStyle applies to even if the column is empty).
	id, err := f.GetCellStyle(sheetName, fmt.Sprintf("A%d", row))
	if err != nil {
		t.Fatalf("get style A%d: %v", row, err)
	}
	if id == 0 {
		return "", 0, nil
	}
	style, err := f.GetStyle(id)
	if err != nil {
		t.Fatalf("read style %d: %v", id, err)
	}
	if style == nil {
		return "", 0, nil
	}
	return style.Fill.Type, style.Fill.Pattern, style.Fill.Color
}

// TestSerializerPersistsRowStyle: a snapshot whose SheetMeta.RowStyles
// declares row 7 should be solid yellow lands as a row-level fill.
func TestSerializerPersistsRowStyle(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{
				ID: "sheet1", Name: "People", Position: 0,
				RowStyles: map[int]*CellStyle{
					7: {
						Fill: &CellFill{
							Type:    stringPtr("pattern"),
							Pattern: stringPtr("solid"),
							FgColor: stringPtr("#FFFF00"),
						},
					},
				},
			},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
	}

	out, err := serializeSnapshotToXLSX(original, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}

	fillType, pattern, colors := readRowStyleFill(t, out, "People", 7)
	if fillType != "pattern" {
		t.Errorf("row 7 fill.type: want %q, got %q", "pattern", fillType)
	}
	if pattern != 1 {
		t.Errorf("row 7 fill.pattern: want 1 (solid), got %d", pattern)
	}
	if len(colors) == 0 || colors[0] != "FFFF00" {
		t.Errorf("row 7 fill.colors: want [\"FFFF00\"...], got %v", colors)
	}
}

// TestSerializerStyleClearsFill: snapshot FgColor = "" on a cell that
// already has a red fill must clear the foreground color. The trailing-
// empty trimmer in the Fill override drops the now-empty color slot,
// producing an empty Color slice which excelize treats as no fill color.
func TestSerializerStyleClearsFill(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}

	seeded := stampFill(t, original, "People", 2, 2)
	seededColors := readCellFillColors(t, seeded, "People", 2, 2)
	if len(seededColors) == 0 || seededColors[0] != "FF0000" {
		t.Fatalf("seed: want fill color FF0000, got %v", seededColors)
	}

	snap := YDocSnapshot{
		Sheets: []SheetMeta{
			{ID: "sheet1", Name: "People", Position: 0},
			{ID: "sheet2", Name: "Incomes", Position: 1},
		},
		Cells: []CellEntry{
			{
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				Style: &CellStyle{
					Fill: &CellFill{
						FgColor: stringPtr(""),
					},
				},
			},
		},
	}

	out, err := serializeSnapshotToXLSX(seeded, snap, nil)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	colors := readCellFillColors(t, out, "People", 2, 2)
	// An empty-string FgColor patch trims the color slot — the resulting
	// Color slice should be empty, which means no fill color is set.
	if len(colors) != 0 {
		t.Errorf("B2 fill color: want empty slice after clear, got %v", colors)
	}
}
