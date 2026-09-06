package calc

import (
	"testing"

	"tinycld.org/core/oauth"
)

// The comment commands are calc's whole CLI surface; an unclassified
// collection 403s for OAuth callers only, which the CLI's fake server never
// sees.
func TestOAuthClassifiesCommentCollection(t *testing.T) {
	oauth.RegisterPackage(oauthPackage())

	for _, r := range []struct{ method, path, scope string }{
		{"GET", "/api/collections/calc_comments/records", scopeRead},
		{"POST", "/api/collections/calc_comments/records", scopeWrite},
		{"PATCH", "/api/collections/calc_comments/records/abc123", scopeWrite},
	} {
		rule := oauth.ScopeForRoute(r.method, r.path)
		if len(rule) == 0 {
			t.Errorf("%s %s is default-denied for OAuth callers", r.method, r.path)
			continue
		}
		if !rule.SatisfiedBy([]string{r.scope}) {
			t.Errorf("%s %s: %q must admit it (got %v)", r.method, r.path, r.scope, rule)
		}
	}
	if oauth.ScopeForRoute("POST", "/api/collections/calc_comments/records").SatisfiedBy([]string{scopeRead}) {
		t.Error("calc:read alone must not admit a comment write")
	}
}
