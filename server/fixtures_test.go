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

// setupAuthTestApp creates a tests.TestApp with the minimal drive_items,
// user_org, and drive_shares collections needed by authorize tests.
// Mirrors text/server/fixtures_test.go::setupAuthTestApp.
func setupAuthTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("tests.NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	items := core.NewBaseCollection(driveItemsCollection)
	items.Fields.Add(&core.TextField{Name: "name"})
	items.Fields.Add(&core.TextField{Name: "org"})
	items.Fields.Add(&core.NumberField{Name: "size"})
	if err := app.Save(items); err != nil {
		t.Fatalf("save drive_items collection: %v", err)
	}

	userOrg := core.NewBaseCollection("user_org")
	userOrg.Fields.Add(&core.TextField{Name: "user", Required: true})
	userOrg.Fields.Add(&core.TextField{Name: "org", Required: true})
	if err := app.Save(userOrg); err != nil {
		t.Fatalf("save user_org collection: %v", err)
	}

	shares := core.NewBaseCollection("drive_shares")
	shares.Fields.Add(&core.TextField{Name: "item", Required: true})
	shares.Fields.Add(&core.RelationField{
		Name:          "user_org",
		Required:      true,
		CollectionId:  userOrg.Id,
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

// seedDriveItemInOrg creates a drive_items record in the given org and
// returns its saved record.
func seedDriveItemInOrg(t *testing.T, app *tests.TestApp, orgID, name string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId(driveItemsCollection)
	if err != nil {
		t.Fatalf("find drive_items collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("name", name)
	rec.Set("size", 0)
	rec.Set("org", orgID)
	if err := app.Save(rec); err != nil {
		t.Fatalf("save drive_item record: %v", err)
	}
	return rec
}

// seedUserOrg creates a user_org row binding the user to the org and
// returns its saved record id.
func seedUserOrg(t *testing.T, app *tests.TestApp, userID, orgID string) string {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("user_org")
	if err != nil {
		t.Fatalf("find user_org collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("user", userID)
	rec.Set("org", orgID)
	if err := app.Save(rec); err != nil {
		t.Fatalf("save user_org record: %v", err)
	}
	return rec.Id
}

// seedShare creates a drive_shares row binding the user_org row to the
// drive_item with the given role.
func seedShare(t *testing.T, app *tests.TestApp, itemID, userOrgID, role string) {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("drive_shares")
	if err != nil {
		t.Fatalf("find drive_shares collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("item", itemID)
	rec.Set("user_org", userOrgID)
	rec.Set("role", role)
	if err := app.Save(rec); err != nil {
		t.Fatalf("save drive_shares record: %v", err)
	}
}

// mustCreateUser creates a minimal _superusers record and returns it.
func mustCreateUser(t *testing.T, app *tests.TestApp, email string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("_superusers")
	if err != nil {
		t.Fatalf("find _superusers collection: %v", err)
	}
	rec := core.NewRecord(collection)
	rec.Set("email", email)
	rec.Set("password", "test-password-1234")
	if err := app.Save(rec); err != nil {
		t.Fatalf("save user %s: %v", email, err)
	}
	return rec
}
