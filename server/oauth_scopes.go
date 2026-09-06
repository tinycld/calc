package calc

import "tinycld.org/core/oauth"

const (
	scopeRead  = "calc:read"
	scopeWrite = "calc:write"
)

// oauthPackage declares what an OAuth token may reach in calc: ONLY the
// comment collection. The spreadsheets themselves are drive_items, governed
// by drive's scopes, so these are narrower than they look — a token that does
// anything useful with them holds drive:read too, and the comment rules reach
// through `drive_item` to the workbook's own access before any of this
// applies. Registered from registerShared.
func oauthPackage() oauth.Package {
	return oauth.Package{
		Slug: "calc",
		Scopes: []oauth.Scope{
			{ID: scopeRead, Label: "Read comments on your spreadsheets"},
			{ID: scopeWrite, Label: "Add and resolve comments on your spreadsheets"},
		},
		Collections: map[string]oauth.Access{
			"calc_comments": {Read: []string{scopeRead}, Write: []string{scopeWrite}},
		},
	}
}
