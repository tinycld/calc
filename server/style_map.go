package calc

import (
	"github.com/nathanstitt/doctaculous/pkg/xlsx"
)

// This file is the style seam between calc's CellStyle (the partial,
// all-pointer-leaf shape mirroring the TS CellStyle — see snapshot.go)
// and doctaculous pkg/xlsx. Three hand-written mappers replaced the
// excelize-era reflection overlay (style_reflect.go, deleted with the
// excelize write path):
//
//   - cellStyleToPatch: write path. A CellStyle patch becomes an
//     xlsx.StylePatch — nil leaves stay untouched on disk, set leaves
//     land on top of the cell's existing style (PatchCellStyle clones
//     the xf and edits only the named leaves, so diagonals, indent,
//     protection and every other unmodeled facet survive).
//   - styleToCellStyle: read path. A fully resolved xlsx.Style becomes
//     a leaves-only *CellStyle — zero/absent facets become nil pointers
//     ("not tracked"), and a style with nothing we model returns nil.
//   - cellStyleToStyle / cellStyleToDxfStyle: full-style builds for
//     SetRowStyle and conditional-format dxfs, where the target API
//     takes a complete xlsx.Style rather than a patch.
//
// Adding a CellStyle leaf now means: the field in snapshot.go (+ the
// TS CellStyle), the mapping in each direction here, and a registry
// entry in style_attribute_registry.go — the round-trip audit fails
// loudly until all of them exist.

// cellStyleToPatch converts a doc-side partial style to the write-path
// patch shape. Nil leaves stay nil (leave the on-disk style alone).
func cellStyleToPatch(cs *CellStyle) xlsx.StylePatch {
	if cs == nil {
		return xlsx.StylePatch{}
	}
	return xlsx.StylePatch{
		Font:      fontToPatch(cs.Font),
		Fill:      fillToPatch(cs.Fill),
		Alignment: alignmentToPatch(cs.Alignment),
		Border:    bordersToPatch(cs.Borders),
		// Verbatim: a pointer to "" clears back to General on both
		// sides of the seam.
		NumFmt: cs.NumFmt,
	}
}

func fontToPatch(f *CellFont) *xlsx.FontPatch {
	if f == nil {
		return nil
	}
	p := &xlsx.FontPatch{
		Bold:   f.Bold,
		Italic: f.Italic,
		Strike: f.Strike,
		Size:   f.Size,
		Name:   f.Name,
	}
	if f.Underline != nil {
		// Doc-side underline is a bool; the file format has variants
		// ("single", "double", ...). We only ever write "single"; ""
		// removes the underline entirely (excelize's "none" equivalent).
		u := ""
		if *f.Underline {
			u = "single"
		}
		p.Underline = &u
	}
	if f.Color != nil {
		p.Color = ptr(stripHash(*f.Color))
	}
	return p
}

func fillToPatch(f *CellFill) *xlsx.FillPatch {
	if f == nil {
		return nil
	}
	p := &xlsx.FillPatch{}
	if f.Pattern != nil {
		// The doc models only "solid"; anything else clears the fill
		// (pattern "" is doctaculous's fill-to-none), matching the old
		// overlay's unknown-pattern → code-0 behavior.
		pat := ""
		if *f.Pattern == "solid" {
			pat = "solid"
		}
		p.Pattern = &pat
	}
	if f.FgColor != nil {
		p.Fg = ptr(stripHash(*f.FgColor))
	}
	if f.BgColor != nil {
		p.Bg = ptr(stripHash(*f.BgColor))
	}
	// A color patch without a (solid) pattern means "user picked this
	// color via the fill button" — without a pattern the color would be
	// invisible (or dropped), so default to solid. Preserves the
	// excelize-era overlay's defensive rule.
	if (p.Fg != nil || p.Bg != nil) && (p.Pattern == nil || *p.Pattern == "") {
		p.Pattern = ptr("solid")
	}
	// CellFill.Type ("pattern") is an excelize-ism the wire shape keeps
	// for the TS side; it has no doctaculous counterpart and is dropped
	// on write. A patch that only carried Type is therefore a no-op.
	if *p == (xlsx.FillPatch{}) {
		return nil
	}
	return p
}

func alignmentToPatch(a *CellAlignment) *xlsx.AlignmentPatch {
	if a == nil {
		return nil
	}
	return &xlsx.AlignmentPatch{
		Horizontal: a.Horizontal,
		Vertical:   a.Vertical,
		WrapText:   a.WrapText,
	}
}

func bordersToPatch(b *CellBorders) *xlsx.BorderPatch {
	if b == nil {
		return nil
	}
	return &xlsx.BorderPatch{
		Top:    edgeToPatch(b.Top),
		Right:  edgeToPatch(b.Right),
		Bottom: edgeToPatch(b.Bottom),
		Left:   edgeToPatch(b.Left),
	}
}

