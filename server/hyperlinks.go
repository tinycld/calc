package calc

import (
	"fmt"
	"sort"
	"strings"

	"github.com/nathanstitt/omnidoc/pkg/xlsx"
)

// linkKey is the cell key holding the cell's hyperlink (LINK_KEY in
// tinycld/calc/lib/y-doc-bootstrap.ts).
const linkKey = "link"

// hyperlinkTarget is the one string calc keeps per linked cell. An
// external link is its URL. An in-workbook link (Location "Sheet2!A1" or
// a defined name) is "#" + Location — the form Excel itself shows and
// HYPERLINK() takes — so it survives the doc and the save can tell it
// from a URL. A URL with a Location (some producers file the URL's
// fragment there) joins them with "#".
func hyperlinkTarget(h xlsx.Hyperlink) string {
	switch {
	case h.URL != "" && h.Location != "":
		return h.URL + "#" + h.Location
	case h.URL != "":
		return h.URL
	case h.Location != "":
		return "#" + h.Location
	}
	return ""
}

// hyperlinkFromTarget is the inverse of hyperlinkTarget for a link calc
// wrote: "#..." is an in-workbook location, anything else a URL (its own
// fragment kept in the URL).
func hyperlinkFromTarget(ref, target string) xlsx.Hyperlink {
	if loc, ok := strings.CutPrefix(target, "#"); ok {
		return xlsx.Hyperlink{Ref: ref, Location: loc}
	}
	return xlsx.Hyperlink{Ref: ref, URL: target}
}

// applyHyperlinks sets each sheet hyperlink on the cells it covers: the
// anchor (top-left) cell always, the range's other cells when they hold
// something. An anchor with no text becomes a string cell showing the
// link's display text (or the link itself), as calc does for a link added
// to an empty cell, so the link has something to click. The first link
// on a cell wins. rowCap/colCap bound the read as in readWorksheet.
// Returns the extent of the cells it created.
func applyHyperlinks(cells map[string]CellValueDTO, links []xlsx.Hyperlink, rowCap, colCap int) (maxRow, maxCol int) {
	inCaps := func(row, col int) bool {
		return (rowCap <= 0 || row <= rowCap) && (colCap <= 0 || col <= colCap)
	}
	for _, h := range links {
		target := hyperlinkTarget(h)
		rng, err := xlsx.ParseRange(h.Ref)
		if target == "" || err != nil {
			continue
		}
		if inCaps(rng.StartRow, rng.StartCol) {
			key := fmt.Sprintf("%d:%d", rng.StartRow, rng.StartCol)
			cell, exists := cells[key]
			if cell.Link == "" {
				if !exists || isBlankTextCell(cell) {
					text := h.Display
					if text == "" {
						text = target
					}
					cell.Kind, cell.Raw, cell.Display = "string", text, text
					maxRow, maxCol = max(maxRow, rng.StartRow), max(maxCol, rng.StartCol)
				}
				cell.Link = target
				cells[key] = cell
			}
		}
		forCellsInRange(cells, rng, func(key string, cell CellValueDTO) {
			if cell.Link == "" {
				cell.Link = target
				cells[key] = cell
			}
		})
	}
	return maxRow, maxCol
}

// isBlankTextCell reports a cell that shows no text: no value, no
// formula (a decorated empty from readWorkbookCell).
func isBlankTextCell(c CellValueDTO) bool {
	return c.Formula == "" && (c.Raw == nil || c.Raw == "")
}

// forCellsInRange calls fn for each cell of cells inside rng, walking
// whichever is smaller: the range's coordinates or the map, so a
// whole-column link does not walk a million rows.
func forCellsInRange(cells map[string]CellValueDTO, rng xlsx.Range, fn func(key string, cell CellValueDTO)) {
	area := (rng.EndRow - rng.StartRow + 1) * (rng.EndCol - rng.StartCol + 1)
	if area > 0 && area <= len(cells) {
		for r := rng.StartRow; r <= rng.EndRow; r++ {
			for c := rng.StartCol; c <= rng.EndCol; c++ {
				key := fmt.Sprintf("%d:%d", r, c)
				if cell, ok := cells[key]; ok {
					fn(key, cell)
				}
			}
		}
		return
	}
	for key, cell := range cells {
		r, c := parseModelCellKey(key)
		if r >= rng.StartRow && r <= rng.EndRow && c >= rng.StartCol && c <= rng.EndCol {
			fn(key, cell)
		}
	}
}

// cellPos is a 1-based cell coordinate.
type cellPos struct{ row, col int }

// sheetHyperlinks builds the hyperlink list a sheet saves with, from the
// links its snapshot cells carry (links, keyed by every snapshot cell of
// the sheet; "" for a cell without a link) and the file's own links
// (orig, file order):
//
//   - A file link whose anchor and every present cell in its range still
//     carry its target is kept verbatim (range, display, tooltip), so a
//     no-op save is byte-identical.
//   - When seeded is false the doc predates links (see
//     YDocSnapshot.SheetFactsSeeded): a file link none of whose cells
//     carries a link is kept too, since the doc never knew about it.
//   - Every other linked cell becomes a one-cell link, in row-major order
//     after the kept ones.
func sheetHyperlinks(links map[cellPos]string, orig []xlsx.Hyperlink, seeded bool) []xlsx.Hyperlink {
	var out []xlsx.Hyperlink
	consumed := map[cellPos]bool{}
	for _, h := range orig {
		target := hyperlinkTarget(h)
		rng, err := xlsx.ParseRange(h.Ref)
		if target == "" || err != nil {
			continue
		}
		anchor := cellPos{rng.StartRow, rng.StartCol}
		covered := []cellPos{}
		allMatch := links[anchor] == target
		anyLinked := links[anchor] != ""
		forLinksInRange(links, rng, func(p cellPos, link string) {
			covered = append(covered, p)
			allMatch = allMatch && link == target
			anyLinked = anyLinked || link != ""
		})
		switch {
		case allMatch:
			for _, p := range covered {
				consumed[p] = true
			}
			consumed[anchor] = true
			out = append(out, h)
		case !seeded && !anyLinked:
			out = append(out, h)
		}
	}
	var added []cellPos
	for p, link := range links {
		if link != "" && !consumed[p] {
			added = append(added, p)
		}
	}
	sort.Slice(added, func(i, j int) bool {
		if added[i].row != added[j].row {
			return added[i].row < added[j].row
		}
		return added[i].col < added[j].col
	})
	for _, p := range added {
		out = append(out, hyperlinkFromTarget(xlsx.CellRef(p.row, p.col), links[p]))
	}
	return out
}

// forLinksInRange is forCellsInRange over the snapshot's per-cell links.
func forLinksInRange(links map[cellPos]string, rng xlsx.Range, fn func(p cellPos, link string)) {
	area := (rng.EndRow - rng.StartRow + 1) * (rng.EndCol - rng.StartCol + 1)
	if area > 0 && area <= len(links) {
		for r := rng.StartRow; r <= rng.EndRow; r++ {
			for c := rng.StartCol; c <= rng.EndCol; c++ {
				if link, ok := links[cellPos{r, c}]; ok {
					fn(cellPos{r, c}, link)
				}
			}
		}
		return
	}
	for p, link := range links {
		if p.row >= rng.StartRow && p.row <= rng.EndRow && p.col >= rng.StartCol && p.col <= rng.EndCol {
			fn(p, link)
		}
	}
}
