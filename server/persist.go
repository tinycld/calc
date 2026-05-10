package calc

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"github.com/xuri/excelize/v2"

	"tinycld.org/core/realtime"
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

	if err := app.Save(item); err != nil {
		return fmt.Errorf("calc: save drive_items %s: %w", driveItemID, err)
	}
	return nil
}

// serializeSnapshotToXLSX reads the original .xlsx bytes, applies the
// Y.Doc snapshot's sheet metadata + cell entries on top, and returns
// the rewritten .xlsx bytes.
//
// Behavior:
//   - Sheets are ordered by SheetMeta.Position (the snapshot producer
//     pre-sorts; we use slice index as the position in the output).
//   - Sheets present in the snapshot but not in the original workbook
//     are appended via NewSheet.
//   - Sheets present in the original workbook with a different name in
//     the snapshot are renamed.
//   - For each cell: if Formula is non-empty, write the formula via
//     SetCellFormula; otherwise write the value (Raw, falling back to
//     Display).
//   - Cells in the original workbook that the snapshot has no entry
//     for are left untouched. There is no client-side delete path
//     today, so a missing snapshot entry means "untouched", not
//     "removed".
//   - When comments is non-empty, classic xlsx cell notes are written
//     for each thread via applyCommentsToFile (one-way: app → xlsx).
//     Existing cell notes from external editors are overwritten.
//
// Returns an error rather than empty bytes on any sheet/cell write
// failure; the caller treats both alike.
func serializeSnapshotToXLSX(originalBytes []byte, snap YDocSnapshot, comments []CommentRow) ([]byte, error) {
	if len(originalBytes) == 0 {
		return nil, errors.New("calc: serializeSnapshotToXLSX called with empty original bytes")
	}
	f, err := excelize.OpenReader(bytes.NewReader(originalBytes))
	if err != nil {
		return nil, fmt.Errorf("open xlsx: %w", err)
	}
	defer func() { _ = f.Close() }()

	// existingSheets is the workbook's sheets in their on-disk order;
	// we line them up positionally with the snapshot's sorted slice.
	existingSheets := f.GetSheetList()

	// Map snapshot sheet id → resolved excelize sheet name. New sheets
	// take SheetMeta.Name verbatim; renamed existing sheets take the
	// updated name as well.
	sheetNameByID := make(map[string]string, len(snap.Sheets))
	for i, meta := range snap.Sheets {
		switch {
		case i < len(existingSheets):
			oldName := existingSheets[i]
			if meta.Name != "" && meta.Name != oldName {
				if err := f.SetSheetName(oldName, meta.Name); err != nil {
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
			if _, err := f.NewSheet(name); err != nil {
				return nil, fmt.Errorf("add sheet %q: %w", name, err)
			}
			sheetNameByID[meta.ID] = name
		}
	}

	// Second pass: now that every sheet has its final name, write
	// dimensions for any sheet whose snapshot carries non-zero counts.
	// Sheets with rowCount==0 / colCount==0 are left at the workbook's
	// existing <dimension> — that mirrors the "absence means untracked"
	// convention the cell loop also follows.
	for _, meta := range snap.Sheets {
		if meta.RowCount <= 0 || meta.ColCount <= 0 {
			continue
		}
		name, ok := sheetNameByID[meta.ID]
		if !ok {
			continue
		}
		bottomRight, err := excelize.CoordinatesToCellName(meta.ColCount, meta.RowCount)
		if err != nil {
			return nil, fmt.Errorf("dimension coords (%d,%d): %w", meta.ColCount, meta.RowCount, err)
		}
		if err := f.SetSheetDimension(name, "A1:"+bottomRight); err != nil {
			return nil, fmt.Errorf("set dimension on %s: %w", name, err)
		}
	}

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
		ref, err := excelize.CoordinatesToCellName(cell.Col, cell.Row)
		if err != nil {
			return nil, fmt.Errorf("cell coords (%d,%d): %w", cell.Col, cell.Row, err)
		}
		if cell.Formula != "" {
			// Seed the cached value first so non-evaluating readers see
			// something; SetCellFormula attaches the formula on top
			// without clearing it. Calling SetCellValue *after*
			// SetCellFormula would erase the formula.
			if cached, ok := formulaCachedValue(cell); ok {
				if err := f.SetCellValue(sheetName, ref, cached); err != nil {
					return nil, fmt.Errorf("seed formula result at %s!%s: %w", sheetName, ref, err)
				}
			}
			if err := f.SetCellFormula(sheetName, ref, cell.Formula); err != nil {
				return nil, fmt.Errorf("set formula at %s!%s: %w", sheetName, ref, err)
			}
		} else {
			if err := f.SetCellValue(sheetName, ref, cellValueForExcelize(cell)); err != nil {
				return nil, fmt.Errorf("set value at %s!%s: %w", sheetName, ref, err)
			}
		}
		if cell.Style != nil {
			if err := applyCellStyle(f, sheetName, ref, cell.Style); err != nil {
				return nil, fmt.Errorf("apply style at %s!%s: %w", sheetName, ref, err)
			}
		}
	}

	if len(comments) > 0 {
		if err := applyCommentsToFile(f, comments, sheetNameByID); err != nil {
			return nil, fmt.Errorf("apply comments: %w", err)
		}
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, fmt.Errorf("write workbook: %w", err)
	}
	return buf.Bytes(), nil
}

// applyCellStyle overlays a partial CellStyle onto the cell's existing
// excelize style and writes the result back via NewStyle/SetCellStyle.
//
// "Existing" matters: the original .xlsx may already have a style on
// this cell (a fill color, a number format, a font size). Reading it
// first and overlaying only the snapshot's non-nil leaves preserves
// every attribute the doc didn't track.
func applyCellStyle(f *excelize.File, sheet, ref string, patch *CellStyle) error {
	if patch == nil {
		return nil
	}
	styleID, err := f.GetCellStyle(sheet, ref)
	if err != nil {
		return fmt.Errorf("get existing style: %w", err)
	}
	base := &excelize.Style{}
	if styleID != 0 {
		got, err := f.GetStyle(styleID)
		if err != nil {
			return fmt.Errorf("read style %d: %w", styleID, err)
		}
		if got != nil {
			base = got
		}
	}
	overlayStyle(base, patch)
	newID, err := f.NewStyle(base)
	if err != nil {
		return fmt.Errorf("register style: %w", err)
	}
	if err := f.SetCellStyle(sheet, ref, ref, newID); err != nil {
		return fmt.Errorf("apply style: %w", err)
	}
	return nil
}

// cellValueForExcelize picks the right Go value to hand to
// excelize.SetCellValue based on the cell's Kind. excelize dispatches
// internally on the value's reflect type — a Go int64/float64 lands
// as a numeric cell, a bool as a boolean cell, a time.Time as a date
// cell, and a string as a text cell. Matching kind to type at this
// boundary is what gives the round-trip its type-fidelity.
//
// Empty Kind (legacy doc with no kind tag written) falls back to the
// previous "try int → float → string" coercion of RawString, so
// already-saved workbooks continue to round-trip as they did before.
func cellValueForExcelize(c CellEntry) any {
	switch c.Kind {
	case "number":
		if c.RawNumber == nil {
			// Legacy fallback: kind says number but raw was carried
			// as a string. Promote via the same path the legacy
			// coercer used.
			return legacyCoerceCellValue(c.RawString)
		}
		n := *c.RawNumber
		// Excel stores integers as floats with no fractional part;
		// surfacing them as int64 to excelize keeps the on-disk
		// representation tidy (no trailing .0 in raw XML). The 2^53
		// guard avoids precision loss for large floats that Go can't
		// round-trip through int64 cleanly.
		if !math.IsNaN(n) && !math.IsInf(n, 0) && n == math.Trunc(n) && math.Abs(n) < (1<<53) {
			return int64(n)
		}
		return n
	case "boolean":
		if c.RawBool == nil {
			return false
		}
		return *c.RawBool
	case "date":
		// ISO-only on the wire (the TS side never writes anything
		// else). Try full RFC3339 first, then date-only.
		if t, err := time.Parse(time.RFC3339, c.RawString); err == nil {
			return t
		}
		if t, err := time.Parse("2006-01-02", c.RawString); err == nil {
			return t
		}
		// Unparseable date — round-trip as the literal text rather
		// than fail the whole save.
		return c.RawString
	case "string":
		return c.RawString
	case "formula":
		// Reached when called from the formula cache path; just
		// surface the cached scalar.
		return c.RawString
	case "":
		// Legacy snapshot: no kind tag was written by the producer.
		// Preserve prior behavior by promoting numeric-looking
		// strings.
		val := c.RawString
		if val == "" {
			val = c.Display
		}
		return legacyCoerceCellValue(val)
	}
	return c.RawString
}

// formulaCachedValue extracts the kind-aware cached scalar for a
// formula cell, if one is present. Returns ok=false when the formula
// has no cached value (e.g. a fresh =A1+B1 the user just typed) so the
// caller can skip the SetCellValue seed.
//
// excelize semantics: when SetCellValue sees a numeric Go type, it
// stores both the number and the cell type as Number; setting the
// same cell to a string-of-digits stores it as an inline string and
// excelize will recompute the formula's result. So promoting numeric
// cached values up front is what keeps "this cell shows 57" durable
// across the round-trip.
func formulaCachedValue(c CellEntry) (any, bool) {
	switch {
	case c.RawNumber != nil:
		v := *c.RawNumber
		if !math.IsNaN(v) && !math.IsInf(v, 0) && v == math.Trunc(v) && math.Abs(v) < (1<<53) {
			return int64(v), true
		}
		return v, true
	case c.RawBool != nil:
		return *c.RawBool, true
	case c.RawString != "":
		// Numeric-looking strings get promoted so excelize stores
		// them as Number cells; non-numeric strings round-trip as
		// strings.
		return legacyCoerceCellValue(c.RawString), true
	case c.Display != "":
		return legacyCoerceCellValue(c.Display), true
	}
	return nil, false
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
