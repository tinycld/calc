package calc

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/nathanstitt/omnidoc/pkg/xlsx"
)

// hiddenFixture hides rows and columns each way a file does:
//   - rows 3 and 4 inside the autoFilter A1:A6, as a filter hides them
//     (row 3 with its own 30pt height, row 4 at the default);
//   - row 5 inside the filter, shown, with a 24pt height;
//   - row 9 hidden by hand outside the filter, with a 40pt height;
//   - row 11 at height 0, as calc saved a hidden row before it wrote
//     hidden="1";
//   - column C hidden with a width, column D at width 0, column E hidden
//     at the default width, and column AD hidden past the grid's extent.
func hiddenFixture(t *testing.T) []byte {
	t.Helper()
	f := xlsx.New()
	sh, err := f.Sheet("Sheet1")
	if err != nil {
		t.Fatal(err)
	}
	for r, v := range []string{"Name", "a", "b", "c", "d", "e"} {
		if err := sh.SetString(r+1, 1, v); err != nil {
			t.Fatal(err)
		}
	}
	if err := sh.SetAutoFilter(&xlsx.AutoFilter{Ref: "A1:A6"}); err != nil {
		t.Fatal(err)
	}
	sh.SetRowHeight(3, 30)
	sh.SetRowHeight(5, 24)
	sh.SetRowHeight(9, 40)
	sh.SetRowHeight(11, 0)
	sh.SetColWidth(3, 20)
	sh.SetColWidth(4, 0)
	for _, row := range []int{3, 4, 9} {
		if err := sh.SetRowHidden(row, true); err != nil {
			t.Fatal(err)
		}
	}
	for _, col := range []int{3, 5, 30} {
		if err := sh.SetColHidden(col, true); err != nil {
			t.Fatal(err)
		}
	}
	return saveNewWorkbook(t, f)
}

func TestHiddenRowsAndColsImport(t *testing.T) {
	model, doc, snap := importAndSnapshot(t, hiddenFixture(t))
	sheet := model.Sheets[0]

	wantRows := map[int]int{3: 0, 4: 0, 5: excelPointsToPx(24), 9: 0, 11: 0}
	if diff := cmp.Diff(wantRows, sheet.RowHeights); diff != "" {
		t.Errorf("RowHeights (-want +got):\n%s", diff)
	}
	wantCols := map[int]int{3: 0, 4: 0, 5: 0}
	if diff := cmp.Diff(wantCols, sheet.ColWidths); diff != "" {
		t.Errorf("ColWidths (-want +got):\n%s", diff)
	}
	// Row 9 is outside the filter, so only rows 3 and 5 have heights to
	// restore when the filter goes.
	wantSaved := map[int]int{3: excelPointsToPx(30), 5: excelPointsToPx(24)}
	if sheet.FilterView == nil {
		t.Fatal("the file's autoFilter did not import")
	}
	if diff := cmp.Diff(wantSaved, sheet.FilterView.SavedHeights); diff != "" {
		t.Errorf("FilterView.SavedHeights (-want +got):\n%s", diff)
	}

	_, meta := docSheetMeta(t, doc.doc, "Sheet1")
	if meta.Get("rowHeights") == nil || meta.Get("colWidths") == nil {
		t.Fatal("the hidden rows and columns did not reach the doc")
	}
	got := snapSheet(t, &snap, "Sheet1")
	if diff := cmp.Diff(wantRows, got.RowHeights); diff != "" {
		t.Errorf("snapshot RowHeights (-want +got):\n%s", diff)
	}
	if diff := cmp.Diff(wantCols, got.ColWidths); diff != "" {
		t.Errorf("snapshot ColWidths (-want +got):\n%s", diff)
	}
	if got.FilterView == nil {
		t.Fatal("snapshot lost the filter view")
	}
	if diff := cmp.Diff(wantSaved, got.FilterView.SavedHeights); diff != "" {
		t.Errorf("snapshot SavedHeights (-want +got):\n%s", diff)
	}
}

// TestFilterHidingNoRowsLeavesSavedHeightsAbsent: with no hidden row in
// the filter, the client's first apply must record the heights itself.
func TestFilterHidingNoRowsLeavesSavedHeightsAbsent(t *testing.T) {
	model, _, _ := importAndSnapshot(t, autoFilterFixture(t))
	if fv := model.Sheets[0].FilterView; fv == nil || fv.SavedHeights != nil {
		t.Errorf("FilterView = %+v, want one with no SavedHeights", fv)
	}
}

