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

	// RowHeights maps row number (1-based) -> pixel height for rows
	// the user has resized away from the default. Sparse: rows at
	// default height have no entry. Pixels are converted to Excel
	// points (px * 0.75) at serialization time.
	RowHeights map[int]int

	// ColWidths maps column number (1-based) -> pixel width for
	// resized columns. Sparse, as above. Converted to Excel
	// character units at serialization time.
	ColWidths map[int]int

	// RowStyles maps row number (1-based) -> partial style applied
	// to the entire row. Per-cell styles still layer on top at
	// render time; this is the "fill row 7 yellow" affordance.
	// Sparse: rows without a row-level style have no entry.
	RowStyles map[int]*CellStyle

	// Color is the user-chosen tab color (hex string like "#FF0000").
	// Empty string means no override; the serializer leaves whatever
	// tab color the source xlsx had alone in that case.
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
