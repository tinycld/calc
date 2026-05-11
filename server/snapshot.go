package calc

// YDocSnapshot is a Go-native, point-in-time view of a calc room's
// Y.Doc state, suitable for handing to a serializer that doesn't
// know (or care) how the doc is implemented. The serializer in
// persist.go consumes this struct and produces an updated .xlsx.
//
// The shape mirrors bootstrapYDocFromWorkbook (in
// tinycld/calc/lib/y-doc-bootstrap.ts) inversely.
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

	// RowCount and ColCount mirror the Y.Doc's per-sheet rowCount /
	// colCount keys — the grid extent the user has scrolled / inserted
	// into. Zero means "Y.Doc didn't track a count for this sheet"; the
	// serializer leaves the workbook's existing <dimension> alone.
	RowCount int
	ColCount int

	// RowHeights / ColWidths / RowStyles are tri-state sparse maps —
	// the snapshot-is-authoritative contract depends on the distinction
	// between absent (nil) and present-but-empty (non-nil, len 0):
	//
	//   - nil: the Y.Doc has no nested map for this field. The
	//     serializer leaves the on-disk xlsx alone. Happens for legacy
	//     workbooks bootstrapped before this field was seeded.
	//   - non-nil, empty: the Y.Doc tracked the field and the user
	//     cleared every entry. The serializer unsets every on-disk
	//     customization for this field on the sheet.
	//   - non-nil, non-empty: the entries are authoritative. The
	//     serializer unsets any on-disk customization not in the map
	//     and writes the entries.
	//
	// Pixels round-trip through pxToExcelPoints / pxToExcelCharWidth at
	// serialization time.
	RowHeights map[int]int
	ColWidths  map[int]int
	RowStyles  map[int]*CellStyle

	// Color is the user-chosen tab color (hex string like "#FF0000").
	// Empty string is authoritative — it means the doc has no tab
	// color, and the serializer clears any prior tab color on save.
	// The Y.Doc is the source of truth for tab color once a workbook
	// has been bootstrapped (bootstrap seeds it from the source xlsx).
	Color string

	// Hidden mirrors the Y.Doc's `hidden` flag. When true the
	// serializer marks the worksheet hidden via SetSheetVisible.
	// Excelize forbids hiding the only visible sheet — see the guard
	// in persist.go.
	Hidden bool

	// Merges enumerates merged-cell rectangles on this sheet. Each
	// entry is the top-left anchor coordinate plus span dimensions.
	// Empty/nil when the sheet has no merges. Round-trips through
	// excelize MergeCell on save.
	Merges []MergeRange

	// FrozenRows / FrozenCols mirror the Y.Doc's frozenRows /
	// frozenCols sheet metadata (count of rows/cols frozen at the
	// top/left). Zero on either axis means "no freeze on this
	// axis"; the serializer skips writing the xlsx <pane> when
	// both are zero.
	FrozenRows int
	FrozenCols int
}

// MergeRange is one merged-cell rectangle anchored at (AnchorRow,
// AnchorCol) with the given span dimensions. Anchor coordinates are
// 1-based; spans are inclusive (1×1 means no merge — the encoder
// drops that case).
type MergeRange struct {
	AnchorRow int
	AnchorCol int
	RowSpan   int
	ColSpan   int
}

// CellEntry is one cell value the doc has touched. SheetID matches a
// SheetMeta.ID. Row/Col are 1-based (matching the Y.Doc cell-key
// scheme: see tinycld/calc/lib/y-cell-key.ts).
//
// Kind is the typed-cell tag ("string", "number", "boolean", "date",
// "formula"). Empty string means a legacy doc with no kind key written;
// the serializer falls back to its previous "coerce numeric strings"
// behavior in that case.
//
// RawString is populated when the doc-side raw value was a string
// scalar; RawNumber and RawBool are nil unless the doc-side raw was
// numeric / boolean respectively. Pointer types so the absence of a
// numeric raw is distinguishable from a numeric zero.
//
// An empty Formula means the cell is a value, not a formula.
//
// A nil Style means the doc does not track any styling for this cell —
// the serializer leaves the cell's existing on-disk style intact.
type CellEntry struct {
	SheetID   string
	Row       int
	Col       int
	Kind      string
	RawString string
	RawNumber *float64
	RawBool   *bool
	Display   string
	Formula   string
	Style     *CellStyle
}

// CellStyle is the partial-style shape that mirrors the TS CellStyle
// (tinycld/calc/lib/workbook-types.ts). Every field is a pointer (or a
// pointer-typed group) so "absent" is distinguishable from "explicitly
// false / empty". The serializer overlays only the non-nil fields onto
// the cell's existing excelize.Style.
//
// JSON tags use camelCase keys to match the doc-side shape: runtime.go's
// decodeCellStyle flattens the style YMap into a plain map and routes
// it through json.Marshal+Unmarshal, so adding a structurally-trivial
// attribute means: add a field here (with a json tag) and a matching
// field on the TS CellStyle. Nothing else.
type CellStyle struct {
	Font      *CellFont      `json:"font,omitempty"`
	Fill      *CellFill      `json:"fill,omitempty"`
	Alignment *CellAlignment `json:"alignment,omitempty"`
	Borders   *CellBorders   `json:"borders,omitempty"`
	NumFmt    *string        `json:"numFmt,omitempty"`
}

type CellFont struct {
	Bold      *bool    `json:"bold,omitempty"`
	Italic    *bool    `json:"italic,omitempty"`
	Underline *bool    `json:"underline,omitempty"`
	Strike    *bool    `json:"strike,omitempty"`
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

// CellBorders mirrors the doc-side schema: presence of each edge as a
// boolean. The "Borders" entry in styleOverlayOverrides maps each
// non-nil edge onto an excelize.Border with Type="thin" and
// Color="000000" — the uniform black-thin look the toolbar's borders
// dropdown affords today. When per-edge color/style pickers come
// online, grow these fields into objects (the deep-merge in
// setYCellStyle on the TS side treats any object patch additively)
// and extend the Borders override.
type CellBorders struct {
	Top    *bool `json:"top,omitempty"`
	Right  *bool `json:"right,omitempty"`
	Bottom *bool `json:"bottom,omitempty"`
	Left   *bool `json:"left,omitempty"`
}
