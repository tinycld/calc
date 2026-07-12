package calc

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"strings"

	"github.com/nathanstitt/doctaculous/pkg/xlsx"
)

// Legacy indexed-color resolution for the read path.
//
// Older producers (and .xls converters) store style colors as indices
// into the legacy 64-color palette instead of explicit RGB. doctaculous
// surfaces those as Color{Indexed: &n} with RGB="" — it deliberately
// doesn't resolve palettes — but the doc-side CellStyle carries only
// hex strings, so without resolution every indexed fill/border/font
// color silently vanishes on import. The excelize-era reader resolved
// indexed colors for fills and borders (via its GetBaseColor path), so
// this is a parity requirement, not a new feature; resolving font
// colors as well is a deliberate widening (excelize only read a font's
// explicit rgb attribute).
//
// Resolution order mirrors excelize: the workbook's own
// <colors><indexedColors> override in styles.xml wins; otherwise the
// standard legacy palette below applies.
//
// Deliberately NOT resolved:
//   - Fill background colors: Excel stamps bgColor indexed="64" (the
//     "system background" sentinel) on virtually every solid fill;
//     resolving it would fabricate a black bgColor on every imported
//     fill. The excelize-era reader never surfaced a pattern fill's
//     bg when a fg was present, so skipping bg entirely is the safe
//     superset of the old behavior.
//   - Theme colors (Color.Theme + tint): needs theme1.xml parsing and
//     the HSL tint transform; tracked as a follow-up in doctaculous.

// standardIndexedPalette is the legacy indexed palette (ECMA-376 part 1,
// §18.8.27): indices 0–7 duplicate 8–15, 64/65 are the system
// foreground/background defaults.
var standardIndexedPalette = []string{
	"000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
	"000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
	"800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
	"9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
	"000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
	"00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
	"3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
	"003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
	"000000", "FFFFFF",
}

// stylesIndexedColorsXML is the minimal styles.xml projection needed to
// read a workbook's legacy-palette override.
type stylesIndexedColorsXML struct {
	Colors *struct {
		IndexedColors *struct {
			RgbColor []struct {
				RGB string `xml:"rgb,attr"`
			} `xml:"rgbColor"`
		} `xml:"indexedColors"`
	} `xml:"colors"`
}

// indexedPaletteFromStyles returns the workbook's <indexedColors>
// palette override (normalized to bare uppercase "RRGGBB"), or nil when
// the workbook declares none. Any parse trouble reads as "no override"
// — the standard palette then applies, which is also what Excel does
// with a malformed override.
func indexedPaletteFromStyles(xlsxBytes []byte) []string {
	zr, err := zip.NewReader(bytes.NewReader(xlsxBytes), int64(len(xlsxBytes)))
	if err != nil {
		return nil
	}
	for _, zf := range zr.File {
		if zf.Name != "xl/styles.xml" {
			continue
		}
		rc, err := zf.Open()
		if err != nil {
			return nil
		}
		data, err := io.ReadAll(rc)
		_ = rc.Close()
		if err != nil {
			return nil
		}
		var doc stylesIndexedColorsXML
		if err := xml.Unmarshal(data, &doc); err != nil {
			return nil
		}
		if doc.Colors == nil || doc.Colors.IndexedColors == nil {
			return nil
		}
		out := make([]string, len(doc.Colors.IndexedColors.RgbColor))
		for i, c := range doc.Colors.IndexedColors.RgbColor {
			out[i] = normalizePaletteRGB(c.RGB)
		}
		return out
	}
	return nil
}

// normalizePaletteRGB canonicalizes a palette entry to the same bare
// uppercase "RRGGBB" form doctaculous uses for explicit rgb attributes
// (ARGB entries lose their alpha byte). Malformed entries become "".
func normalizePaletteRGB(v string) string {
	v = strings.ToUpper(strings.TrimSpace(v))
	if len(v) == 8 {
		v = v[2:]
	}
	if len(v) != 6 {
		return ""
	}
	return v
}

// resolveWorkbookIndexedColors rewrites indexed style colors to their
// palette RGB in place, so everything downstream of the read seam
// (styleToCellStyle, CF dxf conversion, row styles) sees a plain hex
// color. Styles are shared per xf index, so each *Style resolves once.
func resolveWorkbookIndexedColors(wb *xlsx.Workbook, palette []string) {
	seen := make(map[*xlsx.Style]struct{})
	for si := range wb.Sheets {
		sheet := &wb.Sheets[si]
		for r := range sheet.Cells {
			for c := range sheet.Cells[r] {
				resolveStyleIndexedColors(sheet.Cells[r][c].Style, palette, seen)
			}
		}
		for _, st := range sheet.RowStyles {
			resolveStyleIndexedColors(st, palette, seen)
		}
		for bi := range sheet.CondFmts {
			for ri := range sheet.CondFmts[bi].Rules {
				resolveStyleIndexedColors(sheet.CondFmts[bi].Rules[ri].Style, palette, seen)
			}
		}
	}
}

func resolveStyleIndexedColors(st *xlsx.Style, palette []string, seen map[*xlsx.Style]struct{}) {
	if st == nil {
		return
	}
	if _, done := seen[st]; done {
		return
	}
	seen[st] = struct{}{}
	resolveIndexedColor(&st.Font.Color, palette)
	resolveIndexedColor(&st.Fill.Fg, palette)
	// Fill.Bg deliberately skipped — see the package comment above.
	resolveIndexedColor(&st.Border.Top.Color, palette)
	resolveIndexedColor(&st.Border.Right.Color, palette)
	resolveIndexedColor(&st.Border.Bottom.Color, palette)
	resolveIndexedColor(&st.Border.Left.Color, palette)
	resolveIndexedColor(&st.Border.Diagonal.Color, palette)
}

// resolveIndexedColor fills in c.RGB from the palette when the color is
// stored as a legacy index. A workbook override wins over the standard
// palette even when its entry is malformed/empty — matching excelize,
// which trusts a declared override verbatim.
func resolveIndexedColor(c *xlsx.Color, palette []string) {
	if c.RGB != "" || c.Indexed == nil {
		return
	}
	idx := *c.Indexed
	if idx < 0 {
		return
	}
	if palette != nil {
		if idx < len(palette) {
			c.RGB = palette[idx]
		}
		return
	}
	if idx < len(standardIndexedPalette) {
		c.RGB = standardIndexedPalette[idx]
	}
}
