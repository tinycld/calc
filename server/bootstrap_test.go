package calc

import (
	"bytes"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/nathanstitt/omnidoc/pkg/xlsx"
	ycrdt "github.com/skyterra/y-crdt"
	"github.com/xuri/excelize/v2"
)

// TestReadWorkbookFromXLSXTinyFixture parses the user-curated tiny.xlsx
// fixture and asserts the high-level shape — number of sheets, the
// header row of "People", and that the row/col counts grow with the
// data. Drift here usually means an excelize upgrade changed how a
// particular cell type surfaces; that's the kind of regression the
// preview/bootstrap paths quietly amplify into rendering bugs.
func TestReadWorkbookFromXLSXTinyFixture(t *testing.T) {
	bytes, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	model, err := ReadWorkbookFromXLSX(t.Context(), bytes, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	if len(model.Sheets) < 1 {
		t.Fatalf("want at least 1 sheet, got %d", len(model.Sheets))
	}
	first := model.Sheets[0]
	if first.Name == "" {
		t.Fatal("first sheet has empty name")
	}
	if first.RowCount < 5 {
		t.Errorf("first sheet rowCount: want >=5, got %d", first.RowCount)
	}
	if first.ColCount < 3 {
		t.Errorf("first sheet colCount: want >=3, got %d", first.ColCount)
	}
	if len(first.Cells) == 0 {
		t.Error("first sheet has no cells")
	}
	a1 := first.Cells["1:1"]
	if a1.Display == "" {
		t.Errorf("A1 display unexpectedly empty: %+v", a1)
	}
}

// TestReadWorkbookFromXLSXEmptyInputErrors guards against the
// bootstrap hook's empty-bytes branch silently passing through and
// stamping nothing into the YDoc — the bootstrap path treats len==0 as
// "no file yet, leave doc empty", but ReadWorkbookFromXLSX itself must
// reject so the hook can't accidentally feed a parser with no bytes.
func TestReadWorkbookFromXLSXEmptyInputErrors(t *testing.T) {
	_, err := ReadWorkbookFromXLSX(t.Context(), nil, 0, 0)
	if err == nil {
		t.Fatal("expected error on empty input, got nil")
	}
}

// TestReadWorkbookFromXLSXCaps trims rows/cols to the supplied caps,
// which is what the preview endpoint relies on to keep the response
// payload bounded regardless of the source workbook's size.
func TestReadWorkbookFromXLSXCaps(t *testing.T) {
	bytes, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	model, err := ReadWorkbookFromXLSX(t.Context(), bytes, 2, 2)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	for _, sheet := range model.Sheets {
		for key := range sheet.Cells {
			row, col, ok := parseLocalCellKey(key)
			if !ok {
				t.Errorf("malformed cell key: %q", key)
				continue
			}
			if row > 2 || col > 2 {
				t.Errorf("cell %s exceeds caps (row=%d col=%d)", key, row, col)
			}
		}
	}
}

// TestBootstrapYDocFromWorkbookRoundTrip parses the fixture, stamps it
// into a fresh y-crdt doc, and re-extracts via Snapshot — the same
// path the broker uses on first sync. The snapshot's sheets and cells
// must match what we read from xlsx, otherwise clients would see a
// different shape than the server thinks it sent.
func TestBootstrapYDocFromWorkbookRoundTrip(t *testing.T) {
	xlsxBytes, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	model, err := ReadWorkbookFromXLSX(t.Context(), xlsxBytes, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}

	rt := NewRuntime()
	handle, err := rt.NewDoc("bootstrap-test-room")
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
	if len(snap.Sheets) != len(model.Sheets) {
		t.Fatalf("snapshot sheets: want %d, got %d", len(model.Sheets), len(snap.Sheets))
	}
	if len(snap.Cells) == 0 {
		t.Fatal("snapshot has no cells after bootstrap")
	}

	// Spot-check one cell: snapshot SheetID is "sheet1" for the
	// first sheet, and a non-empty A1 should round-trip with a
	// non-empty raw value.
	var sawA1 bool
	for _, c := range snap.Cells {
		if c.SheetID == "sheet1" && c.Row == 1 && c.Col == 1 {
			sawA1 = true
			if c.RawString == "" && c.RawNumber == nil {
				t.Errorf("A1 round-trip: raw is empty: %+v", c)
			}
		}
	}
	if !sawA1 {
		t.Error("A1 missing from snapshot after bootstrap")
	}
}

// TestBootstrapToSerializerRoundTripPreservesCustomizations is the end-
// to-end structural canary for the snapshot-is-authoritative contract.
// It exercises the full bootstrap→snapshot→serializer pipeline that
// runs on every save:
//
//  1. Synthesize an xlsx with every persistable per-sheet
//     customization stamped in: a cell value, row height, col width,
//     row-level style, tab color, sheet hidden, freeze pane, merged
//     range.
//  2. ReadWorkbookFromXLSX (the import-side seed reader).
//  3. BootstrapYDocFromWorkbook (writes the seed into a fresh Y.Doc).
//  4. Snapshot (extracts the Y.Doc state for the serializer).
//  5. serializeSnapshotToXLSX (writes the snapshot back to xlsx).
//  6. Assert every customization survives identically.
//
// Why this matters: each layer is unit-tested individually but the
// chain has the property that an information loss anywhere (the
// reader skipping a field, the bootstrap forgetting to seed it, the
// snapshot decoder collapsing absent/empty, the serializer wiping
// instead of preserving) would silently delete customizations on the
// first save. A failure here means the bug class this package is
// built to prevent has re-opened.
//
// Future fields go in the assertions below; the test is the
// regression net for the whole contract.
func TestBootstrapToSerializerRoundTripPreservesCustomizations(t *testing.T) {
	// 1. Build the source workbook in memory.
	src := excelize.NewFile()
	defer func() { _ = src.Close() }()
	const sheetName = "Sheet1"
	if err := src.SetCellValue(sheetName, "A1", "hello"); err != nil {
		t.Fatalf("seed cell: %v", err)
	}
	if err := src.SetRowHeight(sheetName, 3, 40); err != nil {
		t.Fatalf("seed row height: %v", err)
	}
	if err := src.SetColWidth(sheetName, "B", "B", 25); err != nil {
		t.Fatalf("seed col width: %v", err)
	}
	rowStyleID, err := src.NewStyle(&excelize.Style{
		Fill: excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"FFFF00"}},
	})
	if err != nil {
		t.Fatalf("seed NewStyle: %v", err)
	}
	if err := src.SetRowStyle(sheetName, 5, 5, rowStyleID); err != nil {
		t.Fatalf("seed SetRowStyle: %v", err)
	}
	tabColor := "FF0000"
	if err := src.SetSheetProps(sheetName, &excelize.SheetPropsOptions{TabColorRGB: &tabColor}); err != nil {
		t.Fatalf("seed tab color: %v", err)
	}
	// A second sheet so we can mark it hidden — excelize forbids
	// hiding the only visible sheet.
	if _, err := src.NewSheet("Other"); err != nil {
		t.Fatalf("seed second sheet: %v", err)
	}
	if err := src.SetSheetVisible("Other", false); err != nil {
		t.Fatalf("seed hide: %v", err)
	}
	if err := src.SetPanes(sheetName, &excelize.Panes{
		Freeze:      true,
		XSplit:      1,
		YSplit:      2,
		TopLeftCell: "B3",
		ActivePane:  "bottomRight",
	}); err != nil {
		t.Fatalf("seed freeze: %v", err)
	}
	if err := src.MergeCell(sheetName, "D1", "E1"); err != nil {
		t.Fatalf("seed merge: %v", err)
	}
	buf, err := src.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	original := buf.Bytes()

	// 2. Read.
	model, err := ReadWorkbookFromXLSX(t.Context(), original, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}

	// 3. Bootstrap.
	rt := NewRuntime()
	handle, err := rt.NewDoc("round-trip-test-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })
	sh := handle.(*sheetsDocHandle)
	if err := BootstrapYDocFromWorkbook(sh.doc, model); err != nil {
		t.Fatalf("BootstrapYDocFromWorkbook: %v", err)
	}

	// 4. Snapshot.
	snap, err := sh.Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}

	// 5. Serialize.
	out, err := serializeSnapshotToXLSX(t.Context(), original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}

	// 6. Assertions — every customization stamped above must survive.
	got, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("open output: %v", err)
	}
	defer func() { _ = got.Close() }()

	if v, _ := got.GetCellValue(sheetName, "A1"); v != "hello" {
		t.Errorf("A1 value: want %q, got %q", "hello", v)
	}
	// Row height round-trip: seed is in excelize POINTS (40pt), the
	// bootstrap reader converts pt→px via excelPointsToPx with integer
	// rounding, the serializer converts px→pt via pxToExcelPoints
	// (linear × 0.75). The chain is lossy at the integer-px boundary.
	// For 40pt seed: pt(40) → px(53) → pt(39.75). Tolerate ±1pt to
	// absorb the integer-px quantization without losing the assertion's
	// meaning ("the height survived the round-trip, modulo unit jitter").
	if h, _ := got.GetRowHeight(sheetName, 3); h < 38.0 || h > 41.0 {
		t.Errorf("row 3 height: want ~39.75pt (40pt seed via 53px Y.Doc), got %v", h)
	}
	if w, _ := got.GetColWidth(sheetName, "B"); w < 24.0 || w > 26.0 {
		t.Errorf("col B width: want ~25 chars, got %v", w)
	}
	rowStyleIDOut, _ := got.GetCellStyle(sheetName, "A5")
	if rowStyleIDOut == 0 {
		t.Errorf("row 5 style: want non-zero StyleID, got 0 (row-level style lost)")
	} else if style, err := got.GetStyle(rowStyleIDOut); err == nil && style != nil {
		if len(style.Fill.Color) == 0 || style.Fill.Color[0] != "FFFF00" {
			t.Errorf("row 5 style fill: want FFFF00, got %v", style.Fill.Color)
		}
	}
	if props, err := got.GetSheetProps(sheetName); err == nil {
		// The omnidoc writer stores the spec-shaped ARGB ("FFFF0000",
		// alpha-prefixed, as Excel itself writes); excelize used to store
		// the bare RGB. Accept either — the leading alpha strips off.
		tab := ""
		if props.TabColorRGB != nil {
			tab = *props.TabColorRGB
		}
		if len(tab) == 8 {
			tab = tab[2:]
		}
		if tab != "FF0000" {
			t.Errorf("tab color: want FF0000, got %q", tab)
		}
	}
	if visible, _ := got.GetSheetVisible("Other"); visible {
		t.Errorf("Other sheet visibility: want hidden, got visible")
	}
	if panes, err := got.GetPanes(sheetName); err == nil {
		if !panes.Freeze {
			t.Errorf("freeze: want frozen, got Freeze=false")
		}
		if panes.XSplit != 1 || panes.YSplit != 2 {
			t.Errorf("freeze split: want (XSplit=1, YSplit=2), got (XSplit=%d, YSplit=%d)", panes.XSplit, panes.YSplit)
		}
	}
	merges, _ := got.GetMergeCells(sheetName)
	sawMerge := false
	for _, m := range merges {
		if m.GetStartAxis() == "D1" && m.GetEndAxis() == "E1" {
			sawMerge = true
		}
	}
	if !sawMerge {
		t.Errorf("merge D1:E1: missing from output; got %d merges total", len(merges))
	}
}

