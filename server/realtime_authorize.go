package calc

import (
	"encoding/json"
	"math"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/driveshare"
	"tinycld.org/core/realtime"
	"tinycld.org/core/sharelink"
)

// roomKindCalc is the realtime roomKind name owned by this package.
// Each connection at /api/realtime/calc/<drive_item_id> is gated by
// the authorize handler registered below.
const roomKindCalc = "calc"

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
func registerRealtime(app core.App) {
	runtime := NewRuntime()
	runtime.SetBootstrap(makeXLSXBootstrap(app))

	journal := realtime.NewPocketBaseJournal(app)
	coordinator := realtime.NewSaveCoordinator(MakeProductionFlush(app))
	coordinator.SetJournal(roomKindCalc, journal)

	realtime.RegisterRoomKindWith(roomKindCalc, realtime.RoomKindOptions{
		Authorize: func(auth *core.Record, roomID string) error {
			if auth == nil || auth.Id == "" {
				return driveshare.ErrNoAccess
			}
			return driveshare.CheckRead(app, auth.Id, roomID)
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
		ForceFlush:      coordinator.FlushNow,
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
		readOnly := sharelink.ReadOnlyForConn(app, roomID, conn)
		// Cache on the connection so the broker's WritePredicate (hot
		// path, every MsgDocUpdate) is a pure field read, not a per-frame
		// DB query. Role can't change mid-session.
		conn.SetReadOnly(readOnly)
		return json.Marshal(calcServerHello{ReadOnly: readOnly})
	}
}

// authorizeAnonShare admits an anonymous share-link visitor to a calc room —
// the shared sharelink.AuthorizeAnonRoom policy adapted to realtime's
// ShareClaims shape.
func authorizeAnonShare(app core.App, claims realtime.ShareClaims, roomID string) error {
	return sharelink.AuthorizeAnonRoom(app, claims.ShareToken, claims.ItemID, roomID)
}
