package calc

// YDocSnapshot is a Go-native, point-in-time view of a calc room's
// Y.Doc state, suitable for handing to a serializer that doesn't
// know (or care) how the doc is implemented. The serializer in
// persist.go consumes this struct and produces an updated .xlsx.
//
// The shape mirrors bootstrapYDocFromWorkbook (in
// tinycld/calc/lib/y-doc-bootstrap.ts) inversely. It is the contract
// that survives the goja → native-y-crdt swap: only the producer of
// this struct (sheetsDocHandle.Snapshot) changes when y-crdt lands.
type YDocSnapshot struct {
	Sheets []SheetMeta
	Cells  []CellEntry
}

// SheetMeta describes a single worksheet in the doc, ordered (by the
// snapshot producer) so the slice index matches the desired sheet
// position in the output workbook.
type SheetMeta struct {
	ID       string
	Name     string
	Position int
}

// CellEntry is one cell value the doc has touched. SheetID matches a
// SheetMeta.ID. Row/Col are 1-based (matching the Y.Doc cell-key
// scheme: see tinycld/calc/lib/y-cell-key.ts). An empty Formula means
// the cell is a value, not a formula. A nil Style means the doc does
// not track any styling for this cell — the serializer leaves the
// cell's existing on-disk style intact.
type CellEntry struct {
	SheetID string
	Row     int
	Col     int
	Raw     string
	Display string
	Formula string
	Style   *CellStyle
}

// CellStyle is the partial-style shape that mirrors the TS CellStyle
// (tinycld/calc/lib/workbook-types.ts). Every field is a pointer (or a
// pointer-typed group) so "absent" is distinguishable from "explicitly
// false / empty". The serializer overlays only the non-nil fields onto
// the cell's existing excelize.Style.
//
// JSON tags use camelCase keys to match the on-the-wire shape produced
// by __sheetsSnapshot's JSON.stringify of the cell's style Y.Map. The
// snapshot consumer json.Unmarshals straight into *CellStyle, so adding
// a structurally-trivial attribute means: add a field here (with a
// json tag) and a matching field on the TS CellStyle. Nothing else.
type CellStyle struct {
	Font      *CellFont      `json:"font,omitempty"`
	Fill      *CellFill      `json:"fill,omitempty"`
	Alignment *CellAlignment `json:"alignment,omitempty"`
	NumFmt    *string        `json:"numFmt,omitempty"`
}

type CellFont struct {
	Bold      *bool    `json:"bold,omitempty"`
	Italic    *bool    `json:"italic,omitempty"`
	Underline *bool    `json:"underline,omitempty"`
	Size      *float64 `json:"size,omitempty"`
	Name      *string  `json:"name,omitempty"`
	Color     *string  `json:"color,omitempty"`
}

type CellFill struct {
	Type    *string `json:"type,omitempty"`
	Pattern *string `json:"pattern,omitempty"`
	FgColor *string `json:"fgColor,omitempty"`
	BgColor *string `json:"bgColor,omitempty"`
}

type CellAlignment struct {
	Horizontal *string `json:"horizontal,omitempty"`
	Vertical   *string `json:"vertical,omitempty"`
	WrapText   *bool   `json:"wrapText,omitempty"`
}