func edgeToPatch(e *CellBorderEdge) *xlsx.EdgePatch {
	if e == nil {
		return nil
	}
	if e.IsClear {
		return &xlsx.EdgePatch{Clear: true}
	}
	// The doc's six style names (thin/medium/dashed/dotted/thick/
	// double) are already OOXML names — pass through. Defaults match
	// the renderer's 1px / #000000 so a partial edge written by an old
	// client still produces a visible border.
	style := "thin"
	if e.Style != nil {
		style = *e.Style
	}
	color := "000000"
	if e.Color != nil {
		color = stripHash(*e.Color)
	}
	return &xlsx.EdgePatch{Style: &style, Color: &color}
}

// styleToCellStyle is the read-path inverse of cellStyleToPatch: a
// fully resolved xlsx.Style becomes a leaves-only *CellStyle. Absent /
// zero facets become nil pointers ("not tracked"), which the doc and
// serializer interpret as "leave the on-disk value alone on save". A
// style carrying nothing we model returns nil, so callers can leave
// the doc-side style unset entirely.
//
// Colors surface when stored as an explicit RGB, which by the time this
// runs includes legacy indexed colors — ReadWorkbookFromXLSX resolves
// those to RGB up front (see indexed_palette.go). Theme colors are
// still skipped (follow-up in doctaculous).
func styleToCellStyle(st *xlsx.Style) *CellStyle {
	if st == nil {
		return nil
	}
	cs := &CellStyle{
		Font:      fontLeaves(st.Font),
		Fill:      fillLeaves(st.Fill),
		Alignment: alignmentLeaves(st.Alignment),
		Borders:   borderLeaves(st.Border),
	}
	// Any declared number format — builtin or custom — surfaces as its
	// resolved pattern; only id 0 (General) stays untracked. This is
	// deliberately WIDER than the excelize-era rule (custom ids >= 164
	// only): doctaculous's writer resolves common patterns ("#,##0.00",
	// "0.00%", "@", ...) to their BUILTIN ids, so keeping the old rule
	// would silently drop the doc-side format for calc's own UI presets
	// after one save/bootstrap cycle.
	if st.NumFmtID != 0 && st.NumFmt != "" {
		cs.NumFmt = ptr(st.NumFmt)
	}
	if cs.Font == nil && cs.Fill == nil && cs.Alignment == nil && cs.Borders == nil && cs.NumFmt == nil {
		return nil
	}
	return cs
}

func fontLeaves(f xlsx.Font) *CellFont {
	out := CellFont{}
	if f.Bold {
		out.Bold = ptr(true)
	}
	if f.Italic {
		out.Italic = ptr(true)
	}
	if f.Strike {
		out.Strike = ptr(true)
	}
	// Any underline variant ("single", "double", ...) collapses to the
	// doc's underlined bool — lossy on save, but an externally
	// double-underlined cell stays visibly underlined.
	if f.Underline != "" && f.Underline != "none" {
		out.Underline = ptr(true)
	}
	if f.Size != 0 {
		out.Size = ptr(f.Size)
	}
	if f.Name != "" {
		out.Name = ptr(f.Name)
	}
	if f.Color.RGB != "" {
		out.Color = ptr(f.Color.RGB)
	}
	if out == (CellFont{}) {
		return nil
	}
	return &out
}

func fillLeaves(f xlsx.Fill) *CellFill {
	out := CellFill{}
	if fillDeclared(f) {
		// Any declared pattern (hatched included) collapses to "solid"
		// so the fill color stays visible — lossy on save, faithful to
		// user intent on read. Type "pattern" is kept on the wire so
		// the TS JSON shape is unchanged from the excelize era.
		//
		// Intended diff vs the excelize reader: excelize reported
		// Type="pattern" even for the patternType="none" record every
		// unstyled fill points at, so styled cells used to carry a
		// {type:"pattern"} no-op. Here Type/Pattern surface only for
		// an actual fill.
		out.Type = ptr("pattern")
		out.Pattern = ptr("solid")
	}
	if f.Fg.RGB != "" {
		out.FgColor = ptr(f.Fg.RGB)
	}
	if f.Bg.RGB != "" {
		out.BgColor = ptr(f.Bg.RGB)
	}
	if out == (CellFill{}) {
		return nil
	}
	return &out
}

// fillDeclared reports whether the fill declares an actual pattern
// ("none" and the zero value both mean "no fill").
func fillDeclared(f xlsx.Fill) bool {
	return f.Pattern != "" && f.Pattern != "none"
}

func alignmentLeaves(a xlsx.Alignment) *CellAlignment {
	out := CellAlignment{}
	if a.Horizontal != "" {
		out.Horizontal = ptr(a.Horizontal)
	}
	if a.Vertical != "" {
		out.Vertical = ptr(a.Vertical)
	}
	if a.WrapText {
		out.WrapText = ptr(true)
	}
	if out == (CellAlignment{}) {
		return nil
	}
	return &out
}

func borderLeaves(b xlsx.Border) *CellBorders {
	out := CellBorders{
		Top:    edgeLeaves(b.Top),
		Right:  edgeLeaves(b.Right),
		Bottom: edgeLeaves(b.Bottom),
		Left:   edgeLeaves(b.Left),
	}
	if out == (CellBorders{}) {
		return nil
	}
	return &out
}

