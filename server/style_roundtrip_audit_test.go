package calc

import (
	"bytes"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/nathanstitt/doctaculous/pkg/xlsx"
	ycrdt "github.com/skyterra/y-crdt"
	"github.com/xuri/excelize/v2"
)

// TestCellStyleAttributeRoundTripExhaustive is the canonical audit: it
// proves that EVERY leaf on CellStyle survives the full server-side
// round-trip — cellStyleToPatch → PatchCellStyle → Save → OpenBytes →
// probe + styleToCellStyle, AND bootstrap-emit to YMap + decode back.
//
// The enumeration is reflect-driven via collectCellStyleLeaves, so
// adding a new leaf on CellStyle automatically grows the matrix. The
// test fails with a per-leaf, per-stage breakdown the first time a
// new attribute slips through without writer + reader + bootstrap
// support.
func TestCellStyleAttributeRoundTripExhaustive(t *testing.T) {
	leaves := collectCellStyleLeaves()
	if len(leaves) == 0 {
		t.Fatal("no CellStyle leaves discovered — schema introspection broken")
	}

	// Every CellStyle leaf MUST have a registry entry. The registry is
	// what this audit uses to canary every stage and what proves the
	// write mapper landed the value independently of the read mapper.
	for _, path := range leaves {
		if _, ok := styleAttributeRegistry[path]; !ok {
			t.Errorf("CellStyle leaf %q has no entry in styleAttributeRegistry — the audit cannot verify it round-trips", path)
		}
	}
	if t.Failed() {
		return
	}

	for _, path := range leaves {
		t.Run(path, func(t *testing.T) {
			spec := styleAttributeRegistry[path]
			expected := spec.CanaryReadBack
			if expected == nil {
				expected = spec.Canary
			}

			patch := buildSingleLeafCellStyle(t, path, spec.Canary)
			report := stageReport{path: path, canary: spec.Canary, expected: expected}

			// Stage 1+2: real xlsx round-trip — patch a blank workbook
			// through the production write mapper, save, re-open with
			// the doctaculous reader, and probe the resolved style.
			xlsxBytes := writeSingleStyledCellXLSX(t, patch)
			reopened := readXlsxCellStyle(t, xlsxBytes)
			report.xlsx, report.xlsxOK = spec.ReadFromXlsx(reopened)

			// Stage 3: the production read mapper.
			extracted := styleToCellStyle(reopened)
			report.extracted, report.extractedOK = leafValueFromCellStyle(extracted, path)

			// Stage 4: bootstrap-emit + decode. Mirrors the read path
			// the YDoc bootstrap uses on first joiner — fails when
			// buildStyleYMapFromStyle drops a leaf even if
			// styleToCellStyle recovered it.
			bootstrapped := bootstrapRoundTrip(t, patch)
			report.bootstrap, report.bootstrapOK = leafValueFromCellStyle(bootstrapped, path)

			report.assert(t, expected)
		})
	}
}

// TestFillColorPatchWithoutPatternForcesSolid locks the write mapper's
// defensive rule in isolation: a doc-side fill-color edit that doesn't
// also carry a pattern must land as a SOLID fill on disk (otherwise
// the color is invisible or dropped). The exhaustive audit deliberately
// co-requires Fill.Pattern alongside Fill.FgColor so it does not depend
// on this fallback — this test is what covers it.
func TestFillColorPatchWithoutPatternForcesSolid(t *testing.T) {
	patch := &CellStyle{Fill: &CellFill{FgColor: ptr("#FF8800")}}
	xlsxBytes := writeSingleStyledCellXLSX(t, patch)
	st := readXlsxCellStyle(t, xlsxBytes)
	if st == nil {
		t.Fatal("cell has no style after a fill-color patch")
	}
	if st.Fill.Pattern != "solid" {
		t.Errorf("fill color without pattern should force a solid fill, got pattern %q", st.Fill.Pattern)
	}
	if st.Fill.Fg.RGB != "FF8800" {
		t.Errorf("fill color lost: want FF8800, got %q", st.Fill.Fg.RGB)
	}
}

