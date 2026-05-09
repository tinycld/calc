package calc

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/buffer"
	"github.com/dop251/goja_nodejs/console"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/dop251/goja_nodejs/process"
	"github.com/dop251/goja_nodejs/require"
	"github.com/dop251/goja_nodejs/url"
	_ "github.com/dop251/goja_nodejs/util"
	"github.com/xuri/excelize/v2"
)

// makeYDocUpdateForCell returns the bytes a client would emit on a
// fresh Y.Doc after seeding the SHEETS_MAP/CELLS_MAP shape that
// bootstrapYDocFromWorkbook produces, with one synthesized cell edit.
//
// The returned bytes are an encodeStateAsUpdate output, ready to feed
// into a server-side handle's ApplyUpdate.
//
// We construct it inside its own goja runtime (separate from the
// Runtime being tested) so the test exercises the same wire format
// real clients produce.
func makeYDocUpdateForCell(t *testing.T, sheetID, sheetName string, sheetPos, rowCount, colCount, row, col int, raw, display string) []byte {
	return makeYDocUpdate(t, sheetID, sheetName, sheetPos, rowCount, colCount, row, col, raw, display, nil)
}

// makeYDocUpdateForCellWithBold is the bold-aware variant — same as
// makeYDocUpdateForCell but also stamps a style.font.bold=true entry
// on the cell Y.Map, mirroring what a client emits when the user hits
// the bold button.
func makeYDocUpdateForCellWithBold(t *testing.T, sheetID, sheetName string, sheetPos, rowCount, colCount, row, col int, raw, display string) []byte {
	return makeYDocUpdate(t, sheetID, sheetName, sheetPos, rowCount, colCount, row, col, raw, display, map[string]any{"font": map[string]any{"bold": true}})
}

// makeYDocUpdate is the shared workhorse. style is an optional plain
// JS-shaped style object that gets faithfully reproduced as nested
// Y.Maps under cell['style'].
func makeYDocUpdate(t *testing.T, sheetID, sheetName string, sheetPos, rowCount, colCount, row, col int, raw, display string, style map[string]any) []byte {
	t.Helper()

	type result struct {
		bytes []byte
		err   error
	}
	ch := make(chan result, 1)

	registry := new(require.Registry)
	loop := eventloop.NewEventLoop(
		eventloop.WithRegistry(registry),
		eventloop.EnableConsole(true),
	)
	loop.Run(func(vm *goja.Runtime) {
		buffer.Enable(vm)
		console.Enable(vm)
		process.Enable(vm)
		url.Enable(vm)

		if _, err := vm.RunString(yjsBundle); err != nil {
			ch <- result{err: fmt.Errorf("load yjs: %w", err)}
			return
		}

		_ = vm.Set("__paramsForCell", map[string]any{
			"sheetID":   sheetID,
			"sheetName": sheetName,
			"sheetPos":  sheetPos,
			"rowCount":  rowCount,
			"colCount":  colCount,
			"row":       row,
			"col":       col,
			"raw":       raw,
			"display":   display,
			"style":     style,
		})
		_ = vm.Set("__sendCellUpdate", func(call goja.FunctionCall) goja.Value {
			arg := call.Argument(0)
			obj := arg.ToObject(vm)
			length := int(obj.Get("length").ToInteger())
			out := make([]byte, length)
			for i := 0; i < length; i++ {
				out[i] = byte(obj.Get(fmt.Sprintf("%d", i)).ToInteger())
			}
			ch <- result{bytes: out}
			return goja.Undefined()
		})
		_ = vm.Set("__sendCellError", func(call goja.FunctionCall) goja.Value {
			ch <- result{err: errors.New(call.Argument(0).String())}
			return goja.Undefined()
		})

		script := `
		(function () {
			try {
				const Y = globalThis.Y;
				const doc = new Y.Doc();
				const sheetsMap = doc.getMap('sheets');
				const cellsMap = doc.getMap('cells');
				doc.transact(function () {
					const meta = new Y.Map();
					meta.set('name', __paramsForCell.sheetName);
					meta.set('position', __paramsForCell.sheetPos);
					meta.set('rowCount', __paramsForCell.rowCount);
					meta.set('colCount', __paramsForCell.colCount);
					sheetsMap.set(__paramsForCell.sheetID, meta);

					const cell = new Y.Map();
					cell.set('raw', __paramsForCell.raw);
					cell.set('display', __paramsForCell.display);
					if (__paramsForCell.style) {
						const styleMap = new Y.Map();
						const groups = __paramsForCell.style;
						Object.keys(groups).forEach(function (groupKey) {
							const group = groups[groupKey];
							if (group == null) return;
							if (typeof group === 'object') {
								const groupMap = new Y.Map();
								Object.keys(group).forEach(function (k) {
									const v = group[k];
									if (v == null) return;
									groupMap.set(k, v);
								});
								styleMap.set(groupKey, groupMap);
								return;
							}
							styleMap.set(groupKey, group);
						});
						cell.set('style', styleMap);
					}
					const key = __paramsForCell.sheetID + ':' + __paramsForCell.row + ':' + __paramsForCell.col;
					cellsMap.set(key, cell);
				});
				const update = Y.encodeStateAsUpdate(doc);
				__sendCellUpdate(update);
			} catch (e) {
				__sendCellError(String(e && e.stack || e));
			}
		})();
		`
		if _, err := vm.RunString(script); err != nil {
			ch <- result{err: fmt.Errorf("build update: %w", err)}
		}
	})
	go func() {
		select {
		case r := <-ch:
			loop.StopNoWait()
			ch <- r
		case <-time.After(15 * time.Second):
			loop.StopNoWait()
			ch <- result{err: errors.New("timeout building update")}
		}
	}()
	loop.StartInForeground()

	r := <-ch
	if r.err != nil {
		t.Fatalf("makeYDocUpdateForCell: %v", r.err)
	}
	if len(r.bytes) == 0 {
		t.Fatal("makeYDocUpdateForCell returned empty update")
	}
	return r.bytes
}

