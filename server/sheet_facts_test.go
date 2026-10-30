package calc

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/nathanstitt/omnidoc/pkg/xlsx"
	ycrdt "github.com/skyterra/y-crdt"
)

const googleExportPath = "../tests/assets/google-export.xlsx"

func readGoogleExport(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile(googleExportPath)
	if err != nil {
		t.Fatalf("read %s: %v", googleExportPath, err)
	}
	return data
}

// importAndSnapshot runs the production import + bootstrap + snapshot on
// xlsx bytes.
func importAndSnapshot(t *testing.T, data []byte) (WorkbookModel, *sheetsDocHandle, YDocSnapshot) {
	t.Helper()
	model, err := ReadWorkbookFromXLSX(t.Context(), data, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	doc, snap := bootstrapAndSnapshot(t, model)
	return model, doc, snap
}

func saveSnapshot(t *testing.T, original []byte, snap YDocSnapshot) []byte {
	t.Helper()
	out, err := serializeSnapshotToXLSX(t.Context(), original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	return out
}

func openWorkbook(t *testing.T, data []byte) *xlsx.Workbook {
	t.Helper()
	wb, err := xlsx.OpenBytes(t.Context(), data)
	if err != nil {
		t.Fatalf("OpenBytes: %v", err)
	}
	return wb
}

func snapSheet(t *testing.T, snap *YDocSnapshot, name string) *SheetMeta {
	t.Helper()
	for i := range snap.Sheets {
		if snap.Sheets[i].Name == name {
			return &snap.Sheets[i]
		}
	}
	t.Fatalf("sheet %q missing from the snapshot", name)
	return nil
}

// zipPart returns one part of an xlsx package as text.
func zipPart(t *testing.T, data []byte, name string) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", name, err)
		}
		defer func() { _ = rc.Close() }()
		b, err := io.ReadAll(rc)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		return string(b)
	}
	t.Fatalf("part %s missing", name)
	return ""
}

// ---------------------------------------------------------------------------
// Gridlines
// ---------------------------------------------------------------------------

func gridLinesFixture(t *testing.T) []byte {
	t.Helper()
	f := xlsx.New()
	sh, err := f.Sheet("Sheet1")
	if err != nil {
		t.Fatal(err)
	}
	if err := sh.SetString(1, 1, "hidden lines"); err != nil {
		t.Fatal(err)
	}
	sh.SetShowGridLines(false)
	sh2, err := f.AddSheet("Sheet2")
	if err != nil {
		t.Fatal(err)
	}
	if err := sh2.SetString(1, 1, "shown lines"); err != nil {
		t.Fatal(err)
	}
	return saveNewWorkbook(t, f)
}

// TestGridLinesImportAndSave: a sheet that hides its gridlines must show
// none in calc, and calc's View › Gridlines toggle must reach the file.
func TestGridLinesImportAndSave(t *testing.T) {
	original := gridLinesFixture(t)
	model, doc, snap := importAndSnapshot(t, original)
	if !model.Sheets[0].HideGridLines || model.Sheets[1].HideGridLines {
		t.Fatalf("model HideGridLines = (%v, %v), want (true, false)", model.Sheets[0].HideGridLines, model.Sheets[1].HideGridLines)
	}
	_, meta1 := docSheetMeta(t, doc.doc, "Sheet1")
	_, meta2 := docSheetMeta(t, doc.doc, "Sheet2")
	if got := meta1.Get("hideGridLines"); got != true {
		t.Errorf("Sheet1 meta hideGridLines = %v, want true", got)
	}
	if got := meta2.Get("hideGridLines"); got != nil {
		t.Errorf("Sheet2 meta hideGridLines = %v, want absent", got)
	}
	if !snap.SheetFactsSeeded {
		t.Fatal("snapshot of a fresh bootstrap must report SheetFactsSeeded")
	}
	if !snapSheet(t, &snap, "Sheet1").HideGridLines || snapSheet(t, &snap, "Sheet2").HideGridLines {
		t.Fatalf("snapshot HideGridLines wrong: %+v", snap.Sheets)
	}

	snapSheet(t, &snap, "Sheet1").HideGridLines = false
	snapSheet(t, &snap, "Sheet2").HideGridLines = true
	wb := openWorkbook(t, saveSnapshot(t, original, snap))
	if wb.Sheets[0].HideGridLines || !wb.Sheets[1].HideGridLines {
		t.Errorf("saved HideGridLines = (%v, %v), want (false, true)", wb.Sheets[0].HideGridLines, wb.Sheets[1].HideGridLines)
	}
}

