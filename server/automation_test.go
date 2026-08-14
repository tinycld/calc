package calc

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/rlstest"
)

// automation_test.go pins calc's owner resolver: a comment belongs to
// everyone who can reach the workbook it is on, not to whoever wrote it.
//
// Built on the real migrations (same rlstest idiom as comments_rls_test.go)
// rather than hand-declared collections, because the resolver's answer is
// only correct relative to drive's actual creator/share schema.

type resolverEnv struct {
	app      *tests.TestApp
	author   *core.Record
	sharee   *core.Record
	outsider *core.Record
	item     *core.Record
}

func setupResolverApp(t *testing.T) *resolverEnv {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	// driveshare reads users.disabled; core's users schema isn't carried by
	// this module, so the column has to exist before the resolver runs.
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	if err := app.Save(users); err != nil {
		t.Fatalf("add users.disabled: %v", err)
	}

	rlstest.Apply(t, app,
		rlstest.MigrationsDir(t, "../../drive/pb-migrations"),
		rlstest.MigrationsDir(t, "../pb-migrations"),
	)

	author := calcCommentsUser(t, app, "author@test.local")
	sharee := calcCommentsUser(t, app, "sharee@test.local")
	outsider := calcCommentsUser(t, app, "outsider@test.local")

	items, err := app.FindCollectionByNameOrId("drive_items")
	if err != nil {
		t.Fatal(err)
	}
	item := core.NewRecord(items)
	item.Set("name", "book.xlsx")
	item.Set("created_by", author.Id)
	if err := app.Save(item); err != nil {
		t.Fatal(err)
	}

	shares, err := app.FindCollectionByNameOrId("drive_shares")
	if err != nil {
		t.Fatal(err)
	}
	share := core.NewRecord(shares)
	share.Set("item", item.Id)
	share.Set("user", sharee.Id)
	share.Set("role", "editor")
	share.Set("created_by", author.Id)
	if err := app.Save(share); err != nil {
		t.Fatal(err)
	}

	return &resolverEnv{app: app, author: author, sharee: sharee, outsider: outsider, item: item}
}

func (e *resolverEnv) comment(t *testing.T, authorID string) *core.Record {
	t.Helper()
	comments, err := e.app.FindCollectionByNameOrId("calc_comments")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(comments)
	rec.Set("drive_item", e.item.Id)
	rec.Set("sheet_id", "Sheet1")
	rec.Set("row", 1)
	rec.Set("col", 1)
	rec.Set("body", "check this total")
	rec.Set("author", authorID)
	rec.Set("author_name", "Someone")
	if err := e.app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func TestCommentOwnerResolver_ResolvesWorkbookParticipants(t *testing.T) {
	env := setupResolverApp(t)
	// Written by the sharee — the workbook's creator must still be an owner
	// of the event, which is the whole point of not using `author`.
	comment := env.comment(t, env.sharee.Id)

	owners := commentOwnerResolver(env.app, comment)

	got := map[string]bool{}
	for _, id := range owners {
		got[id] = true
	}
	if !got[env.author.Id] {
		t.Errorf("workbook creator %s missing from %v", env.author.Id, owners)
	}
	if !got[env.sharee.Id] {
		t.Errorf("share holder %s missing from %v", env.sharee.Id, owners)
	}
	if got[env.outsider.Id] {
		t.Errorf("outsider %s must not be an owner: %v", env.outsider.Id, owners)
	}
}

// The bug this resolver exists to avoid: auto-detection on `author` would
// return only the commenter, so "tell me when someone comments on my
// workbook" would never fire for the workbook's owner.
func TestCommentOwnerResolver_IsNotJustTheAuthor(t *testing.T) {
	env := setupResolverApp(t)
	comment := env.comment(t, env.sharee.Id)

	owners := commentOwnerResolver(env.app, comment)
	if len(owners) < 2 {
		t.Fatalf("owners = %v, want the workbook's participants, not just the comment author", owners)
	}
}

func TestCommentOwnerResolver_MalformedRecordsResolveNil(t *testing.T) {
	env := setupResolverApp(t)

	if owners := commentOwnerResolver(env.app, nil); owners != nil {
		t.Errorf("nil record: got %v, want nil", owners)
	}

	comments, err := env.app.FindCollectionByNameOrId("calc_comments")
	if err != nil {
		t.Fatal(err)
	}
	orphan := core.NewRecord(comments)
	orphan.Set("sheet_id", "Sheet1")
	orphan.Set("body", "no workbook")
	orphan.Set("author", env.author.Id)
	// Skip validation: the point of the fixture is a missing drive_item,
	// which the relation's required check would reject.
	if err := env.app.SaveNoValidate(orphan); err != nil {
		t.Fatalf("save orphan comment: %v", err)
	}

	if owners := commentOwnerResolver(env.app, orphan); owners != nil {
		t.Errorf("comment with no drive_item: got %v, want nil", owners)
	}
}

// A suspended participant must drop out — otherwise their personal rules keep
// firing on a workbook they can no longer open.
func TestCommentOwnerResolver_ExcludesSuspendedParticipants(t *testing.T) {
	env := setupResolverApp(t)
	comment := env.comment(t, env.author.Id)

	env.sharee.Set("disabled", true)
	if err := env.app.Save(env.sharee); err != nil {
		t.Fatalf("suspend sharee: %v", err)
	}

	owners := commentOwnerResolver(env.app, comment)
	for _, id := range owners {
		if id == env.sharee.Id {
			t.Fatalf("suspended user %s still resolved as an owner: %v", id, owners)
		}
	}
	if len(owners) == 0 {
		t.Fatal("the active creator should still be an owner")
	}
}
