package cli

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
	"tinycld.org/cli/output"
)

// newCommentsCmd is the whole command surface: list a document's comments,
// add one, reply to one, or resolve a thread.
//
// Flags rather than subcommands (`comments --add` over `comments add`) because
// every mode takes the same required argument — the document — and the reading
// mode is overwhelmingly the common one. `tinycld text comments <path>` with
// no flags is the thing people type.
func newCommentsCmd(c *client.Client) *cobra.Command {
	var (
		add     string
		replyTo string
		resolve string
		reopen  string
		showAll bool
		cell    string
		sheet   string
	)
	cmd := &cobra.Command{
		Use:   "comments <path>",
		Short: "Read, add, and resolve comments on a spreadsheet",
		Long: "Read, add, and resolve comments on a spreadsheet.\n\n" +
			"<path> is a Drive path (/Budget.xlsx) or id:<record id>, the same\n" +
			"references `tinycld drive` accepts.\n\n" +
			"Comments anchor to a cell, given in A1 notation. Resolved threads are\n" +
			"hidden unless --all.",
		Args:    cobra.ExactArgs(1),
		Aliases: []string{"comment"},
		Example: "  tinycld calc comments /Budget.xlsx\n" +
			"  tinycld calc comments /Budget.xlsx --cell B7 --add \"This looks off\"\n" +
			"  tinycld calc comments /Budget.xlsx --reply-to cmt123 --add \"Fixed\"\n" +
			"  tinycld calc comments /Budget.xlsx --resolve cmt123",
		RunE: func(cmd *cobra.Command, args []string) error {
			o, _, err := output.FromCommand(cmd)
			if err != nil {
				return err
			}
			ctx := cmd.Context()

			// One action per invocation: combining them would make the output
			// ambiguous about what happened.
			if err := exactlyOneAction(cmd); err != nil {
				return err
			}

			doc, err := resolveDocument(ctx, c, args[0])
			if err != nil {
				return err
			}

			switch {
			case add != "":
				return addComment(cmd, c, o, doc, add, replyTo, cell, sheet)
			case resolve != "":
				return setResolved(cmd, c, o, doc, resolve, true)
			case reopen != "":
				return setResolved(cmd, c, o, doc, reopen, false)
			default:
				return listComments(cmd, c, o, doc, showAll)
			}
		},
	}
	fl := cmd.Flags()
	fl.StringVar(&add, "add", "", "post a comment with this body")
	fl.StringVar(&replyTo, "reply-to", "", "reply to this comment id (with --add)")
	fl.StringVar(&cell, "cell", "", "the cell this comment is about, in A1 notation (with --add)")
	fl.StringVar(&sheet, "sheet", "", "the sheet id the cell is on (with --add)")
	fl.StringVar(&resolve, "resolve", "", "mark this thread resolved")
	fl.StringVar(&reopen, "reopen", "", "mark this thread unresolved")
	fl.BoolVar(&showAll, "all", false, "include resolved threads")
	cmd.MarkFlagsMutuallyExclusive("add", "resolve", "reopen")
	return cmd
}

// exactlyOneAction rejects flag combinations MarkFlagsMutuallyExclusive cannot
// express — a modifier passed without the action it modifies. Silently
// ignoring --reply-to would post a root comment the user believes is a reply.
func exactlyOneAction(cmd *cobra.Command) error {
	fl := cmd.Flags()
	if !fl.Changed("add") {
		for _, modifier := range []string{"reply-to", "cell", "sheet"} {
			if fl.Changed(modifier) {
				return fmt.Errorf("--%s only applies with --add", modifier)
			}
		}
	}
	return nil
}

func listComments(
	cmd *cobra.Command,
	c *client.Client,
	o output.Options,
	doc item,
	showAll bool,
) error {
	comments, err := documentComments(cmd.Context(), c, doc.ID)
	if err != nil {
		return err
	}

	// resolved_at lives on the root, so a reply's state is its thread's.
	resolved := map[string]bool{}
	for _, cm := range comments {
		if cm.ParentComment == "" && cm.ResolvedAt != "" {
			resolved[cm.ID] = true
		}
	}

	var (
		rows    [][]string
		visible []comment
		hidden  int
	)
	for _, cm := range comments {
		if resolved[threadOf(cm)] && !showAll {
			hidden++
			continue
		}
		visible = append(visible, cm)
		rows = append(rows, []string{
			threadCell(cm), formatCell(cm.Row, cm.Col), cm.AuthorName,
			oneLine(cm.Body), stateCell(cm, resolved), cm.ID,
		})
	}

	if err := o.Write(cmd.OutOrStdout(),
		[]string{"", "CELL", "AUTHOR", "COMMENT", "STATE", "ID"}, rows, visible); err != nil {
		return err
	}
	if hidden > 0 {
		o.Info(cmd.ErrOrStderr(),
			"%d resolved comment(s) hidden — pass --all to see them", hidden)
	}
	return nil
}

// threadCell indents a reply so a thread reads as a thread in a flat table.
func threadCell(cm comment) string {
	if cm.ParentComment != "" {
		return "  ↳"
	}
	return ""
}

func stateCell(cm comment, resolved map[string]bool) string {
	if resolved[threadOf(cm)] {
		return "resolved"
	}
	return "open"
}