// TestLegacyDocLeavesGridLinesAlone: a doc bootstrapped before calc read
// gridlines carries no hideGridLines key; saving it must not turn the
// file's hidden gridlines back on.
func TestLegacyDocLeavesGridLinesAlone(t *testing.T) {
	original := gridLinesFixture(t)
	snap := snapshotFromXLSX(t, original)
	wb := openWorkbook(t, saveSnapshot(t, original, snap))
	if !wb.Sheets[0].HideGridLines {
		t.Error("legacy save showed the gridlines the file hides")
	}
}

// ---------------------------------------------------------------------------
// Google export reference file
// ---------------------------------------------------------------------------

// TestGoogleExportSheetFactsImport pins the facts calc reads from the
// reference Google Sheets export.
func TestGoogleExportSheetFactsImport(t *testing.T) {
	model, doc, snap := importAndSnapshot(t, readGoogleExport(t))

	if model.DefaultFont == nil || model.DefaultFont.Name != "Arial" || model.DefaultFont.Size != 10 {
		t.Errorf("DefaultFont = %+v, want Arial 10", model.DefaultFont)
	}
	wbMap, ok := doc.doc.GetMap("workbook").(*ycrdt.YMap)
	if !ok {
		t.Fatal("workbook map missing")
	}
	font, ok := wbMap.Get("defaultFont").(*ycrdt.YMap)
	if !ok {
		t.Fatalf("workbook.defaultFont = %T, want a Y.Map", wbMap.Get("defaultFont"))
	}
	if font.Get("name") != "Arial" || font.Get("size") != 10 {
		t.Errorf("workbook.defaultFont = {%v, %v}, want {Arial, 10}", font.Get("name"), font.Get("size"))
	}

	detail := snapSheet(t, &snap, "detail")
	want := &FilterView{Mode: "header", Range: FilterRange{StartRow: 1, EndRow: 35, StartCol: 1, EndCol: 77}}
	if d := cmp.Diff(want, detail.FilterView); d != "" {
		t.Errorf("detail filter view (-want +got):\n%s", d)
	}
	_, meta := docSheetMeta(t, doc.doc, "detail")
	fv, ok := meta.Get("filterView").(*ycrdt.YMap)
	if !ok {
		t.Fatal("detail meta has no filterView Y.Map")
	}
	if fv.Get("mode") != "header" {
		t.Errorf("filterView mode = %v, want header", fv.Get("mode"))
	}
	if fv.Get("savedHeights") != nil {
		t.Error("filterView must carry no savedHeights: the import hides no rows")
	}
	for _, name := range []string{"Summary both $ and Hours", "Summary of $ by person"} {
		if !snapSheet(t, &snap, name).HideGridLines {
			t.Errorf("%s: gridlines not hidden", name)
		}
	}
	if detail.HideGridLines {
		t.Error("detail: gridlines hidden, want shown")
	}
}

// TestGoogleExportNoOpSaveKeepsSheetFacts: a save with no edits must
// leave every sheet fact calc now writes byte-identical in the file.
func TestGoogleExportNoOpSaveKeepsSheetFacts(t *testing.T) {
	original := readGoogleExport(t)
	_, _, snap := importAndSnapshot(t, original)
	saved := saveSnapshot(t, original, snap)

	facts := regexp.MustCompile(`<sheetView [^>]*>|<sheetFormatPr [^>]*>|<autoFilter [^>]*>|<hyperlinks>.*?</hyperlinks>`)
	for _, part := range []string{"xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml"} {
		before := facts.FindAllString(zipPart(t, original, part), -1)
		after := facts.FindAllString(zipPart(t, saved, part), -1)
		if d := cmp.Diff(before, after); d != "" {
			t.Errorf("%s sheet facts changed on a no-op save (-before +after):\n%s", part, d)
		}
	}
	names := regexp.MustCompile(`<definedName [^>]*_FilterDatabase[^<]*</definedName>`)
	if b, a := names.FindAllString(zipPart(t, original, "xl/workbook.xml"), -1), names.FindAllString(zipPart(t, saved, "xl/workbook.xml"), -1); !slices.Equal(b, a) {
		t.Errorf("_FilterDatabase changed: %v -> %v", b, a)
	}
}

// ---------------------------------------------------------------------------
// AutoFilter ↔ filter view
// ---------------------------------------------------------------------------

