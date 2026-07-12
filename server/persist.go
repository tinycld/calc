package calc

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/nathanstitt/doctaculous/pkg/xlsx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"tinycld.org/core/previewqueue"
	"tinycld.org/core/realtime"
	"tinycld.org/core/thumbnails/textpreview"
)

// Preview region dimensions: the top-left block of the first sheet we
// hand to the thumbnail renderer. Kept small so the preview reads as a
// glanceable snippet, not a full re-render.
const (
	previewGridRows    = 12
	previewGridCols    = 6
	previewCellMaxRune = 14
)

// driveItemsCollection is the PocketBase collection where spreadsheet
// blobs live. The roomID handed to a sheets RealtimeRoom IS the
// drive_items.id.
const driveItemsCollection = "drive_items"

// SaveRoom serializes the current state of the room's server-side
// Y.Doc back into the source XLSX, writing the result to the
// drive_items record's `file` field.
//
// Failures are returned as errors but never panic. The caller (the
// SaveCoordinator running off a broker hook) is expected to log and
// retry; nothing here mutates the Y.Doc, so the room can re-attempt
// against the same in-memory state on the next trigger.
//
// The handle parameter is the room's DocHandle as returned by
// Runtime.NewDoc; we type-assert to *sheetsDocHandle to access the
// Snapshot method (not part of the realtime.DocHandle interface
// because XLSX-flavored snapshots are calc-specific).
//
// loadComments is optional; when nil the saved xlsx omits cell-comment
// rendering. Tests pass nil; production wiring (MakeProductionFlush)
// supplies MakeProductionLoadComments(app).
func SaveRoom(app core.App, handle realtime.DocHandle, driveItemID string, loadComments LoadCommentsFn) error {
	if handle == nil {
		return errors.New("calc: SaveRoom called with nil handle")
	}
	sh, ok := handle.(*sheetsDocHandle)
	if !ok {
		return fmt.Errorf("calc: SaveRoom expected *sheetsDocHandle, got %T", handle)
	}

	item, err := app.FindRecordById(driveItemsCollection, driveItemID)
	if err != nil {
		return fmt.Errorf("calc: load drive_items %s: %w", driveItemID, err)
	}

	originalBytes, err := readDriveItemBytes(app, item)
	if err != nil {
		return fmt.Errorf("calc: read existing file for %s: %w", driveItemID, err)
	}

	snap, err := sh.Snapshot()
	if err != nil {
		return fmt.Errorf("calc: snapshot Y.Doc for %s: %w", driveItemID, err)
	}

	var comments []CommentRow
	if loadComments != nil {
		comments, err = loadComments(driveItemID)
		if err != nil {
			return fmt.Errorf("calc: load comments for %s: %w", driveItemID, err)
		}
	}

	updatedBytes, err := serializeSnapshotToXLSX(originalBytes, snap, comments)
	if err != nil {
		return fmt.Errorf("calc: serialize Y.Doc for %s: %w", driveItemID, err)
	}
	if len(updatedBytes) == 0 {
		return fmt.Errorf("calc: serializer produced empty bytes for %s", driveItemID)
	}

	// Reuse the original filename so URLs / mime detection stay
	// consistent. PocketBase will rename the on-disk blob to a fresh
	// hash on save, so the prior blob isn't overwritten in place.
	filename := item.GetString("file")
	if filename == "" {
		filename = "spreadsheet.xlsx"
	}
	f, err := filesystem.NewFileFromBytes(updatedBytes, filename)
	if err != nil {
		return fmt.Errorf("calc: build filesystem.File for %s: %w", driveItemID, err)
	}
	item.Set("file", f)
	item.Set("size", len(updatedBytes))

	// Compute preview hashes + page model from the snapshot and stash a
	// payload for the async render hook BEFORE saving. The hashes let the
	// generic drive save-hook skip thumbnail/index regeneration when the
	// visible region and searchable text are unchanged.
	grid, gridString := buildPreviewGrid(snap)
	allCellsPlaintext := buildPlaintext(snap)
	regionHash := textpreview.Hash(gridString)
	indexHash := textpreview.Hash(allCellsPlaintext)
	item.Set("thumb_region_hash", regionHash)
	item.Set("index_hash", indexHash)
	previewqueue.Stash(driveItemID, previewqueue.Payload{
		Plaintext:  allCellsPlaintext,
		RegionHash: regionHash,
		IndexHash:  indexHash,
		Page:       textpreview.PageModel{Grid: grid},
	})

	if err := app.Save(item); err != nil {
		return fmt.Errorf("calc: save drive_items %s: %w", driveItemID, err)
	}
	return nil
}

// cellDisplayString returns the human-readable text for a cell, used to
// build both the thumbnail grid and the search index. It prefers the
// doc's cached Display string (already formatted on the TS side), then
// falls back to the typed raw scalar, then the formula source, so a
// freshly-typed cell with no cached display still contributes text.
func cellDisplayString(c CellEntry) string {
	if c.Display != "" {
		return c.Display
	}
	switch {
	case c.RawString != "":
		return c.RawString
	case c.RawNumber != nil:
		return strconv.FormatFloat(*c.RawNumber, 'f', -1, 64)
	case c.RawBool != nil:
		return strconv.FormatBool(*c.RawBool)
	case c.Formula != "":
		return c.Formula
	}
	return ""
}

