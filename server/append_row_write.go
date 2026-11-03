package calc

import (
	"context"
	"fmt"
	"sync"

	"github.com/pocketbase/pocketbase/core"
	ycrdt "github.com/skyterra/y-crdt"

	"tinycld.org/core/appstate"
	"tinycld.org/core/automation"
	"tinycld.org/core/realtime"
)

// appendLocksKey holds one lock per workbook, so two rows for one workbook
// never read the same last row. A lock is a one-slot channel rather than a
// mutex, so a run can stop waiting for it when its context ends.
var appendLocksKey = appstate.NewKey[*sync.Map]("calc.appendLocks")

// acquireAppendLock takes itemID's append lock, or fails when ctx ends
// first. The caller runs the returned release when its write is done.
func acquireAppendLock(ctx context.Context, app core.App, itemID string) (func(), error) {
	locks := appendLocksKey.GetOrInit(app, func() *sync.Map { return &sync.Map{} })
	slot, _ := locks.LoadOrStore(itemID, make(chan struct{}, 1))
	lock := slot.(chan struct{})
	select {
	case lock <- struct{}{}:
		return func() { <-lock }, nil
	case <-ctx.Done():
		return nil, fmt.Errorf("calc: wait to add a row to %s: %w", itemID, ctx.Err())
	}
}

// AppendRow adds one row to a workbook. An open workbook gets it in its live
// doc, so editors see it arrive, and the room's save schedule writes it. A
// closed one is changed in its stored file, inside realtime.WriteItem so no
// editor can join half way.
//
// Nothing is written once ctx has ended: the engine has then recorded the
// run as failed, and a retry of it must not add a second row.
func AppendRow(ctx context.Context, app core.App, itemID, sheetName string, values []automation.RowValue) error {
	release, err := acquireAppendLock(ctx, app, itemID)
	if err != nil {
		return err
	}
	defer release()

	if rt := runtimeKey.Get(app); rt != nil {
		open, err := rt.withOpenRoom(itemID, func(h *sheetsDocHandle, room *realtime.Room) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			return appendToLiveDoc(h, room, sheetName, values)
		})
		if open {
			return err
		}
	}
	return realtime.WriteItem(app, itemID, func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		return appendToStoredFile(ctx, app, itemID, sheetName, values)
	})
}

// appendToLiveDoc writes the row and publishes only the change, not the
// whole workbook, to the room's editors.
func appendToLiveDoc(h *sheetsDocHandle, room *realtime.Room, sheetName string, values []automation.RowValue) error {
	var update []byte
	err := h.withDoc(func(doc *ycrdt.Doc) error {
		before := ycrdt.EncodeStateVector(doc, nil, ycrdt.NewUpdateEncoderV1())
		if _, err := appendRowToDoc(doc, sheetName, values); err != nil {
			return err
		}
		update = ycrdt.EncodeStateAsUpdate(doc, before)
		return nil
	})
	if err != nil {
		return err
	}
	return room.PublishDocUpdate(update)
}

// appendToStoredFile seeds a doc from the stored file, as a room open does,
// writes the row, and saves it through the same SaveRoom a room uses.
func appendToStoredFile(ctx context.Context, app core.App, itemID, sheetName string, values []automation.RowValue) error {
	item, err := app.FindRecordById(driveItemsCollection, itemID)
	if err != nil {
		return fmt.Errorf("calc: load workbook %s: %w", itemID, err)
	}
	src, err := readDriveItemBytes(app, item)
	if err != nil {
		return fmt.Errorf("calc: read workbook %s: %w", itemID, err)
	}
	doc := ycrdt.NewDoc(itemID, false, nil, nil, false)
	if len(src) > 0 {
		model, err := ReadWorkbookFromXLSX(ctx, src, 0, 0)
		if err != nil {
			return fmt.Errorf("calc: parse workbook %s: %w", itemID, err)
		}
		if err := BootstrapYDocFromWorkbook(doc, model); err != nil {
			return fmt.Errorf("calc: load workbook %s: %w", itemID, err)
		}
	}
	if _, err := appendRowToDoc(doc, sheetName, values); err != nil {
		return err
	}
	// A handle the runtime never registered: SaveRoom only reads it.
	h := &sheetsDocHandle{id: itemID, doc: doc}
	if err := ctx.Err(); err != nil {
		return err
	}
	return SaveRoom(ctx, app, h, itemID, MakeProductionLoadComments(app))
}
