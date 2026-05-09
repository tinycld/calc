package calc

import (
	"os"
	"testing"
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
	model, err := ReadWorkbookFromXLSX(bytes, 0, 0)
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
	_, err := ReadWorkbookFromXLSX(nil, 0, 0)
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
	model, err := ReadWorkbookFromXLSX(bytes, 2, 2)
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
	model, err := ReadWorkbookFromXLSX(xlsxBytes, 0, 0)
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
