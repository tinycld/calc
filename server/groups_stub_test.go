package calc

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

// stubGroupsCollection creates the core `groups` collection with the id
// drive's 2040000002_group_grants_on_shares.js names as its `group` relation
// target. These fixtures apply only drive's and this package's own
// migrations (not core's), so core's collection has to exist before that
// relation field can be saved — without it, migrating drive_shares fails
// with "The relation collection doesn't exist" before this package's own
// migrations even get a chance to run.
func stubGroupsCollection(t testing.TB, app core.App) {
	t.Helper()
	if _, err := app.FindCollectionByNameOrId("groups"); err == nil {
		return
	}
	groups := core.NewBaseCollection("groups")
	groups.Id = "pbc_groups_01"
	groups.Fields.Add(&core.TextField{Name: "name", Required: true})
	if err := app.Save(groups); err != nil {
		t.Fatalf("stub groups collection: %v", err)
	}
}