// truncateRunes shortens s to at most n runes (not bytes), so multibyte
// content isn't cut mid-rune.
func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// buildPreviewGrid extracts the top-left previewGridRows×previewGridCols
// block of the FIRST sheet (slice position 0) as a textpreview.GridModel,
// plus a deterministic row-major string of that block for region hashing.
//
// Rows/Cols in the returned model are the actual extents used (the
// largest populated 1-based row/col within the capped block), so an empty
// sheet yields a 0×0 grid. Missing cells render as empty strings. Each
// cell string is truncated to previewCellMaxRune runes.
func buildPreviewGrid(snap YDocSnapshot) (*textpreview.GridModel, string) {
	if len(snap.Sheets) == 0 {
		return &textpreview.GridModel{}, ""
	}
	firstSheetID := snap.Sheets[0].ID

	// block[r][c] holds the truncated display string for 1-based row r+1,
	// col c+1 within the capped region.
	block := make([][]string, previewGridRows)
	for r := range block {
		block[r] = make([]string, previewGridCols)
	}

	usedRows, usedCols := 0, 0
	for _, cell := range snap.Cells {
		if cell.SheetID != firstSheetID {
			continue
		}
		if cell.Row < 1 || cell.Row > previewGridRows || cell.Col < 1 || cell.Col > previewGridCols {
			continue
		}
		s := truncateRunes(cellDisplayString(cell), previewCellMaxRune)
		if s == "" {
			continue
		}
		block[cell.Row-1][cell.Col-1] = s
		if cell.Row > usedRows {
			usedRows = cell.Row
		}
		if cell.Col > usedCols {
			usedCols = cell.Col
		}
	}

	cells := make([][]string, usedRows)
	for r := 0; r < usedRows; r++ {
		cells[r] = make([]string, usedCols)
		copy(cells[r], block[r][:usedCols])
	}

	grid := &textpreview.GridModel{Rows: usedRows, Cols: usedCols, Cells: cells}

	// Deterministic canonical string: row-major, cells tab-separated,
	// rows newline-separated. Stable across saves so the region hash only
	// changes when the visible block changes.
	var sb strings.Builder
	for r := 0; r < usedRows; r++ {
		if r > 0 {
			sb.WriteByte('\n')
		}
		for c := 0; c < usedCols; c++ {
			if c > 0 {
				sb.WriteByte('\t')
			}
			sb.WriteString(cells[r][c])
		}
	}
	return grid, sb.String()
}

// buildPlaintext joins every populated cell's display string across all
// sheets in deterministic order (sheets in snapshot order; cells in
// row-major order within each sheet) into a single newline-separated
// searchable blob for the index hash + search index.
func buildPlaintext(snap YDocSnapshot) string {
	// Group cells by sheet id, preserving snapshot sheet order, then sort
	// each group row-major so the output is deterministic regardless of
	// the snapshot's cell slice ordering.
	cellsBySheet := make(map[string][]CellEntry, len(snap.Sheets))
	for _, cell := range snap.Cells {
		cellsBySheet[cell.SheetID] = append(cellsBySheet[cell.SheetID], cell)
	}

	var lines []string
	for _, sheet := range snap.Sheets {
		group := cellsBySheet[sheet.ID]
		sort.Slice(group, func(i, j int) bool {
			if group[i].Row != group[j].Row {
				return group[i].Row < group[j].Row
			}
			return group[i].Col < group[j].Col
		})
		for _, cell := range group {
			if s := cellDisplayString(cell); s != "" {
				lines = append(lines, s)
			}
		}
	}
	return strings.Join(lines, "\n")
}

// serializeWorkbook is the model-only serialization path: build a fresh
// xlsx from a WorkbookModel (including pivot defs), without needing a
// Y.Doc. Used by tests; production goes through serializeSnapshotToXLSX.
func serializeWorkbook(model WorkbookModel) ([]byte, error) {
	f := xlsx.New()

	// Replace the default Sheet1 with the first model sheet's name, so
	// the workbook starts cleanly named.
	firstName := "Sheet1"
	if len(model.Sheets) > 0 && model.Sheets[0].Name != "" {
		firstName = model.Sheets[0].Name
	}
	if firstName != "Sheet1" {
		sh, err := f.Sheet("Sheet1")
		if err != nil {
			return nil, fmt.Errorf("resolve default sheet: %w", err)
		}
		if err := sh.SetName(firstName); err != nil {
			return nil, fmt.Errorf("rename default sheet to %q: %w", firstName, err)
		}
	}

	for i, s := range model.Sheets {
		var sh *xlsx.SheetEdit
		var err error
		if i == 0 {
			sh, err = f.Sheet(firstName)
		} else {
			sh, err = f.AddSheet(s.Name)
		}
		if err != nil {
			return nil, fmt.Errorf("sheet %q: %w", s.Name, err)
		}
		// Write each cell at its (row,col).
		for key, v := range s.Cells {
			r, c := parseModelCellKey(key)
			if r < 1 || c < 1 {
				continue
			}
			if err := writeModelCell(sh, r, c, v); err != nil {
				return nil, err
			}
		}
	}

	writePivots(f, model.Pivots)

	out, err := f.Save()
	if err != nil {
		return nil, fmt.Errorf("write xlsx: %w", err)
	}
	return out, nil
}

// writePivots emits each pivot definition as an xlsx.PivotTable on the
// workbook. Shared between serializeWorkbook (model-only path) and
// serializeSnapshotToXLSX (snapshot-on-disk-bytes path) so both paths
// agree on field mapping, naming, and the "skip when Values is empty"
// rule.
//
// Behavior:
//   - Pivots with no Values are skipped silently (a pivot needs at
//     least one Data field to materialize; v1 surfaces the def to
//     clients via the Y.Doc but doesn't try to materialize it in xlsx).
//   - AddPivotTable failures are logged and skipped rather than fatal,
//     so a single malformed def doesn't poison the whole save. The
//     Y.Doc keeps the original def around for the next attempt.
//   - AddPivotTable reads field names from the source range's header
//     cells, so the caller must emit pivots AFTER all cell writes.
//
// The caller's slice order is preserved verbatim so cache IDs allocate
// deterministically.
func writePivots(f *xlsx.File, pivots []PivotDefinitionDTO) {
	for _, p := range pivots {
		if len(p.Values) == 0 {
			continue
		}
		srcSheet, srcRange := splitSourceRange(p.SourceRange)
		pt := xlsx.PivotTable{
			Name:           p.ID,
			SourceSheet:    srcSheet,
			SourceRange:    srcRange,
			TargetSheet:    p.TargetSheetName,
			Location:       pivotTableRange(f, p),
			Rows:           sourceColumnNames(p.Rows),
			Cols:           sourceColumnNames(p.Cols),
			Filters:        sourceColumnNames(p.Filters),
			Values:         toPivotValueFields(p.Values),
			RowGrandTotals: p.RowGrandTotals,
			ColGrandTotals: p.ColGrandTotals,
			StyleName:      p.StyleName,
		}
		if err := f.AddPivotTable(pt); err != nil {
			slog.Warn("calc: AddPivotTable failed; skipping pivot",
				"pivotID", p.ID, "err", err)
			continue
		}
	}
}

