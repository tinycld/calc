package calc

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/nathanstitt/omnidoc/pkg/xlsx"
	ycrdt "github.com/skyterra/y-crdt"
	"github.com/xuri/excelize/v2"
)

// TestPivotDefinitionDTOJSONRoundTrip asserts that a fully-populated
// DTO marshals to camelCase JSON and decodes byte-for-byte back into
// the same Go value. The Y.Doc bootstrap and preview endpoints both
// rely on this shape matching the TS PivotDefinition interface
// exactly — a silent rename in either direction would surface as a
// missing field on the client.
func TestPivotDefinitionDTOJSONRoundTrip(t *testing.T) {
	orig := PivotDefinitionDTO{
		ID:              "pv1",
		SourceRange:     "Sheet1!A1:D10",
		TargetSheetName: "Pivot1",
		Rows: []PivotFieldDTO{
			{SourceColumn: "Region", DisplayName: "Region"},
		},
		Cols: []PivotFieldDTO{
			{SourceColumn: "Quarter"},
		},
		Values: []PivotValueFieldDTO{
			{
				SourceColumn: "Revenue",
				DisplayName:  "Total Revenue",
				Aggregation:  "sum",
				NumFmt:       "#,##0.00",
			},
		},
		Filters: []PivotFieldDTO{
			{SourceColumn: "Year"},
		},
		FilterSelections: map[string][]string{
			"Year": {"2024", "2025"},
		},
		RowGrandTotals: true,
		ColGrandTotals: false,
		RowSubtotals:   true,
		ColSubtotals:   false,
		StyleName:      "PivotStyleMedium9",
	}

	encoded, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	wantSubstrings := []string{
		`"id":"pv1"`,
		`"sourceRange":"Sheet1!A1:D10"`,
		`"targetSheetName":"Pivot1"`,
		`"filterSelections":`,
		`"rowGrandTotals":true`,
		`"colGrandTotals":false`,
		`"rowSubtotals":true`,
		`"colSubtotals":false`,
		`"styleName":"PivotStyleMedium9"`,
		`"sourceColumn":"Revenue"`,
		`"aggregation":"sum"`,
		`"numFmt":"#,##0.00"`,
	}
	s := string(encoded)
	for _, want := range wantSubstrings {
		if !strings.Contains(s, want) {
			t.Errorf("missing JSON fragment %q in %s", want, s)
		}
	}

	var decoded PivotDefinitionDTO
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(orig, decoded) {
		t.Fatalf("round-trip mismatch:\n got: %#v\nwant: %#v", decoded, orig)
	}
}

// TestPivotDefinitionDTOOmitEmpty asserts that the omitempty-tagged
// fields drop out of the wire shape when unset. The preview endpoint
// emits a DTO per pivot in the workbook; bytes saved per pivot
// multiply across large workbooks.
func TestPivotDefinitionDTOOmitEmpty(t *testing.T) {
	minimal := PivotDefinitionDTO{
		ID:              "pv2",
		SourceRange:     "A1:B2",
		TargetSheetName: "P",
		Rows:            []PivotFieldDTO{},
		Cols:            []PivotFieldDTO{},
		Values:          []PivotValueFieldDTO{},
		Filters:         []PivotFieldDTO{},
	}

	encoded, err := json.Marshal(minimal)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(encoded)

	for _, banned := range []string{
		`"filterSelections"`,
		`"styleName"`,
	} {
		if strings.Contains(s, banned) {
			t.Errorf("expected %s to be omitted when zero, got %s", banned, s)
		}
	}

	for _, required := range []string{
		`"rowGrandTotals":false`,
		`"colGrandTotals":false`,
		`"rowSubtotals":false`,
		`"colSubtotals":false`,
	} {
		if !strings.Contains(s, required) {
			t.Errorf("expected %s to be present (boolean, no omitempty), got %s", required, s)
		}
	}
}

// TestPivotFieldDTOOmitEmpty: DisplayName is optional in the TS shape,
// so empty values shouldn't end up on the wire.
func TestPivotFieldDTOOmitEmpty(t *testing.T) {
	f := PivotFieldDTO{SourceColumn: "Region"}
	encoded, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(encoded)
	if strings.Contains(s, `"displayName"`) {
		t.Errorf("expected displayName omitted, got %s", s)
	}
	if !strings.Contains(s, `"sourceColumn":"Region"`) {
		t.Errorf("expected sourceColumn present, got %s", s)
	}
}

// TestPivotValueFieldDTOOmitEmpty: DisplayName and NumFmt are
// optional; Aggregation is required and should always serialize.
func TestPivotValueFieldDTOOmitEmpty(t *testing.T) {
	v := PivotValueFieldDTO{SourceColumn: "Revenue", Aggregation: "sum"}
	encoded, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(encoded)
	for _, banned := range []string{`"displayName"`, `"numFmt"`} {
		if strings.Contains(s, banned) {
			t.Errorf("expected %s omitted, got %s", banned, s)
		}
	}
	if !strings.Contains(s, `"aggregation":"sum"`) {
		t.Errorf("expected aggregation present, got %s", s)
	}
}

