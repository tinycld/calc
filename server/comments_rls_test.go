package calc

import (
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/rlstest"
)

// comments_rls_test.go proves calc_comments' access rules against
// PocketBase's REAL rule engine: a user may read a comment only when
// they hold a drive_shares row on the commented-on drive_item, and may
// only mutate their own comments.
//
// This file exists because these rules had rotted undetected. They
// walked `drive_shares_via_item.user_org`, a field drive renamed to
// `user` during the single-org migration, which made every list/view
// return zero rows and every create 403 — with no compile error and no
// failing test, because nothing asserted them. PB rejects the stale rule
// outright at migration-apply time now, but only for a fresh DB; a guard
// here is what catches the next silent divergence.
//
// Each scenario builds a FRESH TestApp: ApiScenario.Test re-triggers
// OnServe, and reusing one app panics on duplicate route registration.

// The rules are NOT restated here. The whole collection graph — drive's items
// and shares, calc's comments — comes from those packages' real migrations, so
// what is asserted below is what ships. This file used to keep the rules as
// constants "copied verbatim from the migration"; that arrangement is exactly
// what let drive's shipped createRule quietly lose a security clause while the
// suite guarding it stayed green against its own stale copy.

type calcCommentsEnv struct {
	app         *tests.TestApp
	sharee      *core.Record
	stranger    *core.Record
	item        *core.Record
	comment     *core.Record
	shareeToken string
	strangerTok string
}

// setupTextCommentsRLSApp builds the real collection graph the rules
// walk: users → drive_shares → drive_items ← calc_comments. drive_shares
// must exist for the `drive_shares_via_item` back-relation to parse at
// all.
func setupTextCommentsRLSApp(t *testing.T) *calcCommentsEnv {
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

	// `disabled` belongs to core's users schema, which this module does not
	// carry; the rules under test read it, so it has to exist before they are
	// installed.
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	if err := app.Save(users); err != nil {
		t.Fatalf("add users.disabled: %v", err)
	}

	// drive's migrations run first: the comment rules walk drive_shares.
	rlstest.Apply(t, app,
		rlstest.MigrationsDir(t, "../../drive/pb-migrations"),
		rlstest.MigrationsDir(t, "../pb-migrations"),
	)

	items, err := app.FindCollectionByNameOrId("drive_items")
	if err != nil {
		t.Fatal(err)
	}
	shares, err := app.FindCollectionByNameOrId("drive_shares")
	if err != nil {
		t.Fatal(err)
	}
	comments, err := app.FindCollectionByNameOrId("calc_comments")
	if err != nil {
		t.Fatalf("calc_comments should have been created by the migrations: %v", err)
	}

	sharee := calcCommentsUser(t, app, "sharee@test.local")
	stranger := calcCommentsUser(t, app, "stranger@test.local")

	item := core.NewRecord(items)
	item.Set("name", "book.xlsx")
	item.Set("created_by", sharee.Id)
	if err := app.Save(item); err != nil {
		t.Fatal(err)
	}

	share := core.NewRecord(shares)
	share.Set("item", item.Id)
	share.Set("user", sharee.Id)
	share.Set("role", "editor")
	share.Set("created_by", sharee.Id)
	if err := app.Save(share); err != nil {
		t.Fatal(err)
	}

	comment := core.NewRecord(comments)
	comment.Set("drive_item", item.Id)
	comment.Set("sheet_id", "Sheet1")
	comment.Set("row", 1)
	comment.Set("col", 1)
	comment.Set("body", "SECRET-COMMENT-BODY")
	comment.Set("author", sharee.Id)
	comment.Set("author_name", "Sharee")
	if err := app.Save(comment); err != nil {
		t.Fatal(err)
	}

	shareeToken, err := sharee.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	strangerTok, err := stranger.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	return &calcCommentsEnv{
		app: app, sharee: sharee, stranger: stranger,
		item: item, comment: comment,
		shareeToken: shareeToken, strangerTok: strangerTok,
	}
}