// pivotTableRange derives the pivot's anchor Location range on the
// target sheet from the materialized pivot's ACTUAL dimensions, rather
// than the old hardcoded "A1:Z200" (which truncated pivots past column Z
// or row 200). The dimensions are computed exactly as the TS render
// engine does (see tinycld/calc/lib/pivot/render.ts): a header band, one
// render-row per distinct row-key tuple (plus subtotals and a
// grand-total row), and one render-col per distinct col-key tuple times
// the value count (plus row grand totals). Distinct tuple counts come
// from the pivot's source data, which is present in the workbook by the
// time writePivots runs.
//
// If the source data can't be read (missing/malformed range, absent
// sheet), we fall back to the legacy A1:Z200 box so a single unreadable
// pivot never poisons the save — matching writePivots' "skip, don't
// fatal" posture.
//
// Unlike the excelize-era PivotTableRange, doctaculous' Location is a
// bare range on TargetSheet — no sheet prefix.
func pivotTableRange(f *xlsx.File, p PivotDefinitionDTO) string {
	const legacyRange = "A1:Z200"
	rowCount, colCount, ok := computePivotDimensions(f, p)
	if !ok {
		return legacyRange
	}
	// Guard against a degenerate 0×0 pivot: the header band is always at
	// least 1×1.
	if rowCount < 1 {
		rowCount = 1
	}
	if colCount < 1 {
		colCount = 1
	}
	bottomRight := xlsx.CellRef(rowCount, colCount)
	if bottomRight == "" {
		return legacyRange
	}
	return "A1:" + bottomRight
}

// computePivotDimensions returns the (rowCount, colCount) of the
// materialized pivot grid, computed from the pivot definition plus the
// distinct row-/col-key tuples found in its (filtered) source data. The
// formulas mirror renderPivot in tinycld/calc/lib/pivot/render.ts:
//
//	valueCount     = max(1, len(Values))
//	headerRowCount = len(Cols) + (len(Values) > 1 ? 1 : 0), min 1
//	headerColCount = len(Rows)
//	renderRows     = distinct row tuples (+ one subtotal per first-field
//	                 group when RowSubtotals && len(Rows) >= 2); min 1
//	renderCols     = distinct col tuples; min 1
//	rowCount       = headerRowCount + renderRows + (ColGrandTotals ? 1 : 0)
//	colCount       = headerColCount + renderCols*valueCount
//	                   + (RowGrandTotals ? valueCount : 0)
//
// ok is false when the source data can't be read; the caller then falls
// back to the legacy range.
func computePivotDimensions(f *xlsx.File, p PivotDefinitionDTO) (rowCount, colCount int, ok bool) {
	rows, err := readPivotSourceRows(f, p.SourceRange)
	if err != nil {
		return 0, 0, false
	}
	rows = filterPivotRows(rows, p)

	valueCount := max(1, len(p.Values))
	headerRowCount := len(p.Cols)
	if len(p.Values) > 1 {
		headerRowCount++
	}
	if headerRowCount < 1 {
		headerRowCount = 1
	}
	headerColCount := len(p.Rows)

	rowTuples := distinctTuples(rows, p.Rows)
	colTuples := distinctTuples(rows, p.Cols)
	renderRows := max(1, len(rowTuples))
	renderCols := max(1, len(colTuples))

	// Subtotals add one render-row per distinct first-field group, but
	// only when there are at least two row fields (single-field pivots
	// have no inner group to subtotal — see buildRenderRows).
	if p.RowSubtotals && len(p.Rows) >= 2 && len(rowTuples) > 0 {
		renderRows += distinctFirstFieldGroups(rowTuples)
	}

	rowCount = headerRowCount + renderRows
	if p.ColGrandTotals {
		rowCount++
	}
	colCount = headerColCount + renderCols*valueCount
	if p.RowGrandTotals {
		colCount += valueCount
	}
	return rowCount, colCount, true
}

// pivotSourceRow is a decoded source data row keyed by header name, so
// field lookups (by PivotFieldDTO.SourceColumn) match the TS engine,
// which keys rows by header text.
type pivotSourceRow map[string]string

// readPivotSourceRows reads the pivot's source range out of the workbook
// and returns one map per data row (header row excluded), keyed by header
// name. Cell values are stringified the same way the TS engine keys them
// (stringifyRaw: raw scalar → string), so distinct-tuple counts match.
func readPivotSourceRows(f *xlsx.File, a1 string) ([]pivotSourceRow, error) {
	sheetName, ref := splitSourceRange(a1)
	if sheetName == "" {
		return nil, fmt.Errorf("calc: pivot source range %q missing sheet name", a1)
	}
	rng, err := xlsx.ParseRange(ref)
	if err != nil {
		return nil, err
	}
	sh, err := f.Sheet(sheetName)
	if err != nil {
		return nil, err
	}
	headers := make([]string, 0, rng.EndCol-rng.StartCol+1)
	for c := rng.StartCol; c <= rng.EndCol; c++ {
		headers = append(headers, pivotCellString(sh.Cell(rng.StartRow, c).Value))
	}
	out := make([]pivotSourceRow, 0, rng.EndRow-rng.StartRow)
	for r := rng.StartRow + 1; r <= rng.EndRow; r++ {
		row := make(pivotSourceRow, len(headers))
		for i, h := range headers {
			row[h] = pivotCellString(sh.Cell(r, rng.StartCol+i).Value)
		}
		out = append(out, row)
	}
	return out, nil
}

// pivotCellString renders a typed cell value the way the TS engine's
// stringifyRaw (tinycld/calc/lib/pivot/aggregate.ts) keys the Y.Doc raw:
// numbers via JS String(n) semantics, booleans as "true"/"false", dates
// in the same ISO convention the bootstrap stores as the date raw
// (dateRawString). Filter selections arrive stringified by the client
// with the same function, so filterPivotRows matches exactly.
func pivotCellString(v xlsx.Value) string {
	switch v.Kind {
	case xlsx.KindNumber:
		return formatNumber(v.F)
	case xlsx.KindBool:
		if v.B {
			return "true"
		}
		return "false"
	case xlsx.KindDate:
		return dateRawString(v.T)
	case xlsx.KindString, xlsx.KindError:
		return v.S
	default: // KindEmpty
		return ""
	}
}

// filterPivotRows drops rows excluded by the pivot's filter selections,
// matching applyFilters in tinycld/calc/lib/pivot/aggregate.ts: a filter
// with a non-empty selection keeps only rows whose value for that column
// is in the selection set.
func filterPivotRows(rows []pivotSourceRow, p PivotDefinitionDTO) []pivotSourceRow {
	if len(p.Filters) == 0 || len(p.FilterSelections) == 0 {
		return rows
	}
	active := make(map[string]map[string]struct{})
	for _, fld := range p.Filters {
		sel := p.FilterSelections[fld.SourceColumn]
		if len(sel) == 0 {
			continue
		}
		allowed := make(map[string]struct{}, len(sel))
		for _, v := range sel {
			allowed[v] = struct{}{}
		}
		active[fld.SourceColumn] = allowed
	}
	if len(active) == 0 {
		return rows
	}
	out := rows[:0]
	for _, row := range rows {
		keep := true
		for col, allowed := range active {
			if _, in := allowed[row[col]]; !in {
				keep = false
				break
			}
		}
		if keep {
			out = append(out, row)
		}
	}
	return out
}