// stageReport holds one leaf's result from every audit stage so the
// failure message points at the exact stage that dropped the value.
type stageReport struct {
	path     string
	canary   any
	expected any

	xlsx        any
	xlsxOK      bool
	extracted   any
	extractedOK bool
	bootstrap   any
	bootstrapOK bool
}

func (r stageReport) assert(t *testing.T, expected any) {
	t.Helper()
	fail := func(stage, detail string, got any, ok bool) {
		t.Errorf("attribute %q: %s lost the value\n"+
			"  set       = %v\n"+
			"  expected  = %v\n"+
			"  got       = %v (present=%v)\n"+
			"  ↳ %s", r.path, stage, r.canary, expected, got, ok, detail)
	}
	if !r.xlsxOK || !equalAny(r.xlsx, expected) {
		fail("xlsx", "cellStyleToPatch → PatchCellStyle did not land the value in the saved file — likely a write-mapper gap in style_map.go", r.xlsx, r.xlsxOK)
	}
	if !r.extractedOK || !equalAny(r.extracted, expected) {
		fail("extract", "styleToCellStyle did not recover the leaf from the resolved xlsx.Style — likely a read-mapper gap in style_map.go", r.extracted, r.extractedOK)
	}
	if !r.bootstrapOK || !equalAny(r.bootstrap, expected) {
		fail("bootstrap", "buildStyleYMapFromStyle → decodeCellStyle dropped the leaf — the bootstrap emitter is missing this field", r.bootstrap, r.bootstrapOK)
	}
}

// collectCellStyleLeaves enumerates every dotted pointer-leaf on
// CellStyle. Used both by the audit and as the source of truth for
// "what attributes must round-trip".
func collectCellStyleLeaves() []string {
	var out []string
	walkLeafFields(reflect.TypeOf(CellStyle{}), "", &out)
	sort.Strings(out)
	return out
}

func walkLeafFields(t reflect.Type, prefix string, out *[]string) {
	if t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct {
		return
	}
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if !field.IsExported() {
			continue
		}
		path := field.Name
		if prefix != "" {
			path = prefix + "." + field.Name
		}
		ft := field.Type
		if ft.Kind() == reflect.Pointer {
			elem := ft.Elem()
			if elem.Kind() == reflect.Struct {
				walkLeafFields(elem, path, out)
				continue
			}
			*out = append(*out, path)
			continue
		}
		// Non-pointer struct fields (none on CellStyle today) recurse
		// without contributing a leaf themselves.
		if ft.Kind() == reflect.Struct {
			walkLeafFields(ft, path, out)
		}
	}
}

// buildSingleLeafCellStyle constructs a *CellStyle with the target
// leaf set to its canary, plus any co-required leaves from the
// registry. The latter ride along so the resulting CellStyle is a
// sensible xlsx record (e.g. Fill.Type is dropped on write and only
// reads back alongside an actual pattern + color fill). The audit
// asserts only the target leaf's round-trip; co-required leaves are
// independently asserted by their own iterations.
func buildSingleLeafCellStyle(t *testing.T, path string, canary any) *CellStyle {
	t.Helper()
	cs := &CellStyle{}
	assignLeafByPath(t, cs, path, canary)
	spec := styleAttributeRegistry[path]
	for _, co := range spec.CoRequiredPaths {
		coSpec, ok := styleAttributeRegistry[co]
		if !ok {
			t.Fatalf("co-required path %q (referenced by %q) not in registry", co, path)
		}
		assignLeafByPath(t, cs, co, coSpec.Canary)
	}
	return cs
}

