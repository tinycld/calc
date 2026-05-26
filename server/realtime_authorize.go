package calc

import (
	"encoding/json"
	"errors"
	"math"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/realtime"
	"tinycld.org/core/sharelink"
)

// roomKindCalc is the realtime roomKind name owned by this package.
// Each connection at /api/realtime/calc/<drive_item_id> is gated by
// the authorize handler registered below.
const roomKindCalc = "calc"

// errNoShare is returned when the user has no drive_shares row for the
// requested drive_item. It is the only kind of denial calc emits;
// distinguishing share roles (viewer vs. editor) happens client-side
// for now (a future save-back effort will enforce roles server-side).
var errNoShare = errors.New("calc: no drive_shares row for this user/item")

// registerRealtime is called once at startup from Register(). It plugs
// the calc authorize handler, the y-crdt Runtime, and the
// SaveCoordinator into core's realtime registry. The closures
// capture `app` so they can run share-access queries and persist
// XLSX bytes back to drive_items.
//
// Wiring:
//   - Authorize: enforces drive_shares membership before the WS
//     upgrade.
//   - RuntimeProvider: hands out per-room server-side Y.Doc handles.
//   - OnRoomCreate / OnDocUpdate / OnEmpty: the save coordinator
//     consumes broker events to drive debounce/ceiling/teardown
//     persistence.
//   - Runtime.SetBootstrap: server reads the drive_items xlsx and
//     populates the doc before the broker's first SyncReply, so
//     clients never see xlsx bytes.
func registerRealtime(app *pocketbase.PocketBase) {
	runtime := NewRuntime()
	runtime.SetBootstrap(makeXLSXBootstrap(app))

	journal := realtime.NewPocketBaseJournal(app)
	coordinator := realtime.NewSaveCoordinator(MakeProductionFlush(app))
	coordinator.SetJournal(roomKindCalc, journal)

	realtime.RegisterRoomKindWith(roomKindCalc, realtime.RoomKindOptions{
		Authorize: func(auth *core.Record, roomID string) error {
			if auth == nil || auth.Id == "" {
				return errNoShare
			}
			return checkDriveItemAccess(app, auth.Id, roomID)
		},
		// Anonymous editable-link visitors: admit only when the share
		// link is still live and grants edit. The session token was
		// already signature-verified by the transport; we re-resolve the
		// link here so revocation/expiry/downgrade takes effect at
		// connect time.
		AuthorizeShare: func(claims realtime.ShareClaims, roomID string) error {
			return authorizeAnonShare(app, claims, roomID)
		},
		RuntimeProvider: runtime,
		Journal:         journal,
		OnRoomCreate:    coordinator.OnRoomCreate,
		OnDocUpdate:     coordinator.OnDocUpdate,
		OnDocUpdateSeq:  coordinator.NoteSeq,
		OnEmpty:         coordinator.OnRoomEmpty,
		OnConnect:       makeOnConnect(app),
		// Server-side write gate: drop mutations from read-only
		// connections (viewer members; anon viewers once admitted). This
		// is what makes calc's read-only mode real rather than client-only.
		WritePredicate: func(c *realtime.Client, roomID string) bool {
			return !isReadOnlyForConn(app, roomID, c)
		},
	})

	// Cascade-clean WAL rows when a drive_items record (calc workbook)
	// is deleted. Scoped to room_kind = "calc"; other kinds register
	// their own parallel hook. math.MaxInt64 as the upper bound
	// effectively truncates every row regardless of seq.
	app.OnRecordAfterDeleteSuccess("drive_items").BindFunc(func(e *core.RecordEvent) error {
		if err := journal.Truncate(roomKindCalc, e.Record.Id, math.MaxInt64); err != nil {
			app.Logger().Warn("calc: WAL cleanup on drive_items delete failed",
				"itemID", e.Record.Id, "err", err)
		}
		return e.Next()
	})
}