// distinctTuples returns the set of distinct value-tuples produced by
// projecting each row onto the given fields, matching the row-/col-key
// grouping in aggregate.ts. An empty field list yields no tuples (the
// caller floors the render count at 1, matching the engine's single
// empty key).
func distinctTuples(rows []pivotSourceRow, fields []PivotFieldDTO) [][]string {
	if len(fields) == 0 {
		return nil
	}
	seen := make(map[string]struct{})
	out := make([][]string, 0)
	for _, row := range rows {
		tuple := make([]string, len(fields))
		for i, fld := range fields {
			tuple[i] = row[fld.SourceColumn]
		}
		key := strings.Join(tuple, "\x00")
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, tuple)
	}
	return out
}

// distinctFirstFieldGroups counts distinct first-field values among the
// row tuples — one row subtotal is emitted per such group (buildRenderRows
// in render.ts groups by the prefix tuple of length 1).
func distinctFirstFieldGroups(tuples [][]string) int {
	seen := make(map[string]struct{})
	for _, t := range tuples {
		if len(t) == 0 {
			continue
		}
		seen[t[0]] = struct{}{}
	}
	return len(seen)
}

// sourceColumnNames projects axis field DTOs (rows/cols/filters) onto
// the source-column names doctaculous keys pivot fields by.
func sourceColumnNames(in []PivotFieldDTO) []string {
	out := make([]string, 0, len(in))
	for _, f := range in {
		out = append(out, f.SourceColumn)
	}
	return out
}

// toPivotValueFields maps value-field DTOs onto xlsx.PivotValueField.
// Calc's aggregation names ("sum", "average", "countNums", "stdDevp",
// …) are already the OOXML dataField subtotal vocabulary, so they pass
// through verbatim. NumFmt intentionally does NOT round-trip: the
// dataField numFmt slot is a built-in numFmt ID and only accepts that
// catalog — see docs/pivot.md "Per-value numFmt round-trip".
func toPivotValueFields(in []PivotValueFieldDTO) []xlsx.PivotValueField {
	out := make([]xlsx.PivotValueField, 0, len(in))
	for _, v := range in {
		out = append(out, xlsx.PivotValueField{
			Field:       v.SourceColumn,
			Aggregation: v.Aggregation,
			DisplayName: v.DisplayName,
		})
	}
	return out
}

// splitSourceRange is the inverse of combineSourceRange (pivot.go): it
// splits the combined "<sheet>!<range>" form the DTO carries into the
// separate sheet + ref doctaculous expects, unquoting a single-quoted
// sheet name (doubled ” collapse to a literal quote). A bare range
// with no sheet prefix returns ("", ref); AddPivotTable then fails its
// sheet lookup and the pivot is logged-and-skipped, matching the old
// writer's handling of malformed source ranges.
func splitSourceRange(combined string) (sheet, ref string) {
	if strings.HasPrefix(combined, "'") {
		i := 1
		for i < len(combined) {
			if combined[i] != '\'' {
				i++
				continue
			}
			if i+1 < len(combined) && combined[i+1] == '\'' {
				i += 2 // escaped quote, keep scanning
				continue
			}
			break // closing quote
		}
		if i < len(combined) && i+1 < len(combined) && combined[i+1] == '!' {
			name := strings.ReplaceAll(combined[1:i], "''", "'")
			return name, combined[i+2:]
		}
		return "", combined
	}
	if idx := strings.LastIndex(combined, "!"); idx >= 0 {
		return combined[:idx], combined[idx+1:]
	}
	return "", combined
}

// parseModelCellKey parses the "row:col" keys used by
// WorksheetModel.Cells (a different shape from runtime.go's
// parseCellKey, which takes a 3-part "sheetID:row:col"). Returns
// (0,0) on any malformed input — callers treat that as "skip".
func parseModelCellKey(key string) (row, col int) {
	parts := strings.SplitN(key, ":", 2)
	if len(parts) != 2 {
		return 0, 0
	}
	r, errR := strconv.Atoi(parts[0])
	c, errC := strconv.Atoi(parts[1])
	if errR != nil || errC != nil {
		return 0, 0
	}
	return r, c
}

// writeModelCell writes one CellValueDTO at (row, col). Formula cells
// carry no cached value on this path (parity with the excelize-era
// writer, which emitted the formula alone); typed scalars dispatch to
// the matching typed setter.
func writeModelCell(sh *xlsx.SheetEdit, row, col int, v CellValueDTO) error {
	if v.Formula != "" {
		return sh.SetFormula(row, col, v.Formula, xlsx.Value{})
	}
	switch v.Kind {
	case "number":
		if n, ok := v.Raw.(float64); ok {
			return sh.SetNumber(row, col, n)
		}
	case "boolean":
		if b, ok := v.Raw.(bool); ok {
			return sh.SetBool(row, col, b)
		}
	}
	if s, ok := v.Raw.(string); ok && s != "" {
		return sh.SetString(row, col, s)
	}
	if v.Display != "" {
		return sh.SetString(row, col, v.Display)
	}
	return nil
}

