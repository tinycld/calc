package calc

import (
	"fmt"
	"testing"

	"github.com/xuri/excelize/v2"
)

// buildSourceSheet creates an in-memory workbook whose first sheet holds
// the given header row plus data rows, so the pivot-range computation can
// read real source data the same way it does on the save path.
func buildSourceSheet(t *testing.T, sheet string, headers []string, rows [][]any) *excelize.File {
	t.Helper()
	f := excelize.NewFile()
	if sheet != "Sheet1" {
		if err := f.SetSheetName("Sheet1", sheet); err != nil {
			t.Fatalf("rename sheet: %v", err)
		}
	}
	for c, h := range headers {
		ref, err := excelize.CoordinatesToCellName(c+1, 1)
		if err != nil {
			t.Fatalf("coord: %v", err)
		}
		if err := f.SetCellValue(sheet, ref, h); err != nil {
			t.Fatalf("set header: %v", err)
		}
	}
	for r, row := range rows {
		for c, v := range row {
			ref, err := excelize.CoordinatesToCellName(c+1, r+2)
			if err != nil {
				t.Fatalf("coord: %v", err)
			}
			if err := f.SetCellValue(sheet, ref, v); err != nil {
				t.Fatalf("set cell: %v", err)
			}
		}
	}
	return f
}

// TestPivotTableRange_SmallPivot: a Region×Year×Sum pivot over 3 distinct
// regions and 2 distinct years, with row+col grand totals. Dimensions:
//
//	headerRowCount = len(Cols)=1
//	headerColCount = len(Rows)=1
//	renderRows     = 3 regions
//	renderCols     = 2 years
//	valueCount     = 1
//	rows = 1 + 3 + 1(colGrandTotal) = 5
//	cols = 1 + 2*1 + 1(rowGrandTotal) = 4  -> D
//
// Range: Pivot!A1:D5.
func TestPivotTableRange_SmallPivot(t *testing.T) {
	f := buildSourceSheet(t, "Sheet1",
		[]string{"Region", "Year", "Sales"},
		[][]any{
			{"East", 2023, 10},
			{"East", 2024, 12},
			{"West", 2023, 5},
			{"West", 2024, 7},
			{"North", 2023, 3},
			{"North", 2024, 9},
		},
	)
	defer func() { _ = f.Close() }()

	p := PivotDefinitionDTO{
		SourceRange:     "Sheet1!A1:C7",
		TargetSheetName: "Pivot",
		Rows:            []PivotFieldDTO{{SourceColumn: "Region"}},
		Cols:            []PivotFieldDTO{{SourceColumn: "Year"}},
		Values:          []PivotValueFieldDTO{{SourceColumn: "Sales", Aggregation: "sum"}},
		RowGrandTotals:  true,
		ColGrandTotals:  true,
	}

	rowCount, colCount, ok := computePivotDimensions(f, p)
	if !ok {
		t.Fatal("computePivotDimensions returned ok=false")
	}
	if rowCount != 5 || colCount != 4 {
		t.Fatalf("dims = %dx%d, want 5x4", rowCount, colCount)
	}
	if got := pivotTableRange(f, p); got != "Pivot!A1:D5" {
		t.Fatalf("range = %q, want Pivot!A1:D5", got)
	}
}

// TestPivotTableRange_NoTotals: same shape without grand totals — verifies
// the totals rows/cols aren't added.
func TestPivotTableRange_NoTotals(t *testing.T) {
	f := buildSourceSheet(t, "Sheet1",
		[]string{"Region", "Year", "Sales"},
		[][]any{
			{"East", 2023, 10},
			{"West", 2024, 7},
			{"North", 2023, 3},
		},
	)
	defer func() { _ = f.Close() }()

	p := PivotDefinitionDTO{
		SourceRange:     "Sheet1!A1:C4",
		TargetSheetName: "Pivot",
		Rows:            []PivotFieldDTO{{SourceColumn: "Region"}},
		Cols:            []PivotFieldDTO{{SourceColumn: "Year"}},
		Values:          []PivotValueFieldDTO{{SourceColumn: "Sales", Aggregation: "sum"}},
	}
	// 3 regions, 2 years: rows = 1 + 3 = 4, cols = 1 + 2 = 3 -> C4
	if got := pivotTableRange(f, p); got != "Pivot!A1:C4" {
		t.Fatalf("range = %q, want Pivot!A1:C4", got)
	}
}

