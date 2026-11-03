package calc

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/automation"
	"tinycld.org/core/driveshare"
)

// registerAutomation installs calc's owner resolver and its append-row
// action. Called from registerShared before hooks load.
func registerAutomation() {
	automation.RegisterOwnerResolver("calc:comment-added", commentOwnerResolver)
	automation.RegisterAction("calc:append-row", appendRow)
	automation.RegisterRelationAuthorizer("calc:append-row", "workbook", workbookAuthorizer)
}

// commentOwnerResolver maps a new calc_comments row to the users a comment on
// that workbook belongs to: everyone who can reach the workbook.
//
// calc_comments.author is a relation to users, so the engine's auto-detection
// would find it without this — but that scopes a personal rule to whoever
// wrote the comment, firing "when I comment" rather than the rule people
// actually want, "when someone comments on my workbook".
//
// Participants come from core (driveshare.ParticipantIDs) rather than being
// derived here. Workbooks ARE drive_items, so the creator/share/suspension
// rules that decide who can open one live in drive's authorization code; a
// second copy in this package would drift from it, and an owner resolver that
// over-reports fires OTHER users' personal rules on a workbook they cannot
// see.
//
// Returns nil (never an error) on absent or malformed data so org-scoped rules
// still fire when no personal owner can be determined.
func commentOwnerResolver(app core.App, record *core.Record) []string {
	if record == nil {
		return nil
	}
	itemID := record.GetString("drive_item")
	if itemID == "" {
		return nil
	}
	return driveshare.ParticipantIDs(app, itemID)
}

// workbookAuthorizer: the rule's owner may write the workbook, and it is a
// spreadsheet. The picker lists only spreadsheets, and the engine checks
// relationMatch too; this check also covers an owner who lost write access
// after the rule was saved.
func workbookAuthorizer(app core.App, req automation.ActionRequest, itemID string) error {
	item, err := app.FindRecordById(driveItemsCollection, itemID)
	if err != nil {
		return fmt.Errorf("workbook %s: %w", itemID, err)
	}
	if item.GetBool("is_folder") || item.GetString("mime_type") != xlsxMimeType {
		return fmt.Errorf("%q is not a spreadsheet", item.GetString("name"))
	}
	if err := driveshare.CheckWrite(app, req.OwnerID, itemID); err != nil {
		return fmt.Errorf("the rule's owner may not edit %q", item.GetString("name"))
	}
	return nil
}

// appendRow adds the trigger's row (its exposed fields, then a web form's
// answers) to the workbook. The authorizer has already run.
func appendRow(app core.App, req automation.ActionRequest) error {
	itemID := req.Params["workbook"]
	if itemID == "" {
		return fmt.Errorf("calc:append-row: no workbook")
	}
	values := automation.TriggerRow(app, req)
	if len(values) == 0 {
		return fmt.Errorf("calc:append-row: the trigger has no fields to write")
	}
	return AppendRow(req.Context(), app, itemID, req.Params["sheet"], values)
}
