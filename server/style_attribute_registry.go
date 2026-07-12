package calc

import (
	"github.com/nathanstitt/doctaculous/pkg/xlsx"
)

// This file is the single source of truth for every leaf attribute on
// CellStyle. Each entry describes a deterministic canary value the
// round-trip audit injects and a probe that reads the leaf back off a
// fully resolved xlsx.Style (the doctaculous read model).
//
// The audit (style_roundtrip_audit_test.go) drives each leaf through
// the real pipeline — cellStyleToPatch → PatchCellStyle → Save →
// OpenBytes → probe + styleToCellStyle — so a probe here is the
// independent read-back check that the write mapper actually landed
// the value in the file.
//
// Adding a new CellStyle leaf: add the field in snapshot.go (+ the TS
// CellStyle), map it in style_map.go's three mappers, and add an entry
// here. The audit fails with a missing-registry-entry error until the
// entry exists, and with a per-stage breakdown until the mappers
// handle it.

// attributeProbe pulls a value out of an *xlsx.Style at the given
// CellStyle path. Returns (value, true) when present, (nil, false)
// when absent — absent after a round-trip means the writer lost it.
type attributeProbe func(*xlsx.Style) (any, bool)

// attributeSpec describes one CellStyle leaf for the audit. Path is
// dotted Go field names rooted at CellStyle (e.g. "Font.Bold",
// "Borders.Top.Style").
type attributeSpec struct {
	// Canary is a deterministic non-zero value to inject when testing
	// this attribute in isolation. The audit constructs a *CellStyle
	// with just this leaf set to Canary and asserts it survives the
	// full pipeline.
	Canary any

	// CanaryReadBack is the value we expect to read back after a
	// round-trip. Defaults to Canary when nil. Diverges for attributes
	// the writer normalizes — e.g. "#FF8800" is accepted by the writer
	// but the file stores bare "FF8800".
	CanaryReadBack any

	// ReadFromXlsx returns the value of this leaf on a resolved
	// *xlsx.Style, mirroring styleToCellStyle's per-leaf policy. Used
	// by the audit to verify the write mapper succeeded independently
	// of the read mapper.
	ReadFromXlsx attributeProbe

	// CoRequiredPaths names other registry entries that must be set
	// alongside this leaf for the resulting CellStyle to be a sensible
	// xlsx fill / border / etc. The audit constructs the CellStyle with
	// the co-required leaves at their own canaries, then asserts only
	// the target leaf's round-trip.
	//
	// Example: Fill.Type is dropped on write (an excelize-ism kept only
	// on the read wire), so it reads back only when an actual fill —
	// pattern + color — is present.
	CoRequiredPaths []string
}

