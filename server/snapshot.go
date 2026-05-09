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
// the cell is a value, not a formula.
type CellEntry struct {
	SheetID string
	Row     int
	Col     int
	Raw     string
	Display string
	Formula string
}
