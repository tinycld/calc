package calc

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"log/slog"
	"strconv"
	"strings"

	"github.com/nathanstitt/doctaculous/pkg/xlsx"
)

// Legacy conditional-format blob conversion.
//
// Y.Docs persisted before the doctaculous migration hold opaque CF
// rules as json.Marshal(excelize.ConditionalFormatOptions) — a
// PascalCase-keyed map ("Type", "Criteria", "MinValue", …), detected
// by the absence of the post-migration "rawXml" key. This file
// converts such a blob, excelize-free, into the <cfRule> XML that
// excelize's SetConditionalFormat would have written for the same
// options, handed to the editor as CFRule{Raw}.
//
// Fidelity notes (each locked by the oracle test in legacy_cf_test.go,
// which builds the same options THROUGH excelize and compares the
// re-parsed rule semantics):
//   - The blob's stored Format dxf index pointed into a dxfs table the
//     excelize writer used to rebuild per save — it is meaningless
//     against the preserved file, so it is dropped. When the doc rule
//     carries a Style, it rides along on CFRule.Style and the editor
//     mints a fresh dxf, stamping its id onto the raw element.
//   - Data-bar gradient hints (BarSolid / BarDirection /
//     BarBorderColor) lived in an x14 <extLst> extension excelize
//     paired with the base rule; the extension is not reproduced. The
//     base <dataBar> (colors, cfvo bounds, showValue) converts fully.
//   - x14-only icon-set styles ("3Stars", "3Triangles", "5Boxes") got
//     no base <cfRule> from excelize either — such a blob is skipped.
//
// The Y.Doc's runtime decode (runtime.go) is untouched: legacy
// conversion runs ONLY in the save-path rule builder, so pre-migration
// docs keep round-tripping their blobs until a future lazy in-doc
// upgrade rewrites them to rawXml.

// legacyCFOptions mirrors the excelize.ConditionalFormatOptions field
// set (PascalCase keys — the struct had no json tags), minus fields
// that never reached the opaque path. Format is decoded but ignored;
// see the fidelity notes above.
type legacyCFOptions struct {
	Type           string
	AboveAverage   bool
	Percent        bool
	Format         *int
	Criteria       string
	Value          string
	MinType        string
	MidType        string
	MaxType        string
	MinValue       string
	MidValue       string
	MaxValue       string
	MinColor       string
	MidColor       string
	MaxColor       string
	BarColor       string
	BarBorderColor string
	BarDirection   string
	BarOnly        bool
	BarSolid       bool
	IconStyle      string
	ReverseIcons   bool
	IconsOnly      bool
	StopIfTrue     bool
}

// legacyOpaqueToCFRule converts one legacy blob into a CFRule carrying
// synthesized rule XML. Returns ok=false (and logs) for blob types the
// converter does not model — the doc keeps the blob for a future
// attempt, matching the writer's general skip-don't-corrupt stance.
// Note the file-side consequence: the save replaces each sheet's
// conditional formatting wholesale (SetConditionalFormats), so a
// skipped rule is ERASED from the emitted xlsx whenever any sibling
// rule on the sheet survives — only the Y.Doc retains the blob. This
// differs from the excelize-era writer, which appended rules and left
// the file's existing formatting in place.
func legacyOpaqueToCFRule(blob map[string]interface{}, style *CellStyle, anchor string) (xlsx.CFRule, bool, error) {
	raw, err := json.Marshal(blob)
	if err != nil {
		return xlsx.CFRule{}, false, fmt.Errorf("marshal legacy CF blob: %w", err)
	}
	var opt legacyCFOptions
	if err := json.Unmarshal(raw, &opt); err != nil {
		return xlsx.CFRule{}, false, fmt.Errorf("decode legacy CF blob: %w", err)
	}
	ruleXML, ok := legacyRuleXML(&opt, anchor)
	if !ok {
		slog.Warn("calc: unconvertible legacy CF blob; skipping rule",
			"blobType", opt.Type)
		return xlsx.CFRule{}, false, nil
	}
	out := xlsx.CFRule{Raw: ruleXML}
	if style != nil {
		st := cellStyleToDxfStyle(style)
		out.Style = &st
	}
	return out, true, nil
}

// The XML shapes below mirror the subset of CT_CfRule the legacy
// converter emits. Priority is stamped by the editor; dxfId (when the
// rule has a style) is stamped by the editor from CFRule.Style.
type legacyCfvoXML struct {
	Type string `xml:"type,attr"`
	Val  string `xml:"val,attr,omitempty"`
}

type legacyColorXML struct {
	RGB string `xml:"rgb,attr"`
}

type legacyColorScaleXML struct {
	Cfvo  []legacyCfvoXML  `xml:"cfvo"`
	Color []legacyColorXML `xml:"color"`
}

type legacyDataBarXML struct {
	ShowValue string           `xml:"showValue,attr,omitempty"`
	Cfvo      []legacyCfvoXML  `xml:"cfvo"`
	Color     []legacyColorXML `xml:"color"`
}