// TestWorkbookModelPivotsRoundTrip: the new Pivots slice on
// WorkbookModel must round-trip through JSON the same way Sheets
// does, and must be omitted when nil/empty.
func TestWorkbookModelPivotsRoundTrip(t *testing.T) {
	withPivots := WorkbookModel{
		Sheets: []WorksheetModel{{Name: "Sheet1"}},
		Pivots: []PivotDefinitionDTO{
			{
				ID:              "pv1",
				SourceRange:     "Sheet1!A1:B2",
				TargetSheetName: "Pivot1",
				Rows:            []PivotFieldDTO{{SourceColumn: "A"}},
				Cols:            []PivotFieldDTO{},
				Values:          []PivotValueFieldDTO{{SourceColumn: "B", Aggregation: "sum"}},
				Filters:         []PivotFieldDTO{},
			},
		},
	}

	encoded, err := json.Marshal(withPivots)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(encoded), `"pivots"`) {
		t.Errorf("expected pivots in JSON, got %s", string(encoded))
	}

	var decoded WorkbookModel
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(decoded.Pivots) != 1 {
		t.Fatalf("want 1 pivot after round-trip, got %d", len(decoded.Pivots))
	}
	if decoded.Pivots[0].ID != "pv1" {
		t.Errorf("pivot id: want pv1, got %s", decoded.Pivots[0].ID)
	}

	noPivots := WorkbookModel{Sheets: []WorksheetModel{{Name: "Sheet1"}}}
	encoded, err = json.Marshal(noPivots)
	if err != nil {
		t.Fatalf("marshal no-pivots: %v", err)
	}
	if strings.Contains(string(encoded), `"pivots"`) {
		t.Errorf("expected pivots omitted when empty, got %s", string(encoded))
	}
}

// TestReadWorkbookFromXLSX_Pivots exercises the xlsx → WorkbookModel
// pivot import path end-to-end. testdata/pivot-basic.xlsx is a
// deterministic fixture authored via excelize.AddPivotTable that
// places a single Region × Year × Sum(Sales) pivot on a dedicated
// PivotSheet so we can assert the basic field mapping without also
// exercising the in-sheet → dedicated-sheet promotion path
// (ensureDistinctTargets owns that case and is covered by a separate
// case where source and target collide).
func TestReadWorkbookFromXLSX_Pivots(t *testing.T) {
	data, err := os.ReadFile("testdata/pivot-basic.xlsx")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	model, err := ReadWorkbookFromXLSX(t.Context(), data, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	if len(model.Pivots) != 1 {
		t.Fatalf("want 1 pivot, got %d", len(model.Pivots))
	}
	p := model.Pivots[0]
	if p.SourceRange != "Sheet1!A1:C4" {
		t.Errorf("SourceRange = %q, want Sheet1!A1:C4", p.SourceRange)
	}
	if p.TargetSheetName != "PivotSheet" {
		t.Errorf("TargetSheetName = %q, want PivotSheet", p.TargetSheetName)
	}
	if len(p.Rows) != 1 || p.Rows[0].SourceColumn != "Region" {
		t.Errorf("Rows = %+v", p.Rows)
	}
	if len(p.Cols) != 1 || p.Cols[0].SourceColumn != "Year" {
		t.Errorf("Cols = %+v", p.Cols)
	}
	if len(p.Values) != 1 || p.Values[0].SourceColumn != "Sales" ||
		p.Values[0].Aggregation != "sum" {
		t.Errorf("Values = %+v", p.Values)
	}
	if !p.RowGrandTotals || !p.ColGrandTotals {
		t.Errorf("totals flags = %+v / %+v", p.RowGrandTotals, p.ColGrandTotals)
	}
}

// TestSerializeWorkbook_PivotRoundTrip drives serializeWorkbook end-to-end:
// build a WorkbookModel with one pivot, serialize to xlsx bytes, reopen
// with excelize, and assert GetPivotTables surfaces an equivalent
// definition. Guards against silent drift in DTO→PivotTableOptions
// mapping and aggregation-enum encoding.
func TestSerializeWorkbook_PivotRoundTrip(t *testing.T) {
	model := WorkbookModel{
		Sheets: []WorksheetModel{
			{
				Name: "Sheet1", RowCount: 4, ColCount: 3,
				Cells: map[string]CellValueDTO{
					"1:1": {Kind: "string", Raw: "Region", Display: "Region"},
					"1:2": {Kind: "string", Raw: "Year", Display: "Year"},
					"1:3": {Kind: "string", Raw: "Sales", Display: "Sales"},
					"2:1": {Kind: "string", Raw: "East", Display: "East"},
					"2:2": {Kind: "number", Raw: float64(2024), Display: "2024"},
					"2:3": {Kind: "number", Raw: float64(10), Display: "10"},
					"3:1": {Kind: "string", Raw: "West", Display: "West"},
					"3:2": {Kind: "number", Raw: float64(2024), Display: "2024"},
					"3:3": {Kind: "number", Raw: float64(5), Display: "5"},
				},
			},
			{Name: "Pivot of Sheet1", RowCount: 1, ColCount: 1, Cells: map[string]CellValueDTO{}},
		},
		Pivots: []PivotDefinitionDTO{
			{
				ID:              "p1",
				SourceRange:     "Sheet1!A1:C3",
				TargetSheetName: "Pivot of Sheet1",
				Rows:            []PivotFieldDTO{{SourceColumn: "Region"}},
				Cols:            []PivotFieldDTO{{SourceColumn: "Year"}},
				Values: []PivotValueFieldDTO{
					{SourceColumn: "Sales", Aggregation: "sum"},
				},
				RowGrandTotals: true,
				ColGrandTotals: true,
			},
		},
	}
	data, err := serializeWorkbook(t.Context(), model)
	if err != nil {
		t.Fatalf("serializeWorkbook: %v", err)
	}
	if len(data) == 0 {
		t.Fatalf("empty serialization output")
	}

	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("re-open: %v", err)
	}
	defer func() { _ = f.Close() }()

	pivots, err := f.GetPivotTables("Pivot of Sheet1")
	if err != nil {
		t.Fatalf("GetPivotTables: %v", err)
	}
	if len(pivots) != 1 {
		t.Fatalf("want 1 pivot on target sheet, got %d", len(pivots))
	}
	if got := pivots[0].DataRange; got != "Sheet1!A1:C3" {
		t.Errorf("DataRange = %q, want Sheet1!A1:C3", got)
	}
	if len(pivots[0].Rows) != 1 || pivots[0].Rows[0].Data != "Region" {
		t.Errorf("Rows = %+v", pivots[0].Rows)
	}
	if len(pivots[0].Columns) != 1 || pivots[0].Columns[0].Data != "Year" {
		t.Errorf("Columns = %+v", pivots[0].Columns)
	}
	if len(pivots[0].Data) != 1 || pivots[0].Data[0].Data != "Sales" {
		t.Errorf("Data = %+v", pivots[0].Data)
	}
}