func TestFilterColumnCriterion(t *testing.T) {
	custom := func(and bool, fs ...xlsx.CustomFilter) xlsx.FilterColumn {
		return xlsx.FilterColumn{Custom: &xlsx.CustomFilters{And: and, Filters: fs}}
	}
	eq := func(v string) xlsx.CustomFilter { return xlsx.CustomFilter{Operator: "equal", Val: v} }
	cond := func(op string, values ...string) *FilterCriterion {
		return &FilterCriterion{Type: "condition", Condition: &FilterCondition{Op: op, Values: values}}
	}
	ten := 10.0
	cases := []struct {
		name string
		col  xlsx.FilterColumn
		want *FilterCriterion
	}{
		{"values", xlsx.FilterColumn{Values: []string{"a", "b"}}, &FilterCriterion{Type: "values", AllowedValues: []string{"a", "b"}}},
		{"values and blanks", xlsx.FilterColumn{Values: []string{"a"}, Blank: true}, &FilterCriterion{Type: "values", AllowedValues: []string{"a", ""}}},
		{"blanks only", xlsx.FilterColumn{Blank: true}, cond("isEmpty")},
		{"date groups", xlsx.FilterColumn{DateGroups: []xlsx.DateGroupItem{{Year: 2024}}}, nil},
		{"greater than", custom(false, xlsx.CustomFilter{Operator: "greaterThan", Val: "5"}), cond("gt", "5")},
		{"less than", custom(false, xlsx.CustomFilter{Operator: "lessThan", Val: "5"}), cond("lt", "5")},
		{"at least", custom(false, xlsx.CustomFilter{Operator: "greaterThanOrEqual", Val: "5"}), nil},
		{"equal", custom(false, eq("x")), cond("eq", "x")},
		{"equal escaped star", custom(false, eq("a~*b")), cond("eq", "a*b")},
		{"contains", custom(false, eq("*x*")), cond("contains", "x")},
		{"starts with", custom(false, eq("x*")), cond("startsWith", "x")},
		{"ends with", custom(false, eq("*x")), cond("endsWith", "x")},
		{"single char wildcard", custom(false, eq("a?c")), nil},
		{"inner star", custom(false, eq("a*c")), nil},
		{"equal blank", custom(false, eq("")), cond("isEmpty")},
		{"not equal", custom(false, xlsx.CustomFilter{Operator: "notEqual", Val: "x"}), cond("neq", "x")},
		{"non-blanks", custom(false, xlsx.CustomFilter{Operator: "notEqual", Val: " "}), cond("isNotEmpty")},
		{"not equal pattern", custom(false, xlsx.CustomFilter{Operator: "notEqual", Val: "*x*"}), nil},
		{"two equals OR", custom(false, eq("a"), eq("b")), cond("eq", "a", "b")},
		{"two equals AND", custom(true, eq("a"), eq("b")), nil},
		{"two contains OR", custom(false, eq("*a*"), eq("*b*")), cond("contains", "a", "b")},
		{"mixed OR", custom(false, eq("*a*"), eq("b*")), nil},
		{"two not equal AND", custom(true, xlsx.CustomFilter{Operator: "notEqual", Val: "a"}, xlsx.CustomFilter{Operator: "notEqual", Val: "b"}), cond("neq", "a", "b")},
		{"two not equal OR", custom(false, xlsx.CustomFilter{Operator: "notEqual", Val: "a"}, xlsx.CustomFilter{Operator: "notEqual", Val: "b"}), nil},
		{"top 10", xlsx.FilterColumn{Top10: &xlsx.Top10Filter{Val: ten}}, nil},
		{"dynamic", xlsx.FilterColumn{Dynamic: &xlsx.DynamicFilter{Type: "today"}}, nil},
		{"color", xlsx.FilterColumn{Color: &xlsx.ColorFilter{}}, nil},
		{"icon", xlsx.FilterColumn{Icon: &xlsx.IconFilter{IconSet: "3Arrows"}}, nil},
		{"button only", xlsx.FilterColumn{HiddenButton: true}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := filterColumnCriterion(tc.col)
			if tc.want == nil {
				if ok {
					t.Errorf("got %+v, want no calc criterion", got)
				}
				return
			}
			if !ok {
				t.Fatalf("no criterion, want %+v", *tc.want)
			}
			if d := cmp.Diff(*tc.want, got); d != "" {
				t.Errorf("criterion (-want +got):\n%s", d)
			}
		})
	}
}