func addComment(
	cmd *cobra.Command,
	c *client.Client,
	o output.Options,
	doc item,
	body, replyTo, cellRef, sheet string,
) error {
	ctx := cmd.Context()

	// sheet_id, row, and col are all REQUIRED on a root comment: a calc
	// comment anchors to one cell on one sheet. A reply inherits its thread's
	// anchor, so it needs neither. Without this check the server answers a bare
	// "Failed to create record" — a 400 that names nothing the user can act on
	// (the missing --sheet, or the --cell they did remember to pass).
	if replyTo == "" {
		switch {
		case cellRef == "" && sheet == "":
			return fmt.Errorf("a new comment needs a cell and a sheet: pass --cell (e.g. --cell B7) and --sheet")
		case cellRef == "":
			return fmt.Errorf("a new comment needs a cell: pass --cell (e.g. --cell B7)")
		case sheet == "":
			return fmt.Errorf("a new comment needs the sheet the cell is on: pass --sheet")
		}
	} else if cellRef != "" || sheet != "" {
		// Say so rather than silently overriding: a reply always takes the
		// thread's anchor, so these flags would not do what they look like.
		return fmt.Errorf("--cell/--sheet do not apply to a reply: a reply inherits the anchor of the thread it joins")
	}

	userID, err := c.UserID(ctx)
	if err != nil {
		return err
	}
	// author_name is snapshotted at write time so a removed user still renders
	// with a name — the app does the same, and a comment written by the CLI
	// must not read differently.
	name, err := authorName(ctx, c, userID)
	if err != nil {
		return err
	}

	payload := map[string]any{
		"drive_item":  doc.ID,
		"body":        body,
		"author":      userID,
		"author_name": name,
		"sheet_id":    sheet,
	}
	// A root comment anchors to a cell; a reply inherits its thread's anchor,
	// so --cell is only meaningful on a new thread.
	if cellRef != "" {
		row, col, err := parseCell(cellRef)
		if err != nil {
			return err
		}
		payload["row"], payload["col"] = row, col
	}
	if replyTo != "" {
		// Replies are one level deep: replying to a reply attaches to its
		// thread root, matching how the app nests them.
		parent, err := client.GetRecord[comment](ctx, c, commentsCollection, replyTo)
		if err != nil {
			return fmt.Errorf("%s: %w", replyTo, err)
		}
		if parent.DriveItem != doc.ID {
			return fmt.Errorf("%s is a comment on a different document", replyTo)
		}
		payload["parent_comment"] = threadOf(parent)
		// A reply carries its thread's anchor rather than one of its own:
		// sheet_id/row/col are all required by the collection, so a reply that
		// omitted them would be rejected outright, and one that invented its
		// own would detach the reply from the cell its thread hangs on.
		payload["sheet_id"] = parent.SheetID
		payload["row"], payload["col"] = parent.Row, parent.Col
	}

	created, err := client.CreateRecord[comment](ctx, c, commentsCollection, payload)
	if err != nil {
		return err
	}
	o.Info(cmd.ErrOrStderr(), "added comment %s on %s", created.ID, doc.Name)
	return o.Write(cmd.OutOrStdout(),
		[]string{"AUTHOR", "COMMENT", "ID"},
		[][]string{{created.AuthorName, oneLine(created.Body), created.ID}},
		created)
}

// setResolved marks a thread resolved or reopens it.
//
// Always applied to the thread ROOT: resolved_at lives there and replies
// inherit it, so stamping a reply would leave the thread open while looking
// resolved in the row the user acted on.
func setResolved(
	cmd *cobra.Command,
	c *client.Client,
	o output.Options,
	doc item,
	commentID string,
	resolved bool,
) error {
	ctx := cmd.Context()

	target, err := client.GetRecord[comment](ctx, c, commentsCollection, commentID)
	if err != nil {
		return fmt.Errorf("%s: %w", commentID, err)
	}
	if target.DriveItem != doc.ID {
		return fmt.Errorf("%s is a comment on a different document", commentID)
	}

	stamp := ""
	if resolved {
		stamp = time.Now().UTC().Format(time.RFC3339)
	}
	rootID := threadOf(target)
	if _, err := client.UpdateRecord[comment](ctx, c, commentsCollection, rootID,
		map[string]any{"resolved_at": stamp}); err != nil {
		return err
	}

	verb := "reopened"
	if resolved {
		verb = "resolved"
	}
	o.Info(cmd.ErrOrStderr(), "%s thread %s on %s", verb, rootID, doc.Name)
	return nil
}

// authorName reads the caller's display name for the snapshot field.
func authorName(ctx context.Context, c *client.Client, userID string) (string, error) {
	type userRow struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	u, err := client.GetRecord[userRow](ctx, c, "users", userID)
	if err != nil {
		return "", err
	}
	if u.Name != "" {
		return u.Name, nil
	}
	// An account with no display name still has an address, and a blank
	// author column reads as a bug.
	return u.Email, nil
}

// oneLine flattens a multi-line body for a table cell. The full text is in
// --json, which is where a caller goes for the whole thing.
func oneLine(s string) string {
	return strings.Join(strings.Fields(s), " ")
}