// TestRoundTrip_ImportExportImport: read a real xlsx fixture, serialize
// it back out, then re-import. The pivot count and SourceRange must
// match across the two imports — drift here means the export path is
// reshaping the def in a way the importer can't recover.
func TestRoundTrip_ImportExportImport(t *testing.T) {
	data, err := os.ReadFile("testdata/pivot-basic.xlsx")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	model, err := ReadWorkbookFromXLSX(t.Context(), data, 0, 0)
	if err != nil {
		t.Fatalf("first import: %v", err)
	}
	out, err := serializeWorkbook(t.Context(), model)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	second, err := ReadWorkbookFromXLSX(t.Context(), out, 0, 0)
	if err != nil {
		t.Fatalf("second import: %v", err)
	}
	if len(second.Pivots) != len(model.Pivots) {
		t.Fatalf("pivot count drift: first=%d second=%d", len(model.Pivots), len(second.Pivots))
	}
	if model.Pivots[0].SourceRange != second.Pivots[0].SourceRange {
		t.Errorf("SourceRange drift: %q -> %q", model.Pivots[0].SourceRange, second.Pivots[0].SourceRange)
	}
}

// TestSerializeSnapshotToXLSX_EmitsPivots exercises the SaveRoom
// snapshot path: a YDocSnapshot carrying a Pivots slice round-trips
// through serializeSnapshotToXLSX and lands as a real PivotTable on
// the output xlsx. Guards against the snapshot path drifting from the
// model-only path (serializeWorkbook) — both should produce equivalent
// pivot output for the same definition.
func TestSerializeSnapshotToXLSX_EmitsPivots(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	snap := snapshotFromXLSX(t, original)
	// Append a target sheet for the pivot to land on. The fixture is
	// "tiny.xlsx" with sheets "People" + "Incomes"; we add a third.
	snap.Sheets = append(snap.Sheets, SheetMeta{
		ID:       "sheet3",
		Name:     "PivotTarget",
		Position: 2,
	})
	snap.Pivots = []PivotDefinitionDTO{
		{
			ID:              "p1",
			SourceRange:     "People!A1:D8",
			TargetSheetName: "PivotTarget",
			Rows:            []PivotFieldDTO{{SourceColumn: "First Name"}},
			Values: []PivotValueFieldDTO{
				{SourceColumn: "Last Name", Aggregation: "count"},
			},
			RowGrandTotals: true,
			ColGrandTotals: true,
		},
	}

	out, err := serializeSnapshotToXLSX(t.Context(), original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("empty output")
	}

	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("re-open: %v", err)
	}
	defer func() { _ = f.Close() }()

	pivots, err := f.GetPivotTables("PivotTarget")
	if err != nil {
		t.Fatalf("GetPivotTables: %v", err)
	}
	if len(pivots) != 1 {
		t.Fatalf("want 1 pivot on PivotTarget, got %d", len(pivots))
	}
	if got := pivots[0].DataRange; got != "People!A1:D8" {
		t.Errorf("DataRange = %q, want People!A1:D8", got)
	}
	if len(pivots[0].Rows) != 1 || pivots[0].Rows[0].Data != "First Name" {
		t.Errorf("Rows = %+v", pivots[0].Rows)
	}
	if len(pivots[0].Data) != 1 || pivots[0].Data[0].Data != "Last Name" {
		t.Errorf("Data = %+v", pivots[0].Data)
	}
}

// TestSerializeSnapshotToXLSX_OmitsPivotsWhenEmpty ensures the
// snapshot path is a no-op for pivots when the snapshot doesn't carry
// any — non-pivot workbooks must round-trip unaffected. (Behavior
// preservation: pre-pivot snapshots must not gain new artifacts.)
func TestSerializeSnapshotToXLSX_OmitsPivotsWhenEmpty(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	snap := snapshotFromXLSX(t, original)
	// snap.Pivots is the zero value: nil.

	out, err := serializeSnapshotToXLSX(t.Context(), original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("re-open: %v", err)
	}
	defer func() { _ = f.Close() }()
	for _, sheet := range f.GetSheetList() {
		pts, err := f.GetPivotTables(sheet)
		if err != nil {
			t.Fatalf("GetPivotTables(%q): %v", sheet, err)
		}
		if len(pts) != 0 {
			t.Errorf("sheet %q: unexpected pivots after round-trip with empty snap.Pivots: %+v", sheet, pts)
		}
	}
}

