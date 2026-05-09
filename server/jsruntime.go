package calc

import (
	_ "embed"
	"errors"
	"fmt"
	"sync"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/buffer"
	"github.com/dop251/goja_nodejs/console"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/dop251/goja_nodejs/process"
	"github.com/dop251/goja_nodejs/require"
	"github.com/dop251/goja_nodejs/url"
	_ "github.com/dop251/goja_nodejs/util" // registers "util" core module via init()

	"tinycld.org/core/realtime"
)

//go:embed jsvendor/yjs.bundle.js
var yjsBundle string

// Runtime owns the single goja event loop the calc package uses for
// every yjs operation. Only one goroutine at a time may execute
// against the loop; callers serialize via mu.
//
// One Runtime per process. Lazy-init on first use so the cost of
// loading the yjs bundle isn't paid by tests / CLI invocations
// that don't need it.
type Runtime struct {
	mu          sync.Mutex
	initOnce    sync.Once
	initErr     error
	loop        *eventloop.EventLoop
	docsCounter uint64 // for handle ids
}

// NewRuntime returns an unstarted Runtime. The event loop and JS
// bundle are loaded the first time NewDoc (or any other method) is
// invoked, so constructing one is cheap.
func NewRuntime() *Runtime {
	return &Runtime{}
}

// ensureStarted lazily boots the event loop and loads the yjs bundle.
// Holds r.mu for the entire init pass; subsequent callers wait once.
func (r *Runtime) ensureStarted() error {
	r.initOnce.Do(func() {
		registry := new(require.Registry)
		r.loop = eventloop.NewEventLoop(
			eventloop.WithRegistry(registry),
			eventloop.EnableConsole(true),
		)

		errCh := make(chan error, 1)
		r.loop.Run(func(vm *goja.Runtime) {
			buffer.Enable(vm)
			console.Enable(vm)
			process.Enable(vm)
			url.Enable(vm)

			// yjs bundle is a self-contained IIFE that attaches to
			// globalThis.Y; just run it.
			if _, err := vm.RunString(yjsBundle); err != nil {
				errCh <- fmt.Errorf("evaluate yjs bundle: %w", err)
				return
			}

			// Per-room doc registry on the JS side. Keyed by
			// handleID (a numeric string the Go side mints). The
			// Go side never holds a reference to the JS Y.Doc
			// itself; it asks the registry by id every time.
			if _, err := vm.RunString(`
				globalThis.__sheetsDocs = new Map();
				globalThis.__sheetsCreate = function (id) {
					__sheetsDocs.set(String(id), new Y.Doc());
				};
				globalThis.__sheetsApply = function (id, bytes) {
					const doc = __sheetsDocs.get(String(id));
					if (!doc) throw new Error('no doc for id ' + id);
					Y.applyUpdate(doc, bytes);
				};
				globalThis.__sheetsEncode = function (id) {
					const doc = __sheetsDocs.get(String(id));
					if (!doc) throw new Error('no doc for id ' + id);
					return Y.encodeStateAsUpdate(doc);
				};
				globalThis.__sheetsClose = function (id) {
					__sheetsDocs.delete(String(id));
				};
				globalThis.__sheetsHas = function (id) {
					return __sheetsDocs.has(String(id));
				};
				// __sheetsSnapshot returns a plain-JS snapshot of the
				// room's Y.Doc. The Go side then walks the returned
				// object once via reflection — no further JS calls.
				globalThis.__sheetsSnapshot = function (id) {
					const doc = __sheetsDocs.get(String(id));
					if (!doc) throw new Error('no doc for id ' + id);
					const sheetsMap = doc.getMap('sheets');
					const cellsMap = doc.getMap('cells');
					const sheets = [];
					sheetsMap.forEach(function (meta, sid) {
						const pos = meta.get('position');
						sheets.push({
							id: String(sid),
							name: String(meta.get('name') || sid),
							position: typeof pos === 'number' ? pos : 0,
						});
					});
					sheets.sort(function (a, b) { return a.position - b.position; });
					const cells = [];
					cellsMap.forEach(function (cellMap, key) {
						const parts = String(key).split(':');
						if (parts.length !== 3) return;
						const row = Number(parts[1]);
						const col = Number(parts[2]);
						if (!Number.isFinite(row) || !Number.isFinite(col)) return;
						const raw = cellMap.get('raw');
						const display = cellMap.get('display');
						const formula = cellMap.get('formula');
						cells.push({
							sheetId: String(parts[0]),
							row: row,
							col: col,
							raw: raw == null ? '' : String(raw),
							display: display == null ? '' : String(display),
							formula: formula == null ? '' : String(formula),
						});
					});
					return { sheets: sheets, cells: cells };
				};
			`); err != nil {
				errCh <- fmt.Errorf("install calc doc registry: %w", err)
				return
			}

			errCh <- nil
		})

		// Start the loop in the background; it will keep processing
		// callbacks for the lifetime of the process.
		r.loop.Start()
		r.initErr = <-errCh
	})
	return r.initErr
}

