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
		// Pure in-memory check: read-only was resolved once in OnConnect
		// (SetReadOnly) — do NOT re-query the DB here, this runs on every
		// inbound MsgDocUpdate. Relies on OnConnect having run first (it
		// does: OnConnect fires during the handshake before the read loop).
		WritePredicate: func(c *realtime.Client, _ string) bool {
			return !c.ReadOnly()
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
//
// Org isolation: the share's user_org.org must equal the item's owning
// org. Without this check, a stale share row pointing at item X (added
// when X belonged to org A) would still grant write after the auth
// user has left org A and X has been moved to org B — PB SDK methods
// bypass API rules, so the implicit org filter from the collection
// rule does NOT apply here. We re-implement the predicate explicitly,
// matching the canonical filter in text/server/authorize.go.
func memberCanWrite(app core.App, userID, driveItemID string) bool {
	item, err := app.FindRecordById(driveItemsCollection, driveItemID)
	if err != nil {
		return false
	}
	orgID := item.GetString("org")
	if orgID == "" {
		return false
	}
	rows, err := app.FindRecordsByFilter(
		"drive_shares",
		"item = {:item} && user_org.user = {:user} && user_org.org = {:org}",
		"", 0, 0,
		map[string]any{"item": driveItemID, "user": userID, "org": orgID},
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
		readOnly := isReadOnlyForConn(app, roomID, conn)
		// Cache on the connection so the broker's WritePredicate (hot
		// path, every MsgDocUpdate) is a pure field read, not a per-frame
		// DB query. Role can't change mid-session.
		conn.SetReadOnly(readOnly)
		return json.Marshal(calcServerHello{ReadOnly: readOnly})
	}
}

// authorizeAnonShare admits an anonymous share-link visitor to a calc room.
// It re-resolves the share link (so a revoked/expired/downgraded link is
// rejected at connect time, not just at mint time) and admits any recognized
// share role (viewer, commentor, or editor) bound to this exact drive_item.
// Non-editor roles are admitted read-only: write enforcement is delegated to
// the broker's WritePredicate (isReadOnlyForConn / SetReadOnly in OnConnect).
func authorizeAnonShare(app core.App, claims realtime.ShareClaims, roomID string) error {
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
	role := link.GetString("role")
	switch role {
	case sharelink.RoleViewer, sharelink.RoleCommentor, sharelink.RoleEditor:
		// Admit — read-only enforcement for non-editor roles happens via
		// the broker WritePredicate (isReadOnlyForConn), so viewers and
		// commentors may open the room but cannot write.
	default:
		return errNoShare
	}
	return nil
}

// checkDriveItemAccess returns nil iff the user identified by userID has
// at least one drive_shares row connecting them (via a user_org in the
// same org that owns the drive_item) to the given drive_item.
//
// Mirrors the shape of the PB RLS rule:
//
//	item.drive_shares_via_item.user_org.user ?= @request.auth.id
//
// We do the lookup directly against drive_shares rather than walking
// through drive_items because the room admission only cares whether
// *any* share row exists for this (user, item) pair — role-level
// distinctions are enforced elsewhere.
//
// Org isolation: the share's user_org.org must equal the item's owning
// org so a stale share row from a previous org membership cannot
// silently grant access after the item is moved to a different org.
// Mirrors the canonical filter in text/server/authorize.go.
func checkDriveItemAccess(app core.App, userID, driveItemID string) error {
	item, err := app.FindRecordById(driveItemsCollection, driveItemID)
	if err != nil {
		return errNoShare
	}
	orgID := item.GetString("org")
	if orgID == "" {
		return errNoShare
	}
	rows, err := app.FindRecordsByFilter(
		"drive_shares",
		"item = {:item} && user_org.user = {:user} && user_org.org = {:org}",
		"",
		1,
		0,
		map[string]any{"item": driveItemID, "user": userID, "org": orgID},
	)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return errNoShare
	}
	return nil
}