// TestSerializeSnapshotToXLSX_SkipsPivotWithNoValues mirrors the
// model-only path's silent-skip rule: a pivot definition with no
// Values is dropped (excelize requires at least one Data field). The
// rest of the snapshot still serializes successfully.
func TestSerializeSnapshotToXLSX_SkipsPivotWithNoValues(t *testing.T) {
	original, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	snap := snapshotFromXLSX(t, original)
	snap.Sheets = append(snap.Sheets, SheetMeta{
		ID: "sheet3", Name: "PivotTarget", Position: 2,
	})
	snap.Pivots = []PivotDefinitionDTO{
		{
			ID:              "no-values",
			SourceRange:     "People!A1:D8",
			TargetSheetName: "PivotTarget",
			Rows:            []PivotFieldDTO{{SourceColumn: "First Name"}},
			// Values omitted on purpose.
		},
	}

	out, err := serializeSnapshotToXLSX(t.Context(), original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}

	f, err := excelize.OpenReader(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("re-open: %v", err)
	}
	defer func() { _ = f.Close() }()
	pts, err := f.GetPivotTables("PivotTarget")
	if err != nil {
		t.Fatalf("GetPivotTables: %v", err)
	}
	if len(pts) != 0 {
		t.Errorf("pivot with no Values should be skipped; got %d", len(pts))
	}
}

// TestSnapshotCollectsPivots exercises collectPivots end-to-end: build
// a Y.Doc carrying a pivot Y.Map (matching the TS y-binding write
// shape), apply the encoded update to a server-side handle, and verify
// Snapshot() surfaces the pivot. This is the read path that wires
// SaveRoom into the doc-side pivot state.
func TestSnapshotCollectsPivots(t *testing.T) {
	update := buildPivotsUpdate(t,
		"sheet1", "Sheet1", 0, 8, 6,
		"piv-1", "Sheet1!A1:C3", "PivotOut",
	)

	rt := NewRuntime()
	handle, err := rt.NewDoc("pivots-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	if err := handle.ApplyUpdate(update); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}
	snap, err := handle.(*sheetsDocHandle).Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snap.Pivots) != 1 {
		t.Fatalf("snap.Pivots = %d; want 1", len(snap.Pivots))
	}
	p := snap.Pivots[0]
	if p.ID != "piv-1" {
		t.Errorf("ID = %q, want piv-1", p.ID)
	}
	if p.SourceRange != "Sheet1!A1:C3" {
		t.Errorf("SourceRange = %q", p.SourceRange)
	}
	if p.TargetSheetName != "PivotOut" {
		t.Errorf("TargetSheetName = %q", p.TargetSheetName)
	}
	if len(p.Rows) != 1 || p.Rows[0].SourceColumn != "Region" {
		t.Errorf("Rows = %+v", p.Rows)
	}
	if len(p.Cols) != 1 || p.Cols[0].SourceColumn != "Year" {
		t.Errorf("Cols = %+v", p.Cols)
	}
	if len(p.Values) != 1 || p.Values[0].SourceColumn != "Sales" || p.Values[0].Aggregation != "sum" {
		t.Errorf("Values = %+v", p.Values)
	}
	if !p.RowGrandTotals {
		t.Errorf("RowGrandTotals = false; want true")
	}
}

// buildPivotsUpdate constructs a y-crdt update mirroring the TS-side
// writePivot output: a top-level "pivots" Y.Map keyed by ID, with
// nested Y.Maps for scalars and Y.Arrays for rows/cols/values/filters.
// One row, one col, one sum value; row totals on. Source/target sheets
// are seeded so the snapshot has somewhere to anchor.
func buildPivotsUpdate(t testing.TB, sheetID, sheetName string, sheetPos, rowCount, colCount int, pivotID, sourceRange, targetSheetName string) []byte {
	t.Helper()
	doc := ycrdt.NewDoc("pivot-builder", false, nil, nil, false)
	sheetsMap := doc.GetMap("sheets").(*ycrdt.YMap)
	pivotsMap := doc.GetMap("pivots").(*ycrdt.YMap)
	doc.Transact(func(_ *ycrdt.Transaction) {
		meta := ycrdt.NewYMap(nil)
		meta.Set("name", sheetName)
		meta.Set("position", sheetPos)
		meta.Set("rowCount", rowCount)
		meta.Set("colCount", colCount)
		sheetsMap.Set(sheetID, meta)

		pivotMap := ycrdt.NewYMap(nil)
		pivotMap.Set("sourceRange", sourceRange)
		pivotMap.Set("targetSheetName", targetSheetName)
		pivotMap.Set("rows", buildFieldArray([]map[string]string{{"sourceColumn": "Region"}}))
		pivotMap.Set("cols", buildFieldArray([]map[string]string{{"sourceColumn": "Year"}}))
		pivotMap.Set("values", buildValueFieldArray([]map[string]string{
			{"sourceColumn": "Sales", "aggregation": "sum"},
		}))
		pivotMap.Set("filters", ycrdt.NewYArray())
		pivotMap.Set("filterSelections", ycrdt.NewYMap(nil))
		pivotMap.Set("rowGrandTotals", true)
		pivotMap.Set("colGrandTotals", false)
		pivotMap.Set("rowSubtotals", true)
		pivotMap.Set("colSubtotals", true)
		pivotsMap.Set(pivotID, pivotMap)
	}, nil)
	out := ycrdt.EncodeStateAsUpdate(doc, nil)
	if len(out) == 0 {
		t.Fatal("buildPivotsUpdate produced empty bytes")
	}
	return out
}