// TestCriterionFilterColumnRoundTrip: every criterion calc can author
// must survive save → re-import unchanged.
func TestCriterionFilterColumnRoundTrip(t *testing.T) {
	cond := func(op string, values ...string) FilterCriterion {
		return FilterCriterion{Type: "condition", Condition: &FilterCondition{Op: op, Values: values}}
	}
	cases := []FilterCriterion{
		{Type: "values", AllowedValues: []string{"a", "b"}},
		{Type: "values", AllowedValues: []string{"a", ""}},
		cond("gt", "5"),
		cond("lt", "5", "10"),
		cond("eq", "a*b"),
		cond("eq", "a", "b"),
		cond("neq", "a", "b"),
		cond("contains", "x?y"),
		cond("startsWith", "x"),
		cond("endsWith", "x", "y"),
		cond("isEmpty"),
		cond("isNotEmpty"),
	}
	for _, c := range cases {
		col, ok := criterionFilterColumn(3, c)
		if !ok {
			t.Errorf("%+v: not writable", c)
			continue
		}
		if col.ColID != 3 {
			t.Errorf("%+v: ColID = %d, want 3", c, col.ColID)
		}
		back, ok := filterColumnCriterion(col)
		if !ok {
			t.Errorf("%+v: written column %+v does not read back", c, col)
			continue
		}
		if d := cmp.Diff(c, back); d != "" {
			t.Errorf("round trip (-want +got):\n%s", d)
		}
	}
	if _, ok := criterionFilterColumn(0, FilterCriterion{Type: "values"}); ok {
		t.Error("an empty values list (shows nothing) has no autoFilter form; want not writable")
	}
}

const sortStateXML = `<sortState ref="A2:D10"><sortCondition ref="A2:A10"/></sortState>`

func autoFilterFixture(t *testing.T) []byte {
	t.Helper()
	f := xlsx.New()
	sh, err := f.Sheet("Sheet1")
	if err != nil {
		t.Fatal(err)
	}
	for c, h := range []string{"Name", "Score", "Note", "Tag"} {
		if err := sh.SetString(1, c+1, h); err != nil {
			t.Fatal(err)
		}
	}
	for r := 2; r <= 10; r++ {
		if err := sh.SetString(r, 1, "a"); err != nil {
			t.Fatal(err)
		}
	}
	if err := sh.SetAutoFilter(&xlsx.AutoFilter{
		Ref: "A1:D10",
		Columns: []xlsx.FilterColumn{
			{ColID: 0, Values: []string{"a", "b"}},
			{ColID: 1, Top10: &xlsx.Top10Filter{Val: 3}},
			{ColID: 2, Custom: &xlsx.CustomFilters{Filters: []xlsx.CustomFilter{{Operator: "equal", Val: "*x*"}}}},
		},
		Extra: [][]byte{[]byte(sortStateXML)},
	}); err != nil {
		t.Fatalf("SetAutoFilter: %v", err)
	}
	return saveNewWorkbook(t, f)
}

// TestAutoFilterImportMapsModeledColumns: the columns calc can show
// become criteria keyed by absolute column; the rest stay in the file.
func TestAutoFilterImportMapsModeledColumns(t *testing.T) {
	_, doc, snap := importAndSnapshot(t, autoFilterFixture(t))
	want := &FilterView{
		Mode:  "header",
		Range: FilterRange{StartRow: 1, EndRow: 10, StartCol: 1, EndCol: 4},
		Criteria: map[int]FilterCriterion{
			1: {Type: "values", AllowedValues: []string{"a", "b"}},
			3: {Type: "condition", Condition: &FilterCondition{Op: "contains", Values: []string{"x"}}},
		},
	}
	if d := cmp.Diff(want, snap.Sheets[0].FilterView); d != "" {
		t.Errorf("filter view (-want +got):\n%s", d)
	}
	_, meta := docSheetMeta(t, doc.doc, "Sheet1")
	fv := meta.Get("filterView").(*ycrdt.YMap)
	rng := fv.Get("range").(*ycrdt.YMap)
	if rng.Get("startRow") != 1 || rng.Get("endRow") != 10 || rng.Get("startCol") != 1 || rng.Get("endCol") != 4 {
		t.Errorf("range Y.Map = {%v %v %v %v}", rng.Get("startRow"), rng.Get("endRow"), rng.Get("startCol"), rng.Get("endCol"))
	}
	crit := fv.Get("criteria").(*ycrdt.YMap)
	values := crit.Get("1").(*ycrdt.YMap)
	if values.Get("type") != "values" {
		t.Errorf("criteria[1].type = %v", values.Get("type"))
	}
	contains := crit.Get("3").(*ycrdt.YMap).Get("condition").(*ycrdt.YMap)
	if contains.Get("op") != "contains" {
		t.Errorf("criteria[3].condition.op = %v", contains.Get("op"))
	}
	if crit.Get("2") != nil {
		t.Error("the top-10 column must not become a calc criterion")
	}
}

func savedAutoFilter(t *testing.T, data []byte) *xlsx.AutoFilter {
	t.Helper()
	return openWorkbook(t, data).Sheets[0].AutoFilter
}