// memberCanWrite reports whether the authenticated user holds an
// owner/editor drive_shares role on the item (viewers get read-only).
// Returns false on any lookup error — fail closed. Mirrors text's
// resolveShareRole().canWrite() but collapsed to a bool since calc only
// needs the write decision.
func memberCanWrite(app core.App, userID, driveItemID string) bool {
	rows, err := app.FindRecordsByFilter(
		"drive_shares",
		"item = {:item} && user_org.user = {:user}",
		"", 0, 0,
		map[string]any{"item": driveItemID, "user": userID},
	)
	if err != nil || len(rows) == 0 {
		return false
	}
	for _, r := range rows {
		switch r.GetString("role") {
		case "owner", "editor":
			return true
		}
	}
	return false
}

// isReadOnlyForConn decides whether the connecting client gets a
// read-only editor. Anonymous share-session visitors are admitted only
// for editor-role links today (see authorizeAnonShare), so an anon here
// is writable iff its share role is editor. Authenticated members are
// writable iff they hold an owner/editor drive_shares role; viewer
// members (and any lookup failure) are read-only — fail closed.
func isReadOnlyForConn(app core.App, roomID string, conn *realtime.Client) bool {
	if conn.IsAnonymous() {
		return conn.ShareRole() != sharelink.RoleEditor
	}
	userID := conn.AuthID()
	if userID == "" {
		return true
	}
	return !memberCanWrite(app, userID, roomID)
}

// calcServerHello is the JSON payload of the MsgServerHello frame calc
// sends each joining client. The client decodes it via the symmetric TS
// type in @tinycld/calc/hooks/use-realtime. Mirrors text's serverHello
// but carries only readOnly (calc has no import-warning concept).
type calcServerHello struct {
	ReadOnly bool `json:"readOnly"`
}

// makeOnConnect builds the per-client ServerHelloFn: { readOnly }.
func makeOnConnect(app core.App) realtime.ServerHelloFn {
	return func(roomID string, conn *realtime.Client) ([]byte, error) {
		return json.Marshal(calcServerHello{ReadOnly: isReadOnlyForConn(app, roomID, conn)})
	}
}

// authorizeAnonShare admits an anonymous editable-link visitor to a calc
// room. It re-resolves the share link (so a revoked/expired/downgraded
// link is rejected at connect time, not just at mint time) and requires
// an editor role bound to this exact drive_item. Read-only/commentor
// links never reach the realtime editor — they use the HTML preview.
//
// LOAD-BEARING: calc now has a server-side WritePredicate + read-only
// serverHello (added alongside this), so a read-only connection cannot
// mutate the Y.Doc even if its client ignores the readOnly flag. This
// function still admits ONLY editor-role anonymous links; admitting
// viewer/commentor anons (in read-only mode) is a separate change that
// pairs with the public share route. Until then, anon = editor = writable.
func authorizeAnonShare(app *pocketbase.PocketBase, claims realtime.ShareClaims, roomID string) error {
	if claims.ItemID != roomID {
		return errNoShare
	}
	link, item, err := sharelink.ResolveLink(app, claims.ShareToken)
	if err != nil {
		return err
	}
	if item.Id != roomID {
		return errNoShare
	}
	if link.GetString("role") != sharelink.RoleEditor {
		return errNoShare
	}
	return nil
}

// checkDriveItemAccess returns nil iff the user identified by userID has
// at least one drive_shares row connecting them (via any of their
// user_org records) to the given drive_item.
//
// Mirrors the shape of the PB RLS rule:
//
//	item.drive_shares_via_item.user_org.user ?= @request.auth.id
//
// We do the lookup directly against drive_shares rather than walking
// through drive_items because the room admission only cares whether
// *any* share row exists for this (user, item) pair — role-level
// distinctions are enforced elsewhere.
func checkDriveItemAccess(app *pocketbase.PocketBase, userID, driveItemID string) error {
	rows, err := app.FindRecordsByFilter(
		"drive_shares",
		"item = {:item} && user_org.user = {:user}",
		"",
		1,
		0,
		map[string]any{"item": driveItemID, "user": userID},
	)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return errNoShare
	}
	return nil
}
