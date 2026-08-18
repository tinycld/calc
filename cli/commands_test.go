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
	open.SheetID, open.Row, open.Col = "Sheet1", 7, 2 // B7, one-based as stored
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

// A1 notation is what the user types; the schema stores one-based integers.
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
	// C10 is one-based row 10, column 3 — the coordinates the app writes and
	// the schema's `min: 1` demands.
	if got := f.lastCreate["row"]; got != float64(10) {
		t.Errorf("create[row] = %v, want 10 (C10 is row 10)", got)
	}
	if got := f.lastCreate["col"]; got != float64(3) {
		t.Errorf("create[col] = %v, want 3 (column C)", got)
	}
}

// One-based on BOTH axes — the app's contract (calc/lib/pivot/range-parse.ts
// keeps the row as written and columnLabel maps 1 → "A"), and what the schema's
// `min: 1` enforces. A1 is the case that matters most: it is the first cell of
// every spreadsheet, and under the previous zero-based mapping it was the one
// reference the server always rejected.
func TestCellParsingRoundTrips(t *testing.T) {
	cases := map[string]struct{ row, col int }{
		"A1":   {1, 1},
		"B7":   {7, 2},
		"Z1":   {1, 26},
		"AA1":  {1, 27},
		"AB10": {10, 28},
		"BA1":  {1, 53},
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

// A1 and column A are the regression that motivated the one-based fix: the
// schema declares `min: 1` on row and col, so the old zero-based mapping made
// the server reject every reference in row 1 or column A — A1, the first cell
// of every spreadsheet, included. The fake server validates nothing, so only an
// explicit check on the posted values catches a return to zero-based.
func TestAddAcceptsFirstRowAndFirstColumn(t *testing.T) {
	for _, tc := range []struct {
		ref              string
		wantRow, wantCol float64
	}{
		{"A1", 1, 1},
		{"B1", 1, 2},
		{"A5", 5, 1},
		{"AA1", 1, 27},
	} {
		t.Run(tc.ref, func(t *testing.T) {
			f := books(t)
			_, c := f.serve()

			if _, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx",
				"--cell", tc.ref, "--sheet", "Sheet1", "--add", "x"); err != nil {
				t.Fatal(err)
			}
			if got := f.lastCreate["row"]; got != tc.wantRow {
				t.Errorf("%s: create[row] = %v, want %v", tc.ref, got, tc.wantRow)
			}
			if got := f.lastCreate["col"]; got != tc.wantCol {
				t.Errorf("%s: create[col] = %v, want %v", tc.ref, got, tc.wantCol)
			}
			// Every stored coordinate must satisfy the schema's `min: 1`.
			if r, _ := f.lastCreate["row"].(float64); r < 1 {
				t.Errorf("%s: row %v violates the schema's min:1", tc.ref, r)
			}
			if cl, _ := f.lastCreate["col"].(float64); cl < 1 {
				t.Errorf("%s: col %v violates the schema's min:1", tc.ref, cl)
			}
		})
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
	if row != 7 || col != 2 {
		t.Errorf("parseCell(\"b7\") = (%d,%d), want (7,2)", row, col)
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

// sheet_id, row, and col are all required by the schema, so a root comment
// missing either anchor flag is refused HERE with a message naming the flag —
// rather than by the server with a bare "Failed to create record", which is
// what the live smoke test hit. The fake server validates nothing, so only an
// explicit test covers this.
func TestAddRequiresBothAnchorFlags(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{"no cell, no sheet", []string{"--add", "x"}, "--cell"},
		{"cell without sheet", []string{"--cell", "B7", "--add", "x"}, "--sheet"},
		{"sheet without cell", []string{"--sheet", "Sheet1", "--add", "x"}, "--cell"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := books(t)
			_, c := f.serve()

			_, _, err := runCmd(t, c, append([]string{"calc", "comments", "/Budget.xlsx"}, tc.args...)...)
			if err == nil {
				t.Fatal("a root comment without a full cell anchor must fail")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error %q does not name the missing flag %q", err, tc.want)
			}
			if f.lastCreate != nil {
				t.Errorf("a refused add still posted: %v", f.lastCreate)
			}
		})
	}
}

// A reply inherits its thread's anchor, so it must NOT demand the flags a root
// comment needs — requiring them would make replying impossible.
//
// The anchor fields are asserted on the wire, not just the exit status:
// sheet_id/row/col are all required by calc_comments, so a reply that sent none
// of them is rejected by a real server even though the fake here accepts it.
func TestReplyCarriesThreadAnchor(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	parent := f.comments["cmtOpen"]
	if parent.SheetID == "" || parent.Row == 0 || parent.Col == 0 {
		t.Fatalf("fixture must have an anchored parent: %+v", parent)
	}

	if _, _, err := runCmd(t, c, "calc", "comments", "/Budget.xlsx",
		"--reply-to", "cmtOpen", "--add", "No anchor needed"); err != nil {
		t.Fatalf("a reply must not require --cell/--sheet: %v", err)
	}
	if f.lastCreate == nil {
		t.Fatal("the reply was not posted")
	}
	if got := str(f.lastCreate["sheet_id"]); got != parent.SheetID {
		t.Errorf("sheet_id = %q, want the thread's %q", got, parent.SheetID)
	}
	if got := intOf(f.lastCreate["row"]); got != parent.Row {
		t.Errorf("row = %d, want the thread's %d", got, parent.Row)
	}
	if got := intOf(f.lastCreate["col"]); got != parent.Col {
		t.Errorf("col = %d, want the thread's %d", got, parent.Col)
	}
}

// The anchor flags are meaningless on a reply, so passing one is a mistake
// worth naming rather than silently overriding with the thread's anchor.
func TestReplyRejectsAnchorFlags(t *testing.T) {
	f := books(t)
	_, c := f.serve()

	for _, args := range [][]string{
		{"--cell", "B7"},
		{"--sheet", "Sheet1"},
	} {
		cmd := append([]string{"calc", "comments", "/Budget.xlsx",
			"--reply-to", "cmtOpen", "--add", "x"}, args...)
		if _, _, err := runCmd(t, c, cmd...); err == nil {
			t.Errorf("%v on a reply must be refused", args)
		}
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
	if comments[0].Row != 7 || comments[0].Col != 2 {
		t.Errorf("--json must carry the stored coordinates, got row=%d col=%d",
			comments[0].Row, comments[0].Col)
	}
}
