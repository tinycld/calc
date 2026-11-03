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

// appendLocksKey holds one mutex per workbook, so two rows for one workbook
// never read the same last row.
var appendLocksKey = appstate.NewKey[*sync.Map]("calc.appendLocks")

func appendLock(app core.App, itemID string) *sync.Mutex {
	locks := appendLocksKey.GetOrInit(app, func() *sync.Map { return &sync.Map{} })
	m, _ := locks.LoadOrStore(itemID, &sync.Mutex{})
	return m.(*sync.Mutex)
}

// AppendRow adds one row to a workbook. An open workbook gets it in its live
// doc, so editors see it arrive, and the room's save schedule writes it. A
// closed one is changed in its stored file, inside realtime.WriteItem so no
// editor can join half way.
func AppendRow(ctx context.Context, app core.App, itemID, sheetName string, values []automation.RowValue) error {
	lock := appendLock(app, itemID)
	lock.Lock()
	defer lock.Unlock()

	if rt := runtimeKey.Get(app); rt != nil {
		open, err := rt.withOpenRoom(itemID, func(h *sheetsDocHandle, room *realtime.Room) error {
			return appendToLiveDoc(h, room, sheetName, values)
		})
		if open {
			return err
		}
	}
	return realtime.WriteItem(app, itemID, func() error {
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
	return SaveRoom(ctx, app, h, itemID, MakeProductionLoadComments(app))
}
