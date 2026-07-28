package calc

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase"

	"tinycld.org/core/driveshare"
	"tinycld.org/core/realtime"
)

// TestRegisterRealtimeRegisters confirms registerRealtime plugs the
// "calc" kind into the core realtime registry, and that the
// registered closure rejects nil auth without touching the DB.
//
// The share-grant / share-denied paths are covered by core/driveshare's
// unit tests plus the end-to-end Playwright spec.
func TestRegisterRealtimeRegisters(t *testing.T) {
	t.Cleanup(realtime.ResetRegistryForTest)

	app := pocketbase.New()
	registerRealtime(app)

	authorize := realtime.LookupForTest("calc")
	if authorize == nil {
		t.Fatal("registerRealtime did not register the 'calc' room kind")
	}

	if err := authorize(nil, "any-drive-item-id"); !errors.Is(err, driveshare.ErrNoAccess) {
		t.Fatalf("nil auth: expected ErrNoAccess, got %v", err)
	}
}

// TestRegisterRealtimeDuplicatePanics confirms calling registerRealtime
// twice surfaces as a panic from realtime.RegisterRoomKind. This
// guards against accidental double-init at startup.
func TestRegisterRealtimeDuplicatePanics(t *testing.T) {
	t.Cleanup(realtime.ResetRegistryForTest)

	app := pocketbase.New()
	registerRealtime(app)

	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on duplicate RegisterRoomKind")
		}
	}()
	registerRealtime(app)
}

// The share-authorization predicates these tests used to cover
// (memberCanWrite / checkDriveItemAccess) now live in core/driveshare
// and are unit-tested there against the full role matrix. The two
// cross-org staleness tests were deleted rather than adapted: single-org
// has no second org for a share to be stale against, and the property
// they guarded — a departed member's grants not surviving — is now
// offboard.OffboardUser's, which has its own tests.

// TestRoomAdmission_DeniesNonExistentItem pins calc's wiring of the core
// predicate: a request for a drive_item that doesn't exist is denied
// (not surfaced as a raw DB error). Fail closed for unknown items.
func TestRoomAdmission_DeniesNonExistentItem(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")

	err := driveshare.CheckRead(app, user.Id, "nonexistent-item-id")
	if !errors.Is(err, driveshare.ErrNoAccess) {
		t.Errorf("nonexistent item: want ErrNoAccess, got %v", err)
	}
}
