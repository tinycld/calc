package calc

// PivotDefinitionDTO mirrors the TS PivotDefinition (see
// tinycld/calc/lib/workbook-types.ts). It is the wire shape for the
// preview endpoint and the YDoc bootstrap path. Field tags are
// camelCase JSON so it decodes byte-for-byte into the TS interface.
type PivotDefinitionDTO struct {
	ID               string               `json:"id"`
	SourceRange      string               `json:"sourceRange"`
	TargetSheetName  string               `json:"targetSheetName"`
	Rows             []PivotFieldDTO      `json:"rows"`
	Cols             []PivotFieldDTO      `json:"cols"`
	Values           []PivotValueFieldDTO `json:"values"`
	Filters          []PivotFieldDTO      `json:"filters"`
	FilterSelections map[string][]string  `json:"filterSelections,omitempty"`
	RowGrandTotals   bool                 `json:"rowGrandTotals"`
	ColGrandTotals   bool                 `json:"colGrandTotals"`
	RowSubtotals     bool                 `json:"rowSubtotals"`
	ColSubtotals     bool                 `json:"colSubtotals"`
	StyleName        string               `json:"styleName,omitempty"`
}

// PivotFieldDTO is the Rows/Cols/Filters per-field shape.
type PivotFieldDTO struct {
	SourceColumn string `json:"sourceColumn"`
	DisplayName  string `json:"displayName,omitempty"`
}

// PivotValueFieldDTO extends PivotFieldDTO with aggregation + numFmt.
// `Aggregation` values: sum, average, count, countNums, max, min,
// product, stdDev, stdDevp, var, varp (matches the TS PivotAggregation
// union).
//
// NumFmt is a free-form Excel format pattern (e.g. "#,##0.00") used by
// the TS-side render engine. It deliberately does NOT round-trip
// through xlsx: excelize's PivotTableField.NumFmt is an int (built-in
// numFmt ID) and only accepts that catalog, so a custom string
// pattern has nowhere to land. We carry the field on the DTO so the
// preview endpoint and Y.Doc bootstrap can ferry it from xlsx import
// (always empty today) to engine render, but the export path drops
// it. See docs/pivot.md for the divergence note.
type PivotValueFieldDTO struct {
	SourceColumn string `json:"sourceColumn"`
	DisplayName  string `json:"displayName,omitempty"`
	Aggregation  string `json:"aggregation"`
	NumFmt       string `json:"numFmt,omitempty"`
}
