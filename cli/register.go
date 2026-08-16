// Package cli contributes the `tinycld calc` command group.
//
// The group is deliberately SMALL, and the reason is worth stating so nobody
// "completes" it by mistake:
//
//   - A SPREADSHEET IS A DRIVE ITEM. calc owns the comments on spreadsheets
//     and nothing else — the workbooks themselves live in drive_items, which
//     `tinycld drive` already lists, uploads, downloads, moves, and deletes.
//     A `calc new` here would be a second code path creating drive items,
//     duplicating what drive/cli already owns and tests. Create a workbook
//     with `tinycld drive put`.
//
//   - THE GRID IS NOT SCRIPTABLE. A workbook's cells live in the stored
//     spreadsheet file, edited through the app. There is no meaningful "write
//     a formula from a shell" operation that would not clobber concurrent
//     edits, so none is offered. `tinycld drive get` fetches the file.
//
// What is left — and what people actually want from a terminal — is the
// comment surface: seeing what has been asked on a document, answering, and
// resolving. That is this package.
//
// Comments reach their workbook through `drive_item`, and the access rules
// admit only its creator or someone it is shared with. So a useful token holds
// drive:read as well as calc:read; calc:* governs the comment collection
// itself, not the workbooks.
package cli

import (
	"github.com/spf13/cobra"

	"tinycld.org/cli/client"
)

func Register(root *cobra.Command, c *client.Client) {
	calc := &cobra.Command{
		Use:   "calc",
		Short: "Spreadsheets: read and answer comments",
		Long: "Comments on your spreadsheets.\n\n" +
			"The workbooks themselves are Drive files — use `tinycld drive` to\n" +
			"create, list, download, and delete them.",
	}
	calc.AddCommand(newCommentsCmd(c))
	root.AddCommand(calc)
}