func buildFieldArray(fields []map[string]string) *ycrdt.YArray {
	arr := ycrdt.NewYArray()
	for _, f := range fields {
		m := ycrdt.NewYMap(nil)
		for k, v := range f {
			m.Set(k, v)
		}
		arr.Push(ycrdt.ArrayAny{m})
	}
	return arr
}

func buildValueFieldArray(fields []map[string]string) *ycrdt.YArray {
	// values entries carry a required `aggregation` scalar in addition
	// to the field shape; the helper accepts both keys in the map.
	arr := ycrdt.NewYArray()
	for _, f := range fields {
		m := ycrdt.NewYMap(nil)
		for k, v := range f {
			m.Set(k, v)
		}
		arr.Push(ycrdt.ArrayAny{m})
	}
	return arr
}

// buildOccupiedTargetPivotFixture authors the Google-Sheets-export
// shape: a pivot whose target sheet also holds the pivot's materialized
// output as plain cells, followed by another sheet. The pivot has two
// value fields and no column field, so its colFields carry only the
// x="-2" "Values" placeholder. Sales cells carry a custom number format;
// Units cells carry none.
func buildOccupiedTargetPivotFixture(t *testing.T) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	if err := f.SetSheetName("Sheet1", "Data"); err != nil {
		t.Fatal(err)
	}
	rows := [][]any{
		{"Region", "Year", "Sales", "Units"},
		{"East", 2024, 10.5, 3},
		{"West", 2024, 5.25, 2},
	}
	for i, row := range rows {
		cell, _ := excelize.CoordinatesToCellName(1, i+1)
		if err := f.SetSheetRow("Data", cell, &row); err != nil {
			t.Fatal(err)
		}
	}
	money := "#,##0.00"
	moneyStyle, err := f.NewStyle(&excelize.Style{CustomNumFmt: &money})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellStyle("Data", "C2", "C3", moneyStyle); err != nil {
		t.Fatal(err)
	}
	if _, err := f.NewSheet("Report"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.NewSheet("Notes"); err != nil {
		t.Fatal(err)
	}
	if err := f.SetCellValue("Notes", "A1", "keep me"); err != nil {
		t.Fatal(err)
	}
	// Sheet XML calc does not model, so only the preserved on-disk part
	// carries it through a save.
	dv := excelize.NewDataValidation(true)
	dv.Sqref = "B1:B5"
	if err := dv.SetDropList([]string{"yes", "no"}); err != nil {
		t.Fatal(err)
	}
	if err := f.AddDataValidation("Notes", dv); err != nil {
		t.Fatal(err)
	}
	if err := f.AddPivotTable(&excelize.PivotTableOptions{
		DataRange:       "Data!A1:D3",
		PivotTableRange: "Report!A1:C5",
		Rows:            []excelize.PivotTableField{{Data: "Region"}},
		Data: []excelize.PivotTableField{
			{Data: "Sales", Subtotal: "Sum"},
			{Data: "Units", Subtotal: "Sum"},
		},
		RowGrandTotals: true,
		ColGrandTotals: true,
	}); err != nil {
		t.Fatalf("AddPivotTable: %v", err)
	}
	if err := f.SetCellValue("Report", "A1", "Region"); err != nil {
		t.Fatal(err)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatalf("WriteToBuffer: %v", err)
	}
	return buf.Bytes()
}

