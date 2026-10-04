package calc

import (
	"context"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	ycrdt "github.com/skyterra/y-crdt"

	"tinycld.org/core/realtime"
)

// addCheckpointCollection extends the test app's schema with the
// realtime_doc_checkpoints collection so the production store can write
// against the test app. Mirrors core's migration.
func addCheckpointCollection(t *testing.T, app *tests.TestApp) {
	t.Helper()
	col := core.NewBaseCollection(realtime.CheckpointCollection)
	col.Fields.Add(&core.TextField{Name: "room_kind", Required: true, Max: 64})
	col.Fields.Add(&core.TextField{Name: "room_id", Required: true, Max: 64})
	col.Fields.Add(&core.NumberField{Name: "epoch", Required: true, Min: ptrFloat(1), OnlyInt: true})
	col.Fields.Add(&core.TextField{Name: "fingerprint", Max: 512})
	col.Fields.Add(&core.TextField{Name: "state", Required: true, Max: 40_000_000})
	col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
	col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_realtime_doc_checkpoints_room", true, "room_kind, room_id", "")
	if err := app.Save(col); err != nil {
		t.Fatalf("create %s: %v", realtime.CheckpointCollection, err)
	}
}

func ptrFloat(v float64) *float64 { return &v }

// Seed runs the xlsx bootstrap on a document NewDoc returned empty.
func TestSeedRunsTheBootstrap(t *testing.T) {
	rt := NewRuntime()
	seeded := 0
	rt.SetBootstrap(func(_ context.Context, roomID string, doc *ycrdt.Doc) error {
		seeded++
		doc.GetMap("sheets")
		return nil
	})
	handle, err := rt.NewDoc("room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })
	if seeded != 0 {
		t.Fatal("NewDoc ran the bootstrap; Seed must")
	}
	if err := rt.Seed(context.Background(), "room", handle); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	if seeded != 1 {
		t.Fatalf("bootstrap ran %d times; want 1", seeded)
	}
}

// The fingerprint is the stored file's name, which every save renews.
func TestFingerprintIsTheStoredFileName(t *testing.T) {
	app := setupPersistTestApp(t)
	itemID := seedDriveItem(t, app, "fp.xlsx", []byte{0x00})
	item, err := app.FindRecordById(driveItemsCollection, itemID)
	if err != nil {
		t.Fatal(err)
	}
	got, err := driveItemFingerprint(app)(itemID)
	if err != nil {
		t.Fatalf("fingerprint: %v", err)
	}
	if got == "" || got != item.GetString("file") {
		t.Fatalf("fingerprint = %q; want the file name %q", got, item.GetString("file"))
	}
	if _, err := driveItemFingerprint(app)("missing"); err == nil {
		t.Fatal("a missing item produced a fingerprint")
	}
}

// Deleting the workbook removes its checkpoint row through the
// production hook.
func TestDeleteDropsTheCheckpointRow(t *testing.T) {
	t.Cleanup(realtime.ResetRegistryForTest)
	app := setupPersistTestApp(t)
	addCheckpointCollection(t, app)
	registerRealtime(app)

	itemID := seedDriveItem(t, app, "ckpt-cleanup.xlsx", []byte{0x00})
	store := realtime.NewPocketBaseCheckpointStore(app)
	if err := store.Save(roomKindCalc, itemID, realtime.Checkpoint{Epoch: 1, Fingerprint: "x", State: []byte{1}}); err != nil {
		t.Fatal(err)
	}
	itemRec, err := app.FindRecordById(driveItemsCollection, itemID)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Delete(itemRec); err != nil {
		t.Fatalf("Delete drive_item: %v", err)
	}
	if _, found, _ := store.Load(roomKindCalc, itemID); found {
		t.Fatal("the checkpoint row survived the drive item's deletion")
	}
}