func calcCommentsUser(t *testing.T, app core.App, email string) *core.Record {
	t.Helper()
	col, _ := app.FindCollectionByNameOrId("users")
	r := core.NewRecord(col)
	r.SetEmail(email)
	r.Set("name", "Test")
	r.SetVerified(true)
	r.SetPassword("Password123!")
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

// TestCalcCommentsRLS_ShareeCanList is the positive control. Without it,
// a rule that denies EVERYONE (the exact bug this file was written for)
// would still pass the deny-side tests below.
func TestCalcCommentsRLS_ShareeCanList(t *testing.T) {
	env := setupTextCommentsRLSApp(t)

	scenario := &tests.ApiScenario{
		Name:                  "sharee lists calc_comments",
		Method:                http.MethodGet,
		URL:                   "/api/collections/calc_comments/records",
		Headers:               map[string]string{"Authorization": env.shareeToken},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"totalItems":1`, "SECRET-COMMENT-BODY"},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

// TestCalcCommentsRLS_StrangerCannotList is the confidentiality guard: a
// user with no drive_shares row on the item must not see its comments.
func TestCalcCommentsRLS_StrangerCannotList(t *testing.T) {
	env := setupTextCommentsRLSApp(t)

	scenario := &tests.ApiScenario{
		Name:                  "stranger lists calc_comments",
		Method:                http.MethodGet,
		URL:                   "/api/collections/calc_comments/records",
		Headers:               map[string]string{"Authorization": env.strangerTok},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"totalItems":0`},
		NotExpectedContent:    []string{"SECRET-COMMENT-BODY"},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

// TestCalcCommentsRLS_StrangerCannotView pins the single-record path
// too: a direct fetch by id must 404, not merely be filtered out of the
// list.
func TestCalcCommentsRLS_StrangerCannotView(t *testing.T) {
	env := setupTextCommentsRLSApp(t)

	scenario := &tests.ApiScenario{
		Name:                  "stranger views one text_comment",
		Method:                http.MethodGet,
		URL:                   "/api/collections/calc_comments/records/" + env.comment.Id,
		Headers:               map[string]string{"Authorization": env.strangerTok},
		ExpectedStatus:        404,
		NotExpectedContent:    []string{"SECRET-COMMENT-BODY"},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

// TestCalcCommentsRLS_StrangerCannotDelete pins the mutate rule: even a
// user who could somehow name the record may not delete someone else's
// comment.
func TestCalcCommentsRLS_StrangerCannotDelete(t *testing.T) {
	env := setupTextCommentsRLSApp(t)

	scenario := &tests.ApiScenario{
		Name:                  "stranger deletes another user's comment",
		Method:                http.MethodDelete,
		URL:                   "/api/collections/calc_comments/records/" + env.comment.Id,
		Headers:               map[string]string{"Authorization": env.strangerTok},
		ExpectedStatus:        404,
		ExpectedContent:       []string{`"status":404`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

// TestCalcCommentsRLS_AnonCannotList pins the `@request.auth.id != ""`
// conjunct: the route admits an unauthenticated list, but the rule
// matches nothing, so no comment body may leak.
func TestCalcCommentsRLS_AnonCannotList(t *testing.T) {
	env := setupTextCommentsRLSApp(t)

	scenario := &tests.ApiScenario{
		Name:                  "anonymous lists calc_comments",
		Method:                http.MethodGet,
		URL:                   "/api/collections/calc_comments/records",
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"totalItems":0`},
		NotExpectedContent:    []string{"SECRET-COMMENT-BODY"},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	scenario.Test(t)
}

// calcCommentsUserWithToken creates a user, optionally suspended, and returns
// it with a token minted BEFORE the suspension — the realistic case, since a
// suspended account's client holds a token it obtained while active.
func calcCommentsUserWithToken(t *testing.T, app core.App, email string, disabled bool) (*core.Record, string) {
	t.Helper()
	u := calcCommentsUser(t, app, email)
	token, err := u.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}
	if disabled {
		fresh, err := app.FindRecordById("users", u.Id)
		if err != nil {
			t.Fatal(err)
		}
		fresh.Set("disabled", true)
		if err := app.Save(fresh); err != nil {
			t.Fatal(err)
		}
	}
	return u, token
}

func calcShareWith(t *testing.T, env *calcCommentsEnv, user *core.Record, role string) {
	t.Helper()
	shares, err := env.app.FindCollectionByNameOrId("drive_shares")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(shares)
	r.Set("item", env.item.Id)
	r.Set("user", user.Id)
	r.Set("role", role)
	r.Set("created_by", env.sharee.Id)
	if err := env.app.Save(r); err != nil {
		t.Fatal(err)
	}
}

// A suspended user's share rows survive their suspension, and the Go gate
// never runs for /api/collections/*_comments — PocketBase evaluates these
// rules instead. Without the disabled clause a suspended account keeps full
// comment access over plain REST.
//
// One app per scenario: ApiScenario.Test re-triggers OnServe, so two scenarios
// sharing an app double-register routes.
func TestCalcCommentsRLS_DisabledShareeCannotList(t *testing.T) {
	env := setupTextCommentsRLSApp(t)
	suspended, token := calcCommentsUserWithToken(t, env.app, "suspended@test.local", true)
	calcShareWith(t, env, suspended, "editor")

	(&tests.ApiScenario{
		Method:                http.MethodGet,
		URL:                   "/api/collections/calc_comments/records",
		Headers:               map[string]string{"Authorization": token},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"totalItems":0`},
		NotExpectedContent:    []string{"SECRET-COMMENT-BODY"},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

func TestCalcCommentsRLS_DisabledShareeCannotView(t *testing.T) {
	env := setupTextCommentsRLSApp(t)
	suspended, token := calcCommentsUserWithToken(t, env.app, "suspended@test.local", true)
	calcShareWith(t, env, suspended, "editor")

	(&tests.ApiScenario{
		Method:                http.MethodGet,
		URL:                   "/api/collections/calc_comments/records/" + env.comment.Id,
		Headers:               map[string]string{"Authorization": token},
		ExpectedStatus:        404,
		NotExpectedContent:    []string{"SECRET-COMMENT-BODY"},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

func TestCalcCommentsRLS_DisabledShareeCannotCreate(t *testing.T) {
	env := setupTextCommentsRLSApp(t)
	suspended, token := calcCommentsUserWithToken(t, env.app, "suspended@test.local", true)
	calcShareWith(t, env, suspended, "editor")

	(&tests.ApiScenario{
		Method: http.MethodPost,
		URL:    "/api/collections/calc_comments/records",
		Body: strings.NewReader(`{"drive_item":"` + env.item.Id +
			`","sheet_id":"Sheet1","row":1,"col":1,"body":"x","author":"` + suspended.Id + `","author_name":"Tester"}`),
		Headers: map[string]string{
			"Authorization": token, "Content-Type": "application/json",
		},
		ExpectedStatus:        400,
		ExpectedContent:       []string{`"message"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// The positive control for the three above: an enabled sharee still comments.
// Without it a rule denying everyone would pass every deny-test.
func TestCalcCommentsRLS_EnabledShareeCanComment(t *testing.T) {
	env := setupTextCommentsRLSApp(t)
	user, token := calcCommentsUserWithToken(t, env.app, "enabled@test.local", false)
	calcShareWith(t, env, user, "editor")

	(&tests.ApiScenario{
		Method: http.MethodPost,
		URL:    "/api/collections/calc_comments/records",
		Body: strings.NewReader(`{"drive_item":"` + env.item.Id +
			`","sheet_id":"Sheet1","row":2,"col":2,"body":"hello","author":"` + user.Id + `","author_name":"Tester"}`),
		Headers: map[string]string{
			"Authorization": token, "Content-Type": "application/json",
		},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"body":"hello"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// A commentor's entire purpose is commenting. Tightening these rules must not
// take that away.
func TestCalcCommentsRLS_CommentorCanComment(t *testing.T) {
	env := setupTextCommentsRLSApp(t)
	user, token := calcCommentsUserWithToken(t, env.app, "commentor@test.local", false)
	calcShareWith(t, env, user, "commentor")

	(&tests.ApiScenario{
		Method: http.MethodPost,
		URL:    "/api/collections/calc_comments/records",
		Body: strings.NewReader(`{"drive_item":"` + env.item.Id +
			`","sheet_id":"Sheet1","row":3,"col":3,"body":"a note","author":"` + user.Id + `","author_name":"Tester"}`),
		Headers: map[string]string{
			"Authorization": token, "Content-Type": "application/json",
		},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"body":"a note"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// The document's creator may hold no drive_shares row at all — drive's
// owner-share hook can be bypassed by a direct SDK write. Without the creator
// disjunct they see zero comments on a document they can otherwise edit, and
// cannot post one.
func TestCalcCommentsRLS_DocumentCreatorWithoutShareCanComment(t *testing.T) {
	env := setupTextCommentsRLSApp(t)
	creator, token := calcCommentsUserWithToken(t, env.app, "creator@test.local", false)

	items, err := env.app.FindCollectionByNameOrId("drive_items")
	if err != nil {
		t.Fatal(err)
	}
	item := core.NewRecord(items)
	item.Set("name", "unshared.xlsx")
	item.Set("created_by", creator.Id)
	if err := env.app.Save(item); err != nil {
		t.Fatal(err)
	}

	(&tests.ApiScenario{
		Method: http.MethodPost,
		URL:    "/api/collections/calc_comments/records",
		Body: strings.NewReader(`{"drive_item":"` + item.Id +
			`","sheet_id":"Sheet1","row":4,"col":4,"body":"mine","author":"` + creator.Id + `","author_name":"Tester"}`),
		Headers: map[string]string{
			"Authorization": token, "Content-Type": "application/json",
		},
		ExpectedStatus:        200,
		ExpectedContent:       []string{`"body":"mine"`},
		TestAppFactory:        func(t testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// Names the clauses each shipped rule must carry, so a migration that restates
// a rule and drops one says which went missing.
func TestCalcCommentsRLS_ShippedRulesCarryTheirGuards(t *testing.T) {
	env := setupTextCommentsRLSApp(t)

	for _, kind := range []string{"list", "view", "create"} {
		rlstest.RequireRuleContains(t, env.app, "calc_comments", kind,
			`@request.auth.disabled != true`)
		rlstest.RequireRuleContains(t, env.app, "calc_comments", kind,
			`drive_item.created_by ?= @request.auth.id`)
	}
	for _, kind := range []string{"update", "delete"} {
		rlstest.RequireRuleContains(t, env.app, "calc_comments", kind,
			`@request.auth.disabled != true`)
		rlstest.RequireRuleContains(t, env.app, "calc_comments", kind,
			`author = @request.auth.id`)
	}
}

// TestCalcCommentsRLS_StaleFieldWalkIsRejected pins the failure that motivated
// this file: a rule referencing a field the schema doesn't have. These rules
// once walked `drive_shares_via_item.user_org`, a field drive renamed to
// `user`, which made every list return zero rows with no compile error.
func TestCalcCommentsRLS_StaleFieldWalkIsRejected(t *testing.T) {
	env := setupTextCommentsRLSApp(t)

	col, err := env.app.FindCollectionByNameOrId("calc_comments")
	if err != nil {
		t.Fatal(err)
	}
	stale := `@request.auth.id != "" && drive_item.drive_shares_via_item.user_org ?= @request.auth.id`
	col.ListRule = &stale
	if err := env.app.Save(col); err == nil {
		t.Error("stale user_org rule saved without error; the rule engine should reject the unknown field")
	}
}