// TestPivotTableRange_WidePivot: >26 distinct column values must push the
// end column past Z into the double-letter range (regression for the old
// hardcoded A1:Z200 truncating at column Z).
func TestPivotTableRange_WidePivot(t *testing.T) {
	// 30 distinct "Bucket" values in the columns axis, one row group.
	rows := make([][]any, 0, 30)
	for i := 0; i < 30; i++ {
		rows = append(rows, []any{"OnlyRow", fmt.Sprintf("col%02d", i), i})
	}
	f := buildSourceSheet(t, "Sheet1", []string{"Group", "Bucket", "N"}, rows)
	defer func() { _ = f.Close() }()

	p := PivotDefinitionDTO{
		SourceRange:     fmt.Sprintf("Sheet1!A1:C%d", len(rows)+1),
		TargetSheetName: "Pivot",
		Rows:            []PivotFieldDTO{{SourceColumn: "Group"}},
		Cols:            []PivotFieldDTO{{SourceColumn: "Bucket"}},
		Values:          []PivotValueFieldDTO{{SourceColumn: "N", Aggregation: "sum"}},
	}
	// headerColCount=1 + 30 cols*1 = 31 -> column 31 = "AE".
	_, colCount, ok := computePivotDimensions(f, p)
	if !ok {
		t.Fatal("ok=false")
	}
	if colCount != 31 {
		t.Fatalf("colCount = %d, want 31", colCount)
	}
	endName, _ := excelize.ColumnNumberToName(colCount)
	if endName != "AE" {
		t.Fatalf("end column letter = %q, want AE", endName)
	}
	got := pivotTableRange(f, p)
	if got != "Pivot!A1:AE2" {
		t.Fatalf("range = %q, want Pivot!A1:AE2 (past Z, not truncated)", got)
	}
}

// TestPivotTableRange_TallPivot: >200 distinct row values must push the
// end row past 200 (regression for the old hardcoded ...200).
func TestPivotTableRange_TallPivot(t *testing.T) {
	rows := make([][]any, 0, 250)
	for i := 0; i < 250; i++ {
		rows = append(rows, []any{fmt.Sprintf("row%04d", i), i})
	}
	f := buildSourceSheet(t, "Sheet1", []string{"Key", "N"}, rows)
	defer func() { _ = f.Close() }()

	p := PivotDefinitionDTO{
		SourceRange:     fmt.Sprintf("Sheet1!A1:B%d", len(rows)+1),
		TargetSheetName: "Pivot",
		Rows:            []PivotFieldDTO{{SourceColumn: "Key"}},
		Values:          []PivotValueFieldDTO{{SourceColumn: "N", Aggregation: "sum"}},
	}
	// No cols -> headerRowCount=1; 250 distinct rows -> rows = 1 + 250 = 251.
	rowCount, _, ok := computePivotDimensions(f, p)
	if !ok {
		t.Fatal("ok=false")
	}
	if rowCount != 251 {
		t.Fatalf("rowCount = %d, want 251", rowCount)
	}
	// No cols, single value -> one heading column: cols = headerColCount(1) + 1 = 2 -> B.
	if got := pivotTableRange(f, p); got != "Pivot!A1:B251" {
		t.Fatalf("range = %q, want Pivot!A1:B251 (past row 200)", got)
	}
}

// TestPivotTableRange_MultiValue: two value fields multiply the column
// count and add a value-label header row.
func TestPivotTableRange_MultiValue(t *testing.T) {
	f := buildSourceSheet(t, "Sheet1",
		[]string{"Region", "Q", "Sales", "Units"},
		[][]any{
			{"East", "Q1", 10, 1},
			{"East", "Q2", 12, 2},
			{"West", "Q1", 5, 3},
		},
	)
	defer func() { _ = f.Close() }()

	p := PivotDefinitionDTO{
		SourceRange:     "Sheet1!A1:D4",
		TargetSheetName: "Pivot",
		Rows:            []PivotFieldDTO{{SourceColumn: "Region"}},
		Cols:            []PivotFieldDTO{{SourceColumn: "Q"}},
		Values: []PivotValueFieldDTO{
			{SourceColumn: "Sales", Aggregation: "sum"},
			{SourceColumn: "Units", Aggregation: "sum"},
		},
	}
	// headerRowCount = 1(cols) + 1(multi-value label row) = 2
	// renderRows = 2 regions -> rows = 2 + 2 = 4
	// renderCols = 2 quarters; valueCount = 2 -> cols = 1 + 2*2 = 5 -> E
	rowCount, colCount, ok := computePivotDimensions(f, p)
	if !ok {
		t.Fatal("ok=false")
	}
	if rowCount != 4 || colCount != 5 {
		t.Fatalf("dims = %dx%d, want 4x5", rowCount, colCount)
	}
}

