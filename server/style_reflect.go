package calc

import (
	"reflect"

	"github.com/xuri/excelize/v2"
)

// This file holds the single reflect-driven layer in the calc save
// path: overlayStyle, which copies a *CellStyle (snapshot.go) onto an
// *excelize.Style (excelize's monolithic per-cell style record).
//
// The reverse direction — turning the y-crdt-decoded style YMap into
// a *CellStyle — does NOT use reflect: runtime.go's decodeCellStyle
// flattens the style YMap into a plain map and json.Marshals it, then
// json.Unmarshals straight into *CellStyle using the standard
// library's tag-driven decoder. CellStyle's TS / Go field names are
// chosen to match the camelCase keys the doc uses (see the json tags
// in snapshot.go), so no per-attribute glue is needed.
//
// The overlay direction needs reflect because excelize's struct shape
// doesn't line up with our CellStyle 1:1 in every case. Most attributes
// (Bold, Italic, Color, Horizontal, Vertical, WrapText, Size) match by
// name and convertible type; a small number diverge (e.g.
// CellStyle.NumFmt → excelize.Style.CustomNumFmt; CellFont.Name →
// excelize.Font.Family). The structural fields round-trip with no
// per-attribute code; the divergent ones declare a single override
// in styleOverlayOverrides.
//
// Adding a new attribute that lines up structurally: add one field on
// CellStyle / CellFont / etc. in snapshot.go (matching excelize's
// PascalCase) AND one matching camelCase field on the TS CellStyle.
// Done — no changes here.
//
// Adding a non-structural attribute: same plus one entry in
// styleOverlayOverrides below.

// styleOverlayOverride is the per-attribute escape hatch for fields
// where CellStyle's Go shape doesn't line up 1:1 with excelize's
// shape. Path is dotted Go field names rooted at CellStyle, e.g.
// "Font.Name" or "NumFmt".
//
// v1 has no overrides (bold is structurally trivial).
type styleOverlayOverride func(dst *excelize.Style, srcPtr reflect.Value)

var styleOverlayOverrides = map[string]styleOverlayOverride{
	"Font.Underline": func(dst *excelize.Style, srcPtr reflect.Value) {
		if dst.Font == nil {
			dst.Font = &excelize.Font{}
		}
		if srcPtr.Elem().Bool() {
			dst.Font.Underline = "single"
		} else {
			dst.Font.Underline = "none"
		}
	},
	"Font.Name": func(dst *excelize.Style, srcPtr reflect.Value) {
		if dst.Font == nil {
			dst.Font = &excelize.Font{}
		}
		dst.Font.Family = srcPtr.Elem().String()
	},
	"NumFmt": func(dst *excelize.Style, srcPtr reflect.Value) {
		s := srcPtr.Elem().String()
		if s == "" {
			// excelize.NewStyle errors on a non-nil pointer to "" with
			// ErrCustomNumFmt. An empty-string patch means "clear the
			// custom format" — drop CustomNumFmt entirely so excelize
			// falls back to the workbook's General format.
			dst.CustomNumFmt = nil
			return
		}
		dst.CustomNumFmt = &s
	},
}

// overlayStyle copies every non-nil leaf in patch onto the matching
// field path in base, mutating base in place.
//
// Most attributes round-trip via a structural walk: a non-nil
// CellStyle.Font.Bold lands on excelize.Font.Bold by name. Attributes
// whose names or types don't match are routed through
// styleOverlayOverrides instead.
func overlayStyle(base *excelize.Style, patch *CellStyle) {
	if patch == nil || base == nil {
		return
	}
	overlayWalk(reflect.ValueOf(base).Elem(), reflect.ValueOf(patch).Elem(), "", base)
}

// overlayWalk recurses through the patch struct and applies non-nil
// leaves onto base. The path arg accumulates the dotted Go field
// path (used to look up override handlers); rootDst stays anchored
// at the *excelize.Style so override handlers can target arbitrary
// fields anywhere on it.
func overlayWalk(dst, src reflect.Value, path string, rootDst *excelize.Style) {
	if src.Kind() != reflect.Struct {
		return
	}
	srcType := src.Type()
	for i := range src.NumField() {
		srcField := src.Field(i)
		if srcField.Kind() != reflect.Pointer || srcField.IsNil() {
			continue
		}
		name := srcType.Field(i).Name
		fieldPath := name
		if path != "" {
			fieldPath = path + "." + name
		}
		if handler, ok := styleOverlayOverrides[fieldPath]; ok {
			handler(rootDst, srcField)
			continue
		}
		dstField := dst.FieldByName(name)
		if !dstField.IsValid() || !dstField.CanSet() {
			continue
		}
		applyPointer(dstField, srcField, fieldPath, rootDst)
	}
}

// applyPointer assigns a non-nil src pointer onto dstField. dstField
// may be a pointer, a value-typed nested struct, or a scalar.
func applyPointer(dstField, srcPtr reflect.Value, path string, rootDst *excelize.Style) {
	srcElem := srcPtr.Elem()
	switch dstField.Kind() {
	case reflect.Pointer:
		elemType := dstField.Type().Elem()
		if dstField.IsNil() {
			dstField.Set(reflect.New(elemType))
		}
		if elemType.Kind() == reflect.Struct {
			overlayWalk(dstField.Elem(), srcElem, path, rootDst)
			return
		}
		if srcElem.Type().AssignableTo(elemType) {
			dstField.Elem().Set(srcElem)
		}
	case reflect.Struct:
		overlayWalk(dstField, srcElem, path, rootDst)
	default:
		if srcElem.Type().AssignableTo(dstField.Type()) {
			dstField.Set(srcElem)
		}
	}
}