// bootstrapAndSnapshot seeds a fresh server Y.Doc from model (the path
// the broker runs on first open) and returns the handle plus the
// snapshot SaveRoom would serialize.
func bootstrapAndSnapshot(t *testing.T, model WorkbookModel) (*sheetsDocHandle, YDocSnapshot) {
	t.Helper()
	handle, err := NewRuntime().NewDoc("bootstrap-snapshot-room")
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
	return sh, snap
}

// saveNewWorkbook serializes an omnidoc editor workbook built by a test.
func saveNewWorkbook(t *testing.T, f *xlsx.File) []byte {
	t.Helper()
	out, err := f.Save(t.Context())
	if err != nil {
		t.Fatalf("save fixture: %v", err)
	}
	return out
}

// docSheetMeta returns the sheet meta Y.Map whose name is sheetName, plus
// its sheet id.
func docSheetMeta(t *testing.T, doc *ycrdt.Doc, sheetName string) (string, *ycrdt.YMap) {
	t.Helper()
	var id string
	var meta *ycrdt.YMap
	doc.GetMap("sheets").(*ycrdt.YMap).ForEach(func(key string, value any, _ *ycrdt.YMap) {
		m, ok := value.(*ycrdt.YMap)
		if ok && m.Get("name") == sheetName {
			id, meta = key, m
		}
	})
	if meta == nil {
		t.Fatalf("sheet %q missing from the Y.Doc", sheetName)
	}
	return id, meta
}