// serializeSnapshotToXLSX reads the original .xlsx bytes, applies the
// Y.Doc snapshot's sheet metadata + cell entries on top, and returns
// the rewritten .xlsx bytes.
//
// The write path is doctaculous pkg/xlsx's preservation-first editor:
// xlsx.Edit opens the original bytes, every mutation touches only what
// it names, and untouched parts (themes, drawings, extension lists,
// unmodeled style facets) copy through byte-verbatim at Save. A second
// read-only handle (xlsx.OpenBytes) supplies the "what's on disk" view
// the authoritative-clear passes diff against — existing row/column
// customizations and the populated-cell grid. The read model is
// 0-based; every index converts to calc's 1-based convention at the
// seam.
//
// Behavior:
//   - Pivot parts are removed up front and rebuilt from the snapshot at
//     the end (re-adding without removing would duplicate caches).
//   - Sheets are ordered by SheetMeta.Position (the snapshot producer
//     pre-sorts; we use slice index as the position in the output).
//     Sheets present in the snapshot but not in the original workbook
//     are appended; existing sheets with a different snapshot name are
//     renamed positionally.
//   - Per-sheet metadata applies after rename/create and before cells:
//     RowCount/ColCount widen the workbook's <dimension> to the union
//     of snapshot and existing extents (never shrink); RowHeights and
//     ColWidths apply px-to-Excel-unit conversions (px=0 hides the
//     row/column, mirroring the TS-side hide-snap thresholds);
//     RowStyles overwrite the row's xlsx style with the Y.Doc state
//     (per-cell styles still layer on top). Merges replace wholesale.
//   - Visibility applies after all sheet writes. Hiding (or deleting)
//     the last visible sheet is logged and skipped rather than failing
//     the save — an intended change from the excelize-era writer, which
//     aborted the whole save; a doc state that hides every sheet is
//     better persisted mostly-hidden than not at all.
//   - Cells in the original workbook that the snapshot does NOT carry
//     are cleared (value + formula; style stays). The Y.Doc is seeded
//     from a complete walk of the source workbook on bootstrap, so a
//     missing snapshot entry reflects a real client-side deletion.
//   - For each snapshot cell: a formula writes atomically with its
//     cached value via SetFormula; plain values dispatch by Kind to the
//     typed setters; Style overlays via PatchCellStyle (nil leaves keep
//     the on-disk facet).
//   - When comments is non-empty, classic xlsx cell notes are written
//     via applyCommentsToFile (one-way: app → xlsx; one note per cell).
//   - Conditional formats replace wholesale per sheet from the doc's
//     rules (see writeConditionalFormats).
//
// Returns an error rather than empty bytes on any sheet/cell write
// failure; the caller treats both alike.
func serializeSnapshotToXLSX(originalBytes []byte, snap YDocSnapshot, comments []CommentRow) ([]byte, error) {
	if len(originalBytes) == 0 {
		return nil, errors.New("calc: serializeSnapshotToXLSX called with empty original bytes")
	}
	// Deterministic write order: the snapshot's cells arrive in Y.Map
	// iteration order (randomized per process), and downstream
	// allocation (shared strings, style xfs) is append-ordered, so an
	// unsorted walk would make byte output differ between saves of the
	// same doc state.
	sort.Slice(snap.Cells, func(i, j int) bool {
		a, b := snap.Cells[i], snap.Cells[j]
		if a.SheetID != b.SheetID {
			return a.SheetID < b.SheetID
		}
		if a.Row != b.Row {
			return a.Row < b.Row
		}
		return a.Col < b.Col
	})

	orig, err := xlsx.OpenBytes(originalBytes)
	if err != nil {
		return nil, fmt.Errorf("open xlsx read model: %w", err)
	}
	f, err := xlsx.Edit(originalBytes)
	if err != nil {
		return nil, fmt.Errorf("open xlsx editor: %w", err)
	}

	// Clean slate for pivots FIRST: the snapshot's defs are re-emitted
	// at the end of the save; leaving the old parts in place would
	// duplicate caches.
	if err := f.RemovePivotTables(); err != nil {
		return nil, fmt.Errorf("remove pivot tables: %w", err)
	}

	// existingSheets is the workbook's sheets in their on-disk order;
	// we line them up positionally with the snapshot's sorted slice.
	existingSheets := f.SheetNames()

	// Map snapshot sheet id → resolved sheet name. New sheets take
	// SheetMeta.Name verbatim; renamed existing sheets take the updated
	// name as well.
	sheetNameByID := make(map[string]string, len(snap.Sheets))
	for i, meta := range snap.Sheets {
		switch {
		case i < len(existingSheets):
			oldName := existingSheets[i]
			if meta.Name != "" && meta.Name != oldName {
				sh, err := f.Sheet(oldName)
				if err != nil {
					return nil, fmt.Errorf("sheet %q: %w", oldName, err)
				}
				if err := sh.SetName(meta.Name); err != nil {
					return nil, fmt.Errorf("rename sheet %q -> %q: %w", oldName, meta.Name, err)
				}
				sheetNameByID[meta.ID] = meta.Name
			} else {
				sheetNameByID[meta.ID] = oldName
			}
		default:
			name := meta.Name
			if name == "" {
				name = meta.ID
			}
			if _, err := f.AddSheet(name); err != nil {
				return nil, fmt.Errorf("add sheet %q: %w", name, err)
			}
			sheetNameByID[meta.ID] = name
		}
	}

	// Second pass: now that every sheet has its final name, apply the
	// per-sheet metadata (dimension, sizes, styles, merges, freeze, tab
	// color). The orig read model at the same position supplies the
	// existing-customization sets the authoritative clears diff against;
	// appended sheets have no orig counterpart and nothing to clear.
	for i, meta := range snap.Sheets {
		name, ok := sheetNameByID[meta.ID]
		if !ok {
			continue
		}
		sh, err := f.Sheet(name)
		if err != nil {
			return nil, fmt.Errorf("sheet %q: %w", name, err)
		}
		var origSheet *xlsx.Sheet
		if i < len(orig.Sheets) {
			origSheet = &orig.Sheets[i]
		}
		if err := applySheetMeta(sh, meta, origSheet); err != nil {
			return nil, fmt.Errorf("apply sheet meta on %s: %w", name, err)
		}
	}

	// Visibility pass: applied AFTER every sheet write so the count of
	// visible sheets is accurate. Sheets the snapshot wants visible
	// (Hidden=false) get explicitly re-shown so a Y.Doc unhide
	// propagates. Hiding the last visible sheet is refused by the
	// workbook-level rule; log-and-skip (see the function docstring).
	for _, meta := range snap.Sheets {
		name, ok := sheetNameByID[meta.ID]
		if !ok {
			continue
		}
		sh, err := f.Sheet(name)
		if err != nil {
			return nil, fmt.Errorf("sheet %q: %w", name, err)
		}
		visibility := xlsx.SheetVisible
		if meta.Hidden {
			visibility = xlsx.SheetHidden
		}
		if err := sh.SetVisibility(visibility); err != nil {
			if errors.Is(err, xlsx.ErrLastVisibleSheet) {
				slog.Warn("calc: cannot hide last visible sheet; leaving visible",
					"sheet", name)
				continue
			}
			return nil, fmt.Errorf("set sheet visibility on %s: %w", name, err)
		}
	}

	// Drop any sheets that exist on disk but the snapshot no longer
	// references. Without this, a sheet deleted via the sheet-management
	// UI would persist in the saved xlsx. Deleting the last visible
	// sheet is refused workbook-wide; log-and-skip keeps the save alive
	// (the excelize-era writer silently no-op'd the same case).
	keptNames := make(map[string]struct{}, len(sheetNameByID))
	for _, name := range sheetNameByID {
		keptNames[name] = struct{}{}
	}
	for _, name := range f.SheetNames() {
		if _, kept := keptNames[name]; kept {
			continue
		}
		if err := f.DeleteSheet(name); err != nil {
			if errors.Is(err, xlsx.ErrLastVisibleSheet) {
				slog.Warn("calc: cannot delete last visible sheet; leaving in place",
					"sheet", name)
				continue
			}
			return nil, fmt.Errorf("delete sheet %s: %w", name, err)
		}
	}

	// Build the per-sheet set of (row, col) keys the snapshot carries
	// so we can clear any source-workbook cell the snapshot has dropped.
	// Encoding row/col as int64 (row << 32 | col) keeps the key cheap
	// and unambiguous for the worksheet's million-row/16k-column limit.
	snapshotCellsBySheet := make(map[string]map[int64]struct{}, len(sheetNameByID))
	for _, cell := range snap.Cells {
		sheetName, ok := sheetNameByID[cell.SheetID]
		if !ok || cell.Row <= 0 || cell.Col <= 0 {
			continue
		}
		set, exists := snapshotCellsBySheet[sheetName]
		if !exists {
			set = make(map[int64]struct{})
			snapshotCellsBySheet[sheetName] = set
		}
		set[int64(cell.Row)<<32|int64(cell.Col)] = struct{}{}
	}

	// Per-sheet deletion pass: walk the orig read model's populated
	// cells (typed value or formula — the used-range grid pads with
	// KindEmpty) and blank any cell the snapshot no longer carries.
	// Without this, row/column deletions and clear-contents would
	// silently bounce back on reload because the original .xlsx bytes
	// still hold those values. ClearCell drops value + formula but
	// keeps the cell's style — a formula-only cell with no cached value
	// is populated too (the excelize-era GetRows walk missed those; the
	// typed grid does not).
	for i := range orig.Sheets {
		if i >= len(snap.Sheets) {
			break // disk sheets past the snapshot were deleted above
		}
		name, ok := sheetNameByID[snap.Sheets[i].ID]
		if !ok {
			continue
		}
		sh, err := f.Sheet(name)
		if err != nil {
			return nil, fmt.Errorf("sheet %q: %w", name, err)
		}
		set := snapshotCellsBySheet[name]
		grid := orig.Sheets[i].Cells
		for r := range grid {
			for c := range grid[r] {
				cell := &grid[r][c]
				if cell.Value.Kind == xlsx.KindEmpty && cell.Formula == "" {
					continue
				}
				if _, kept := set[int64(r+1)<<32|int64(c+1)]; kept {
					continue
				}
				sh.ClearCell(r+1, c+1)
			}
		}
	}

	// snap.Cells is sorted by sheet (then row/col) above, so the sheet
	// handle is resolved once per run of same-sheet cells rather than
	// per cell.
	var curSheetName string
	var curSheet *xlsx.SheetEdit
	for _, cell := range snap.Cells {
		sheetName, ok := sheetNameByID[cell.SheetID]
		if !ok {
			// Snapshot referred to a sheet id we never registered.
			// Skip rather than fail — better to write the rest than
			// reject the whole save over an orphan cell.
			continue
		}
		if cell.Row <= 0 || cell.Col <= 0 {
			continue
		}
		if curSheet == nil || sheetName != curSheetName {
			sh, err := f.Sheet(sheetName)
			if err != nil {
				return nil, fmt.Errorf("sheet %q: %w", sheetName, err)
			}
			curSheetName, curSheet = sheetName, sh
		}
		sh := curSheet
		if cell.Formula != "" {
			// Atomic formula + cached value: the cached scalar's kind
			// selects the cell type (KindEmpty writes no cache). Go
			// still never evaluates — cached values come from
			// HyperFormula via the snapshot.
			if err := sh.SetFormula(cell.Row, cell.Col, cell.Formula, formulaCachedValue(cell)); err != nil {
				return nil, fmt.Errorf("set formula at %s!%s: %w", sheetName, xlsx.CellRef(cell.Row, cell.Col), err)
			}
		} else if err := writeSnapshotCellValue(sh, cell); err != nil {
			return nil, fmt.Errorf("set value at %s!%s: %w", sheetName, xlsx.CellRef(cell.Row, cell.Col), err)
		}
		if cell.Style != nil {
			if err := sh.PatchCellStyle(cell.Row, cell.Col, cellStyleToPatch(cell.Style)); err != nil {
				return nil, fmt.Errorf("apply style at %s!%s: %w", sheetName, xlsx.CellRef(cell.Row, cell.Col), err)
			}
		}
	}

	if len(comments) > 0 {
		if err := applyCommentsToFile(f, comments, sheetNameByID); err != nil {
			return nil, fmt.Errorf("apply comments: %w", err)
		}
	}

	// Replace conditional-formatting rules wholesale per sheet. Done
	// after the per-cell writes (styles minted here land after cell
	// styles) and before pivots.
	for _, meta := range snap.Sheets {
		if len(meta.ConditionalFormats) == 0 {
			continue
		}
		name, ok := sheetNameByID[meta.ID]
		if !ok {
			continue
		}
		sh, err := f.Sheet(name)
		if err != nil {
			return nil, fmt.Errorf("sheet %q: %w", name, err)
		}
		if err := writeConditionalFormats(sh, meta.ConditionalFormats); err != nil {
			return nil, fmt.Errorf("write conditional formats on %s: %w", name, err)
		}
	}

	// Emit pivots last so all cells and sheets the pivot defs reference
	// (both source ranges and target sheets) are present in the workbook
	// by the time AddPivotTable reads header names off the source cells.
	writePivots(f, snap.Pivots)

	out, err := f.Save()
	if err != nil {
		return nil, fmt.Errorf("write workbook: %w", err)
	}
	return out, nil
}