func TestAutoFilterSave(t *testing.T) {
	original := autoFilterFixture(t)
	origAF := savedAutoFilter(t, original)

	t.Run("no-op keeps the file's filter", func(t *testing.T) {
		_, _, snap := importAndSnapshot(t, original)
		if d := cmp.Diff(origAF, savedAutoFilter(t, saveSnapshot(t, original, snap))); d != "" {
			t.Errorf("autoFilter changed (-orig +saved):\n%s", d)
		}
	})

	t.Run("edits keep the columns calc cannot show", func(t *testing.T) {
		_, _, snap := importAndSnapshot(t, original)
		fv := snap.Sheets[0].FilterView
		delete(fv.Criteria, 1)
		fv.Criteria[3] = FilterCriterion{Type: "condition", Condition: &FilterCondition{Op: "startsWith", Values: []string{"y"}}}
		fv.Criteria[4] = FilterCriterion{Type: "condition", Condition: &FilterCondition{Op: "gt", Values: []string{"5"}}}
		got := savedAutoFilter(t, saveSnapshot(t, original, snap))
		if got == nil {
			t.Fatal("filter removed")
		}
		if got.Ref != "A1:D10" {
			t.Errorf("Ref = %q", got.Ref)
		}
		if len(got.Columns) != 3 {
			t.Fatalf("Columns = %+v, want top10 (B), startsWith (C), gt (D)", got.Columns)
		}
		if c := got.Columns[0]; c.ColID != 1 || c.Top10 == nil || c.Top10.Val != 3 {
			t.Errorf("column B = %+v, want the file's top-10 kept", c)
		}
		if c := got.Columns[1]; c.ColID != 2 || c.Custom == nil || c.Custom.Filters[0].Val != "y*" {
			t.Errorf("column C = %+v, want equal y*", c)
		}
		if c := got.Columns[2]; c.ColID != 3 || c.Custom == nil || c.Custom.Filters[0].Operator != "greaterThan" {
			t.Errorf("column D = %+v, want greaterThan 5", c)
		}
		if len(got.Extra) != 1 || !bytes.Contains(got.Extra[0], []byte("sortState")) {
			t.Errorf("Extra = %q, want the sortState kept", got.Extra)
		}
	})

	t.Run("clearing the filter removes it", func(t *testing.T) {
		_, _, snap := importAndSnapshot(t, original)
		snap.Sheets[0].FilterView = nil
		saved := saveSnapshot(t, original, snap)
		if got := savedAutoFilter(t, saved); got != nil {
			t.Errorf("autoFilter = %+v, want none", got)
		}
		for _, n := range openWorkbook(t, saved).DefinedNames {
			if n.Name == "_xlnm._FilterDatabase" {
				t.Errorf("_FilterDatabase name left behind: %+v", n)
			}
		}
	})

	t.Run("a resized range drops the sort state and outside columns", func(t *testing.T) {
		_, _, snap := importAndSnapshot(t, original)
		snap.Sheets[0].FilterView.Range = FilterRange{StartRow: 1, EndRow: 20, StartCol: 2, EndCol: 3}
		got := savedAutoFilter(t, saveSnapshot(t, original, snap))
		if got == nil || got.Ref != "B1:C20" {
			t.Fatalf("autoFilter = %+v, want B1:C20", got)
		}
		if len(got.Extra) != 0 {
			t.Errorf("Extra = %q, want none for a new range", got.Extra)
		}
		if len(got.Columns) != 2 || got.Columns[0].ColID != 0 || got.Columns[0].Top10 == nil || got.Columns[1].ColID != 1 || got.Columns[1].Custom == nil {
			t.Errorf("Columns = %+v, want top-10 then contains, re-based on column B", got.Columns)
		}
	})
}

// TestFilterViewFromCalcIsWritten: a filter authored in calc (no filter
// in the file) reaches the file. The client's header filter starts its
// range at row/column 0, which the file cannot hold.
func TestFilterViewFromCalcIsWritten(t *testing.T) {
	f := xlsx.New()
	sh, _ := f.Sheet("Sheet1")
	if err := sh.SetString(1, 1, "Name"); err != nil {
		t.Fatal(err)
	}
	original := saveNewWorkbook(t, f)
	_, _, snap := importAndSnapshot(t, original)
	snap.Sheets[0].FilterView = &FilterView{
		Mode:     "header",
		Range:    FilterRange{StartRow: 0, EndRow: 99, StartCol: 0, EndCol: 25},
		Criteria: map[int]FilterCriterion{2: {Type: "values", AllowedValues: []string{"x"}}},
	}
	got := savedAutoFilter(t, saveSnapshot(t, original, snap))
	if got == nil || got.Ref != "A1:Y99" {
		t.Fatalf("autoFilter = %+v, want A1:Y99", got)
	}
	if len(got.Columns) != 1 || got.Columns[0].ColID != 1 || !slices.Equal(got.Columns[0].Values, []string{"x"}) {
		t.Errorf("Columns = %+v, want column B values [x]", got.Columns)
	}
}