// readBackCellInTinyXlsx parses xlsx bytes through excelize and
// returns the value at (sheet 0, row, col) as a string (matching the
// shape the older ExcelJS-based helper returned). Both formula and
// value cells stringify to a single readable token.
func readBackCellInTinyXlsx(t *testing.T, xlsx []byte, row int, col int) string {
	t.Helper()
	f, err := excelize.OpenReader(bytes.NewReader(xlsx))
	if err != nil {
		t.Fatalf("open xlsx: %v", err)
	}
	defer func() { _ = f.Close() }()
	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		t.Fatal("xlsx has no sheets")
	}
	ref, err := excelize.CoordinatesToCellName(col, row)
	if err != nil {
		t.Fatalf("coords (%d,%d): %v", col, row, err)
	}
	v, err := f.GetCellValue(sheets[0], ref)
	if err != nil {
		t.Fatalf("get cell %s: %v", ref, err)
	}
	return v
}

// TestRuntimeRoundTrip is the central jsruntime smoke test:
//
//  1. Build a yjs update on a fresh client doc that sets B2 = "from-yjs".
//  2. Hand that update to a server-side DocHandle's ApplyUpdate.
//  3. Call Snapshot() to get a Go-native view of the doc.
//  4. Verify the expected sheet + cell entry is present.
func TestRuntimeRoundTrip(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("test-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	// Build the update outside the rt being tested so we exercise
	// the same byte format real clients send.
	update := makeYDocUpdateForCell(t,
		"sheet1", "Sheet1", 0, 8, 6,
		2, 2, "from-yjs", "from-yjs",
	)

	if err := handle.ApplyUpdate(update); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}

	// Sanity: EncodeStateAsUpdate should now return non-empty bytes
	// reflecting the applied state.
	state, err := handle.EncodeStateAsUpdate()
	if err != nil {
		t.Fatalf("EncodeStateAsUpdate: %v", err)
	}
	if len(state) == 0 {
		t.Fatal("expected non-empty encoded state after ApplyUpdate")
	}

	snap, err := handle.(*sheetsDocHandle).Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snap.Sheets) != 1 {
		t.Fatalf("snapshot sheets: want 1, got %d (%+v)", len(snap.Sheets), snap.Sheets)
	}
	if snap.Sheets[0].ID != "sheet1" || snap.Sheets[0].Name != "Sheet1" {
		t.Fatalf("snapshot sheet meta: %+v", snap.Sheets[0])
	}
	if len(snap.Cells) != 1 {
		t.Fatalf("snapshot cells: want 1, got %d", len(snap.Cells))
	}
	if got := snap.Cells[0]; got.SheetID != "sheet1" || got.Row != 2 || got.Col != 2 || got.Raw != "from-yjs" {
		t.Fatalf("snapshot cell: %+v", got)
	}
}

