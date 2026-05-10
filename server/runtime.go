package calc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"

	ycrdt "github.com/skyterra/y-crdt"

	"tinycld.org/core/realtime"
)

// Runtime is the calc package's server-side Y.Doc registry. One per
// process; the broker calls NewDoc once per active room and the
// returned handle owns the room's mirror until Close.
//
// Backed by github.com/skyterra/y-crdt (a native-Go yjs decoder /
// encoder). Operations on a single Y.Doc serialize through that doc's
// own internal state machine; the per-room mutex below only guards the
// docs map itself.
type Runtime struct {
	// bootstrap, when non-nil, runs synchronously inside NewDoc with
	// the freshly-minted Y.Doc. Production wires this to load the
	// drive_items xlsx and stamp it into the doc, so the broker's
	// first SyncReply already carries populated sheets/cells. Tests
	// leave it nil — they construct doc state via ApplyUpdate.
	bootstrap func(roomID string, doc *ycrdt.Doc) error

	mu   sync.Mutex
	docs map[string]*ycrdt.Doc
}

// NewRuntime returns an empty Runtime. Cheap; no doc state is allocated
// until NewDoc is called.
func NewRuntime() *Runtime {
	return &Runtime{docs: map[string]*ycrdt.Doc{}}
}

// SetBootstrap registers a per-room bootstrap hook. NewDoc invokes the
// hook (if set) inside the same critical section that creates the doc,
// so MsgSyncRequest replies are guaranteed to see the populated state.
//
// A nil hook disables bootstrap (for tests). Passing nil after a hook
// has been registered clears it.
func (r *Runtime) SetBootstrap(hook func(roomID string, doc *ycrdt.Doc) error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.bootstrap = hook
}

// NewDoc satisfies realtime.DocRuntime: mints a fresh server-side
// Y.Doc identified by the broker's roomID and returns an opaque
// handle the broker calls into for the room's lifetime.
//
// If a bootstrap hook is registered, it runs synchronously after the
// doc is created. Bootstrap failures are logged but do not abort the
// room creation — a partially-bootstrapped (or empty) doc is preferable
// to refusing the connection, since a peer-driven SyncRequest path
// can still recover (the client treats an empty SyncReply as "you're
// alone" and previously fell back to its own xlsx parse).
func (r *Runtime) NewDoc(roomID string) (realtime.DocHandle, error) {
	r.mu.Lock()
	if _, exists := r.docs[roomID]; exists {
		r.mu.Unlock()
		return nil, fmt.Errorf("calc: room %s already has a Y.Doc", roomID)
	}
	doc := ycrdt.NewDoc(roomID, false, nil, nil, false)
	r.docs[roomID] = doc
	hook := r.bootstrap
	r.mu.Unlock()

	if hook != nil {
		if err := hook(roomID, doc); err != nil {
			slog.Warn("calc: bootstrap hook failed; room continues with empty doc",
				"roomID", roomID, "err", err)
		}
	}
	return &sheetsDocHandle{runtime: r, id: roomID, doc: doc}, nil
}

// closeDoc removes the doc from the registry. Returns true if the
// doc was registered. Safe to call multiple times.
func (r *Runtime) closeDoc(roomID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.docs[roomID]; !ok {
		return false
	}
	delete(r.docs, roomID)
	return true
}

// sheetsDocHandle is the broker's handle on one room's server-side
// Y.Doc.
type sheetsDocHandle struct {
	runtime *Runtime
	id      string

	mu     sync.Mutex
	doc    *ycrdt.Doc // nil after Close
	closed bool
}

// ApplyUpdate folds an inbound MsgDocUpdate payload into the server's
// mirror of the room's Y.Doc.
//
// y-crdt's ApplyUpdate logs and silently returns on malformed bytes
// rather than surfacing a decode error. The defer/recover guards
// against that contract regressing — a future panic-on-bad-input
// change in the library would otherwise take down the broker
// goroutine on hostile client input.
func (h *sheetsDocHandle) ApplyUpdate(payload []byte) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.doc == nil {
		return fmt.Errorf("calc: ApplyUpdate on closed room %s", h.id)
	}
	var applyErr error
	func() {
		defer func() {
			if r := recover(); r != nil {
				applyErr = fmt.Errorf("calc: ApplyUpdate panic for room %s: %v", h.id, r)
			}
		}()
		ycrdt.ApplyUpdate(h.doc, payload, nil)
	}()
	return applyErr
}

// EncodeStateAsUpdate returns the bytes a new joiner needs to catch
// up to the room's current state. Wrapped by the broker in a
// MsgSyncReply frame.
func (h *sheetsDocHandle) EncodeStateAsUpdate() ([]byte, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.doc == nil {
		return nil, fmt.Errorf("calc: EncodeStateAsUpdate on closed room %s", h.id)
	}
	return ycrdt.EncodeStateAsUpdate(h.doc, nil), nil
}

// Close releases the room's Y.Doc so it can be garbage-collected.
func (h *sheetsDocHandle) Close() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	h.closed = true
	h.doc = nil
	h.runtime.closeDoc(h.id)
	return nil
}

