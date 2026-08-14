package calc

import (
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/automation"
	"tinycld.org/core/driveshare"
)

// registerAutomation installs calc's owner resolver. Called from
// registerShared before hooks load.
func registerAutomation() {
	automation.RegisterOwnerResolver("calc:comment-added", commentOwnerResolver)
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