// runOnLoop executes fn against the goja runtime, blocking until fn
// returns. Serializes access to the single VM via r.mu so callers
// from multiple goroutines (e.g. multiple rooms) get strict ordering.
func (r *Runtime) runOnLoop(fn func(vm *goja.Runtime) error) error {
	if err := r.ensureStarted(); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	done := make(chan error, 1)
	r.loop.RunOnLoop(func(vm *goja.Runtime) {
		done <- fn(vm)
	})
	return <-done
}

// NewDoc satisfies realtime.DocRuntime: mints a fresh server-side
// Y.Doc identified by the broker's roomID and returns an opaque
// handle the broker calls into for the room's lifetime.
func (r *Runtime) NewDoc(roomID string) (realtime.DocHandle, error) {
	if err := r.ensureStarted(); err != nil {
		return nil, err
	}
	// Use roomID as the JS-side key. It's stable and unique per
	// active room (the broker enforces one Room per (kind, id)).
	if err := r.runOnLoop(func(vm *goja.Runtime) error {
		create, ok := goja.AssertFunction(vm.Get("__sheetsCreate"))
		if !ok {
			return errors.New("__sheetsCreate not callable")
		}
		_, err := create(goja.Undefined(), vm.ToValue(roomID))
		return err
	}); err != nil {
		return nil, fmt.Errorf("create yjs doc for %s: %w", roomID, err)
	}
	return &sheetsDocHandle{runtime: r, id: roomID}, nil
}

// sheetsDocHandle is the broker's handle on one room's server-side
// Y.Doc. The actual JS-side state lives in globalThis.__sheetsDocs
// keyed by id; this struct is just a Go-side accessor.
type sheetsDocHandle struct {
	runtime *Runtime
	id      string
}

// ApplyUpdate folds an inbound MsgDocUpdate payload into the server's
// mirror of the room's Y.Doc.
func (h *sheetsDocHandle) ApplyUpdate(payload []byte) error {
	return h.runtime.runOnLoop(func(vm *goja.Runtime) error {
		apply, ok := goja.AssertFunction(vm.Get("__sheetsApply"))
		if !ok {
			return errors.New("__sheetsApply not callable")
		}
		// Hand the bytes in as a Uint8Array (yjs accepts that).
		ab := vm.NewArrayBuffer(append([]byte(nil), payload...))
		// Wrap into a Uint8Array view so yjs's decoder reads
		// per-byte values rather than treating each ArrayBuffer
		// element as a 32-bit word.
		arr, err := vm.RunString(`(function (ab) { return new Uint8Array(ab); })`)
		if err != nil {
			return fmt.Errorf("build Uint8Array wrapper: %w", err)
		}
		wrap, ok := goja.AssertFunction(arr)
		if !ok {
			return errors.New("Uint8Array wrapper not callable")
		}
		view, err := wrap(goja.Undefined(), vm.ToValue(ab))
		if err != nil {
			return fmt.Errorf("wrap as Uint8Array: %w", err)
		}
		_, err = apply(goja.Undefined(), vm.ToValue(h.id), view)
		return err
	})
}