// applySheetMeta writes one sheet's snapshot metadata onto its editor
// handle. origSheet is the same sheet's read model from the original
// bytes (nil for sheets appended by this save) — it supplies the
// existing-customization sets the snapshot-is-authoritative clears
// diff against, bounded to what's actually customized on disk so a
// no-op save touches nothing it doesn't have to.
//
// Row heights / col widths / row styles follow the tri-state sparse-map
// contract (see SheetMeta): nil ⇒ preserve on-disk values (legacy
// bootstraps); non-nil ⇒ clear any on-disk customization not in the
// map, then write the map entries. The existing sets reuse the SAME
// default-height/width filters the bootstrap seeding applies
// (readRowHeights / readColWidths), so the clear pass exactly covers
// the set a bootstrap would have seeded — producer-stamped default
// heights are neither seeded nor cleared. Clearing is a true unset
// (ClearRowHeight / ClearColWidth remove the attribute / <col> entry),
// unlike the excelize-era writer which wrote the default value back.
//
// px==0 is a deliberate value (snap-to-hide), not an absence: the TS
// side's HIDE_SNAP_THRESHOLD rounds small drag sizes to 0 so a
// zero-height row / zero-width column reads as hidden. px<0 is an
// out-of-band sentinel and is skipped.
func applySheetMeta(sh *xlsx.SheetEdit, meta SheetMeta, origSheet *xlsx.Sheet) error {
	existingDim, hasDim := sh.Dimension()

	if meta.RowCount > 0 && meta.ColCount > 0 {
		// Union with the workbook's existing <dimension>: the Y.Doc
		// may track a narrower extent than the imported file actually
		// contains (e.g. when bootstrap sees only a scrolled-into
		// region), and a contracting save would silently hide rows
		// past meta.RowCount from readers that trust <dimension>.
		// Always grow, never shrink.
		finalRow, finalCol := meta.RowCount, meta.ColCount
		if hasDim {
			finalRow = max(finalRow, existingDim.EndRow)
			finalCol = max(finalCol, existingDim.EndCol)
		}
		sh.SetDimension(xlsx.Range{StartRow: 1, StartCol: 1, EndRow: finalRow, EndCol: finalCol})
	}

	// All sparse-map passes below iterate in sorted key order: Go map
	// iteration is randomized, and the editor appends elements (e.g.
	// <col> entries) in call order, so unsorted walks would make every
	// save of the same doc state produce different bytes.
	if meta.RowHeights != nil {
		var existing map[int]int
		if origSheet != nil {
			existing = readRowHeights(origSheet)
		}
		for _, row := range sortedIntKeys(existing) {
			if _, kept := meta.RowHeights[row]; !kept {
				sh.ClearRowHeight(row)
			}
		}
		for _, row := range sortedIntKeys(meta.RowHeights) {
			px := meta.RowHeights[row]
			if row < 1 || px < 0 {
				continue
			}
			sh.SetRowHeight(row, pxToExcelPoints(px))
		}
	}

	if meta.ColWidths != nil {
		var existing map[int]int
		if origSheet != nil {
			// Bound the existing-custom scan to the union of the
			// snapshot's tracked extent and the on-disk <dimension>
			// column extent, mirroring the excelize-era walk: blanket
			// <col> ranges spanning thousands of trailing columns
			// beyond the used range represent no real edit.
			maxCol := meta.ColCount
			if hasDim && existingDim.EndCol > maxCol {
				maxCol = existingDim.EndCol
			}
			existing = readColWidths(origSheet, maxCol)
		}
		for _, col := range sortedIntKeys(existing) {
			if _, kept := meta.ColWidths[col]; !kept {
				sh.ClearColWidth(col)
			}
		}
		for _, col := range sortedIntKeys(meta.ColWidths) {
			px := meta.ColWidths[col]
			if col < 1 || px < 0 {
				continue
			}
			sh.SetColWidth(col, pxToExcelCharWidth(px))
		}
	}

	// Merges replace wholesale — the snapshot is authoritative, so the
	// set it carries (1×1 and degenerate entries dropped) IS the
	// sheet's merge list.
	merges := make([]xlsx.Range, 0, len(meta.Merges))
	for _, m := range meta.Merges {
		if m.RowSpan < 1 || m.ColSpan < 1 {
			continue
		}
		if m.RowSpan == 1 && m.ColSpan == 1 {
			continue
		}
		merges = append(merges, xlsx.Range{
			StartRow: m.AnchorRow,
			StartCol: m.AnchorCol,
			EndRow:   m.AnchorRow + m.RowSpan - 1,
			EndCol:   m.AnchorCol + m.ColSpan - 1,
		})
	}
	// Anchor order for the emitted <mergeCells> list — the snapshot
	// decodes merges from a Y.Map, so slice order is randomized.
	sort.Slice(merges, func(i, j int) bool {
		if merges[i].StartRow != merges[j].StartRow {
			return merges[i].StartRow < merges[j].StartRow
		}
		return merges[i].StartCol < merges[j].StartCol
	})
	sh.SetMerges(merges)

	// Freeze panes: (0, 0) removes the pane, so an unfreeze on the doc
	// round-trips back to a freeze-less xlsx. The editor derives
	// topLeftCell/activePane itself.
	sh.SetFrozen(max(meta.FrozenRows, 0), max(meta.FrozenCols, 0))

	// Row styles follow the same tri-state contract. The existing set
	// is every row carrying a row-level style on disk (customFormat),
	// modeled or not — a row style the doc doesn't track is cleared,
	// matching the excelize-era behavior. Per-cell styles layer on top
	// in Excel's render model, so the row-level clear doesn't affect
	// individual cells' own styles applied in the cells pass.
	if meta.RowStyles != nil {
		if origSheet != nil {
			for _, row := range sortedIntKeys(origSheet.RowStyles) {
				if _, kept := meta.RowStyles[row+1]; !kept {
					sh.ClearRowStyle(row + 1)
				}
			}
		}
		for _, row := range sortedIntKeys(meta.RowStyles) {
			style := meta.RowStyles[row]
			if row < 1 || style == nil {
				continue
			}
			if err := sh.SetRowStyle(row, cellStyleToStyle(style)); err != nil {
				return fmt.Errorf("set row style on row %d: %w", row, err)
			}
		}
	}

	// Tab color: the Y.Doc is authoritative once a workbook has been
	// bootstrapped (BootstrapYDocFromWorkbook seeds the imported xlsx's
	// tab color into the doc). Empty Color ⇒ clear any prior tab color
	// so a user-side unset round-trips; non-empty ⇒ stamp the bare RGB.
	sh.SetTabColor(strings.TrimPrefix(meta.Color, "#"))
	return nil
}

