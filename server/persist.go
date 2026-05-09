package calc

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"strconv"

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
// because XLSX is calc-specific).
func SaveRoom(app core.App, handle realtime.DocHandle, driveItemID string) error {
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

	updatedBytes, err := serializeSnapshotToXLSX(originalBytes, snap)
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
//
// Returns an error rather than empty bytes on any sheet/cell write
// failure; the caller treats both alike.
func serializeSnapshotToXLSX(originalBytes []byte, snap YDocSnapshot) ([]byte, error) {
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
			val := cell.Raw
			if val == "" {
				val = cell.Display
			}
			if val != "" {
				if err := f.SetCellValue(sheetName, ref, coerceCellValue(val)); err != nil {
					return nil, fmt.Errorf("seed formula result at %s!%s: %w", sheetName, ref, err)
				}
			}
			if err := f.SetCellFormula(sheetName, ref, cell.Formula); err != nil {
				return nil, fmt.Errorf("set formula at %s!%s: %w", sheetName, ref, err)
			}
			continue
		}
		val := cell.Raw
		if val == "" {
			val = cell.Display
		}
		if err := f.SetCellValue(sheetName, ref, coerceCellValue(val)); err != nil {
			return nil, fmt.Errorf("set value at %s!%s: %w", sheetName, ref, err)
		}
	}

	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, fmt.Errorf("write workbook: %w", err)
	}
	return buf.Bytes(), nil
}

// coerceCellValue takes the snapshot's stringly-typed Raw/Display
// value and promotes numeric strings to actual numbers so excelize
// stores them as numeric cells (matching what the original parser
// produced from the workbook). Non-numeric strings stay strings.
func coerceCellValue(s string) any {
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
