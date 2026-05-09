package calc

import (
	"net/http"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// previewRowCap and previewColCap bound the response size for the
// preview endpoint. Matches the client-side caps that CalcPreview.tsx
// renders, so reading further would just bloat the JSON the
// thumbnail discards. Bumping either is a one-line change here.
const (
	previewRowCap = 50
	previewColCap = 26
)

// registerAPI binds the calc HTTP endpoints. Called from Register at
// startup. Each endpoint runs through the standard PocketBase auth
// middleware (so re.Auth is non-nil) and additionally enforces drive
// share access via checkDriveItemAccess — same gate the realtime
// authorize uses.
func registerAPI(app *pocketbase.PocketBase) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET("/api/calc/preview/{id}", func(re *core.RequestEvent) error {
			return handlePreview(app, re)
		}).BindFunc(requireAuthCalc)
		return e.Next()
	})
}

// requireAuthCalc rejects unauthenticated requests with a 401. PB sets
// re.Auth from the Authorization header (Bearer token) or from the
// pb_auth cookie — both are populated transparently by core's serve
// middleware before our handler runs.
func requireAuthCalc(re *core.RequestEvent) error {
	if re.Auth == nil {
		return re.UnauthorizedError("Authentication required", nil)
	}
	return re.Next()
}

// handlePreview returns the WorkbookModel for the drive_item identified
// by `:id`, capped at the first sheet's first 50×26 region. The
// response shape matches the TS WorkbookModel exactly (sheets[].cells
// keyed by "row:col"), so the client can drop it straight into the
// existing CalcPreview render path.
func handlePreview(app *pocketbase.PocketBase, re *core.RequestEvent) error {
	driveItemID := re.Request.PathValue("id")
	if driveItemID == "" {
		return re.BadRequestError("missing drive_item id", nil)
	}
	if err := checkDriveItemAccess(app, re.Auth.Id, driveItemID); err != nil {
		return re.ForbiddenError("no access to this drive item", nil)
	}
	item, err := app.FindRecordById(driveItemsCollection, driveItemID)
	if err != nil {
		return re.NotFoundError("drive item not found", err)
	}
	xlsxBytes, err := readDriveItemBytes(app, item)
	if err != nil {
		return re.InternalServerError("could not read file", err)
	}
	if len(xlsxBytes) == 0 {
		return re.JSON(http.StatusOK, WorkbookModel{Sheets: []WorksheetModel{}})
	}
	model, err := ReadWorkbookFromXLSX(xlsxBytes, previewRowCap, previewColCap)
	if err != nil {
		return re.InternalServerError("could not parse spreadsheet", err)
	}
	// Preview only renders the first sheet; trim before sending so the
	// JSON size scales with what the client actually needs.
	if len(model.Sheets) > 1 {
		model.Sheets = model.Sheets[:1]
	}
	return re.JSON(http.StatusOK, model)
}