// TestLegacyDocKeepsFileAutoFilter: a doc bootstrapped before calc read
// autoFilters has no filterView; its save must keep the file's filter.
func TestLegacyDocKeepsFileAutoFilter(t *testing.T) {
	original := autoFilterFixture(t)
	snap := snapshotFromXLSX(t, original)
	if got := savedAutoFilter(t, saveSnapshot(t, original, snap)); got == nil {
		t.Error("legacy save removed the file's autoFilter")
	}
}

// ---------------------------------------------------------------------------
// Hyperlinks
// ---------------------------------------------------------------------------

func hyperlinksFixture(t *testing.T) ([]byte, []xlsx.Hyperlink) {
	t.Helper()
	f := xlsx.New()
	sh, _ := f.Sheet("Sheet1")
	if _, err := f.AddSheet("Sheet2"); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		row, col int
		v        string
	}{{2, 2, "Site"}, {5, 5, "left"}, {5, 6, "right"}, {4, 4, "Go"}} {
		if err := sh.SetString(c.row, c.col, c.v); err != nil {
			t.Fatal(err)
		}
	}
	links := []xlsx.Hyperlink{
		{Ref: "B2", URL: "https://example.com/", Tooltip: "Open the site", Display: "Site"},
		{Ref: "C3", URL: "https://docs.example.com/", Display: "Docs"},
		{Ref: "D4", Location: "Sheet2!A1"},
		{Ref: "E5:F5", URL: "https://range.example.com/"},
	}
	if err := sh.SetHyperlinks(links); err != nil {
		t.Fatalf("SetHyperlinks: %v", err)
	}
	return saveNewWorkbook(t, f), links
}

func TestHyperlinksImport(t *testing.T) {
	data, _ := hyperlinksFixture(t)
	model, doc, snap := importAndSnapshot(t, data)
	cells := model.Sheets[0].Cells
	for key, want := range map[string]string{
		"2:2": "https://example.com/",
		"3:3": "https://docs.example.com/",
		"4:4": "#Sheet2!A1",
		"5:5": "https://range.example.com/",
		"5:6": "https://range.example.com/",
	} {
		if got := cells[key].Link; got != want {
			t.Errorf("cell %s link = %q, want %q", key, got, want)
		}
	}
	if c := cells["3:3"]; c.Kind != "string" || c.Raw != "Docs" || c.Display != "Docs" {
		t.Errorf("empty linked cell C3 = %+v, want a string cell showing the link text", c)
	}
	if c := cells["2:2"]; c.Raw != "Site" {
		t.Errorf("B2 raw = %v, want its own text kept", c.Raw)
	}

	sheetID, _ := docSheetMeta(t, doc.doc, "Sheet1")
	cell := doc.doc.GetMap("cells").(*ycrdt.YMap).Get(sheetID + ":4:4").(*ycrdt.YMap)
	if got := cell.Get("link"); got != "#Sheet2!A1" {
		t.Errorf("Y cell D4 link = %v", got)
	}
	if c, ok := findSnapshotCell(snap, sheetID, 2, 2); !ok || c.Link != "https://example.com/" {
		t.Errorf("snapshot B2 = %+v, want its link", c)
	}
}

