package cli

import (
	"encoding/json"
	"strings"
	"testing"
)

// books builds the standard fixture:
//
//	/Budget.xlsx        (itmBudget) — one open thread with a reply, one resolved
//	/Finance/Q4.xlsx    (itmQ4)     — one comment, to prove scoping
//	/Finance            (itmFin)    — a folder
func books(t *testing.T) *fakeCalc {
	f := newFakeCalc(t)
	f.addItem("itmBudget", "Budget.xlsx", "", false)
	f.addItem("itmFin", "Finance", "", true)
	f.addItem("itmQ4", "Q4.xlsx", "itmFin", false)

	open := f.addComment("cmtOpen", "itmBudget", "This looks off", "Ada")
	open.SheetID, open.Row, open.Col = "Sheet1", 6, 1 // B7
	reply := f.addComment("cmtReply", "itmBudget", "Checking now", "Grace")
	reply.ParentComment = "cmtOpen"

	done := f.addComment("cmtDone", "itmBudget", "Rounded correctly", "Ada")
	done.ResolvedAt = "2026-08-01 12:00:00Z"

	f.addComment("cmtOther", "itmQ4", "On another workbook", "Ada")
	return f
}

func TestCommentsListsOpenThreads(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"This looks off", "Checking now", "Ada", "Grace"} {
		if !strings.Contains(out, want) {
			t.Errorf("comments missing %q:\n%s", want, out)
		}
	}
	// The cell is what makes a bare comment intelligible out of context, and
	// it must render in A1 notation rather than as the stored integers.
	if !strings.Contains(out, "B7") {
		t.Errorf("comments must show the anchored cell in A1 notation:\n%s", out)
	}
}

// A resolved thread is answered. Showing it by default buries the open ones.
func TestCommentsHidesResolvedUnlessAll(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	out, errOut, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "Rounded correctly") {
		t.Errorf("a resolved thread was listed by default:\n%s", out)
	}
	if !strings.Contains(errOut, "hidden") {
		t.Errorf("hiding comments must be reported, not silent: %s", errOut)
	}

	out, _, err = runCmd(t, c, "calc", "comments", "/Budget.xlsx", "--all")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Rounded correctly") {
		t.Errorf("--all must include resolved threads:\n%s", out)
	}
}

// A REPLY inherits its thread's resolved state — resolved_at lives on the root
// only. A reply to a resolved thread showing as open would be a phantom task.
func TestCommentsHidesRepliesOfResolvedThreads(t *testing.T) {
	f := books(t)
	f.comments["cmtOpen"].ResolvedAt = "2026-08-02 09:00:00Z"
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "Checking now") {
		t.Errorf("a reply on a resolved thread must be hidden too:\n%s", out)
	}
}

// The whole point of the drive_item filter. A command that read every comment
// would leak other workbooks' discussions into this one's thread.
func TestCommentsScopedToOneWorkbook(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "On another workbook") {
		t.Errorf("comments leaked from another workbook:\n%s", out)
	}
}

func TestResolvesNestedPath(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calc", "comments", "/Finance/Q4.xlsx")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "On another workbook") {
		t.Errorf("nested path did not resolve to the right workbook:\n%s", out)
	}
}

// `id:<record id>` is the same escape hatch `tinycld drive` accepts.
func TestResolvesByIDPrefix(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calc", "comments", "id:itmBudget")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "This looks off") {
		t.Errorf("id: reference did not resolve:\n%s", out)
	}
}

// A folder has no comments; answering with an empty list would read as "no
// discussion here" rather than "you named the wrong thing".
func TestFolderIsRejected(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	_, _, err := runCmd(t, c, "calc", "comments", "/Finance")
	if err == nil {
		t.Fatal("a folder must be rejected, not answered with an empty list")
	}
	if !strings.Contains(err.Error(), "folder") {
		t.Errorf("the error should say it is a folder, got: %v", err)
	}
}

func TestUnknownPathFails(t *testing.T) {
	f := books(t)
	_, c := f.serve()
	if _, _, err := runCmd(t, c, "calc", "comments", "/Nope.xlsx"); err == nil {
		t.Fatal("an unknown path must fail")
	}
}

// A1 notation is what the user types; the schema stores zero-based integers.
func TestAddParsesCellIntoStoredCoordinates(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx",
		"--cell", "C10", "--sheet", "Sheet1", "--add", "Check this formula"); err != nil {
		t.Fatal(err)
	}

	for key, want := range map[string]any{
		"drive_item": "itmBudget",
		"body":       "Check this formula",
		"author":     "user1",
		"sheet_id":   "Sheet1",
		// Snapshotted at write time so a removed user still renders with a
		// name — the app does the same.
		"author_name": "Ada Lovelace",
	} {
		if got := f.lastCreate[key]; got != want {
			t.Errorf("create[%q] = %v, want %v", key, got, want)
		}
	}
	// C10 is zero-based row 9, column 2.
	if got := f.lastCreate["row"]; got != float64(9) {
		t.Errorf("create[row] = %v, want 9 (C10 is zero-based row 9)", got)
	}
	if got := f.lastCreate["col"]; got != float64(2) {
		t.Errorf("create[col] = %v, want 2 (column C)", got)
	}
}

