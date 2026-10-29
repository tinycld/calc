package calc

import "strings"

// isDateNumFmt reports whether a number format code draws a date or a
// time: a day/month/year/hour/second letter outside quoted text,
// escapes and brackets, or an elapsed-time bracket ([h], [mm], [ss]).
// It mirrors omnidoc's own (unexported) check, which decides which
// cached values the import reads as dates; the save path must apply the
// same rule to shift those values back.
func isDateNumFmt(code string) bool {
	inQuote := false
	for i := 0; i < len(code); i++ {
		ch := code[i]
		switch {
		case inQuote:
			if ch == '"' {
				inQuote = false
			}
		case ch == '"':
			inQuote = true
		case ch == '\\':
			i++
		case ch == '[':
			end := strings.IndexByte(code[i:], ']')
			if end < 0 {
				return false
			}
			if isElapsedToken(code[i+1 : i+end]) {
				return true
			}
			i += end
		case strings.IndexByte("ydhsmYDHSM", ch) >= 0:
			return true
		}
	}
	return false
}

func isElapsedToken(s string) bool {
	if s == "" {
		return false
	}
	c := s[0] | 0x20
	if c != 'h' && c != 'm' && c != 's' {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i]|0x20 != c {
			return false
		}
	}
	return true
}