// EncodeStateAsUpdate returns the bytes a new joiner needs to catch
// up to the room's current state. Wrapped by the broker in a
// MsgSyncReply frame.
func (h *sheetsDocHandle) EncodeStateAsUpdate() ([]byte, error) {
	var out []byte
	err := h.runtime.runOnLoop(func(vm *goja.Runtime) error {
		encode, ok := goja.AssertFunction(vm.Get("__sheetsEncode"))
		if !ok {
			return errors.New("__sheetsEncode not callable")
		}
		v, err := encode(goja.Undefined(), vm.ToValue(h.id))
		if err != nil {
			return err
		}
		bytes, err := readUint8ArrayBytes(vm, v)
		if err != nil {
			return err
		}
		out = bytes
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Close releases the JS-side reference to this room's Y.Doc so it can
// be garbage-collected.
func (h *sheetsDocHandle) Close() error {
	return h.runtime.runOnLoop(func(vm *goja.Runtime) error {
		closeFn, ok := goja.AssertFunction(vm.Get("__sheetsClose"))
		if !ok {
			return errors.New("__sheetsClose not callable")
		}
		_, err := closeFn(goja.Undefined(), vm.ToValue(h.id))
		return err
	})
}

// Snapshot returns a Go-native, point-in-time view of the room's
// Y.Doc. The serializer in persist.go consumes this; nothing in this
// path touches ExcelJS.
//
// The walk happens in JS once (via __sheetsSnapshot) and the result
// is exported back as a plain map/slice tree, then translated into
// the typed YDocSnapshot here. When the y-crdt swap lands, the JS
// half goes away and this method walks the Go-native doc directly —
// the returned struct shape stays the same.
func (h *sheetsDocHandle) Snapshot() (YDocSnapshot, error) {
	var snap YDocSnapshot
	err := h.runtime.runOnLoop(func(vm *goja.Runtime) error {
		hasFn, ok := goja.AssertFunction(vm.Get("__sheetsHas"))
		if !ok {
			return errors.New("__sheetsHas not callable")
		}
		has, err := hasFn(goja.Undefined(), vm.ToValue(h.id))
		if err != nil {
			return err
		}
		if !has.ToBoolean() {
			return fmt.Errorf("no Y.Doc registered for room %s (closed?)", h.id)
		}
		snapFn, ok := goja.AssertFunction(vm.Get("__sheetsSnapshot"))
		if !ok {
			return errors.New("__sheetsSnapshot not callable")
		}
		v, err := snapFn(goja.Undefined(), vm.ToValue(h.id))
		if err != nil {
			return err
		}
		obj := v.ToObject(vm)

		sheetsVal := obj.Get("sheets")
		if sheetsVal == nil {
			return errors.New("snapshot missing sheets")
		}
		sheetsObj := sheetsVal.ToObject(vm)
		sheetsLen := int(sheetsObj.Get("length").ToInteger())
		snap.Sheets = make([]SheetMeta, 0, sheetsLen)
		for i := 0; i < sheetsLen; i++ {
			entry := sheetsObj.Get(fmt.Sprintf("%d", i)).ToObject(vm)
			snap.Sheets = append(snap.Sheets, SheetMeta{
				ID:       entry.Get("id").String(),
				Name:     entry.Get("name").String(),
				Position: int(entry.Get("position").ToInteger()),
			})
		}

		cellsVal := obj.Get("cells")
		if cellsVal == nil {
			return errors.New("snapshot missing cells")
		}
		cellsObj := cellsVal.ToObject(vm)
		cellsLen := int(cellsObj.Get("length").ToInteger())
		snap.Cells = make([]CellEntry, 0, cellsLen)
		for i := 0; i < cellsLen; i++ {
			entry := cellsObj.Get(fmt.Sprintf("%d", i)).ToObject(vm)
			snap.Cells = append(snap.Cells, CellEntry{
				SheetID: entry.Get("sheetId").String(),
				Row:     int(entry.Get("row").ToInteger()),
				Col:     int(entry.Get("col").ToInteger()),
				Raw:     entry.Get("raw").String(),
				Display: entry.Get("display").String(),
				Formula: entry.Get("formula").String(),
			})
		}
		return nil
	})
	if err != nil {
		return YDocSnapshot{}, err
	}
	return snap, nil
}

// readUint8ArrayBytes converts a JS Uint8Array (or ArrayBuffer) into
// a Go []byte. yjs's encodeStateAsUpdate returns a Uint8Array.
func readUint8ArrayBytes(vm *goja.Runtime, v goja.Value) ([]byte, error) {
	if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
		return nil, errors.New("nil bytes value")
	}
	// Try ArrayBuffer first.
	if ab, ok := v.Export().(goja.ArrayBuffer); ok {
		return ab.Bytes(), nil
	}
	// Otherwise treat as an indexable typed array.
	obj := v.ToObject(vm)
	if buffer := obj.Get("buffer"); buffer != nil && !goja.IsUndefined(buffer) {
		if ab, ok := buffer.Export().(goja.ArrayBuffer); ok {
			byteOffset := int(obj.Get("byteOffset").ToInteger())
			byteLen := int(obj.Get("byteLength").ToInteger())
			full := ab.Bytes()
			if byteOffset+byteLen > len(full) {
				return nil, fmt.Errorf("typed array bounds out of range: offset=%d len=%d full=%d", byteOffset, byteLen, len(full))
			}
			cp := make([]byte, byteLen)
			copy(cp, full[byteOffset:byteOffset+byteLen])
			return cp, nil
		}
	}
	// Last resort: walk the indexable.
	length := int(obj.Get("length").ToInteger())
	out := make([]byte, length)
	for i := 0; i < length; i++ {
		out[i] = byte(obj.Get(fmt.Sprintf("%d", i)).ToInteger())
	}
	return out, nil
}
