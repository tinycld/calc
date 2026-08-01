package calc

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// tinyXlsxPath points at the user-curated fixture under
// calc/tests/assets. It's read with os.ReadFile (not go:embed)
// because go:embed paths cannot escape the containing package.
const tinyXlsxPath = "../tests/assets/tiny.xlsx"

// setupAuthTestApp creates a tests.TestApp with the minimal drive_items
// and drive_shares collections needed by authorize tests. Single-org:
// drive_shares.user points straight at the users auth collection, so
// there is no junction to synthesize.
// Mirrors text/server/fixtures_test.go::setupAuthTestApp.
func setupAuthTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("tests.NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users collection: %v", err)
	}

	items := core.NewBaseCollection(driveItemsCollection)
	items.Fields.Add(&core.TextField{Name: "name"})
	items.Fields.Add(&core.NumberField{Name: "size"})
	items.Fields.Add(&core.RelationField{
		Name:         "created_by",
		CollectionId: users.Id,
		MaxSelect:    1,
	})
	if err := app.Save(items); err != nil {
		t.Fatalf("save drive_items collection: %v", err)
	}

	shares := core.NewBaseCollection("drive_shares")
	shares.Fields.Add(&core.TextField{Name: "item", Required: true})
	shares.Fields.Add(&core.RelationField{
		Name:          "user",
		Required:      true,
		CollectionId:  users.Id,
		MaxSelect:     1,
		CascadeDelete: true,
	})
	shares.Fields.Add(&core.SelectField{
		Name:      "role",
		Required:  true,
		Values:    []string{"owner", "editor", "viewer"},
		MaxSelect: 1,
	})
	if err := app.Save(shares); err != nil {
		t.Fatalf("save drive_shares collection: %v", err)
	}

	return app
}

// seedSharedItem creates a drive_items record for the authorization
// tests and returns its saved record. Pass a nil creator to isolate the
// share-row path from the created_by branch driveshare also honors.
// (persist_test.go's seedDriveItem is a different helper — it attaches
// file bytes and returns only the id.)
func seedSharedItem(t *testing.T, app *tests.TestApp, creator *core.Record, name string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(driveItemsCollection)
	if err != nil {
		t.Fatalf("find drive_items collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("name", name)
	rec.Set("size", 0)
	if creator != nil {
		rec.Set("created_by", creator.Id)
	}
	if err := app.Save(rec); err != nil {
		t.Fatalf("save drive_item record: %v", err)
	}
	return rec
}

// seedShare creates a drive_shares row binding the user to the
// drive_item with the given role.
func seedShare(t *testing.T, app *tests.TestApp, itemID, userID, role string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("drive_shares")
	if err != nil {
		t.Fatalf("find drive_shares collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("item", itemID)
	rec.Set("user", userID)
	rec.Set("role", role)
	if err := app.Save(rec); err != nil {
		t.Fatalf("save drive_shares record: %v", err)
	}
}

// mustCreateUser creates a minimal users record and returns it. Must be
// the real users collection, not _superusers: drive_shares.user is a
// relation that validates its target collection.
func mustCreateUser(t *testing.T, app *tests.TestApp, email string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("email", email)
	rec.Set("password", "test-password-1234")
	if err := app.Save(rec); err != nil {
		t.Fatalf("save user %s: %v", email, err)
	}
	return rec
}