// TestRuntimeMultipleApplyUpdates: applying two updates in sequence
// composes correctly — both edits show up in the snapshot.
func TestRuntimeMultipleApplyUpdates(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("multi-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	u1 := makeYDocUpdateForCell(t, "sheet1", "Sheet1", 0, 8, 6, 2, 2, "v-one", "v-one")
	u2 := makeYDocUpdateForCell(t, "sheet1", "Sheet1", 0, 8, 6, 3, 2, "v-two", "v-two")

	if err := handle.ApplyUpdate(u1); err != nil {
		t.Fatalf("ApplyUpdate u1: %v", err)
	}
	if err := handle.ApplyUpdate(u2); err != nil {
		t.Fatalf("ApplyUpdate u2: %v", err)
	}

	snap, err := handle.(*sheetsDocHandle).Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	cells := map[string]CellEntry{}
	for _, c := range snap.Cells {
		cells[fmt.Sprintf("%s:%d:%d", c.SheetID, c.Row, c.Col)] = c
	}
	if got, ok := cells["sheet1:2:2"]; !ok || got.Raw != "v-one" {
		t.Errorf("B2 in snapshot: ok=%v got=%+v", ok, got)
	}
	if got, ok := cells["sheet1:3:2"]; !ok || got.Raw != "v-two" {
		t.Errorf("B3 in snapshot: ok=%v got=%+v", ok, got)
	}
}

// TestServerRoundtripBoldUpdate is the broker-side equivalent of the
// client's bootstrap → encode → applyUpdate roundtrip test. If the
// server's __sheetsApply / __sheetsEncode mishandles a bootstrap
// update that contains nested style Y.Maps, the encoded reply will
// fail to decode on the client and we'll see lib0 "Unexpected end of
// array" in the browser console.
func TestServerRoundtripBoldUpdate(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("rt-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	update := makeYDocUpdateForCellWithBold(t, "sheet1", "Sheet1", 0, 8, 6, 2, 2, "bold-cell", "bold-cell")
	if err := handle.ApplyUpdate(update); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}
	state, err := handle.EncodeStateAsUpdate()
	if err != nil {
		t.Fatalf("EncodeStateAsUpdate: %v", err)
	}
	if len(state) == 0 {
		t.Fatal("EncodeStateAsUpdate produced empty bytes")
	}
	// Apply that state to a fresh peer doc on the same JS side; if the
	// state is malformed, applyUpdate throws.
	rt2 := NewRuntime()
	peer, err := rt2.NewDoc("peer-room")
	if err != nil {
		t.Fatalf("peer NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = peer.Close() })
	if err := peer.ApplyUpdate(state); err != nil {
		t.Fatalf("peer ApplyUpdate: %v", err)
	}
}

// TestSnapshotExtractsBoldStyle: a Y.Doc cell whose style.font.bold is
// true must surface as snap.Cells[0].Style.Font.Bold = &true after
// __sheetsSnapshot + the JSON unmarshal in Snapshot().
func TestSnapshotExtractsBoldStyle(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("style-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	update := makeYDocUpdateForCellWithBold(t, "sheet1", "Sheet1", 0, 8, 6, 2, 2, "bold-cell", "bold-cell")
	if err := handle.ApplyUpdate(update); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}

	snap, err := handle.(*sheetsDocHandle).Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snap.Cells) != 1 {
		t.Fatalf("snapshot cells: want 1, got %d", len(snap.Cells))
	}
	c := snap.Cells[0]
	if c.Style == nil {
		t.Fatalf("snapshot cell missing Style: %+v", c)
	}
	if c.Style.Font == nil {
		t.Fatalf("snapshot cell missing Style.Font: %+v", *c.Style)
	}
	if c.Style.Font.Bold == nil || !*c.Style.Font.Bold {
		t.Fatalf("snapshot cell Style.Font.Bold: want &true, got %+v", c.Style.Font.Bold)
	}
}

// TestSnapshotNoStyleProducesNilStyle: a vanilla cell without a style
// entry must surface as Style == nil so the serializer leaves the
// existing on-disk style alone.
func TestSnapshotNoStyleProducesNilStyle(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("nostyle-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	t.Cleanup(func() { _ = handle.Close() })

	update := makeYDocUpdateForCell(t, "sheet1", "Sheet1", 0, 8, 6, 1, 1, "x", "x")
	if err := handle.ApplyUpdate(update); err != nil {
		t.Fatalf("ApplyUpdate: %v", err)
	}

	snap, err := handle.(*sheetsDocHandle).Snapshot()
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if len(snap.Cells) != 1 {
		t.Fatalf("snapshot cells: want 1, got %d", len(snap.Cells))
	}
	if snap.Cells[0].Style != nil {
		t.Fatalf("expected nil Style, got %+v", *snap.Cells[0].Style)
	}
}

// TestRuntimeCloseRejectsLaterCalls: Snapshot after Close must fail
// rather than silently returning empty results.
func TestRuntimeCloseRejectsLaterCalls(t *testing.T) {
	rt := NewRuntime()
	handle, err := rt.NewDoc("close-room")
	if err != nil {
		t.Fatalf("NewDoc: %v", err)
	}
	if err := handle.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if _, err := handle.(*sheetsDocHandle).Snapshot(); err == nil {
		t.Fatal("expected Snapshot after Close to fail, got nil")
	}
	// Sentinel use of tinyXlsxPath so the fixture path stays
	// exercised across tests.
	if _, err := os.Stat(tinyXlsxPath); err != nil {
		t.Fatalf("fixture missing: %v", err)
	}
}