// Snapshot returns a Go-native, point-in-time view of the room's
// Y.Doc. The serializer in persist.go consumes this; nothing in this
// path crosses the realtime wire.
func (h *sheetsDocHandle) Snapshot() (YDocSnapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.doc == nil {
		return YDocSnapshot{}, fmt.Errorf("calc: Snapshot on closed room %s", h.id)
	}

	sheetsRaw := h.doc.GetMap("sheets")
	cellsRaw := h.doc.GetMap("cells")
	sheetsMap, _ := sheetsRaw.(*ycrdt.YMap)
	cellsMap, _ := cellsRaw.(*ycrdt.YMap)

	snap := YDocSnapshot{}
	if sheetsMap != nil {
		sheets, err := collectSheets(sheetsMap)
		if err != nil {
			return YDocSnapshot{}, err
		}
		snap.Sheets = sheets
	}
	if cellsMap != nil {
		cells, err := collectCells(cellsMap)
		if err != nil {
			return YDocSnapshot{}, err
		}
		snap.Cells = cells
	}
	return snap, nil
}

// collectSheets walks the top-level "sheets" YMap and returns sheet
// metadata sorted by position. Each value should itself be a YMap
// holding name/position/rowCount/colCount and optionally the sparse
// rowHeights/colWidths/rowStyles maps (decoded inline below).
// Non-YMap values are skipped — they would indicate a schema violation
// but we'd rather ship a partial snapshot than fail the whole save.
// Style-decode failures bubble up as errors so the save can retry
// rather than silently persist a partial snapshot.
func collectSheets(sheetsMap *ycrdt.YMap) ([]SheetMeta, error) {
	out := make([]SheetMeta, 0, sheetsMap.GetSize())
	var collectErr error
	sheetsMap.ForEach(func(sheetID string, value any, _ *ycrdt.YMap) {
		if collectErr != nil {
			return
		}
		meta, ok := value.(*ycrdt.YMap)
		if !ok {
			return
		}
		name, _ := meta.Get("name").(string)
		if name == "" {
			name = sheetID
		}
		rowStyles, err := decodeSparseStyleMap(meta, "rowStyles")
		if err != nil {
			collectErr = err
			return
		}
		out = append(out, SheetMeta{
			ID:         sheetID,
			Name:       name,
			Position:   numberFromAny(meta.Get("position")),
			RowCount:   numberFromAny(meta.Get("rowCount")),
			ColCount:   numberFromAny(meta.Get("colCount")),
			RowHeights: decodeSparseIntMap(meta, "rowHeights"),
			ColWidths:  decodeSparseIntMap(meta, "colWidths"),
			RowStyles:  rowStyles,
		})
	})
	if collectErr != nil {
		return nil, collectErr
	}
	// Stable sort by position (slice index is what the serializer
	// uses to align with existing-sheet positions on disk).
	sortSheetsByPosition(out)
	return out, nil
}

// collectCells walks the top-level "cells" YMap. Keys are
// "<sheetID>:<row>:<col>" strings produced by yCellKey.ts; values are
// per-cell YMaps holding kind/raw/display/formula/style.
func collectCells(cellsMap *ycrdt.YMap) ([]CellEntry, error) {
	out := make([]CellEntry, 0, cellsMap.GetSize())
	var collectErr error
	cellsMap.ForEach(func(key string, value any, _ *ycrdt.YMap) {
		if collectErr != nil {
			return
		}
		cellMap, ok := value.(*ycrdt.YMap)
		if !ok {
			return
		}
		sheetID, row, col, ok := parseCellKey(key)
		if !ok {
			return
		}
		entry := CellEntry{
			SheetID: sheetID,
			Row:     row,
			Col:     col,
		}
		if k, ok := cellMap.Get("kind").(string); ok {
			entry.Kind = k
		}
		switch raw := cellMap.Get("raw").(type) {
		case string:
			entry.RawString = raw
		case float64:
			n := raw
			entry.RawNumber = &n
		case float32:
			n := float64(raw)
			entry.RawNumber = &n
		case int:
			n := float64(raw)
			entry.RawNumber = &n
		case int32:
			n := float64(raw)
			entry.RawNumber = &n
		case int64:
			n := float64(raw)
			entry.RawNumber = &n
		case bool:
			b := raw
			entry.RawBool = &b
		}
		if d, ok := cellMap.Get("display").(string); ok {
			entry.Display = d
		}
		if f, ok := cellMap.Get("formula").(string); ok {
			entry.Formula = f
		}
		if styleVal := cellMap.Get("style"); styleVal != nil {
			if styleMap, ok := styleVal.(*ycrdt.YMap); ok {
				cs, err := decodeCellStyle(styleMap)
				if err != nil {
					collectErr = fmt.Errorf("decode style for %s!%d:%d: %w", sheetID, row, col, err)
					return
				}
				entry.Style = cs
			}
		}
		out = append(out, entry)
	})
	if collectErr != nil {
		return nil, collectErr
	}
	return out, nil
}

