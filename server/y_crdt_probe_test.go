// Throwaway probe: does skyterra/y-crdt round-trip the sheets Y.Doc
// schema produced by the real client (bootstrapYDocFromWorkbook)?
//
// The repo's own compatibility_test.go covers flat Y.Map / Y.Array /
// Y.Text round-trips, but our schema nests a Y.Map per cell inside a
// top-level "cells" Y.Map. That's the case we need to verify here
// before considering a swap from the goja+yjs path.
//
// This file is not part of production. Delete after the swap
// decision is made.
package calc

import (
	"errors"
	"fmt"
	"runtime"
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

	ycrdt "github.com/skyterra/y-crdt"
)

// makeSheetsYDocUpdateInGoja builds a real-yjs Y.Doc that mirrors
// what bootstrapYDocFromWorkbook would produce: one sheet meta entry
// in `sheets` and `cellCount` populated cell entries in `cells`. Each
// cell is itself a Y.Map with `raw` and `display` string members.
//
// Returns the encoded update bytes a client would emit on first
// edit. We use the canonical yjs implementation (in goja) to produce
// these so the bytes are identical to what real users would send.
func makeSheetsYDocUpdateInGoja(t testing.TB, cellCount int) []byte {
	t.Helper()
	type result struct {
		bytes []byte
		err   error
	}
	ch := make(chan result, 1)
	registry := new(require.Registry)
	loop := eventloop.NewEventLoop(
		eventloop.WithRegistry(registry),
		eventloop.EnableConsole(false),
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
		_ = vm.Set("__cellCount", cellCount)
		_ = vm.Set("__sendBytes", func(call goja.FunctionCall) goja.Value {
			obj := call.Argument(0).ToObject(vm)
			length := int(obj.Get("length").ToInteger())
			out := make([]byte, length)
			for i := 0; i < length; i++ {
				out[i] = byte(obj.Get(fmt.Sprintf("%d", i)).ToInteger())
			}
			ch <- result{bytes: out}
			return goja.Undefined()
		})
		_ = vm.Set("__sendErr", func(call goja.FunctionCall) goja.Value {
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
					meta.set('name', 'Sheet1');
					meta.set('position', 0);
					meta.set('rowCount', Math.max(8, Math.floor(__cellCount / 100) + 1));
					meta.set('colCount', 100);
					sheetsMap.set('sheet1', meta);

					for (let i = 0; i < __cellCount; i++) {
						const row = Math.floor(i / 100) + 1;
						const col = (i % 100) + 1;
						const cell = new Y.Map();
						cell.set('raw', 'r' + i);
						cell.set('display', 'd' + i);
						cellsMap.set('sheet1:' + row + ':' + col, cell);
					}
				});
				__sendBytes(Y.encodeStateAsUpdate(doc));
			} catch (e) {
				__sendErr(String(e && e.stack || e));
			}
		})();
		`
		if _, err := vm.RunString(script); err != nil {
			ch <- result{err: err}
		}
	})
	go func() {
		select {
		case r := <-ch:
			loop.StopNoWait()
			ch <- r
		case <-time.After(60 * time.Second):
			loop.StopNoWait()
			ch <- result{err: errors.New("timeout")}
		}
	}()
	loop.StartInForeground()
	r := <-ch
	if r.err != nil {
		t.Fatalf("makeSheetsYDocUpdateInGoja(%d): %v", cellCount, r.err)
	}
	return r.bytes
}

// TestYCRDTNestedMapRoundTrip verifies y-crdt can decode a yjs
// payload that contains nested Y.Maps. This is the case our schema
// hits and the case skyterra's own tests don't cover.
func TestYCRDTNestedMapRoundTrip(t *testing.T) {
	update := makeSheetsYDocUpdateInGoja(t, 3)
	t.Logf("update size: %d bytes", len(update))

	doc := ycrdt.NewDoc("probe", false, nil, nil, false)
	doc.Transact(func(trans *ycrdt.Transaction) {
		ycrdt.ApplyUpdate(doc, update, nil)
	}, nil)

	sheetsRaw := doc.GetMap("sheets")
	if sheetsRaw == nil {
		t.Fatal("doc.GetMap(sheets) returned nil after ApplyUpdate")
	}
	sheets, ok := sheetsRaw.(*ycrdt.YMap)
	if !ok {
		t.Fatalf("doc.GetMap(sheets) returned %T, expected *YMap", sheetsRaw)
	}
	if got := sheets.GetSize(); got != 1 {
		t.Errorf("sheets size: want 1, got %v", got)
	}

	metaRaw := sheets.Get("sheet1")
	if metaRaw == nil {
		t.Fatal("sheets.Get(sheet1) returned nil — nested map lookup failed")
	}
	meta, ok := metaRaw.(*ycrdt.YMap)
	if !ok {
		t.Fatalf("sheets.Get(sheet1) returned %T, expected *YMap (this is the showstopper case)", metaRaw)
	}
	if got := meta.Get("name"); got != "Sheet1" {
		t.Errorf("meta.Get(name): want %q, got %v", "Sheet1", got)
	}
	if got := meta.Get("position"); got != 0 && got != float64(0) {
		t.Errorf("meta.Get(position): want 0, got %v (%T)", got, got)
	}

	cellsRaw := doc.GetMap("cells")
	cells, ok := cellsRaw.(*ycrdt.YMap)
	if !ok {
		t.Fatalf("doc.GetMap(cells) returned %T, expected *YMap", cellsRaw)
	}
	if got := cells.GetSize(); got != 3 {
		t.Errorf("cells size: want 3, got %v", got)
	}

	// Spot-check one cell.
	cellRaw := cells.Get("sheet1:1:1")
	if cellRaw == nil {
		t.Fatal("cells.Get(sheet1:1:1) returned nil")
	}
	cell, ok := cellRaw.(*ycrdt.YMap)
	if !ok {
		t.Fatalf("cells.Get(sheet1:1:1) returned %T, expected *YMap", cellRaw)
	}
	if got := cell.Get("raw"); got != "r0" {
		t.Errorf("cell.Get(raw): want %q, got %v", "r0", got)
	}
	if got := cell.Get("display"); got != "d0" {
		t.Errorf("cell.Get(display): want %q, got %v", "d0", got)
	}

	// And re-encode → re-apply in real yjs, asserting we round-trip
	// out as well as in.
	reEncoded := ycrdt.EncodeStateAsUpdate(doc, nil)
	t.Logf("re-encoded size: %d bytes", len(reEncoded))
	if len(reEncoded) == 0 {
		t.Fatal("re-encode produced empty bytes")
	}
	verifyInRealYjs(t, reEncoded, 3)
}

// verifyInRealYjs takes a y-crdt-produced update, applies it to a
// fresh real-yjs Y.Doc in goja, and asserts the same nested cell
// values come out. This catches the case where y-crdt encodes
// something real yjs can't decode.
func verifyInRealYjs(t *testing.T, update []byte, cellCount int) {
	t.Helper()
	type result struct {
		err     error
		matched int
	}
	ch := make(chan result, 1)
	registry := new(require.Registry)
	loop := eventloop.NewEventLoop(
		eventloop.WithRegistry(registry),
		eventloop.EnableConsole(false),
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
		_ = vm.Set("__updateBytes", vm.NewArrayBuffer(append([]byte(nil), update...)))
		_ = vm.Set("__cellCount", cellCount)
		_ = vm.Set("__sendCount", func(call goja.FunctionCall) goja.Value {
			ch <- result{matched: int(call.Argument(0).ToInteger())}
			return goja.Undefined()
		})
		_ = vm.Set("__sendErr", func(call goja.FunctionCall) goja.Value {
			ch <- result{err: errors.New(call.Argument(0).String())}
			return goja.Undefined()
		})
		script := `
		(function () {
			try {
				const Y = globalThis.Y;
				const doc = new Y.Doc();
				Y.applyUpdate(doc, new Uint8Array(__updateBytes));
				const cells = doc.getMap('cells');
				let matched = 0;
				for (let i = 0; i < __cellCount; i++) {
					const row = Math.floor(i / 100) + 1;
					const col = (i % 100) + 1;
					const cell = cells.get('sheet1:' + row + ':' + col);
					if (cell && cell.get('raw') === 'r' + i && cell.get('display') === 'd' + i) {
						matched++;
					}
				}
				__sendCount(matched);
			} catch (e) {
				__sendErr(String(e && e.stack || e));
			}
		})();
		`
		if _, err := vm.RunString(script); err != nil {
			ch <- result{err: err}
		}
	})
	go func() {
		select {
		case r := <-ch:
			loop.StopNoWait()
			ch <- r
		case <-time.After(60 * time.Second):
			loop.StopNoWait()
			ch <- result{err: errors.New("timeout")}
		}
	}()
	loop.StartInForeground()
	r := <-ch
	if r.err != nil {
		t.Fatalf("verifyInRealYjs: %v", r.err)
	}
	if r.matched != cellCount {
		t.Errorf("verifyInRealYjs: %d/%d cells matched after y-crdt -> yjs round-trip", r.matched, cellCount)
	}
}

// BenchmarkYCRDTApplyOneCell measures the cost of applying a single
// small update (one cell change) to an empty doc — the per-keystroke
// hot path in production.
func BenchmarkYCRDTApplyOneCell(b *testing.B) {
	update := makeSheetsYDocUpdateInGoja(b, 1)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		doc := ycrdt.NewDoc("bench", false, nil, nil, false)
		ycrdt.ApplyUpdate(doc, update, nil)
	}
}

// BenchmarkYCRDTApplyOneCellToWarmDoc measures the same thing but
// against a doc that already holds 10k cells — closer to the
// keystroke-into-large-spreadsheet shape.
func BenchmarkYCRDTApplyOneCellToWarmDoc(b *testing.B) {
	bigUpdate := makeSheetsYDocUpdateInGoja(b, 10000)
	smallUpdate := makeSheetsYDocUpdateInGoja(b, 1)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		b.StopTimer()
		doc := ycrdt.NewDoc("bench", false, nil, nil, false)
		ycrdt.ApplyUpdate(doc, bigUpdate, nil)
		b.StartTimer()
		ycrdt.ApplyUpdate(doc, smallUpdate, nil)
	}
}

// BenchmarkYCRDTEncodeStateAsUpdate measures cost of
// encodeStateAsUpdate on a populated doc — the cost of serving a
// MsgSyncRequest from the server-side mirror.
func BenchmarkYCRDTEncodeStateAsUpdate(b *testing.B) {
	update := makeSheetsYDocUpdateInGoja(b, 10000)
	doc := ycrdt.NewDoc("bench", false, nil, nil, false)
	ycrdt.ApplyUpdate(doc, update, nil)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = ycrdt.EncodeStateAsUpdate(doc, nil)
	}
}

// TestYCRDTMemoryFootprint creates N populated docs and reports
// heap delta. Not a strict assertion — just produces a number we
// can use to estimate fleet capacity.
func TestYCRDTMemoryFootprint(t *testing.T) {
	if testing.Short() {
		t.Skip("memory probe is slow")
	}
	const (
		numDocs   = 100
		cellCount = 10000
	)
	update := makeSheetsYDocUpdateInGoja(t, cellCount)
	t.Logf("populating %d docs of %d cells (update %d bytes)", numDocs, cellCount, len(update))

	runtime.GC()
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)

	docs := make([]*ycrdt.Doc, numDocs)
	for i := 0; i < numDocs; i++ {
		docs[i] = ycrdt.NewDoc(fmt.Sprintf("doc-%d", i), false, nil, nil, false)
		ycrdt.ApplyUpdate(docs[i], update, nil)
	}

	runtime.GC()
	runtime.GC()
	var after runtime.MemStats
	runtime.ReadMemStats(&after)
	// Touch every doc after the GC pass so the compiler / GC can't
	// have collected them and so HeapAlloc reflects retained state.
	keepalive := 0
	for _, d := range docs {
		if d != nil {
			keepalive++
		}
	}
	if keepalive != numDocs {
		t.Fatalf("docs collected prematurely: %d", keepalive)
	}

	heapDelta := int64(after.HeapInuse) - int64(before.HeapInuse)
	allocDelta := int64(after.TotalAlloc) - int64(before.TotalAlloc)
	t.Logf("HeapInuse delta: %d KB total, ~%d KB/doc (resident, after GC)",
		heapDelta/1024, heapDelta/int64(numDocs)/1024)
	t.Logf("TotalAlloc delta: %d KB total, ~%d KB/doc (cumulative incl. GC'd intermediates)",
		allocDelta/1024, allocDelta/int64(numDocs)/1024)
	t.Logf("(input update was %d KB; doc count %d × %d cells)",
		len(update)/1024, numDocs, cellCount)
}