func findSnapshotCell(snap YDocSnapshot, sheetID string, row, col int) (CellEntry, bool) {
	for _, c := range snap.Cells {
		if c.SheetID == sheetID && c.Row == row && c.Col == col {
			return c, true
		}
	}
	return CellEntry{}, false
}

// TestFormulaImportCarriesLeadingEquals guards the formula engine
// contract: the client (HyperFormula) treats only "="-prefixed input as
// a formula, so an imported formula without it would render as text and
// never calculate. The prefix must survive import → save → re-import
// exactly once, because the writer strips it and the reader adds it.
func TestFormulaImportCarriesLeadingEquals(t *testing.T) {
	f := xlsx.New()
	sh, err := f.Sheet("Sheet1")
	if err != nil {
		t.Fatalf("Sheet1: %v", err)
	}
	if err := sh.SetNumber(1, 1, 2); err != nil {
		t.Fatal(err)
	}
	if err := sh.SetNumber(2, 1, 3); err != nil {
		t.Fatal(err)
	}
	if err := sh.SetFormula(3, 1, "SUM(A1:A2)", xlsx.Value{Kind: xlsx.KindNumber, F: 5}); err != nil {
		t.Fatal(err)
	}
	if err := sh.SetFormula(4, 1, "A1*A2", xlsx.Value{}); err != nil {
		t.Fatal(err)
	}
	original := saveNewWorkbook(t, f)

	model, err := ReadWorkbookFromXLSX(t.Context(), original, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	cells := model.Sheets[0].Cells
	if got := cells["3:1"]; got.Formula != "=SUM(A1:A2)" || got.Raw != float64(5) || got.Display != "5" {
		t.Errorf("A3 = %+v, want formula =SUM(A1:A2) with cached 5", got)
	}
	// With no cached value the display falls back to the formula text,
	// which must read the way the user would type it.
	if got := cells["4:1"]; got.Formula != "=A1*A2" || got.Display != "=A1*A2" {
		t.Errorf("A4 = %+v, want formula and display =A1*A2", got)
	}

	doc, snap := bootstrapAndSnapshot(t, model)
	cellMap, ok := doc.doc.GetMap("cells").(*ycrdt.YMap).Get("sheet1:3:1").(*ycrdt.YMap)
	if !ok {
		t.Fatal("sheet1:3:1 missing from the Y.Doc")
	}
	if got := cellMap.Get("formula"); got != "=SUM(A1:A2)" {
		t.Errorf("Y.Doc formula = %v, want =SUM(A1:A2)", got)
	}

	saved, err := serializeSnapshotToXLSX(t.Context(), original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	ed, err := xlsx.Edit(t.Context(), saved)
	if err != nil {
		t.Fatalf("reopen saved: %v", err)
	}
	savedSheet, err := ed.Sheet("Sheet1")
	if err != nil {
		t.Fatal(err)
	}
	if got := savedSheet.Cell(3, 1).Formula; got != "SUM(A1:A2)" {
		t.Errorf("saved <f> = %q, want SUM(A1:A2) (no stored \"=\")", got)
	}

	again, err := ReadWorkbookFromXLSX(t.Context(), saved, 0, 0)
	if err != nil {
		t.Fatalf("re-import: %v", err)
	}
	for _, key := range []string{"3:1", "4:1"} {
		got := again.Sheets[0].Cells[key].Formula
		if !strings.HasPrefix(got, "=") || strings.HasPrefix(got, "==") {
			t.Errorf("re-imported %s formula = %q, want exactly one leading =", key, got)
		}
	}
}

// TestStyleOnlyCellsImportAndRoundTrip covers empty cells whose only
// content is a visible decoration (a box border, a fill). Dropping them
// loses the drawn box on import; keeping font-, alignment- or
// numFmt-only empties would bloat the doc with cells nobody can see.
func TestStyleOnlyCellsImportAndRoundTrip(t *testing.T) {
	f := xlsx.New()
	sh, err := f.Sheet("Sheet1")
	if err != nil {
		t.Fatalf("Sheet1: %v", err)
	}
	if err := sh.SetString(1, 1, "label"); err != nil {
		t.Fatal(err)
	}
	thin := "thin"
	box := &xlsx.EdgePatch{Style: &thin}
	solid, yellow := "solid", "FFFF00"
	bold, center, money := true, "center", "#,##0.00"
	patches := map[[2]int]xlsx.StylePatch{
		{2, 2}: {Border: &xlsx.BorderPatch{Top: box, Right: box, Bottom: box, Left: box}},
		{2, 3}: {Fill: &xlsx.FillPatch{Pattern: &solid, Fg: &yellow}},
		{3, 2}: {Font: &xlsx.FontPatch{Bold: &bold}},
		{3, 3}: {Alignment: &xlsx.AlignmentPatch{Horizontal: &center}},
		{3, 4}: {NumFmt: &money},
	}
	for at, p := range patches {
		if err := sh.PatchCellStyle(at[0], at[1], p); err != nil {
			t.Fatalf("style %v: %v", at, err)
		}
	}
	original := saveNewWorkbook(t, f)

	model, err := ReadWorkbookFromXLSX(t.Context(), original, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	cells := model.Sheets[0].Cells
	border, ok := cells["2:2"]
	if !ok || border.Kind != "string" || border.Raw != "" || border.Display != "" ||
		border.Style == nil || border.Style.Borders == nil || border.Style.Borders.Top == nil {
		t.Fatalf("border-only B2 = %+v (present=%v), want an empty string cell with borders", border, ok)
	}
	if fill, ok := cells["2:3"]; !ok || fill.Style == nil || fill.Style.Fill == nil {
		t.Errorf("fill-only C2 = %+v (present=%v), want an empty cell with the fill", fill, ok)
	}
	for _, key := range []string{"3:2", "3:3", "3:4"} {
		if c, ok := cells[key]; ok {
			t.Errorf("%s = %+v, want font/alignment/numFmt-only empties skipped", key, c)
		}
	}

	_, snap := bootstrapAndSnapshot(t, model)
	entry, ok := findSnapshotCell(snap, "sheet1", 2, 2)
	if !ok || entry.Kind != "string" || entry.RawString != "" || entry.Style == nil || entry.Style.Borders == nil {
		t.Fatalf("snapshot B2 = %+v (present=%v), want the styled empty cell", entry, ok)
	}

	saved, err := serializeSnapshotToXLSX(t.Context(), original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	ed, err := xlsx.Edit(t.Context(), saved)
	if err != nil {
		t.Fatalf("reopen saved: %v", err)
	}
	savedSheet, err := ed.Sheet("Sheet1")
	if err != nil {
		t.Fatal(err)
	}
	for _, at := range [][2]int{{2, 2}, {2, 3}} {
		got := savedSheet.Cell(at[0], at[1])
		if got.Value.Kind != xlsx.KindEmpty {
			t.Errorf("saved %v value = %+v, want no value (not an empty string)", at, got.Value)
		}
	}
	if got := savedSheet.CellStyle(2, 2).Border.Left.Style; got != "thin" {
		t.Errorf("saved B2 left border = %q, want thin", got)
	}

	again, err := ReadWorkbookFromXLSX(t.Context(), saved, 0, 0)
	if err != nil {
		t.Fatalf("re-import: %v", err)
	}
	if c, ok := again.Sheets[0].Cells["2:2"]; !ok || c.Style == nil || c.Style.Borders == nil {
		t.Errorf("re-imported B2 = %+v (present=%v), want the bordered empty cell", c, ok)
	}
}

// TestSheetDefaultSizesSeedTheDoc: without the sheet's own default row
// height / column width, every unsized row and column renders at the
// client's built-in defaults instead of the source file's.
func TestSheetDefaultSizesSeedTheDoc(t *testing.T) {
	src := excelize.NewFile()
	defer func() { _ = src.Close() }()
	rowHeight, colWidth, custom := 15.75, 12.63, true
	if err := src.SetSheetProps("Sheet1", &excelize.SheetPropsOptions{
		DefaultRowHeight: &rowHeight,
		DefaultColWidth:  &colWidth,
		CustomHeight:     &custom,
	}); err != nil {
		t.Fatalf("seed sheet defaults: %v", err)
	}
	if err := src.SetCellValue("Sheet1", "A1", "x"); err != nil {
		t.Fatal(err)
	}
	// An explicit height equal to the default is no customization.
	if err := src.SetRowHeight("Sheet1", 2, rowHeight); err != nil {
		t.Fatal(err)
	}
	if err := src.SetRowHeight("Sheet1", 3, 30); err != nil {
		t.Fatal(err)
	}
	buf, err := src.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	original := buf.Bytes()

	model, err := ReadWorkbookFromXLSX(t.Context(), original, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	ws := model.Sheets[0]
	wantRow, wantCol := excelPointsToPx(rowHeight), excelCharWidthToPx(colWidth)
	if ws.DefaultRowHeight != wantRow || ws.DefaultColWidth != wantCol {
		t.Errorf("defaults = (%d, %d) px, want (%d, %d)", ws.DefaultRowHeight, ws.DefaultColWidth, wantRow, wantCol)
	}
	if _, ok := ws.RowHeights[2]; ok {
		t.Errorf("row 2 at the sheet default leaked into RowHeights: %v", ws.RowHeights)
	}
	if _, ok := ws.RowHeights[3]; !ok {
		t.Errorf("row 3 custom height missing from RowHeights: %v", ws.RowHeights)
	}

	doc, snap := bootstrapAndSnapshot(t, model)
	_, meta := docSheetMeta(t, doc.doc, "Sheet1")
	if got := meta.Get("defaultRowHeight"); got != wantRow {
		t.Errorf("meta defaultRowHeight = %v, want %d", got, wantRow)
	}
	if got := meta.Get("defaultColWidth"); got != wantCol {
		t.Errorf("meta defaultColWidth = %v, want %d", got, wantCol)
	}
	if got := snap.Sheets[0]; got.DefaultRowHeight != wantRow || got.DefaultColWidth != wantCol {
		t.Errorf("snapshot defaults = (%d, %d), want (%d, %d)", got.DefaultRowHeight, got.DefaultColWidth, wantRow, wantCol)
	}

	saved, err := serializeSnapshotToXLSX(t.Context(), original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	reread, err := xlsx.OpenBytes(t.Context(), saved)
	if err != nil {
		t.Fatalf("reopen saved: %v", err)
	}
	if got := reread.Sheets[0]; got.DefaultRowHeight != rowHeight || got.DefaultColWidth != colWidth {
		t.Errorf("saved sheetFormatPr = (%v, %v), want (%v, %v)", got.DefaultRowHeight, got.DefaultColWidth, rowHeight, colWidth)
	}
}

// TestSheetWithoutDefaultColWidthSeedsExcelWidth: a sheet that declares
// no defaultColWidth still has one — Excel derives it from baseColWidth
// and the default font (9.140625 chars for Calibri 11) — so the doc
// carries that width rather than the client's own default.
func TestSheetWithoutDefaultColWidthSeedsExcelWidth(t *testing.T) {
	f := xlsx.New()
	sh, err := f.Sheet("Sheet1")
	if err != nil {
		t.Fatalf("Sheet1: %v", err)
	}
	if err := sh.SetString(1, 1, "x"); err != nil {
		t.Fatal(err)
	}
	model, err := ReadWorkbookFromXLSX(t.Context(), saveNewWorkbook(t, f), 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	doc, _ := bootstrapAndSnapshot(t, model)
	_, meta := docSheetMeta(t, doc.doc, "Sheet1")
	if got, want := meta.Get("defaultColWidth"), excelCharWidthToPx(defaultExcelColWidth); got != want {
		t.Errorf("meta defaultColWidth = %v, want %d", got, want)
	}
}

// TestBlankTemplateUsesTheStandardColumnWidth: a new spreadsheet starts
// from blank.xlsx, which declares no column width, so new sheets get the
// same standard width an imported file without one gets.
func TestBlankTemplateUsesTheStandardColumnWidth(t *testing.T) {
	model, err := ReadWorkbookFromXLSX(t.Context(), blankXLSX, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	if got, want := model.Sheets[0].DefaultColWidth, excelCharWidthToPx(defaultExcelColWidth); got != want {
		t.Errorf("blank template default column width = %d px, want the standard %d", got, want)
	}
}

// TestFormulaDateCacheIsSerialNumber: the formula engine produces
// serial numbers for date formulas and the display path formats them
// through numFmt, so an imported date-typed formula cache must be the
// serial too — an ISO string would make the cached value a text value.
// Plain date cells keep their ISO raw (the client converts those).
func TestFormulaDateCacheIsSerialNumber(t *testing.T) {
	f := xlsx.New()
	sh, err := f.Sheet("Sheet1")
	if err != nil {
		t.Fatalf("Sheet1: %v", err)
	}
	if err := sh.SetDate(1, 1, time.Date(2024, 12, 6, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	const serial = 45633.0 // 2024-12-07 in the 1900 date system
	if err := sh.SetFormula(2, 1, "A1+1", xlsx.Value{Kind: xlsx.KindNumber, F: serial}); err != nil {
		t.Fatal(err)
	}
	dateFmt := "yyyy-mm-dd"
	if err := sh.PatchCellStyle(2, 1, xlsx.StylePatch{NumFmt: &dateFmt}); err != nil {
		t.Fatal(err)
	}
	model, err := ReadWorkbookFromXLSX(t.Context(), saveNewWorkbook(t, f), 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	cells := model.Sheets[0].Cells
	if got := cells["1:1"]; got.Kind != "date" || got.Raw != "2024-12-06" {
		t.Errorf("A1 = %+v, want a date cell with ISO raw", got)
	}
	got := cells["2:1"]
	if got.Kind != "formula" || got.Raw != serial {
		t.Errorf("A2 = %+v (raw %T), want formula with serial raw %v", got, got.Raw, serial)
	}
	if got.Display != "2024-12-07" {
		t.Errorf("A2 display = %q, want 2024-12-07", got.Display)
	}
}
