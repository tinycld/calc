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
				SheetID: "sheet1",
				Row:     1,
				Col:     11,
				RawString: "57",
				Display: "57",
				Formula: "F2+F3",
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
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				RawString: "from-save",
				Display: "from-save",
				Style:   &CellStyle{Font: &CellFont{Bold: boolPtr(true)}},
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
				SheetID: "sheet1",
				Row:     2,
				Col:     2,
				RawString: "from-save",
				Display: "from-save",
				Style:   &CellStyle{Font: &CellFont{Bold: boolPtr(true)}},
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