// assignLeafByPath sets a CellStyle leaf at the dotted path to the
// given value, allocating the intermediate group structs (Font / Fill /
// Alignment / Borders / border edges) on demand. The leaf field type
// drives the allocation (always *bool / *string / *float64 on
// CellStyle today).
func assignLeafByPath(t *testing.T, dst *CellStyle, path string, value any) {
	t.Helper()
	v := reflect.ValueOf(dst).Elem()
	parts := splitDottedPath(path)
	for i, name := range parts {
		field := v.FieldByName(name)
		if !field.IsValid() {
			t.Fatalf("CellStyle has no field at %q (segment %q)", path, name)
		}
		if i == len(parts)-1 {
			elem := field.Type().Elem()
			rv := reflect.ValueOf(value)
			if !rv.Type().AssignableTo(elem) {
				if !rv.Type().ConvertibleTo(elem) {
					t.Fatalf("canary %v (%T) not assignable to leaf %q", value, value, path)
				}
				rv = rv.Convert(elem)
			}
			p := reflect.New(elem)
			p.Elem().Set(rv)
			field.Set(p)
			return
		}
		if field.IsNil() {
			field.Set(reflect.New(field.Type().Elem()))
		}
		v = field.Elem()
	}
}

func splitDottedPath(path string) []string {
	return strings.Split(path, ".")
}

// leafValueFromCellStyle extracts the value at the given path off a
// *CellStyle (post-pipeline). Returns (nil, false) when the leaf or
// any of its ancestor groups is nil.
func leafValueFromCellStyle(cs *CellStyle, path string) (any, bool) {
	if cs == nil {
		return nil, false
	}
	v := reflect.ValueOf(cs).Elem()
	parts := splitDottedPath(path)
	for i, name := range parts {
		f := v.FieldByName(name)
		if !f.IsValid() {
			return nil, false
		}
		if i == len(parts)-1 {
			if f.Kind() == reflect.Pointer {
				if f.IsNil() {
					return nil, false
				}
				return f.Elem().Interface(), true
			}
			return f.Interface(), true
		}
		if f.Kind() != reflect.Pointer || f.IsNil() {
			return nil, false
		}
		v = f.Elem()
	}
	return nil, false
}

// equalAny compares two values from the audit pipeline. Most values
// are bool / string / float64 and compare directly; hex strings need
// the leading "#" trimmed because the writer accepts both forms but
// the file stores bare hex.
func equalAny(got, want any) bool {
	if got == nil || want == nil {
		return got == nil && want == nil
	}
	gs, gok := got.(string)
	ws, wok := want.(string)
	if gok && wok {
		return strings.TrimPrefix(gs, "#") == strings.TrimPrefix(ws, "#")
	}
	return reflect.DeepEqual(got, want)
}

// blankWorkbookBytes builds the minimal fixture the audit patches: a
// fresh single-sheet workbook with a value in A1 (so the cell exists
// in the saved sheetData for the style to attach to). excelize is the
// transition oracle and stays test-only — using it to MINT the fixture
// also guarantees the doctaculous editor handles files it didn't
// write itself.
func blankWorkbookBytes(t *testing.T) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	if err := f.SetCellValue("Sheet1", "A1", "audit"); err != nil {
		t.Fatalf("seed cell value: %v", err)
	}
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatalf("write fixture workbook: %v", err)
	}
	return buf.Bytes()
}

// writeSingleStyledCellXLSX runs the production write path: open the
// blank fixture for editing, patch A1's style with the mapped
// CellStyle, and save. Mirrors what the serializer does per styled
// cell on save.
func writeSingleStyledCellXLSX(t *testing.T, patch *CellStyle) []byte {
	t.Helper()
	f, err := xlsx.Edit(blankWorkbookBytes(t))
	if err != nil {
		t.Fatalf("xlsx.Edit: %v", err)
	}
	sh, err := f.Sheet("Sheet1")
	if err != nil {
		t.Fatalf("sheet: %v", err)
	}
	if err := sh.PatchCellStyle(1, 1, cellStyleToPatch(patch)); err != nil {
		t.Fatalf("PatchCellStyle: %v", err)
	}
	out, err := f.Save()
	if err != nil {
		t.Fatalf("save workbook: %v", err)
	}
	return out
}