// TestHiddenRowsAndColsNoOpSave: saving the doc as imported keeps every
// hidden flag and every size the file has.
func TestHiddenRowsAndColsNoOpSave(t *testing.T) {
	original := hiddenFixture(t)
	_, _, snap := importAndSnapshot(t, original)
	before := openWorkbook(t, original).Sheets[0]
	after := openWorkbook(t, saveSnapshot(t, original, snap)).Sheets[0]
	for name, pair := range map[string][2]any{
		"HiddenRows": {before.HiddenRows, after.HiddenRows},
		"HiddenCols": {before.HiddenCols, after.HiddenCols},
		"RowHeights": {before.RowHeights, after.RowHeights},
		"ColWidths":  {before.ColWidths, after.ColWidths},
	} {
		if diff := cmp.Diff(pair[0], pair[1]); diff != "" {
			t.Errorf("%s changed (-before +after):\n%s", name, diff)
		}
	}
}

// TestHideAndShowSave: rows and columns the doc shows lose the hidden
// flag; rows and columns it hides gain it and keep their size in the
// file, so they show at that size again in Excel.
func TestHideAndShowSave(t *testing.T) {
	original := hiddenFixture(t)
	_, _, snap := importAndSnapshot(t, original)
	sheet := snapSheet(t, &snap, "Sheet1")
	sheet.RowHeights[3] = excelPointsToPx(50) // shown at a new height
	delete(sheet.RowHeights, 4)               // shown at the default
	delete(sheet.RowHeights, 11)              // shown: its zero height goes
	sheet.RowHeights[6] = 0                   // hidden by the filter now
	sheet.FilterView.SavedHeights[6] = excelPointsToPx(33)
	delete(sheet.ColWidths, 3) // shown at the width it had
	sheet.ColWidths[7] = 0     // hidden by a drag

	wb := openWorkbook(t, saveSnapshot(t, original, snap)).Sheets[0]
	if diff := cmp.Diff(map[int]bool{5: true, 8: true}, wb.HiddenRows); diff != "" {
		t.Errorf("HiddenRows (-want +got):\n%s", diff)
	}
	// Column AD is past the grid, so calc never showed it and keeps it
	// hidden.
	if diff := cmp.Diff(map[int]bool{4: true, 6: true, 29: true}, wb.HiddenCols); diff != "" {
		t.Errorf("HiddenCols (-want +got):\n%s", diff)
	}
	// Column D keeps the zero width that hides it.
	if w, has := wb.ColWidths[3]; !has || w != 0 {
		t.Errorf("column D width = %v (set %v), want 0", w, has)
	}
	for row, want := range map[int]float64{2: pxToExcelPoints(excelPointsToPx(50)), 5: pxToExcelPoints(excelPointsToPx(33)), 8: 40} {
		if got := wb.RowHeights[row]; got != want {
			t.Errorf("row %d height = %v, want %v", row+1, got, want)
		}
	}
	if pt, has := wb.RowHeights[10]; has {
		t.Errorf("row 11 kept height %v; a shown row must lose its zero height", pt)
	}
	if got := wb.ColWidths[2]; got != 20 {
		t.Errorf("column C width = %v, want the 20 it had while hidden", got)
	}
}

// TestLegacyDocKeepsFileHiddenRowsAndCols: a doc bootstrapped before the
// import read hidden flags shows those rows and columns. Its save must not
// unhide them in the file.
func TestLegacyDocKeepsFileHiddenRowsAndCols(t *testing.T) {
	original := hiddenFixture(t)
	_, _, snap := importAndSnapshot(t, original)
	snap.SheetFactsSeeded = false
	sheet := snapSheet(t, &snap, "Sheet1")
	sheet.RowHeights = map[int]int{3: excelPointsToPx(30), 5: excelPointsToPx(24), 9: excelPointsToPx(40)}
	sheet.ColWidths = map[int]int{3: excelPointsToPx(20)}

	wb := openWorkbook(t, saveSnapshot(t, original, snap)).Sheets[0]
	before := openWorkbook(t, original).Sheets[0]
	if diff := cmp.Diff(before.HiddenRows, wb.HiddenRows); diff != "" {
		t.Errorf("legacy save changed HiddenRows (-before +after):\n%s", diff)
	}
	if diff := cmp.Diff(before.HiddenCols, wb.HiddenCols); diff != "" {
		t.Errorf("legacy save changed HiddenCols (-before +after):\n%s", diff)
	}
}