// writeSnapshotCellValue writes a non-formula snapshot cell through the
// typed setter matching its Kind. Matching kind to setter at this
// boundary is what gives the round-trip its type-fidelity.
//
// Empty Kind (legacy doc with no kind tag written) falls back to the
// previous "try int → float → string" coercion of RawString, so
// already-saved workbooks continue to round-trip as they did before.
func writeSnapshotCellValue(sh *xlsx.SheetEdit, c CellEntry) error {
	switch c.Kind {
	case "number":
		if c.RawNumber != nil {
			return sh.SetNumber(c.Row, c.Col, *c.RawNumber)
		}
		// Legacy fallback: kind says number but raw was carried as a
		// string. Promote via the same path the legacy coercer used.
		return writeCoercedString(sh, c.Row, c.Col, c.RawString)
	case "boolean":
		v := c.RawBool != nil && *c.RawBool
		return sh.SetBool(c.Row, c.Col, v)
	case "date":
		// ISO-only on the wire (the TS side never writes anything
		// else). Try full RFC3339 first, then date-only. Unparseable
		// dates round-trip as the literal text rather than fail the
		// whole save.
		if t, err := time.Parse(time.RFC3339, c.RawString); err == nil {
			return sh.SetDate(c.Row, c.Col, t)
		}
		if t, err := time.Parse("2006-01-02", c.RawString); err == nil {
			return sh.SetDate(c.Row, c.Col, t)
		}
		return sh.SetString(c.Row, c.Col, c.RawString)
	case "":
		// Legacy snapshot: no kind tag was written by the producer.
		// Preserve prior behavior by promoting numeric-looking strings.
		val := c.RawString
		if val == "" {
			val = c.Display
		}
		return writeCoercedString(sh, c.Row, c.Col, val)
	default:
		// "string", a formula kind with no source, and any future kind
		// all land as text.
		return sh.SetString(c.Row, c.Col, c.RawString)
	}
}

