package calc

import "testing"

func TestIsDateNumFmt(t *testing.T) {
	cases := map[string]bool{
		"yyyy-mm-dd":  true,
		"M/d/yyyy":    true,
		"h:mm AM/PM":  true,
		"[h]:mm:ss":   true,
		`"$"#,##0.00`: false,
		"0.00%":       false,
		"[Red]#,##0":  false,
		`"Day "0`:     false,
		`#,##0 \d`:    false,
		"General":     false,
		"":            false,
	}
	for code, want := range cases {
		if got := isDateNumFmt(code); got != want {
			t.Errorf("isDateNumFmt(%q) = %v, want %v", code, got, want)
		}
	}
}