// decodeCellStyle converts a style YMap (groups → leaves, mirroring
// the TS CellStyle shape) into *CellStyle. Returns nil when the style
// is structurally empty so callers can leave the cell's existing
// on-disk style alone.
//
// We flatten the YMap into a plain map and round-trip through
// json.Marshal+Unmarshal so the existing CellStyle json tags drive
// the camelCase ↔ PascalCase translation. This keeps "add a
// structurally-trivial attribute" a one-line edit on the TS+Go types
// and zero changes here.
func decodeCellStyle(styleMap *ycrdt.YMap) (*CellStyle, error) {
	flat := flattenStyleMap(styleMap)
	if len(flat) == 0 {
		return nil, nil
	}
	buf, err := json.Marshal(flat)
	if err != nil {
		return nil, err
	}
	var cs CellStyle
	if err := json.Unmarshal(buf, &cs); err != nil {
		return nil, err
	}
	return &cs, nil
}

// flattenStyleMap walks one level of group-typed entries (font, fill,
// alignment) plus any scalar leaves and returns a plain map suitable
// for json.Marshal. Nil/missing values are skipped so the resulting
// object only carries explicitly-set attributes.
func flattenStyleMap(styleMap *ycrdt.YMap) map[string]any {
	out := map[string]any{}
	styleMap.ForEach(func(key string, value any, _ *ycrdt.YMap) {
		if value == nil {
			return
		}
		if group, ok := value.(*ycrdt.YMap); ok {
			leaves := map[string]any{}
			group.ForEach(func(k string, v any, _ *ycrdt.YMap) {
				if v == nil {
					return
				}
				leaves[k] = v
			})
			if len(leaves) > 0 {
				out[key] = leaves
			}
			return
		}
		out[key] = value
	})
	return out
}

// numberFromAny coerces a y-crdt-decoded number value to int. y-crdt
// decodes JS numbers as float64; older payloads may carry int.
func numberFromAny(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float32:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

// decodeSparseIntMap pulls a nested Y.Map<string,int-like> off the
// given parent meta map and returns it as a Go map[int]int. Keys that
// fail to parse as a positive integer are skipped. Returns nil when
// the nested map is absent or empty so callers can leave the
// surrounding workbook attribute alone (sparse-by-default).
func decodeSparseIntMap(meta *ycrdt.YMap, key string) map[int]int {
	nested, ok := meta.Get(key).(*ycrdt.YMap)
	if !ok || nested.GetSize() == 0 {
		return nil
	}
	out := map[int]int{}
	nested.ForEach(func(k string, v any, _ *ycrdt.YMap) {
		n, err := strconv.Atoi(k)
		if err != nil || n < 1 {
			return
		}
		out[n] = numberFromAny(v)
	})
	if len(out) == 0 {
		return nil
	}
	return out
}

// decodeSparseStyleMap pulls a nested Y.Map<string, Y.Map> off the
// given parent meta map and returns it as a map[int]*CellStyle.
// Decodes each entry through decodeCellStyle to keep the shape
// identical to per-cell styles. Returns nil for an absent or empty
// nested map.
func decodeSparseStyleMap(meta *ycrdt.YMap, key string) (map[int]*CellStyle, error) {
	nested, ok := meta.Get(key).(*ycrdt.YMap)
	if !ok || nested.GetSize() == 0 {
		return nil, nil
	}
	out := map[int]*CellStyle{}
	var decodeErr error
	nested.ForEach(func(k string, v any, _ *ycrdt.YMap) {
		if decodeErr != nil {
			return
		}
		n, err := strconv.Atoi(k)
		if err != nil || n < 1 {
			return
		}
		styleMap, ok := v.(*ycrdt.YMap)
		if !ok {
			return
		}
		cs, err := decodeCellStyle(styleMap)
		if err != nil {
			decodeErr = fmt.Errorf("decode row style %d: %w", n, err)
			return
		}
		if cs != nil {
			out[n] = cs
		}
	})
	if decodeErr != nil {
		return nil, decodeErr
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

// parseCellKey splits "<sheetID>:<row>:<col>" into its three parts.
// Returns ok=false for any malformed key (the snapshot just skips it).
// SheetIDs in production never contain colons (they're "sheet1",
// "sheet2", …) so a 3-way split is unambiguous.
func parseCellKey(key string) (string, int, int, bool) {
	parts := strings.SplitN(key, ":", 3)
	if len(parts) != 3 {
		return "", 0, 0, false
	}
	row, err := strconv.Atoi(parts[1])
	if err != nil {
		return "", 0, 0, false
	}
	col, err := strconv.Atoi(parts[2])
	if err != nil {
		return "", 0, 0, false
	}
	return parts[0], row, col, true
}

// sortSheetsByPosition is an insertion sort over a small slice (sheet
// counts are typically 1-3). Avoids dragging in sort.Slice for one
// call site.
func sortSheetsByPosition(s []SheetMeta) {
	for i := 1; i < len(s); i++ {
		j := i
		for j > 0 && s[j-1].Position > s[j].Position {
			s[j-1], s[j] = s[j], s[j-1]
			j--
		}
	}
}
