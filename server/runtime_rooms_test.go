package calc

import (
	"testing"

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