// TestReadPivotsDropsValuesPlaceholderAxisField: <field x="-2"/> in an
// axis is Excel's "Values" placeholder (where the data fields sit), not
// a source column; surfacing it as a field named "" breaks the engine.
func TestReadPivotsDropsValuesPlaceholderAxisField(t *testing.T) {
	model, err := ReadWorkbookFromXLSX(t.Context(), buildOccupiedTargetPivotFixture(t), 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	if len(model.Pivots) != 1 {
		t.Fatalf("want 1 pivot, got %d", len(model.Pivots))
	}
	p := model.Pivots[0]
	if len(p.Cols) != 0 {
		t.Errorf("Cols = %+v, want none (the x=-2 placeholder is not a field)", p.Cols)
	}
	if len(p.Rows) != 1 || p.Rows[0].SourceColumn != "Region" {
		t.Errorf("Rows = %+v, want Region", p.Rows)
	}
}

// TestReadPivotsValueNumFmtFromDataField: a value field takes the number
// format the file gives it (dataField numFmtId, else its pivotField's).
// "SUM of Employee" sums a text column, so no source cell could supply
// the format; Excel and Google still show $0.00.
func TestReadPivotsValueNumFmtFromDataField(t *testing.T) {
	model, doc, snap := importAndSnapshot(t, readGoogleExport(t))
	p := pivotByTarget(t, model.Pivots, "Summary both $ and Hours")
	got := map[string]string{}
	for _, v := range p.Values {
		got[v.SourceColumn] = v.NumFmt
	}
	want := map[string]string{
		"W/C code - pay ": "",
		"Employee":        `"$"#,##0.00`,
		"Total for year":  `"$"#,##0.00`,
	}
	if d := cmp.Diff(want, got); d != "" {
		t.Errorf("value numFmts (-want +got):\n%s", d)
	}

	entry, ok := doc.doc.GetMap("pivots").(*ycrdt.YMap).Get(p.ID).(*ycrdt.YMap)
	if !ok {
		t.Fatalf("pivot %q missing from the pivots map", p.ID)
	}
	var numFmts []any
	entry.Get("values").(*ycrdt.YArray).ForEach(func(item any, _ ycrdt.Number, _ ycrdt.IAbstractType) {
		numFmts = append(numFmts, item.(*ycrdt.YMap).Get("numFmt"))
	})
	if len(numFmts) != 3 || numFmts[0] != nil || numFmts[1] != `"$"#,##0.00` {
		t.Errorf("Y.Doc value numFmts = %v", numFmts)
	}
	if got := pivotByTarget(t, snap.Pivots, p.TargetSheetName).Values[1].NumFmt; got != `"$"#,##0.00` {
		t.Errorf("snapshot Employee numFmt = %q", got)
	}
}

// pivotByTarget finds the pivot the file placed on target (calc may
// have moved it to a sheet of its own; its ID still names the target).
func pivotByTarget(t *testing.T, pivots []PivotDefinitionDTO, target string) PivotDefinitionDTO {
	t.Helper()
	for _, p := range pivots {
		if p.TargetSheetName == target || strings.HasPrefix(p.ID, "p_"+sanitizeID(target)+"_") {
			return p
		}
	}
	t.Fatalf("no pivot targets %q", target)
	return PivotDefinitionDTO{}
}

// TestPivotLayoutRoundTripsThroughSave: the facts calc does not edit —
// cache field names, the Values placeholder, axis sort, value number
// formats — must survive import → Y.Doc → save. Without CacheFields a
// re-add renames Google's repeated blank headers.
func TestPivotLayoutRoundTripsThroughSave(t *testing.T) {
	original := readGoogleExport(t)
	ed, err := xlsx.Edit(t.Context(), original)
	if err != nil {
		t.Fatal(err)
	}
	want := ed.PivotTables()

	model, doc, snap := importAndSnapshot(t, original)
	p := pivotByTarget(t, model.Pivots, "Summary of $ by person")
	entry := doc.doc.GetMap("pivots").(*ycrdt.YMap).Get(p.ID).(*ycrdt.YMap)
	arr, ok := entry.Get("cacheFields").(*ycrdt.YArray)
	if !ok || arr.GetLength() != len(want[1].CacheFields) {
		t.Fatalf("Y cacheFields = %v, want %d names", entry.Get("cacheFields"), len(want[1].CacheFields))
	}
	if got := pivotByTarget(t, snap.Pivots, p.TargetSheetName).CacheFields; !slices.Equal(got, want[1].CacheFields) {
		t.Errorf("snapshot CacheFields = %q", got)
	}

	saved := saveSnapshot(t, original, snap)
	ed2, err := xlsx.Edit(t.Context(), saved)
	if err != nil {
		t.Fatal(err)
	}
	got := ed2.PivotTables()
	if len(got) != len(want) {
		t.Fatalf("saved %d pivots, want %d", len(got), len(want))
	}
	byName := map[string]xlsx.PivotTable{}
	for _, pt := range got {
		byName[pt.Name] = pt
	}
	for _, w := range want {
		id := pivotByTarget(t, snap.Pivots, w.TargetSheet).ID
		g, ok := byName[id]
		if !ok {
			t.Errorf("pivot %s (on %q) lost", id, w.TargetSheet)
			continue
		}
		// calc names the pivot, places it (on a sheet of its own when the
		// file's target holds data), and lays out its bands itself; an
		// empty style or data caption reads back as omnidoc's default.
		g.Name, g.TargetSheet, g.Location, g.LocationInfo = w.Name, w.TargetSheet, w.Location, w.LocationInfo
		if w.StyleName == "" {
			g.StyleName = ""
		}
		if w.DataCaption == "" {
			g.DataCaption = ""
		}
		if d := cmp.Diff(w, g); d != "" {
			t.Errorf("pivot on %q (-file +saved):\n%s", w.TargetSheet, d)
		}
	}
}

// TestBootstrapWritesPivotsIntoDoc ports writeBootstrapPivots: each
// pivot lands in the top-level "pivots" map in the writePivot shape the
// client reads, and its target sheet's meta carries pivotId so the grid
// renders engine output there. Without it imported pivots never reach
// the client.
func TestBootstrapWritesPivotsIntoDoc(t *testing.T) {
	data, err := os.ReadFile("testdata/pivot-basic.xlsx")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	model, err := ReadWorkbookFromXLSX(t.Context(), data, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	want := model.Pivots[0]
	doc, snap := bootstrapAndSnapshot(t, model)

	entry, ok := doc.doc.GetMap("pivots").(*ycrdt.YMap).Get(want.ID).(*ycrdt.YMap)
	if !ok {
		t.Fatalf("pivot %q missing from the pivots map", want.ID)
	}
	for _, key := range []string{"rows", "cols", "values", "filters"} {
		if _, ok := entry.Get(key).(*ycrdt.YArray); !ok {
			t.Errorf("pivot %s = %T, want a Y.Array", key, entry.Get(key))
		}
	}
	if _, ok := entry.Get("filterSelections").(*ycrdt.YMap); !ok {
		t.Errorf("pivot filterSelections = %T, want a Y.Map", entry.Get("filterSelections"))
	}
	for _, key := range []string{"rowGrandTotals", "colGrandTotals", "rowSubtotals", "colSubtotals"} {
		if _, ok := entry.Get(key).(bool); !ok {
			t.Errorf("pivot %s = %T, want a bool", key, entry.Get(key))
		}
	}
	firstRow := entry.Get("rows").(*ycrdt.YArray).Get(0).(*ycrdt.YMap)
	if got := firstRow.Get("sourceColumn"); got != "Region" {
		t.Errorf("rows[0].sourceColumn = %v, want Region", got)
	}
	_, meta := docSheetMeta(t, doc.doc, want.TargetSheetName)
	if got := meta.Get("pivotId"); got != want.ID {
		t.Errorf("target sheet pivotId = %v, want %q", got, want.ID)
	}

	if len(snap.Pivots) != 1 {
		t.Fatalf("snapshot pivots = %d, want 1", len(snap.Pivots))
	}
	got := snap.Pivots[0]
	if got.ID != want.ID || got.SourceRange != want.SourceRange || got.TargetSheetName != want.TargetSheetName ||
		!reflect.DeepEqual(got.Rows, want.Rows) || !reflect.DeepEqual(got.Cols, want.Cols) ||
		!reflect.DeepEqual(got.Values, want.Values) || len(got.Filters) != 0 ||
		got.RowGrandTotals != want.RowGrandTotals || got.ColGrandTotals != want.ColGrandTotals {
		t.Errorf("snapshot pivot = %+v, want %+v", got, want)
	}
}

// TestBootstrapPivotOnOccupiedTargetGetsOwnSheet: a pivot whose target
// sheet already holds cells is relocated to "<sheet> pivot"
// (ensureDistinctTargets). That sheet exists only in the doc, so the
// bootstrap creates it right after the original target, and the save
// path must write it out (with the pivot on it) without disturbing the
// sheets around it.
func TestBootstrapPivotOnOccupiedTargetGetsOwnSheet(t *testing.T) {
	original := buildOccupiedTargetPivotFixture(t)
	model, err := ReadWorkbookFromXLSX(t.Context(), original, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	pivot := model.Pivots[0]
	if pivot.TargetSheetName != "Report pivot" {
		t.Fatalf("pivot target = %q, want Report pivot", pivot.TargetSheetName)
	}

	doc, snap := bootstrapAndSnapshot(t, model)
	wantOrder := []string{"Data", "Report", "Report pivot", "Notes"}
	var gotOrder []string
	for _, s := range snap.Sheets {
		gotOrder = append(gotOrder, s.Name)
	}
	if !reflect.DeepEqual(gotOrder, wantOrder) {
		t.Fatalf("doc sheet order = %v, want %v", gotOrder, wantOrder)
	}
	for i, s := range snap.Sheets {
		if s.Position != i {
			t.Errorf("sheet %q position = %d, want %d", s.Name, s.Position, i)
		}
	}
	reportID, reportMeta := docSheetMeta(t, doc.doc, "Report")
	if got := reportMeta.Get("pivotId"); got != nil {
		t.Errorf("Report pivotId = %v, want none (its cells stay)", got)
	}
	if _, ok := findSnapshotCell(snap, reportID, 1, 1); !ok {
		t.Error("Report!A1 missing from the doc")
	}
	pivotSheetID, pivotMeta := docSheetMeta(t, doc.doc, "Report pivot")
	if got := pivotMeta.Get("pivotId"); got != pivot.ID {
		t.Errorf("Report pivot pivotId = %v, want %q", got, pivot.ID)
	}
	for _, id := range []string{"sheet1", "sheet2", "sheet3"} {
		if id == pivotSheetID {
			t.Errorf("pivot sheet id %q collides with an imported sheet id", id)
		}
	}
	if len(snap.Pivots) != 1 || snap.Pivots[0].TargetSheetName != "Report pivot" {
		t.Fatalf("snapshot pivots = %+v, want one targeting Report pivot", snap.Pivots)
	}

	saved, err := serializeSnapshotToXLSX(t.Context(), original, snap, nil)
	if err != nil {
		t.Fatalf("serializeSnapshotToXLSX: %v", err)
	}
	ed, err := xlsx.Edit(t.Context(), saved)
	if err != nil {
		t.Fatalf("reopen saved: %v", err)
	}
	if got := ed.SheetNames(); !reflect.DeepEqual(got, wantOrder) {
		t.Errorf("saved sheet order = %v, want %v", got, wantOrder)
	}
	if got := readCell(t, saved, "Report", 1, 1); got != "Region" {
		t.Errorf("saved Report!A1 = %q, want Region", got)
	}
	if got := readCell(t, saved, "Notes", 1, 1); got != "keep me" {
		t.Errorf("saved Notes!A1 = %q, want keep me", got)
	}
	savedBook, err := excelize.OpenReader(bytes.NewReader(saved))
	if err != nil {
		t.Fatalf("open saved: %v", err)
	}
	defer func() { _ = savedBook.Close() }()
	if dvs, _ := savedBook.GetDataValidations("Notes"); len(dvs) != 1 {
		t.Errorf("saved Notes data validations = %d, want 1 (Notes must keep its own sheet part)", len(dvs))
	}
	if dvs, _ := savedBook.GetDataValidations("Report pivot"); len(dvs) != 0 {
		t.Errorf("saved Report pivot data validations = %d, want 0", len(dvs))
	}
	pts := ed.PivotTables()
	if len(pts) != 1 || pts[0].TargetSheet != "Report pivot" {
		t.Errorf("saved pivots = %+v, want one on Report pivot", pts)
	}

	again, err := ReadWorkbookFromXLSX(t.Context(), saved, 0, 0)
	if err != nil {
		t.Fatalf("re-import: %v", err)
	}
	if len(again.Pivots) != 1 || again.Pivots[0].TargetSheetName != "Report pivot" {
		t.Errorf("re-imported pivots = %+v, want one targeting Report pivot", again.Pivots)
	}
}

// TestBootstrapPivotYShapeRoundTrips covers every pivot field the
// writePivot shape carries, through bootstrap and collectPivots, plus a
// target sheet the model lacks with no known original sheet: it is
// created at the end of the tab order.
func TestBootstrapPivotYShapeRoundTrips(t *testing.T) {
	def := PivotDefinitionDTO{
		ID:              "p1",
		SourceRange:     "'My Data'!A1:D9",
		TargetSheetName: "Out",
		Rows:            []PivotFieldDTO{{SourceColumn: "Region", DisplayName: "Area"}, {SourceColumn: "City"}},
		Cols:            []PivotFieldDTO{{SourceColumn: "Year"}},
		Values: []PivotValueFieldDTO{
			{SourceColumn: "Sales", DisplayName: "Total", Aggregation: "sum", NumFmt: "#,##0.00"},
			{SourceColumn: "Units", Aggregation: "average"},
		},
		Filters:          []PivotFieldDTO{{SourceColumn: "Channel"}},
		FilterSelections: map[string][]string{"Channel": {"web", "store", "phone"}},
		RowGrandTotals:   true,
		ColGrandTotals:   false,
		RowSubtotals:     true,
		ColSubtotals:     true,
		StyleName:        "PivotStyleMedium9",

		CacheFields:       []string{"Region", "City", " ", " 2"},
		ValuesAxis:        "row",
		ValuesPosition:    1,
		AxisSort:          map[string]string{"Region": "descending"},
		DataCaption:       "Data",
		RowHeaderCaption:  "Rows",
		ColHeaderCaption:  "Cols",
		GrandTotalCaption: "All",
		MissingCaption:    "-",
		HideMissing:       true,
		ErrorCaption:      "err",
		ShowError:         true,
	}
	model := WorkbookModel{
		Sheets: []WorksheetModel{{Name: "My Data", RowCount: 1, ColCount: 1, Cells: map[string]CellValueDTO{}}},
		Pivots: []PivotDefinitionDTO{def},
	}
	doc, snap := bootstrapAndSnapshot(t, model)
	if len(snap.Pivots) != 1 {
		t.Fatalf("snapshot pivots = %d, want 1", len(snap.Pivots))
	}
	if d := cmp.Diff(def, snap.Pivots[0]); d != "" {
		t.Errorf("pivot round trip (-model +snapshot):\n%s", d)
	}
	if len(snap.Sheets) != 2 || snap.Sheets[1].Name != "Out" || snap.Sheets[1].Position != 1 {
		t.Fatalf("snapshot sheets = %+v, want My Data then Out", snap.Sheets)
	}
	id, meta := docSheetMeta(t, doc.doc, "Out")
	if id != "sheet2" || meta.Get(pivotSheetKey) != "p1" {
		t.Errorf("Out sheet = %s pivotId=%v, want sheet2 with pivotId p1", id, meta.Get(pivotSheetKey))
	}
	if meta.Get("rowCount") != 0 || meta.Get("colCount") != 0 {
		t.Errorf("Out extent = %vx%v, want the empty 0x0 the client's pivot insert writes", meta.Get("rowCount"), meta.Get("colCount"))
	}
}

// TestRelocatedPivotSheetNameFitsExcelLimit: Excel refuses to open a
// workbook with a sheet name longer than 31 characters, and the
// relocated name is a sheet the save path creates.
func TestRelocatedPivotSheetNameFitsExcelLimit(t *testing.T) {
	long := "Quarterly revenue by region and product"
	for n := 1; n <= 12; n++ {
		got := relocatedPivotSheetName(long, n)
		if len([]rune(got)) > maxSheetNameLen {
			t.Errorf("candidate %d = %q (%d chars), want <= %d", n, got, len([]rune(got)), maxSheetNameLen)
		}
	}
	if got := relocatedPivotSheetName("Report", 1); got != "Report pivot" {
		t.Errorf("short name = %q, want Report pivot", got)
	}
	if got := relocatedPivotSheetName("Report", 3); got != "Report pivot (3)" {
		t.Errorf("third candidate = %q, want Report pivot (3)", got)
	}
}
