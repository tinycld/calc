package calc

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase"

	"tinycld.org/core/realtime"
)

// TestRegisterRealtimeRegisters confirms registerRealtime plugs the
// "calc" kind into the core realtime registry, and that the
// registered closure rejects nil auth without touching the DB.
//
// The share-grant / share-denied paths require a real PocketBase test
// app with drive_items + drive_shares + user_org schemas populated —
// that integration coverage is owned by the end-to-end Playwright spec
// (phase 9 of the plan).
func TestRegisterRealtimeRegisters(t *testing.T) {
	t.Cleanup(realtime.ResetRegistryForTest)

	app := pocketbase.New()
	registerRealtime(app)

	authorize := realtime.LookupForTest("calc")
	if authorize == nil {
		t.Fatal("registerRealtime did not register the 'calc' room kind")
	}

	if err := authorize(nil, "any-drive-item-id"); !errors.Is(err, errNoShare) {
		t.Fatalf("nil auth: expected errNoShare, got %v", err)
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

// TestMemberCanWrite_GrantsEditorInOrg is the positive-control: a user
// with an editor share row whose user_org is in the same org as the
// item must be granted write access. Mirrors text's
// TestAuthorize_GrantsEditor pattern.
func TestMemberCanWrite_GrantsEditorInOrg(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")
	item := seedDriveItemInOrg(t, app, "org-acme", "book.xlsx")
	userOrgID := seedUserOrg(t, app, user.Id, "org-acme")
	seedShare(t, app, item.Id, userOrgID, "editor")

	if !memberCanWrite(app, user.Id, item.Id) {
		t.Errorf("editor share in matching org: want true, got false")
	}
}

// TestMemberCanWrite_DeniesCrossOrgShare is the stale-cross-org
// regression test for memberCanWrite. The user had a user_org in org-acme
// and an editor share on item X when X belonged to org-acme. After X is
// reassigned to org-bravo, the old share row must NOT grant write
// access — without the user_org.org = item.org constraint, the filter
// would silently return the stale row and falsely grant edit.
func TestMemberCanWrite_DeniesCrossOrgShare(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")
	// Item now belongs to org-bravo (e.g. moved/reassigned).
	item := seedDriveItemInOrg(t, app, "org-bravo", "book.xlsx")
	// User's user_org is still bound to org-acme (stale membership).
	staleUserOrgID := seedUserOrg(t, app, user.Id, "org-acme")
	seedShare(t, app, item.Id, staleUserOrgID, "editor")

	if memberCanWrite(app, user.Id, item.Id) {
		t.Errorf("cross-org stale share: want false, got true")
	}
}

// TestMemberCanWrite_DeniesViewer confirms viewer-role shares do not
// grant write even when the org check passes. Belt-and-suspenders for
// the role gate that runs after the org filter.
func TestMemberCanWrite_DeniesViewer(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")
	item := seedDriveItemInOrg(t, app, "org-acme", "book.xlsx")
	userOrgID := seedUserOrg(t, app, user.Id, "org-acme")
	seedShare(t, app, item.Id, userOrgID, "viewer")

	if memberCanWrite(app, user.Id, item.Id) {
		t.Errorf("viewer share: want false, got true")
	}
}

// TestCheckDriveItemAccess_GrantsInOrg is the positive-control for
// checkDriveItemAccess: a share row whose user_org is in the same org
// as the item grants admission (no error).
func TestCheckDriveItemAccess_GrantsInOrg(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")
	item := seedDriveItemInOrg(t, app, "org-acme", "book.xlsx")
	userOrgID := seedUserOrg(t, app, user.Id, "org-acme")
	seedShare(t, app, item.Id, userOrgID, "viewer")

	if err := checkDriveItemAccess(app, user.Id, item.Id); err != nil {
		t.Errorf("matching org share: want nil, got %v", err)
	}
}

// TestCheckDriveItemAccess_DeniesCrossOrgShare is the stale-cross-org
// regression test for checkDriveItemAccess. Same scenario as the
// memberCanWrite cross-org case: stale user_org in org-acme, item now
// in org-bravo — admission must be denied with errNoShare.
func TestCheckDriveItemAccess_DeniesCrossOrgShare(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")
	item := seedDriveItemInOrg(t, app, "org-bravo", "book.xlsx")
	staleUserOrgID := seedUserOrg(t, app, user.Id, "org-acme")
	seedShare(t, app, item.Id, staleUserOrgID, "editor")

	err := checkDriveItemAccess(app, user.Id, item.Id)
	if !errors.Is(err, errNoShare) {
		t.Errorf("cross-org stale share: want errNoShare, got %v", err)
	}
}

// TestCheckDriveItemAccess_DeniesNonExistentItem confirms that a
// request for a drive_item that doesn't exist is denied with errNoShare
// (not a raw DB error). Mirrors text's behavior — fail closed for
// unknown items.
func TestCheckDriveItemAccess_DeniesNonExistentItem(t *testing.T) {
	app := setupAuthTestApp(t)
	user := mustCreateUser(t, app, "alice@example.com")

	err := checkDriveItemAccess(app, user.Id, "nonexistent-item-id")
	if !errors.Is(err, errNoShare) {
		t.Errorf("nonexistent item: want errNoShare, got %v", err)
	}
}
