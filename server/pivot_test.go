package calc

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
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