func edgeLeaves(e xlsx.Edge) *CellBorderEdge {
	out := CellBorderEdge{}
	if e.Style != "" {
		out.Style = ptr(collapseBorderStyleName(e.Style))
	}
	if e.Color.RGB != "" {
		out.Color = ptr(e.Color.RGB)
	}
	if out == (CellBorderEdge{}) {
		return nil
	}
	return &out
}

// collapseBorderStyleName maps any OOXML border style name onto the
// six the doc models, so an externally-authored xlsx with (e.g.) Dash
// Dot still surfaces a doc-side line style instead of silently
// disappearing. Mirrors the semantics of the excelize-era int-code
// table: the dash-family variants collapse to "dashed", "hair" and
// anything unknown to "thin".
func collapseBorderStyleName(name string) string {
	switch name {
	case "thin", "medium", "dashed", "dotted", "thick", "double":
		return name
	case "mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot":
		return "dashed"
	}
	// "hair" and unmodeled styles fall back to a plain thin line.
	return "thin"
}

// cellStyleToStyle materializes a partial CellStyle as a complete
// xlsx.Style, for the whole-style setters (SetRowStyle). Nil leaves
// become the zero facet — matching the excelize-era path, which
// overlaid the patch onto an empty base style.
func cellStyleToStyle(cs *CellStyle) xlsx.Style {
	st := xlsx.Style{}
	if cs == nil {
		return st
	}
	if f := cs.Font; f != nil {
		st.Font = xlsx.Font{
			Bold:   deref(f.Bold),
			Italic: deref(f.Italic),
			Strike: deref(f.Strike),
			Size:   deref(f.Size),
			Name:   deref(f.Name),
		}
		if f.Underline != nil && *f.Underline {
			st.Font.Underline = "single"
		}
		if f.Color != nil {
			st.Font.Color = xlsx.Color{RGB: stripHash(*f.Color)}
		}
	}
	if fl := cs.Fill; fl != nil {
		if fl.Pattern != nil && *fl.Pattern == "solid" {
			st.Fill.Pattern = "solid"
		}
		if fl.FgColor != nil {
			st.Fill.Fg = xlsx.Color{RGB: stripHash(*fl.FgColor)}
		}
		if fl.BgColor != nil {
			st.Fill.Bg = xlsx.Color{RGB: stripHash(*fl.BgColor)}
		}
		// Same defensive rule as the patch path: a color without a
		// solid pattern would be invisible.
		if st.Fill.Pattern == "" && (fl.FgColor != nil || fl.BgColor != nil) {
			st.Fill.Pattern = "solid"
		}
	}
	if a := cs.Alignment; a != nil {
		st.Alignment = xlsx.Alignment{
			Horizontal: deref(a.Horizontal),
			Vertical:   deref(a.Vertical),
			WrapText:   deref(a.WrapText),
		}
	}
	if b := cs.Borders; b != nil {
		st.Border = xlsx.Border{
			Top:    fullEdge(b.Top),
			Right:  fullEdge(b.Right),
			Bottom: fullEdge(b.Bottom),
			Left:   fullEdge(b.Left),
		}
	}
	if cs.NumFmt != nil {
		st.NumFmt = *cs.NumFmt
	}
	return st
}

// cellStyleToDxfStyle renders a CellStyle as the differential (dxf)
// style a conditional-format rule points at. Identical to
// cellStyleToStyle except the fill: in a dxf, bgColor carries the
// visible solid color (Excel's differential-fill convention — see
// doctaculous buildDxfNode), and the patternType is omitted, matching
// what Excel itself writes for CF highlight fills. The doc-side
// FgColor (the swatch the user picked) therefore lands in Fill.Bg.
func cellStyleToDxfStyle(cs *CellStyle) xlsx.Style {
	st := cellStyleToStyle(cs)
	if cs == nil || cs.Fill == nil {
		return st
	}
	color := cs.Fill.FgColor
	if color == nil {
		color = cs.Fill.BgColor
	}
	if color != nil {
		st.Fill = xlsx.Fill{Bg: xlsx.Color{RGB: stripHash(*color)}}
	}
	return st
}

func fullEdge(e *CellBorderEdge) xlsx.Edge {
	if e == nil || e.IsClear {
		return xlsx.Edge{}
	}
	style := "thin"
	if e.Style != nil {
		style = *e.Style
	}
	color := "000000"
	if e.Color != nil {
		color = stripHash(*e.Color)
	}
	return xlsx.Edge{Style: style, Color: xlsx.Color{RGB: color}}
}

// stripHash drops a leading "#" from a hex color string. The doc side
// accepts both forms; the file format stores bare "RRGGBB".
func stripHash(s string) string {
	if len(s) > 0 && s[0] == '#' {
		return s[1:]
	}
	return s
}

func ptr[T any](v T) *T {
	return &v
}

func deref[T any](p *T) T {
	if p == nil {
		var zero T
		return zero
	}
	return *p
}