type legacyIconSetXML struct {
	IconSet   string          `xml:"iconSet,attr,omitempty"`
	ShowValue string          `xml:"showValue,attr,omitempty"`
	Reverse   string          `xml:"reverse,attr,omitempty"`
	Cfvo      []legacyCfvoXML `xml:"cfvo"`
}

type legacyCfRuleXML struct {
	XMLName      xml.Name             `xml:"cfRule"`
	Type         string               `xml:"type,attr"`
	StopIfTrue   string               `xml:"stopIfTrue,attr,omitempty"`
	AboveAverage string               `xml:"aboveAverage,attr,omitempty"`
	Percent      string               `xml:"percent,attr,omitempty"`
	Bottom       string               `xml:"bottom,attr,omitempty"`
	Rank         string               `xml:"rank,attr,omitempty"`
	TimePeriod   string               `xml:"timePeriod,attr,omitempty"`
	Formula      []string             `xml:"formula,omitempty"`
	ColorScale   *legacyColorScaleXML `xml:"colorScale,omitempty"`
	DataBar      *legacyDataBarXML    `xml:"dataBar,omitempty"`
	IconSet      *legacyIconSetXML    `xml:"iconSet,omitempty"`
}

// legacyIconSetCfvo maps the base-spec icon-set style names excelize
// wrote a plain <cfRule> for onto their preset percent thresholds
// (excelize's cfvo3/cfvo4/cfvo5 tables). Styles absent here are
// x14-extension-only and produce no base rule.
var legacyIconSetCfvo = map[string][]legacyCfvoXML{}

func init() {
	cfvo := func(vals ...string) []legacyCfvoXML {
		out := make([]legacyCfvoXML, 0, len(vals))
		for _, v := range vals {
			out = append(out, legacyCfvoXML{Type: "percent", Val: v})
		}
		return out
	}
	three := cfvo("0", "33", "67")
	four := cfvo("0", "25", "50", "75")
	five := cfvo("0", "20", "40", "60", "80")
	for _, name := range []string{
		"3Arrows", "3ArrowsGray", "3Flags", "3Signs", "3Symbols",
		"3Symbols2", "3TrafficLights1", "3TrafficLights2",
	} {
		legacyIconSetCfvo[name] = three
	}
	for _, name := range []string{"4Arrows", "4ArrowsGray", "4Rating", "4RedToBlack", "4TrafficLights"} {
		legacyIconSetCfvo[name] = four
	}
	for _, name := range []string{"5Arrows", "5ArrowsGray", "5Quarters", "5Rating"} {
		legacyIconSetCfvo[name] = five
	}
}

// legacyTimePeriods maps the excelize reader's Criteria strings (what
// the blob stores) to the OOXML timePeriod token plus the criteria
// formula excelize synthesized (anchored; %s is the anchor cell).
var legacyTimePeriods = map[string]struct {
	token   string
	formula string
}{
	"yesterday":      {"yesterday", "FLOOR(%[1]s,1)=TODAY()-1"},
	"today":          {"today", "FLOOR(%[1]s,1)=TODAY()"},
	"tomorrow":       {"tomorrow", "FLOOR(%[1]s,1)=TODAY()+1"},
	"last 7 days":    {"last7Days", "AND(TODAY()-FLOOR(%[1]s,1)<=6,FLOOR(%[1]s,1)<=TODAY())"},
	"last week":      {"lastWeek", "AND(TODAY()-ROUNDDOWN(%[1]s,0)>=(WEEKDAY(TODAY())),TODAY()-ROUNDDOWN(%[1]s,0)<(WEEKDAY(TODAY())+7))"},
	"this week":      {"thisWeek", "AND(TODAY()-ROUNDDOWN(%[1]s,0)<=WEEKDAY(TODAY())-1,ROUNDDOWN(%[1]s,0)-TODAY()>=7-WEEKDAY(TODAY()))"},
	"continue week":  {"nextWeek", "AND(ROUNDDOWN(%[1]s,0)-TODAY()>(7-WEEKDAY(TODAY())),ROUNDDOWN(%[1]s,0)-TODAY()<(15-WEEKDAY(TODAY())))"},
	"last month":     {"lastMonth", "AND(MONTH(%[1]s)=MONTH(TODAY())-1,OR(YEAR(%[1]s)=YEAR(TODAY()),AND(MONTH(%[1]s)=1,YEAR(%[1]s)=YEAR(TODAY())-1)))"},
	"this month":     {"thisMonth", "AND(MONTH(%[1]s)=MONTH(TODAY()),YEAR(%[1]s)=YEAR(TODAY()))"},
	"continue month": {"nextMonth", "AND(MONTH(%[1]s)=MONTH(TODAY())+1,OR(YEAR(%[1]s)=YEAR(TODAY()),AND(MONTH(%[1]s)=12,YEAR(%[1]s)=YEAR(TODAY())+1)))"},
}

