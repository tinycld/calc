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
	registerShared(app)
	// No host-only tail: calc binds no listener and mounts no protocol
	// server, so the single-org app and a multi-org tenant run the same set.
	// If a host-only registration ever appears, move it here with a reason —
	// never fork registerShared (see
	// multi-org/docs/FINDING-tenant-composition-gap.md).
}

// RegisterTenant composes the calc server for a multi-org TENANT process. The
// router's pinned package menu calls it, gated by the org's resolved package
// set (multi-org/docs/SCOPE-tenant-feature-go.md). Identical to Register
// today; the two entries exist so the host/tenant seam is uniform across
// feature packages.
func RegisterTenant(app *pocketbase.PocketBase) {
	registerShared(app)
}

// registerShared is the single source of truth for what BOTH compositions run.
func registerShared(app *pocketbase.PocketBase) {
	userorg.RegisterReassignable(userorg.ReassignableRef{Collection: "calc_comments", Field: "author"})

	// Attach a blank workbook server-side when a new sheet is created with no
	// file — the client just inserts the drive_items row (no Blob upload).
	blankfile.Register(app, xlsxMimeType, "spreadsheet.xlsx", blankXLSX)

	registerRealtime(app)
	registerAPI(app)
}