// readXlsxCellStyle reopens saved bytes with the doctaculous reader and
// returns A1's fully resolved style (nil when the cell carries none).
func readXlsxCellStyle(t *testing.T, data []byte) *xlsx.Style {
	t.Helper()
	wb, err := xlsx.OpenBytes(data)
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	if len(wb.Sheets) == 0 {
		t.Fatal("no sheets in saved workbook")
	}
	cells := wb.Sheets[0].Cells
	if len(cells) == 0 || len(cells[0]) == 0 {
		t.Fatal("A1 missing from the saved workbook's used range")
	}
	return cells[0][0].Style
}

// bootstrapRoundTrip exercises the bootstrap-emit path: build a YMap
// from the patch, attach it under a real Y.Doc (so ForEach can read
// the entries — y-crdt keeps Set'd values in PrelimContent until the
// YMap is integrated into a doc), then decode it through the same
// decodeCellStyle the live runtime uses on first joiner. Returns the
// reconstructed *CellStyle.
func bootstrapRoundTrip(t *testing.T, patch *CellStyle) *CellStyle {
	t.Helper()
	doc := ycrdt.NewDoc("audit", false, nil, nil, false)
	root, ok := doc.GetMap("cells").(*ycrdt.YMap)
	if !ok {
		t.Fatal("doc cells map not a YMap")
	}
	doc.Transact(func(_ *ycrdt.Transaction) {
		emitted := buildStyleYMapFromStyle(patch)
		if emitted == nil {
			return
		}
		root.Set("style", emitted)
	}, nil)

	styleVal := root.Get("style")
	if styleVal == nil {
		return nil
	}
	styleMap, ok := styleVal.(*ycrdt.YMap)
	if !ok {
		t.Fatalf("style key is not a YMap, got %T", styleVal)
	}
	decoded, err := decodeCellStyle(styleMap)
	if err != nil {
		t.Fatalf("decodeCellStyle: %v", err)
	}
	return decoded
}

// TestCellStyleReadFromXLSXEndToEnd is the user-facing reproduction of
// the original style-loss bug: write a workbook with every CellStyle
// attribute set on one cell (through the doctaculous write path), run
// it through ReadWorkbookFromXLSX (the production preview / bootstrap
// entry point), and assert every attribute survives onto the resulting
// WorkbookModel. Catches a regression at the level of "open a customer
// xlsx, half the formatting is gone".
func TestCellStyleReadFromXLSXEndToEnd(t *testing.T) {
	leaves := collectCellStyleLeaves()

	combined := &CellStyle{}
	for _, path := range leaves {
		assignLeafByPath(t, combined, path, styleAttributeRegistry[path].Canary)
	}

	xlsxBytes := writeSingleStyledCellXLSX(t, combined)

	model, err := ReadWorkbookFromXLSX(xlsxBytes, 0, 0)
	if err != nil {
		t.Fatalf("ReadWorkbookFromXLSX: %v", err)
	}
	if len(model.Sheets) == 0 {
		t.Fatal("no sheets in workbook model")
	}
	sheet := model.Sheets[0]
	cell, ok := sheet.Cells["1:1"]
	if !ok {
		t.Fatalf("no cell at 1:1, got keys: %v", sheetCellKeys(sheet))
	}
	if cell.Style == nil {
		t.Fatal("ReadWorkbookFromXLSX dropped the entire style block despite a fully-styled cell")
	}

	for _, path := range leaves {
		spec := styleAttributeRegistry[path]
		expected := spec.CanaryReadBack
		if expected == nil {
			expected = spec.Canary
		}
		got, ok := leafValueFromCellStyle(cell.Style, path)
		if !ok || !equalAny(got, expected) {
			t.Errorf("ReadWorkbookFromXLSX lost %q: want %v, got %v (present=%v)", path, expected, got, ok)
		}
	}
}

func sheetCellKeys(s WorksheetModel) []string {
	keys := make([]string, 0, len(s.Cells))
	for k := range s.Cells {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