// styleAttributeRegistry enumerates every leaf on CellStyle the writer
// must round-trip. The audit loops over this map; missing an entry for
// a new CellStyle leaf is the audit's own failure mode.
var styleAttributeRegistry = map[string]attributeSpec{
	"Font.Bold": {
		Canary:       true,
		ReadFromXlsx: probeBool(func(s *xlsx.Style) bool { return s.Font.Bold }),
	},
	"Font.Italic": {
		Canary:       true,
		ReadFromXlsx: probeBool(func(s *xlsx.Style) bool { return s.Font.Italic }),
	},
	"Font.Strike": {
		Canary:       true,
		ReadFromXlsx: probeBool(func(s *xlsx.Style) bool { return s.Font.Strike }),
	},
	"Font.Underline": {
		Canary: true,
		// The file stores an underline variant ("single", "double",
		// ...); the doc models a bool. The writer only produces
		// "single"; on read anything non-empty and non-"none" collapses
		// to underlined=true — lossy on save, but an externally
		// double-underlined cell stays visibly underlined.
		ReadFromXlsx: func(s *xlsx.Style) (any, bool) {
			if s == nil || s.Font.Underline == "" || s.Font.Underline == "none" {
				return nil, false
			}
			return true, true
		},
	},
	"Font.Size": {
		Canary:       13.5,
		ReadFromXlsx: probeFloat(func(s *xlsx.Style) float64 { return s.Font.Size }),
	},
	"Font.Name": {
		Canary:       "Courier New",
		ReadFromXlsx: probeString(func(s *xlsx.Style) string { return s.Font.Name }),
	},
	"Font.Color": {
		Canary:         "#112233",
		CanaryReadBack: "112233",
		ReadFromXlsx:   probeString(func(s *xlsx.Style) string { return s.Font.Color.RGB }),
	},
	"NumFmt": {
		// A non-builtin pattern, so the round-trip also proves custom
		// numFmt minting; builtin patterns round-trip too — the writer
		// resolves them to their builtin id and the read rule
		// (styleToCellStyle) surfaces any non-General format's resolved
		// pattern, precisely so a UI preset that matches a builtin
		// ("#,##0.00", "0.00%", "@", ...) survives a save/bootstrap
		// cycle instead of being dropped by the excelize-era
		// custom-ids-only rule.
		Canary: "#,##0.000",
		ReadFromXlsx: func(s *xlsx.Style) (any, bool) {
			if s == nil || s.NumFmtID == 0 || s.NumFmt == "" {
				return nil, false
			}
			return s.NumFmt, true
		},
	},
	"Alignment.Horizontal": {
		Canary:       "right",
		ReadFromXlsx: probeString(func(s *xlsx.Style) string { return s.Alignment.Horizontal }),
	},
	"Alignment.Vertical": {
		Canary:       "middle",
		ReadFromXlsx: probeString(func(s *xlsx.Style) string { return s.Alignment.Vertical }),
	},
	"Alignment.WrapText": {
		Canary:       true,
		ReadFromXlsx: probeBool(func(s *xlsx.Style) bool { return s.Alignment.WrapText }),
	},
	// Fill.Type is dropped on write (see fillToPatch) and re-synthesized
	// on read whenever a pattern fill is declared, so it round-trips
	// only alongside an actual fill. Pattern + FgColor ride along as
	// "valid fill" scaffolding; each is independently audited by its
	// own iteration.
	"Fill.Type": {
		Canary: "pattern",
		ReadFromXlsx: func(s *xlsx.Style) (any, bool) {
			if s == nil || !fillDeclared(s.Fill) {
				return nil, false
			}
			return "pattern", true
		},
		CoRequiredPaths: []string{"Fill.Pattern", "Fill.FgColor"},
	},
	"Fill.Pattern": {
		Canary: "solid",
		// Any declared pattern (hatched included) collapses to "solid"
		// on read so the fill color stays visible — see fillLeaves.
		ReadFromXlsx: func(s *xlsx.Style) (any, bool) {
			if s == nil || !fillDeclared(s.Fill) {
				return nil, false
			}
			return "solid", true
		},
		// A solid fill without a color is legal but nonsensical; keep
		// the audit fixture realistic.
		CoRequiredPaths: []string{"Fill.FgColor"},
	},
	"Fill.FgColor": {
		Canary:         "#FF8800",
		CanaryReadBack: "FF8800",
		ReadFromXlsx:   probeString(func(s *xlsx.Style) string { return s.Fill.Fg.RGB }),
		// FgColor on its own relies on the write mapper's defensive
		// Pattern=solid default (independently locked by
		// TestFillColorPatchWithoutPatternForcesSolid); the audit keeps
		// the OOXML co-requirement explicit so it doesn't depend on
		// that fallback.
		CoRequiredPaths: []string{"Fill.Pattern"},
	},
	// Fill.BgColor is meaningful for hatched patterns; the toolbar
	// never produces a bgColor edit, but imported workbooks carry it
	// and the doc must round-trip it. doctaculous writes and reads it
	// symmetrically (the excelize-era write validation that forced
	// this leaf to be read-only is gone).
	"Fill.BgColor": {
		Canary:          "001122",
		ReadFromXlsx:    probeString(func(s *xlsx.Style) string { return s.Fill.Bg.RGB }),
		CoRequiredPaths: []string{"Fill.Pattern", "Fill.FgColor"},
	},
	// Per-edge leaves. Each style entry uses a distinct canary so an
	// accidental cross-edge swap surfaces immediately. The clear-signal
	// (false on the wire, IsClear=true in Go) is NOT in the leaf walk;
	// it's covered by TestSerializerStyleClearViaFalseWire in
	// serializer_test.go.
	"Borders.Top.Style": {
		Canary:       "thin",
		ReadFromXlsx: probeBorderStyle(func(b xlsx.Border) xlsx.Edge { return b.Top }),
	},
	"Borders.Top.Color": {
		Canary:         "#FF8800",
		CanaryReadBack: "FF8800",
		ReadFromXlsx:   probeString(func(s *xlsx.Style) string { return s.Border.Top.Color.RGB }),
	},
	"Borders.Right.Style": {
		Canary:       "medium",
		ReadFromXlsx: probeBorderStyle(func(b xlsx.Border) xlsx.Edge { return b.Right }),
	},
	"Borders.Right.Color": {
		Canary:         "#FF8800",
		CanaryReadBack: "FF8800",
		ReadFromXlsx:   probeString(func(s *xlsx.Style) string { return s.Border.Right.Color.RGB }),
	},
	"Borders.Bottom.Style": {
		Canary:       "dashed",
		ReadFromXlsx: probeBorderStyle(func(b xlsx.Border) xlsx.Edge { return b.Bottom }),
	},
	"Borders.Bottom.Color": {
		Canary:         "#FF8800",
		CanaryReadBack: "FF8800",
		ReadFromXlsx:   probeString(func(s *xlsx.Style) string { return s.Border.Bottom.Color.RGB }),
	},
	"Borders.Left.Style": {
		Canary:       "double",
		ReadFromXlsx: probeBorderStyle(func(b xlsx.Border) xlsx.Edge { return b.Left }),
	},
	"Borders.Left.Color": {
		Canary:         "#FF8800",
		CanaryReadBack: "FF8800",
		ReadFromXlsx:   probeString(func(s *xlsx.Style) string { return s.Border.Left.Color.RGB }),
	},
}

// probeBool wraps a bool getter: false reads as "leaf absent",
// mirroring the leaves-only read policy.
func probeBool(get func(*xlsx.Style) bool) attributeProbe {
	return func(s *xlsx.Style) (any, bool) {
		if s == nil || !get(s) {
			return nil, false
		}
		return true, true
	}
}

// probeString wraps a string getter: "" reads as "leaf absent".
func probeString(get func(*xlsx.Style) string) attributeProbe {
	return func(s *xlsx.Style) (any, bool) {
		if s == nil {
			return nil, false
		}
		v := get(s)
		if v == "" {
			return nil, false
		}
		return v, true
	}
}

// probeFloat wraps a float getter: 0 reads as "leaf absent".
func probeFloat(get func(*xlsx.Style) float64) attributeProbe {
	return func(s *xlsx.Style) (any, bool) {
		if s == nil {
			return nil, false
		}
		v := get(s)
		if v == 0 {
			return nil, false
		}
		return v, true
	}
}

// probeBorderStyle reads one edge's style name, collapsed to the six
// names the doc models (same collapse styleToCellStyle applies).
func probeBorderStyle(edge func(xlsx.Border) xlsx.Edge) attributeProbe {
	return func(s *xlsx.Style) (any, bool) {
		if s == nil {
			return nil, false
		}
		e := edge(s.Border)
		if e.Style == "" {
			return nil, false
		}
		return collapseBorderStyleName(e.Style), true
	}
}
