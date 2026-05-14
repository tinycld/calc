package calc

import (
	"bytes"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

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
	model, err := ReadWorkbookFromXLSX(data, 0, 0)
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
	data, err := serializeWorkbook(model)
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
	model, err := ReadWorkbookFromXLSX(data, 0, 0)
	if err != nil {
		t.Fatalf("first import: %v", err)
	}
	out, err := serializeWorkbook(model)
	if err != nil {
		t.Fatalf("serialize: %v", err)
	}
	second, err := ReadWorkbookFromXLSX(out, 0, 0)
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
