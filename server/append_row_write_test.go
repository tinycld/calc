package calc

import (
	"context"
	"sync"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"

	"tinycld.org/core/automation"
	"tinycld.org/core/realtime"
)

func storedSheet(t *testing.T, app *tests.TestApp, itemID string) WorksheetModel {
	t.Helper()
	item, err := app.FindRecordById(driveItemsCollection, itemID)
	if err != nil {
		t.Fatal(err)
	}
	b, err := readDriveItemBytes(app, item)
	if err != nil {
		t.Fatal(err)
	}
	m, err := ReadWorkbookFromXLSX(context.Background(), b, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	return m.Sheets[0]
}

// addCommentsCollection adds the calc_comments rows the production save
// reads, so the room's own flush and AppendRow's save can run here.
func addCommentsCollection(t *testing.T, app *tests.TestApp) {
	t.Helper()
	col := core.NewBaseCollection("calc_comments")
	col.Fields.Add(&core.TextField{Name: "drive_item"})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	if err := app.Save(col); err != nil {
		t.Fatal(err)
	}
}

func appendRowApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app := setupPersistTestApp(t)
	addCheckpointCollection(t, app)
	addCommentsCollection(t, app)
	registerRealtime(app)
	return app
}

func rowOf(label, value string) []automation.RowValue {
	return []automation.RowValue{{Label: label, Type: "text", Value: value}}
}

func TestAppendRowToAClosedWorkbookWritesTheFile(t *testing.T) {
	app := appendRowApp(t)
	itemID := seedDriveItem(t, app, "closed.xlsx", blankXLSX)

	if err := AppendRow(context.Background(), app, itemID, "", rowOf("Name", "Ada")); err != nil {
		t.Fatal(err)
	}
	if err := AppendRow(context.Background(), app, itemID, "", rowOf("Name", "Bo")); err != nil {
		t.Fatal(err)
	}
	s := storedSheet(t, app, itemID)
	if s.Cells["1:1"].Display != "Name" || s.Cells["2:1"].Display != "Ada" || s.Cells["3:1"].Display != "Bo" {
		t.Fatalf("stored cells: %+v", s.Cells)
	}
}

func TestTwoAppendsAtOnceKeepBothRows(t *testing.T) {
	app := appendRowApp(t)
	itemID := seedDriveItem(t, app, "race.xlsx", blankXLSX)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, v := range []string{"one", "two"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs[i] = AppendRow(context.Background(), app, itemID, "", rowOf("Name", v))
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	s := storedSheet(t, app, itemID)
	got := map[string]bool{s.Cells["2:1"].Display: true, s.Cells["3:1"].Display: true}
	if !got["one"] || !got["two"] {
		t.Fatalf("both rows are kept: %+v", s.Cells)
	}
}

func TestAppendRowToAnOpenWorkbookReachesTheLiveDocAndTheFile(t *testing.T) {
	app := appendRowApp(t)
	itemID := seedDriveItem(t, app, "open.xlsx", blankXLSX)
	leave := realtime.JoinItemForTest(app, roomKindCalc, itemID)

	if err := AppendRow(context.Background(), app, itemID, "", rowOf("Name", "Live")); err != nil {
		t.Fatal(err)
	}
	var live string
	if _, err := runtimeKey.Get(app).withOpenRoom(itemID, func(h *sheetsDocHandle, _ *realtime.Room) error {
		snap, err := h.Snapshot()
		c, _ := findSnapshotCell(snap, "sheet1", 2, 1)
		live = c.Display
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if live != "Live" {
		t.Fatalf("the live doc has the row, got %q", live)
	}

	// The last editor leaves at once: the final save carries the row.
	leave()
	if s := storedSheet(t, app, itemID); s.Cells["2:1"].Display != "Live" {
		t.Fatalf("the saved file has the row: %+v", s.Cells)
	}
}

// A run whose context has ended (the engine timed it out) writes nothing:
// the engine records it as failed, and a retry must not add a second row.
func TestAppendRowWithAnEndedContextWritesNothing(t *testing.T) {
	app := appendRowApp(t)
	itemID := seedDriveItem(t, app, "late.xlsx", blankXLSX)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if err := AppendRow(ctx, app, itemID, "", rowOf("Name", "Late")); err == nil {
		t.Fatal("an ended context fails the append")
	}
	if s := storedSheet(t, app, itemID); len(s.Cells) != 0 {
		t.Fatalf("nothing is written: %+v", s.Cells)
	}

	leave := realtime.JoinItemForTest(app, roomKindCalc, itemID)
	defer leave()
	if err := AppendRow(ctx, app, itemID, "", rowOf("Name", "Late")); err == nil {
		t.Fatal("an ended context fails the append to an open workbook")
	}
	var live string
	if _, err := runtimeKey.Get(app).withOpenRoom(itemID, func(h *sheetsDocHandle, _ *realtime.Room) error {
		snap, err := h.Snapshot()
		c, _ := findSnapshotCell(snap, "sheet1", 1, 1)
		live = c.Display
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if live != "" {
		t.Fatalf("the live doc is unchanged, got %q", live)
	}
}

// A run that waits for another append to the same workbook gives up when
// its context ends, rather than writing after the engine stopped waiting.
func TestAppendRowWaitingForTheLockGivesUpWithItsContext(t *testing.T) {
	app := appendRowApp(t)
	itemID := seedDriveItem(t, app, "busy.xlsx", blankXLSX)
	release, err := acquireAppendLock(context.Background(), app, itemID)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- AppendRow(ctx, app, itemID, "", rowOf("Name", "Waiting")) }()
	cancel()
	if err := <-done; err == nil {
		t.Fatal("the waiting append fails when its context ends")
	}
}
