package calc

import (
	"testing"
	"time"

	"tinycld.org/core/realtime"
)

func TestOpenRoomIsFoundWhileSomeoneIsInIt(t *testing.T) {
	app := setupPersistTestApp(t)
	addCheckpointCollection(t, app)
	registerRealtime(app)
	itemID := seedDriveItem(t, app, "rooms.xlsx", blankXLSX)

	rt := runtimeKey.Get(app)
	if rt == nil {
		t.Fatal("registerRealtime stores the runtime")
	}
	call := func() bool {
		open, err := rt.withOpenRoom(itemID, func(h *sheetsDocHandle, room *realtime.Room) error {
			if h == nil || room == nil {
				t.Fatal("an open room has a handle and a room")
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		return open
	}
	if call() {
		t.Fatal("no room before anyone joins")
	}
	leave := realtime.JoinItemForTest(app, roomKindCalc, itemID)
	if !call() {
		t.Fatal("the room is open while a client is in it")
	}
	leave()
	if call() {
		t.Fatal("the room is gone after the last client leaves")
	}
	leave = realtime.JoinItemForTest(app, roomKindCalc, itemID)
	defer leave()
	if !call() {
		t.Fatal("a reopened room (from the parked doc) is found again")
	}
}

// A write into one open workbook holds only that workbook: another room can
// open meanwhile. A room opens under the broker's lock, so a write that held
// every room would stall every realtime join on the server.
func TestAWriteIntoOneRoomDoesNotBlockAnotherRoomOpening(t *testing.T) {
	app := setupPersistTestApp(t)
	addCheckpointCollection(t, app)
	registerRealtime(app)
	first := seedDriveItem(t, app, "first.xlsx", blankXLSX)
	second := seedDriveItem(t, app, "second.xlsx", blankXLSX)
	leaveFirst := realtime.JoinItemForTest(app, roomKindCalc, first)
	defer leaveFirst()

	rt := runtimeKey.Get(app)
	writing := make(chan struct{})
	finish := make(chan struct{})
	go func() {
		_, _ = rt.withOpenRoom(first, func(*sheetsDocHandle, *realtime.Room) error {
			close(writing)
			<-finish
			return nil
		})
	}()
	<-writing
	defer close(finish)

	opened := make(chan func())
	go func() { opened <- realtime.JoinItemForTest(app, roomKindCalc, second) }()
	// A deadlock detector, not a wait for a condition: the join either
	// returns at once or never does while the first write is held.
	select {
	case leaveSecond := <-opened:
		leaveSecond()
	case <-time.After(5 * time.Second):
		t.Fatal("another room could not open while one room was being written")
	}
}