func TestHyperlinksSave(t *testing.T) {
	original, links := hyperlinksFixture(t)

	t.Run("no-op keeps every link as written", func(t *testing.T) {
		_, _, snap := importAndSnapshot(t, original)
		saved := saveSnapshot(t, original, snap)
		if d := cmp.Diff(links, openWorkbook(t, saved).Sheets[0].Hyperlinks); d != "" {
			t.Errorf("hyperlinks (-orig +saved):\n%s", d)
		}
	})

	t.Run("edits", func(t *testing.T) {
		_, _, snap := importAndSnapshot(t, original)
		sheetID := snap.Sheets[0].ID
		for i := range snap.Cells {
			c := &snap.Cells[i]
			if c.SheetID != sheetID {
				continue
			}
			switch {
			case c.Row == 2 && c.Col == 2:
				c.Link = ""
			case c.Row == 4 && c.Col == 4:
				c.Link = "https://new.example.com/a b"
			case c.Row == 5 && c.Col == 6:
				c.Link = "#Sheet2!B2"
			}
		}
		snap.Cells = append(snap.Cells, CellEntry{SheetID: sheetID, Row: 1, Col: 1, Kind: "string", RawString: "x", Display: "x", Link: "mailto:a@example.com"})
		got := openWorkbook(t, saveSnapshot(t, original, snap)).Sheets[0].Hyperlinks
		want := []xlsx.Hyperlink{
			{Ref: "C3", URL: "https://docs.example.com/", Display: "Docs"},
			{Ref: "A1", URL: "mailto:a@example.com"},
			{Ref: "D4", URL: "https://new.example.com/a%20b"},
			{Ref: "E5", URL: "https://range.example.com/"},
			{Ref: "F5", Location: "Sheet2!B2"},
		}
		if d := cmp.Diff(want, got); d != "" {
			t.Errorf("hyperlinks (-want +got):\n%s", d)
		}
	})

	t.Run("legacy doc keeps the file's links", func(t *testing.T) {
		snap := snapshotFromXLSX(t, original)
		if got := openWorkbook(t, saveSnapshot(t, original, snap)).Sheets[0].Hyperlinks; len(got) != len(links) {
			t.Errorf("legacy save left %d links, want %d", len(got), len(links))
		}
	})
}

// ---------------------------------------------------------------------------
// Default sizes, default font, padding cells
// ---------------------------------------------------------------------------

func TestSheetDefaultSizesSave(t *testing.T) {
	original := readGoogleExport(t)
	_, _, snap := importAndSnapshot(t, original)
	detail := snapSheet(t, &snap, "detail")
	if detail.DefaultRowHeight != 21 || detail.DefaultColWidth != 93 {
		t.Fatalf("detail defaults = (%d, %d) px, want (21, 93)", detail.DefaultRowHeight, detail.DefaultColWidth)
	}
	detail.DefaultRowHeight = 30
	detail.DefaultColWidth = 120
	saved := saveSnapshot(t, original, snap)
	wb := openWorkbook(t, saved)
	if got := wb.Sheets[0]; got.DefaultRowHeight != pxToExcelPoints(30) || got.DefaultColWidth != pxToExcelCharWidth(120) {
		t.Errorf("saved defaults = (%v pt, %v chars), want (%v, %v)", got.DefaultRowHeight, got.DefaultColWidth, pxToExcelPoints(30), pxToExcelCharWidth(120))
	}
	if got := wb.Sheets[1]; got.DefaultRowHeight != 15.75 || got.DefaultColWidth != 12.63 {
		t.Errorf("untouched sheet defaults = (%v, %v), want (15.75, 12.63)", got.DefaultRowHeight, got.DefaultColWidth)
	}
}