// TestPivotTableRange_RowSubtotals: with >=2 row fields and row subtotals
// on, one subtotal render-row is added per distinct first-field group.
func TestPivotTableRange_RowSubtotals(t *testing.T) {
	f := buildSourceSheet(t, "Sheet1",
		[]string{"Region", "City", "Sales"},
		[][]any{
			{"East", "NYC", 10},
			{"East", "Boston", 12},
			{"West", "LA", 5},
			{"West", "SF", 7},
		},
	)
	defer func() { _ = f.Close() }()

	p := PivotDefinitionDTO{
		SourceRange:     "Sheet1!A1:C5",
		TargetSheetName: "Pivot",
		Rows: []PivotFieldDTO{
			{SourceColumn: "Region"},
			{SourceColumn: "City"},
		},
		Values:       []PivotValueFieldDTO{{SourceColumn: "Sales", Aggregation: "sum"}},
		RowSubtotals: true,
	}
	// 4 distinct (Region,City) tuples + 2 first-field groups (East, West)
	// subtotals. headerRowCount=1 (no cols). rows = 1 + 4 + 2 = 7.
	rowCount, _, ok := computePivotDimensions(f, p)
	if !ok {
		t.Fatal("ok=false")
	}
	if rowCount != 7 {
		t.Fatalf("rowCount = %d, want 7", rowCount)
	}
}

// TestPivotTableRange_FilterSelections: an active filter selection drops
// rows, shrinking the distinct row count.
func TestPivotTableRange_FilterSelections(t *testing.T) {
	f := buildSourceSheet(t, "Sheet1",
		[]string{"Region", "Status", "Sales"},
		[][]any{
			{"East", "open", 10},
			{"West", "open", 5},
			{"North", "closed", 3},
			{"South", "closed", 8},
		},
	)
	defer func() { _ = f.Close() }()

	p := PivotDefinitionDTO{
		SourceRange:     "Sheet1!A1:C5",
		TargetSheetName: "Pivot",
		Rows:            []PivotFieldDTO{{SourceColumn: "Region"}},
		Values:          []PivotValueFieldDTO{{SourceColumn: "Sales", Aggregation: "sum"}},
		Filters:         []PivotFieldDTO{{SourceColumn: "Status"}},
		FilterSelections: map[string][]string{
			"Status": {"open"},
		},
	}
	// Only East + West survive the filter -> 2 distinct rows.
	// headerRowCount=1, rows = 1 + 2 = 3.
	rowCount, _, ok := computePivotDimensions(f, p)
	if !ok {
		t.Fatal("ok=false")
	}
	if rowCount != 3 {
		t.Fatalf("rowCount = %d, want 3 (filtered to open)", rowCount)
	}
}

// TestPivotTableRange_QuotedSheetName: a source sheet with spaces uses the
// single-quoted A1 form; the range computation must still read it.
func TestPivotTableRange_QuotedSheetName(t *testing.T) {
	f := buildSourceSheet(t, "My Data",
		[]string{"Region", "Sales"},
		[][]any{
			{"East", 10},
			{"West", 5},
		},
	)
	defer func() { _ = f.Close() }()

	p := PivotDefinitionDTO{
		SourceRange:     "'My Data'!A1:B3",
		TargetSheetName: "Pivot",
		Rows:            []PivotFieldDTO{{SourceColumn: "Region"}},
		Values:          []PivotValueFieldDTO{{SourceColumn: "Sales", Aggregation: "sum"}},
	}
	rowCount, _, ok := computePivotDimensions(f, p)
	if !ok {
		t.Fatal("ok=false for quoted sheet name")
	}
	if rowCount != 3 { // 1 header + 2 regions
		t.Fatalf("rowCount = %d, want 3", rowCount)
	}
}

// TestPivotTableRange_UnreadableSourceFallsBack: a malformed/absent source
// range falls back to the legacy A1:Z200 box rather than failing the save.
func TestPivotTableRange_UnreadableSourceFallsBack(t *testing.T) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()

	p := PivotDefinitionDTO{
		SourceRange:     "NoSuchSheet!A1:C10",
		TargetSheetName: "Pivot",
		Rows:            []PivotFieldDTO{{SourceColumn: "Region"}},
		Values:          []PivotValueFieldDTO{{SourceColumn: "Sales", Aggregation: "sum"}},
	}
	if _, _, ok := computePivotDimensions(f, p); ok {
		t.Fatal("expected ok=false for unreadable source")
	}
	if got := pivotTableRange(f, p); got != "Pivot!A1:Z200" {
		t.Fatalf("fallback range = %q, want Pivot!A1:Z200", got)
	}
}
