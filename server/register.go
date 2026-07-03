package calc

import (
	_ "embed"

	"github.com/pocketbase/pocketbase"

	"tinycld.org/core/blankfile"
	"tinycld.org/core/userorg"
)

// xlsxMimeType is the drive_items.mime_type for spreadsheets — matches the
// client's XLSX_MIME_TYPE (calc/tinycld/calc/types.ts).
const xlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

// blankXLSX is a minimal valid empty workbook, attached server-side to a
// blank-sheet create that arrives with no file. Same bytes the client used to
// upload (calc/tinycld/calc/lib/blank-workbook.bytes.ts).
//
//go:embed blank.xlsx
var blankXLSX []byte

// Register wires server-side hooks for the Sheets package. Core's
// generator injects a call to this function from `server/package_extensions.go`
// once the package is linked.
//
// Typical responsibilities:
//   - Register audit hooks for your collections (see tinycld.org/core/audit).
//   - Bind record lifecycle hooks via `app.OnRecordCreate("...").BindFunc(...)`.
//   - Register HTTP endpoints via `app.OnServe().BindFunc(...)`.
//
// See contacts/server/register.go or calendar/server/register.go for richer
// examples.
func Register(app *pocketbase.PocketBase) {
	userorg.RegisterReassignable(userorg.ReassignableRef{Collection: "calc_comments", Field: "author"})

	// Attach a blank workbook server-side when a new sheet is created with no
	// file — the client just inserts the drive_items row (no Blob upload).
	blankfile.Register(app, xlsxMimeType, "spreadsheet.xlsx", blankXLSX)

	registerRealtime(app)
	registerAPI(app)
}
