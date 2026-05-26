package calc

import (
	"encoding/json"
	"testing"

	"tinycld.org/core/realtime"
)

// TestIsReadOnlyForConn covers the read-only signal that gets shipped in
// MsgServerHello. owner/editor → false; viewer → true; missing share or
// empty auth → true (fail closed). Mirrors text's TestIsReadOnlyForConn.
func TestIsReadOnlyForConn(t *testing.T) {
	app := setupAuthTestApp(t)
	editor := mustCreateUser(t, app, "editor@example.com")
	viewer := mustCreateUser(t, app, "viewer@example.com")
	owner := mustCreateUser(t, app, "owner@example.com")
	stranger := mustCreateUser(t, app, "stranger@example.com")
	item := seedDriveItemInOrg(t, app, "org-acme", "workbook.xlsx")

	editorUO := seedUserOrg(t, app, editor.Id, "org-acme")
	seedShare(t, app, item.Id, editorUO, "editor")
	viewerUO := seedUserOrg(t, app, viewer.Id, "org-acme")
	seedShare(t, app, item.Id, viewerUO, "viewer")
	ownerUO := seedUserOrg(t, app, owner.Id, "org-acme")
	seedShare(t, app, item.Id, ownerUO, "owner")
	// stranger has no share row

	cases := []struct {
		name   string
		authID string
		wantRO bool
	}{
		{"editor", editor.Id, false},
		{"owner", owner.Id, false},
		{"viewer", viewer.Id, true},
		{"stranger (no row)", stranger.Id, true},
		{"empty-auth", "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			conn := realtime.NewClientForTest(c.authID)
			if got := isReadOnlyForConn(app, item.Id, conn); got != c.wantRO {
				t.Errorf("isReadOnlyForConn(%s): got %v, want %v", c.name, got, c.wantRO)
			}
		})
	}
}

// TestMakeOnConnect_ServerHello verifies makeOnConnect returns a valid
// JSON payload with the correct readOnly value for editor and viewer members.
func TestMakeOnConnect_ServerHello(t *testing.T) {
	app := setupAuthTestApp(t)
	editor := mustCreateUser(t, app, "editor2@example.com")
	viewer := mustCreateUser(t, app, "viewer2@example.com")
	item := seedDriveItemInOrg(t, app, "org-acme", "workbook2.xlsx")

	editorUO := seedUserOrg(t, app, editor.Id, "org-acme")
	seedShare(t, app, item.Id, editorUO, "editor")
	viewerUO := seedUserOrg(t, app, viewer.Id, "org-acme")
	seedShare(t, app, item.Id, viewerUO, "viewer")

	helloFn := makeOnConnect(app)

	t.Run("editor gets readOnly=false", func(t *testing.T) {
		conn := realtime.NewClientForTest(editor.Id)
		data, err := helloFn(item.Id, conn)
		if err != nil {
			t.Fatalf("makeOnConnect returned error: %v", err)
		}
		var hello calcServerHello
		if err := json.Unmarshal(data, &hello); err != nil {
			t.Fatalf("unmarshal serverHello: %v", err)
		}
		if hello.ReadOnly {
			t.Error("editor: want readOnly=false, got true")
		}
	})

	t.Run("viewer gets readOnly=true", func(t *testing.T) {
		conn := realtime.NewClientForTest(viewer.Id)
		data, err := helloFn(item.Id, conn)
		if err != nil {
			t.Fatalf("makeOnConnect returned error: %v", err)
		}
		var hello calcServerHello
		if err := json.Unmarshal(data, &hello); err != nil {
			t.Fatalf("unmarshal serverHello: %v", err)
		}
		if !hello.ReadOnly {
			t.Error("viewer: want readOnly=true, got false")
		}
	})
}