// TestPaddingCellsInheritingRowStyleAreNotImported: omnidoc gives a
// padding cell (no <c> element) its row's style. The row style already
// paints it through rowStyles, so it must not also become a cell.
func TestPaddingCellsInheritingRowStyleAreNotImported(t *testing.T) {
	f := xlsx.New()
	sh, _ := f.Sheet("Sheet1")
	if err := sh.SetRowStyle(2, xlsx.Style{Fill: xlsx.Fill{Pattern: "solid", Fg: xlsx.Color{RGB: "FFFF00"}}}); err != nil {
		t.Fatal(err)
	}
	if err := sh.SetString(2, 3, "in row"); err != nil {
		t.Fatal(err)
	}
	if err := sh.SetString(5, 5, "corner"); err != nil {
		t.Fatal(err)
	}
	thin := "thin"
	if err := sh.PatchCellStyle(4, 2, xlsx.StylePatch{Border: &xlsx.BorderPatch{Top: &xlsx.EdgePatch{Style: &thin}}}); err != nil {
		t.Fatal(err)
	}
	model, err := ReadWorkbookFromXLSX(t.Context(), saveNewWorkbook(t, f), 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	ws := model.Sheets[0]
	var keys []string
	for k := range ws.Cells {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	if want := []string{"2:3", "4:2", "5:5"}; !slices.Equal(keys, want) {
		t.Errorf("cells = %v, want %v (row 2 padding stays out; the bordered empty stays in)", keys, want)
	}
	if ws.RowStyles[2] == nil {
		t.Error("row 2 style missing from RowStyles")
	}
}

// rewriteZipPart returns data with one package part replaced by
// edit(part).
func rewriteZipPart(t *testing.T, data []byte, name string, edit func(string) string) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		if f.Name == name {
			b = []byte(edit(string(b)))
		}
		w, err := zw.Create(f.Name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(b); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

// TestFormulaDateCacheIn1904WorkbookIsA1900Serial: the formula engine
// counts serials from 1900, so a 1904 workbook's date caches must be
// shifted on import.
func TestFormulaDateCacheIn1904WorkbookIsA1900Serial(t *testing.T) {
	f := xlsx.New()
	sh, _ := f.Sheet("Sheet1")
	const serial1904 = 45633.0 - 1462 // 2024-12-07 counted from 1904
	if err := sh.SetFormula(1, 1, "DATE(2024,12,7)", xlsx.Value{Kind: xlsx.KindNumber, F: serial1904}); err != nil {
		t.Fatal(err)
	}
	dateFmt := "yyyy-mm-dd"
	if err := sh.PatchCellStyle(1, 1, xlsx.StylePatch{NumFmt: &dateFmt}); err != nil {
		t.Fatal(err)
	}
	data := rewriteZipPart(t, saveNewWorkbook(t, f), "xl/workbook.xml", func(s string) string {
		if strings.Contains(s, "<workbookPr") {
			return strings.Replace(s, "<workbookPr", `<workbookPr date1904="1"`, 1)
		}
		return strings.Replace(s, "<sheets>", `<workbookPr date1904="1"/><sheets>`, 1)
	})
	if !openWorkbook(t, data).Date1904 {
		t.Fatal("fixture is not a 1904 workbook")
	}
	model, err := ReadWorkbookFromXLSX(t.Context(), data, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := model.Sheets[0].Cells["1:1"]; got.Kind != "formula" || got.Raw != 45633.0 || got.Display != "2024-12-07" {
		t.Errorf("A1 = %+v, want formula with 1900-system serial 45633 showing 2024-12-07", got)
	}
}

// TestFormulaDateCacheIn1904WorkbookSavesInItsOwnSystem: the doc holds
// 1900-system serials, so saving back into a 1904 workbook must shift a
// date-formatted formula cache back, or it would be 1462 days off.
func TestFormulaDateCacheIn1904WorkbookSavesInItsOwnSystem(t *testing.T) {
	f := xlsx.New()
	sh, _ := f.Sheet("Sheet1")
	const serial1904 = 45633.0 - 1462
	if err := sh.SetFormula(1, 1, "DATE(2024,12,7)", xlsx.Value{Kind: xlsx.KindNumber, F: serial1904}); err != nil {
		t.Fatal(err)
	}
	dateFmt := "yyyy-mm-dd"
	if err := sh.PatchCellStyle(1, 1, xlsx.StylePatch{NumFmt: &dateFmt}); err != nil {
		t.Fatal(err)
	}
	if err := sh.SetFormula(2, 1, "1+1", xlsx.Value{Kind: xlsx.KindNumber, F: 2}); err != nil {
		t.Fatal(err)
	}
	data := rewriteZipPart(t, saveNewWorkbook(t, f), "xl/workbook.xml", func(s string) string {
		if strings.Contains(s, "<workbookPr") {
			return strings.Replace(s, "<workbookPr", `<workbookPr date1904="1"`, 1)
		}
		return strings.Replace(s, "<sheets>", `<workbookPr date1904="1"/><sheets>`, 1)
	})
	model, err := ReadWorkbookFromXLSX(t.Context(), data, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	_, snap := bootstrapAndSnapshot(t, model)
	out, err := serializeSnapshotToXLSX(t.Context(), data, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	cells := openWorkbook(t, out).Sheets[0].Cells
	if got := cells[0][0].Value.F; got != serial1904 {
		t.Errorf("A1 cached serial = %v, want the 1904-system %v", got, serial1904)
	}
	if got := cells[1][0].Value.F; got != 2 {
		t.Errorf("A2 (not a date) cached value = %v, want 2 unchanged", got)
	}
}

// TestFractionalDefaultFontSizeStaysNumeric: y-crdt drops a bare float
// Set, so a 10.5 pt default font uses the single-element array wrapper
// numberFromYRaw reads, not a string.
func TestFractionalDefaultFontSizeStaysNumeric(t *testing.T) {
	model := WorkbookModel{
		Sheets:      []WorksheetModel{{Name: "Sheet1", RowCount: 1, ColCount: 1, Cells: map[string]CellValueDTO{}}},
		DefaultFont: &WorkbookFontDTO{Name: "Calibri", Size: 10.5},
	}
	doc, _ := bootstrapAndSnapshot(t, model)
	font := doc.doc.GetMap("workbook").(*ycrdt.YMap).Get("defaultFont").(*ycrdt.YMap)
	if n, ok := unwrapYRawNumber(font.Get("size")); !ok || n != 10.5 {
		t.Errorf("defaultFont.size = %#v, want numeric 10.5", font.Get("size"))
	}
}