func TestCellParsingRoundTrips(t *testing.T) {
	cases := map[string]struct{ row, col int }{
		"A1":   {0, 0},
		"B7":   {6, 1},
		"Z1":   {0, 25},
		"AA1":  {0, 26},
		"AB10": {9, 27},
		"BA1":  {0, 52},
	}
	for ref, want := range cases {
		row, col, err := parseCell(ref)
		if err != nil {
			t.Fatalf("parseCell(%q): %v", ref, err)
		}
		if row != want.row || col != want.col {
			t.Errorf("parseCell(%q) = (%d,%d), want (%d,%d)", ref, row, col, want.row, want.col)
		}
		if got := formatCell(row, col); got != ref {
			t.Errorf("formatCell(%d,%d) = %q, want %q", row, col, got, ref)
		}
	}
}

func TestCellParsingRejectsGarbage(t *testing.T) {
	for _, ref := range []string{"", "1", "A", "A0", "1A", "!!", "A-1"} {
		if _, _, err := parseCell(ref); err == nil {
			t.Errorf("parseCell(%q) must fail", ref)
		}
	}
}

// Lowercase is what a person types half the time; rejecting it would be
// gratuitous.
func TestCellParsingIsCaseInsensitive(t *testing.T) {
	row, col, err := parseCell("b7")
	if err != nil {
		t.Fatal(err)
	}
	if row != 6 || col != 1 {
		t.Errorf("parseCell(\"b7\") = (%d,%d), want (6,1)", row, col)
	}
}

func TestAddRejectsBadCell(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx",
		"--cell", "not-a-cell", "--add", "x"); err == nil {
		t.Fatal("an unparseable --cell must fail")
	}
	if f.lastCreate != nil {
		t.Errorf("a refused add still posted: %v", f.lastCreate)
	}
}

func TestReplyAttachesToThread(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx",
		"--reply-to", "cmtOpen", "--add", "Will fix"); err != nil {
		t.Fatal(err)
	}
	if got := f.lastCreate["parent_comment"]; got != "cmtOpen" {
		t.Errorf("parent_comment = %v, want cmtOpen", got)
	}
}

// Replies are one level deep: replying to a reply attaches to its thread root,
// matching how the app nests them.
func TestReplyToAReplyAttachesToTheRoot(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx",
		"--reply-to", "cmtReply", "--add", "Me too"); err != nil {
		t.Fatal(err)
	}
	if got := f.lastCreate["parent_comment"]; got != "cmtOpen" {
		t.Errorf("parent_comment = %v, want the thread root cmtOpen", got)
	}
}

// A comment id from another workbook must not be usable here — it would
// silently attach this workbook's reply to that workbook's thread.
func TestReplyToAnotherWorkbooksCommentFails(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	_, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx",
		"--reply-to", "cmtOther", "--add", "Wrong book")
	if err == nil {
		t.Fatal("replying with another workbook's comment id must fail")
	}
	if f.lastCreate != nil {
		t.Errorf("a refused reply still posted: %v", f.lastCreate)
	}
}

// Silently ignoring --cell would post an unanchored comment the user believes
// is attached to a cell.
func TestModifierWithoutAddFails(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	for _, args := range [][]string{
		{"calc", "comments", "/Budget.xlsx", "--reply-to", "cmtOpen"},
		{"calc", "comments", "/Budget.xlsx", "--cell", "A1"},
		{"calc", "comments", "/Budget.xlsx", "--sheet", "Sheet1"},
	} {
		if _, _, err := runCmd(t, c, args...); err == nil {
			t.Errorf("expected a failure for %v", args)
		}
	}
}

func TestResolveStampsTheThread(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx", "--resolve", "cmtOpen"); err != nil {
		t.Fatal(err)
	}
	if f.patchedID != "cmtOpen" {
		t.Errorf("patched %q, want cmtOpen", f.patchedID)
	}
	if stamp, _ := f.lastPatch["resolved_at"].(string); stamp == "" {
		t.Fatalf("resolve must set a non-empty resolved_at, got %v", f.lastPatch)
	}
}

// resolved_at lives on the ROOT and replies inherit it, so resolving a reply
// must stamp its thread root.
func TestResolvingAReplyStampsTheRoot(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx", "--resolve", "cmtReply"); err != nil {
		t.Fatal(err)
	}
	if f.patchedID != "cmtOpen" {
		t.Errorf("patched %q, want the thread root cmtOpen", f.patchedID)
	}
}

func TestReopenClearsTheStamp(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx", "--reopen", "cmtDone"); err != nil {
		t.Fatal(err)
	}
	if got, ok := f.lastPatch["resolved_at"].(string); !ok || got != "" {
		t.Errorf("reopen must clear resolved_at, got %v", f.lastPatch)
	}
}

func TestResolveAnotherWorkbooksCommentFails(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx", "--resolve", "cmtOther"); err == nil {
		t.Fatal("resolving another workbook's comment must fail")
	}
}

func TestActionsAreMutuallyExclusive(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	if _, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx",
		"--add", "x", "--resolve", "cmtOpen"); err == nil {
		t.Fatal("--add and --resolve together must fail")
	}
}

func TestJSONOutputIsStable(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	out, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx", "--json")
	if err != nil {
		t.Fatal(err)
	}
	var comments []comment
	if err := json.Unmarshal([]byte(out), &comments); err != nil {
		t.Fatalf("--json output is not a stable JSON array: %v\n%s", err, out)
	}
	if len(comments) != 2 {
		t.Errorf("--json returned %d comments, want 2 (the open thread)", len(comments))
	}
	// The stored coordinates survive into --json even though the table renders
	// them as A1, so a script can filter on row/col.
	if comments[0].Row != 6 || comments[0].Col != 1 {
		t.Errorf("--json must carry the stored coordinates, got row=%d col=%d",
			comments[0].Row, comments[0].Col)
	}
}
