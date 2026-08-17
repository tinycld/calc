package cli

import (
	"fmt"
	"strconv"
	"strings"
)

// A1 notation ↔ the ONE-BASED row/col the schema stores.
//
// The CLI speaks A1 because that is what a spreadsheet shows and what a person
// reads off the screen; the collection stores integers because that is what the
// grid indexes by. Converting at the edge keeps every other layer in one
// representation.
//
// One-based is not a choice made here — it is the app's contract, and both ends
// of it are load-bearing:
//
//   - `calc_comments.row`/`col` declare `min: 1` (migration 1719000000), so a
//     zero fails the write outright.
//   - the app's own A1 parser keeps the row as written and rejects
//     `row < 1 || col < 1` (calc/lib/pivot/range-parse.ts), and `columnLabel`
//     maps 1 → "A" (calc/lib/workbook-types.ts). NameBox renders
//     `columnLabel(col) + row` with no offset on either axis.
//
// This file previously subtracted one from both, which meant every cell in row
// 1 and every cell in column A — A1 itself included — was rejected by the
// server as `Failed to create record`. Anything that did save was written one
// row and one column off from the cell the user named, so the CLI and the grid
// disagreed about which cell was annotated.

// parseCell reads "A1", "b2", "AA10" into one-based (row, col).
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

	// Bijective base-26: A=1 … Z=26, AA=27 — already the one-based column the
	// schema stores, so nothing is subtracted.
	for _, ch := range letters {
		col = col*26 + int(ch-'A') + 1
	}

	rowNum, convErr := strconv.Atoi(digits)
	if convErr != nil || rowNum < 1 {
		return 0, 0, fmt.Errorf("%q is not a cell reference: row must be a positive number", ref)
	}
	return rowNum, col, nil
}

// formatCell renders one-based (row, col) back to A1 notation.
func formatCell(row, col int) string {
	if row < 1 || col < 1 {
		return "-"
	}
	var letters string
	for n := col; n > 0; {
		n--
		letters = string(rune('A'+n%26)) + letters
		n /= 26
	}
	return letters + strconv.Itoa(row)
}