// writeCoercedString runs the legacy int → float → string coercion and
// dispatches to the matching typed setter.
func writeCoercedString(sh *xlsx.SheetEdit, row, col int, s string) error {
	switch v := legacyCoerceCellValue(s).(type) {
	case int64:
		return sh.SetNumber(row, col, float64(v))
	case float64:
		return sh.SetNumber(row, col, v)
	default:
		return sh.SetString(row, col, s)
	}
}

// excelErrorLiterals is the set of Excel error values a formula's
// cached result can carry. They map to KindError so the file stores a
// proper t="e" cell instead of a look-alike string.
var excelErrorLiterals = map[string]struct{}{
	"#DIV/0!": {},
	"#N/A":    {},
	"#VALUE!": {},
	"#REF!":   {},
	"#NAME?":  {},
	"#NUM!":   {},
	"#NULL!":  {},
}

// formulaCachedValue extracts the kind-aware cached scalar for a
// formula cell. Returns the zero Value (KindEmpty) when the formula has
// no cached value (e.g. a fresh =A1+B1 the user just typed), which
// SetFormula treats as "no cache".
//
// Numeric-looking strings get promoted so the file stores a Number
// cell — that's what keeps "this cell shows 57" durable across the
// round-trip for viewers that don't evaluate.
func formulaCachedValue(c CellEntry) xlsx.Value {
	switch {
	case c.RawNumber != nil:
		return xlsx.Value{Kind: xlsx.KindNumber, F: *c.RawNumber}
	case c.RawBool != nil:
		return xlsx.Value{Kind: xlsx.KindBool, B: *c.RawBool}
	case c.RawString != "":
		return coercedCachedValue(c.RawString)
	case c.Display != "":
		return coercedCachedValue(c.Display)
	}
	return xlsx.Value{}
}

// coercedCachedValue classifies a string-carried cached scalar: Excel
// error literals become KindError, numeric-looking strings KindNumber,
// everything else KindString.
func coercedCachedValue(s string) xlsx.Value {
	if _, ok := excelErrorLiterals[s]; ok {
		return xlsx.Value{Kind: xlsx.KindError, S: s}
	}
	switch v := legacyCoerceCellValue(s).(type) {
	case int64:
		return xlsx.Value{Kind: xlsx.KindNumber, F: float64(v)}
	case float64:
		return xlsx.Value{Kind: xlsx.KindNumber, F: v}
	default:
		return xlsx.Value{Kind: xlsx.KindString, S: s}
	}
}

// legacyCoerceCellValue is the prior pre-typed-cells fallback: try
// int → float → string. Kept around for legacy docs that were
// persisted before the typed-cell schema landed.
func legacyCoerceCellValue(s string) any {
	if s == "" {
		return s
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		return n
	}
	if n, err := strconv.ParseFloat(s, 64); err == nil {
		return n
	}
	return s
}

// sortedIntKeys returns m's keys in ascending order, for deterministic
// iteration over the sparse row/column maps.
func sortedIntKeys[V any](m map[int]V) []int {
	keys := make([]int, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	return keys
}

// pxToExcelPoints converts a CSS pixel value (the unit calc stores
// in the Y.Doc) to Excel row-height points. 96 px / inch on screen,
// 72 pt / inch in OOXML, so the ratio is 0.75.
func pxToExcelPoints(px int) float64 {
	return float64(px) * 0.75
}

// pxToExcelCharWidth converts a pixel value to Excel column-width
// "character" units. The standard XLSX formula (mirroring Excel's
// own UI math) is:
//
//	chars = (px - 5) / 7    when px > 12
//	chars = px / 12         otherwise
//
// 7 is the average glyph width of the default 11pt Calibri; the 5px
// constant is the column padding Excel reserves for cell gridlines.
func pxToExcelCharWidth(px int) float64 {
	if px <= 0 {
		return 0
	}
	if px > 12 {
		return float64(px-5) / 7.0
	}
	return float64(px) / 12.0
}

// readDriveItemBytes returns the current `file` blob attached to
// item. Returns (nil, nil) if no file is attached — callers that
// need a non-empty XLSX should check.
func readDriveItemBytes(app core.App, item *core.Record) ([]byte, error) {
	filename := item.GetString("file")
	if filename == "" {
		return nil, nil
	}

	fsys, err := app.NewFilesystem()
	if err != nil {
		return nil, fmt.Errorf("open filesystem: %w", err)
	}
	defer fsys.Close()

	key := item.BaseFilesPath() + "/" + filename
	rdr, err := fsys.GetReader(key)
	if err != nil {
		return nil, fmt.Errorf("get reader for %s: %w", key, err)
	}
	defer rdr.Close()

	return io.ReadAll(rdr)
}
