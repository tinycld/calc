package cli

import (
	"fmt"
	"strconv"
	"strings"
)

// A1 notation ↔ the zero-based row/col the schema stores.
//
// The CLI speaks A1 because that is what a spreadsheet shows and what a person
// reads off the screen; the collection stores integers because that is what the
// grid indexes by. Converting at the edge keeps every other layer in one
// representation.

// parseCell reads "A1", "b2", "AA10" into zero-based (row, col).
func parseCell(ref string) (row, col int, err error) {
	ref = strings.TrimSpace(strings.ToUpper(ref))
	if ref == "" {
		return 0, 0, fmt.Errorf("a cell reference is required, e.g. A1")
	}

	split := 0
	for split < len(ref) && ref[split] >= 'A' && ref[split] <= 'Z' {
		split++
	}
	letters, digits := ref[:split], ref[split:]
	if letters == "" || digits == "" {
		return 0, 0, fmt.Errorf("%q is not a cell reference (expected a form like A1 or AA10)", ref)
	}

	// Bijective base-26: A=1 … Z=26, AA=27. Subtract one at the end for the
	// zero-based column the schema stores.
	for _, ch := range letters {
		col = col*26 + int(ch-'A') + 1
	}
	col--

	rowNum, convErr := strconv.Atoi(digits)
	if convErr != nil || rowNum < 1 {
		return 0, 0, fmt.Errorf("%q is not a cell reference: row must be a positive number", ref)
	}
	return rowNum - 1, col, nil
}

// formatCell renders zero-based (row, col) back to A1 notation.
func formatCell(row, col int) string {
	if row < 0 || col < 0 {
		return "-"
	}
	var letters string
	for n := col + 1; n > 0; {
		n--
		letters = string(rune('A'+n%26)) + letters
		n /= 26
	}
	return letters + strconv.Itoa(row+1)
}