// legacyRuleXML synthesizes the <cfRule> element for one legacy blob,
// reproducing what excelize's SetConditionalFormat wrote for the same
// options (per-type mappings mirror excelize's drawCondFmt* writers).
func legacyRuleXML(opt *legacyCFOptions, anchor string) ([]byte, bool) {
	rule := legacyCfRuleXML{}
	if opt.StopIfTrue {
		rule.StopIfTrue = "1"
	}

	switch opt.Type {
	case "top", "bottom":
		rule.Type = "top10"
		if opt.Type == "bottom" {
			rule.Bottom = "1"
		}
		if opt.Percent {
			rule.Percent = "1"
		}
		rank := 10
		if n, err := strconv.Atoi(opt.Value); err == nil {
			rank = n
		}
		rule.Rank = strconv.Itoa(rank)
	case "duplicate":
		rule.Type = "duplicateValues"
	case "unique":
		rule.Type = "uniqueValues"
	case "average":
		rule.Type = "aboveAverage"
		// Always explicit: the OOXML default is true, but excelize wrote
		// the attribute unconditionally and its reader treats an absent
		// attribute as below-average.
		if opt.AboveAverage {
			rule.AboveAverage = "1"
		} else {
			rule.AboveAverage = "0"
		}
	case "errors":
		rule.Type = "containsErrors"
		rule.Formula = []string{fmt.Sprintf("ISERROR(%s)", anchor)}
	case "no_errors":
		rule.Type = "notContainsErrors"
		rule.Formula = []string{fmt.Sprintf("NOT(ISERROR(%s))", anchor)}
	case "2_color_scale", "3_color_scale":
		rule.Type = "colorScale"
		rule.ColorScale = legacyColorScale(opt)
	case "data_bar":
		rule.Type = "dataBar"
		rule.DataBar = &legacyDataBarXML{
			ShowValue: legacyBoolAttr(!opt.BarOnly),
			Cfvo: []legacyCfvoXML{
				{Type: opt.MinType, Val: opt.MinValue},
				{Type: opt.MaxType, Val: opt.MaxValue},
			},
			Color: []legacyColorXML{{RGB: legacyPaletteColor(opt.BarColor)}},
		}
	case "icon_set":
		cfvo, ok := legacyIconSetCfvo[opt.IconStyle]
		if !ok {
			return nil, false
		}
		rule.Type = "iconSet"
		rule.IconSet = &legacyIconSetXML{
			IconSet:   opt.IconStyle,
			ShowValue: legacyBoolAttr(!opt.IconsOnly),
			Cfvo:      cfvo,
		}
		if opt.ReverseIcons {
			rule.IconSet.Reverse = "1"
		}
	case "time_period":
		tp, ok := legacyTimePeriods[strings.ToLower(opt.Criteria)]
		if !ok {
			return nil, false
		}
		rule.Type = "timePeriod"
		rule.TimePeriod = tp.token
		rule.Formula = []string{fmt.Sprintf(tp.formula, anchor)}
	default:
		// Modeled types ("cell", "text", "blanks", "formula", …) were
		// never stored as opaque blobs; anything else is unknown.
		return nil, false
	}

	out, err := xml.Marshal(rule)
	if err != nil {
		return nil, false
	}
	return out, true
}

// legacyColorScale builds the cfvo/color stops with excelize's write
// defaults (min "0", mid "50", max "0" when the blob carries no value —
// the read side dropped a stored "0" to "", so the defaults reproduce
// the original bytes).
func legacyColorScale(opt *legacyCFOptions) *legacyColorScaleXML {
	minValue := opt.MinValue
	if minValue == "" {
		minValue = "0"
	}
	maxValue := opt.MaxValue
	if maxValue == "" {
		maxValue = "0"
	}
	cs := &legacyColorScaleXML{
		Cfvo:  []legacyCfvoXML{{Type: opt.MinType, Val: minValue}},
		Color: []legacyColorXML{{RGB: legacyPaletteColor(opt.MinColor)}},
	}
	if opt.Type == "3_color_scale" {
		midValue := opt.MidValue
		if midValue == "" {
			midValue = "50"
		}
		cs.Cfvo = append(cs.Cfvo, legacyCfvoXML{Type: opt.MidType, Val: midValue})
		cs.Color = append(cs.Color, legacyColorXML{RGB: legacyPaletteColor(opt.MidColor)})
	}
	cs.Cfvo = append(cs.Cfvo, legacyCfvoXML{Type: opt.MaxType, Val: maxValue})
	cs.Color = append(cs.Color, legacyColorXML{RGB: legacyPaletteColor(opt.MaxColor)})
	return cs
}

// legacyPaletteColor mirrors excelize's getPaletteColor: bare uppercase
// hex prefixed with the FF alpha channel.
func legacyPaletteColor(color string) string {
	return "FF" + strings.ToUpper(strings.ReplaceAll(color, "#", ""))
}

// legacyBoolAttr renders an explicit boolean attribute value ("1"/"0")
// — excelize wrote these attributes unconditionally, so the converter
// does too.
func legacyBoolAttr(v bool) string {
	if v {
		return "1"
	}
	return "0"
}
