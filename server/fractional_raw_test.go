package calc

import (
	"testing"

	ycrdt "github.com/skyterra/y-crdt"
)

// TestNormalizeCellRawForY_FractionalStaysNumeric asserts that a
// fractional float64 cell raw is normalized into a y-crdt-compatible
// NUMERIC form (the single-element ArrayAny wrapper), not a string.
// Regression for the bug where a fractional numeric cell degraded to
// text on realtime bootstrap and broke SUM/arithmetic.
func TestNormalizeCellRawForY_FractionalStaysNumeric(t *testing.T) {
	for _, in := range []float64{13.5, 0.085, -2.25, 1.0 / 3.0} {
		got := normalizeCellRawForY(in)
		if _, isStr := got.(string); isStr {
			t.Fatalf("normalizeCellRawForY(%v) = %q (string) — must stay numeric", in, got)
		}
		n, ok := unwrapYRawNumber(got)
		if !ok {
			t.Fatalf("normalizeCellRawForY(%v) = %#v — unwrapYRawNumber could not recover a number", in, got)
		}
		if n != in {
			t.Fatalf("round-trip drift: normalizeCellRawForY(%v) unwraps to %v", in, n)
		}
	}
}

// TestNormalizeCellRawForY_WholeNumberStaysInt keeps the existing
// behavior: whole-number floats become a bare int (the numeric type
// y-crdt's TypeMapSet accepts directly), not the array wrapper.
func TestNormalizeCellRawForY_WholeNumberStaysInt(t *testing.T) {
	got := normalizeCellRawForY(float64(7))
	if _, ok := got.(int); !ok {
		t.Fatalf("normalizeCellRawForY(7) = %#v, want bare int", got)
	}
}

// TestNormalizeCellRawForY_Passthrough covers the non-float branches.
func TestNormalizeCellRawForY_Passthrough(t *testing.T) {
	if got := normalizeCellRawForY(nil); got != nil {
		t.Errorf("nil -> %#v", got)
	}
	if got := normalizeCellRawForY("abc"); got != "abc" {
		t.Errorf("string -> %#v", got)
	}
	if got := normalizeCellRawForY(true); got != true {
		t.Errorf("bool -> %#v", got)
	}
	if got := normalizeCellRawForY(42); got != 42 {
		t.Errorf("int -> %#v", got)
	}
}

// TestNormalizeRawForY_StyleLeafKeepsStringForm documents that the
// STYLE/opaque-leaf normalizer intentionally keeps the legacy numeric
// string form for fractional floats (its decoders parse the string back
// into a number); only the cell-raw path uses the numeric wrapper.
func TestNormalizeRawForY_StyleLeafKeepsStringForm(t *testing.T) {
	if got := normalizeRawForY(float64(10.5)); got != "10.5" {
		t.Fatalf("normalizeRawForY(10.5) = %#v, want \"10.5\"", got)
	}
	if got := normalizeRawForY(float64(12)); got != 12 {
		t.Fatalf("normalizeRawForY(12) = %#v, want int 12", got)
	}
}

// TestUnwrapYRawNumber covers every numeric shape the decoder must
// recover — bare ints (whole numbers), the ArrayAny fractional wrapper,
// and the various int/float widths — plus the non-numeric rejections.
func TestUnwrapYRawNumber(t *testing.T) {
	cases := []struct {
		name string
		in   any
		want float64
		ok   bool
	}{
		{"float64", float64(13.5), 13.5, true},
		{"float32", float32(0.5), 0.5, true},
		{"int", 7, 7, true},
		{"int64", int64(9), 9, true},
		{"wrapped-fractional", ycrdt.ArrayAny{float64(13.5)}, 13.5, true},
		{"wrapped-int", ycrdt.ArrayAny{7}, 7, true},
		{"bare-slice", []any{float64(0.085)}, 0.085, true},
		{"string-not-coerced", "13.5", 0, false},
		{"empty-array", ycrdt.ArrayAny{}, 0, false},
		{"multi-array", ycrdt.ArrayAny{1.0, 2.0}, 0, false},
		{"nil", nil, 0, false},
		{"bool", true, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := unwrapYRawNumber(c.in)
			if ok != c.ok {
				t.Fatalf("ok = %v, want %v", ok, c.ok)
			}
			if ok && got != c.want {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

// TestBootstrapFractionalCell_RoundTripsAsNumber drives the full
// bootstrap -> collectCells path: a fractional numeric cell must land as
// a RawNumber (not a RawString) so downstream SUM/serialization treat it
// as a number. Also asserts the doc-level `raw` is numeric (not the
// string "13.5").
func TestBootstrapFractionalCell_RoundTripsAsNumber(t *testing.T) {
	doc := ycrdt.NewDoc("room", false, nil, nil, false)
	model := WorkbookModel{
		Sheets: []WorksheetModel{{
			Name: "Sheet1", RowCount: 3, ColCount: 1,
			Cells: map[string]CellValueDTO{
				"1:1": {Kind: "number", Raw: float64(13.5), Display: "13.5"},
				"2:1": {Kind: "number", Raw: float64(0.085), Display: "0.085"},
				"3:1": {Kind: "number", Raw: float64(7), Display: "7"},
			},
		}},
	}
	if err := BootstrapYDocFromWorkbook(doc, model); err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	cellsMap, ok := doc.GetMap("cells").(*ycrdt.YMap)
	if !ok {
		t.Fatal("cells map missing")
	}

	// Doc-level raw for a fractional cell must NOT be a string.
	fracCell, _ := cellsMap.Get("sheet1:1:1").(*ycrdt.YMap)
	if fracCell == nil {
		t.Fatal("fractional cell missing")
	}
	if s, isStr := fracCell.Get("raw").(string); isStr {
		t.Fatalf("fractional raw stored as string %q — regressed to text", s)
	}

	entries, err := collectCells(cellsMap)
	if err != nil {
		t.Fatalf("collectCells: %v", err)
	}
	byRow := make(map[int]CellEntry, len(entries))
	for _, e := range entries {
		byRow[e.Row] = e
	}
	for row, want := range map[int]float64{1: 13.5, 2: 0.085, 3: 7} {
		e := byRow[row]
		if e.Kind != "number" {
			t.Errorf("row %d kind = %q, want number", row, e.Kind)
		}
		if e.RawNumber == nil {
			t.Fatalf("row %d: RawNumber is nil (raw degraded to string %q)", row, e.RawString)
		}
		if *e.RawNumber != want {
			t.Errorf("row %d: RawNumber = %v, want %v", row, *e.RawNumber, want)
		}
	}
}
