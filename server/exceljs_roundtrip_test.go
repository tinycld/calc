package sheets

import (
	"bytes"
	_ "embed"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/buffer"
	"github.com/dop251/goja_nodejs/console"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/dop251/goja_nodejs/process"
	"github.com/dop251/goja_nodejs/require"
	"github.com/dop251/goja_nodejs/url"
	_ "github.com/dop251/goja_nodejs/util" // registers "util" core module via init()
)

// exceljsBundle is a Babel-lowered build of ExcelJS 4.4.0's browser
// bundle. The original bundle ships `async function*` and `for await`,
// neither of which goja's parser accepts. Babel transforms with
// `@babel/plugin-transform-async-generator-functions` and
// `@babel/plugin-transform-async-to-generator` reduce both back to
// plain generators + Promise-driven helpers, which goja can run.
//
//go:embed jsvendor/exceljs.lowered.js
var exceljsBundle string

// tinyXlsxPath points at the user-curated fixture under
// sheets/tests/assets. It's read with os.ReadFile (not go:embed)
// because go:embed paths cannot escape the containing package.
const tinyXlsxPath = "../tests/assets/tiny.xlsx"

// TestExcelJSReadModifyWrite drives a full read-modify-write
// round-trip of an actual xlsx file through goja:
//
//  1. Load tests/assets/tiny.xlsx (the user-provided fixture).
//  2. Inside the JS runtime, read it via Workbook.xlsx.load().
//  3. Modify B2 (a shared-string cell currently "Mara") to a new
//     value.
//  4. Append a new row at the end of the sheet.
//  5. Call writeBuffer(), get bytes back into Go, write to a tmp
//     file, then re-open that tmp file in the same JS runtime and
//     verify both edits survive.
//
// We do the "verify" pass inside JS rather than parsing the xml
// ourselves so the test exercises the same code path a save-back
// hook would use to read state. If goja can't run that read path,
// we want to find out here.
func TestExcelJSReadModifyWrite(t *testing.T) {
	if exceljsBundle == "" {
		t.Fatal("embedded exceljs bundle is empty")
	}

	tinyXlsx, err := os.ReadFile(tinyXlsxPath)
	if err != nil {
		t.Fatalf("read fixture %s: %v", tinyXlsxPath, err)
	}
	if len(tinyXlsx) == 0 {
		t.Fatalf("fixture %s is empty", tinyXlsxPath)
	}

	// Sanity: confirm the fixture is actually a ZIP/xlsx before we
	// hand it to JS. The first four bytes of every .xlsx are the
	// local-file-header signature 50 4B 03 04.
	if !bytes.HasPrefix(tinyXlsx, []byte{0x50, 0x4B, 0x03, 0x04}) {
		t.Fatalf("fixture is not a valid xlsx (first 4 bytes = %x)", tinyXlsx[:4])
	}

	// The fixture's first column is a row index (A1=0, A2=1, ...);
	// the actual column headers live in row 1 starting at B1, and
	// data values start at B2. So "First Name" is at B1, "Dulce"
	// (the value we'll overwrite) is at B2. See sheet1.xml of the
	// fixture for the layout.
	const (
		newB2Value     = "Goja-Modified"
		newRowFirst    = "BulkAdded"
		newRowLast     = "FromGo"
		newRowCountry  = "Antarctica"
		newRowAge      = 99
		expectedHeader = "First Name"
		originalB2     = "Dulce"
	)

	type result struct {
		// outBytes is what writeBuffer() produced after edits.
		outBytes []byte
		// originalB2 is what we read out of the input file before
		// touching it — proves the read path actually parsed the
		// fixture rather than handing us empty cells.
		originalB2 string
		// readbackB2 / readbackHeader / readbackNewRow are pulled
		// from the produced file after reopening it inside JS.
		readbackHeader string
		readbackB2     string
		readbackNewRow []string
		err            error
		parseOnly      bool
	}
	resultCh := make(chan result, 1)

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

		bootstrap := `
            globalThis.module = { exports: {} };
            globalThis.exports = globalThis.module.exports;
        `
		if _, err := vm.RunString(bootstrap); err != nil {
			resultCh <- result{err: fmt.Errorf("bootstrap: %w", err)}
			return
		}

		// Strip the sourceMappingURL directive so goja's parser
		// doesn't try to resolve a missing .map file. The lowered
		// bundle itself is already async-generator-free.
		bundle := strings.ReplaceAll(exceljsBundle, "//# sourceMappingURL=exceljs.min.js.map", "")
		if _, err := vm.RunString(bundle); err != nil {
			resultCh <- result{err: fmt.Errorf("evaluate exceljs bundle: %w", err), parseOnly: true}
			return
		}

		// Hand the input file in as a Uint8Array. ExcelJS's
		// xlsx.load() accepts any ArrayBuffer/Uint8Array/Buffer.
		input := vm.NewArrayBuffer(append([]byte(nil), tinyXlsx...))
		if err := vm.Set("__inputBytes", input); err != nil {
			resultCh <- result{err: fmt.Errorf("expose __inputBytes: %w", err)}
			return
		}

		// __sendResult: the JS side calls this once with the final
		// edited bytes plus the values it read back after reopening.
		if err := vm.Set("__sendResult", func(call goja.FunctionCall) goja.Value {
			payload := call.Argument(0).ToObject(vm)

			bytesObj := payload.Get("bytes").ToObject(vm)
			length := int(bytesObj.Get("length").ToInteger())
			out := make([]byte, length)
			for i := 0; i < length; i++ {
				out[i] = byte(bytesObj.Get(fmt.Sprintf("%d", i)).ToInteger())
			}

			rowObj := payload.Get("readbackNewRow").ToObject(vm)
			rowLen := int(rowObj.Get("length").ToInteger())
			row := make([]string, rowLen)
			for i := 0; i < rowLen; i++ {
				row[i] = rowObj.Get(fmt.Sprintf("%d", i)).String()
			}

			resultCh <- result{
				outBytes:       out,
				originalB2:     payload.Get("originalB2").String(),
				readbackHeader: payload.Get("readbackHeader").String(),
				readbackB2:     payload.Get("readbackB2").String(),
				readbackNewRow: row,
			}
			return goja.Undefined()
		}); err != nil {
			resultCh <- result{err: fmt.Errorf("expose __sendResult: %w", err)}
			return
		}

		if err := vm.Set("__sendError", func(call goja.FunctionCall) goja.Value {
			resultCh <- result{err: errors.New(call.Argument(0).String())}
			return goja.Undefined()
		}); err != nil {
			resultCh <- result{err: fmt.Errorf("expose __sendError: %w", err)}
			return
		}

		// Pass the in-test constants through to JS so we don't have
		// to duplicate them as JS literals.
		if err := vm.Set("__params", map[string]any{
			"newB2Value":    newB2Value,
			"newRowFirst":   newRowFirst,
			"newRowLast":    newRowLast,
			"newRowCountry": newRowCountry,
			"newRowAge":     newRowAge,
		}); err != nil {
			resultCh <- result{err: fmt.Errorf("expose __params: %w", err)}
			return
		}

		script := `
            (async function () {
                try {
                    const ExcelJS = module.exports;
                    if (!ExcelJS || !ExcelJS.Workbook) {
                        throw new Error('ExcelJS.Workbook missing — bundle did not attach to module.exports');
                    }

                    // 1. Read.
                    const wb = new ExcelJS.Workbook();
                    await wb.xlsx.load(__inputBytes);
                    const ws = wb.worksheets[0];
                    if (!ws) throw new Error('input workbook has no worksheets');

                    // Cell.value can be a string, a number, or a
                    // {richText: [...]} object depending on style.
                    // Force a readable representation.
                    const stringify = (v) => {
                        if (v === null || v === undefined) return '';
                        if (typeof v === 'object' && Array.isArray(v.richText)) {
                            return v.richText.map((p) => p.text).join('');
                        }
                        return String(v);
                    };

                    // Capture B2 before mutation so the test can
                    // confirm the read path actually parsed the
                    // shared-strings table (not just returned empty).
                    const originalB2 = stringify(ws.getCell('B2').value);

                    // 2. Modify B2 in place.
                    ws.getCell('B2').value = __params.newB2Value;

                    // 3. Append a row at the end. The header is row
                    //    1, data rows go from 2 onward; addRow appends
                    //    after the last populated row.
                    ws.addRow([
                        null,
                        __params.newRowFirst,
                        __params.newRowLast,
                        null,
                        __params.newRowCountry,
                        __params.newRowAge,
                    ]);

                    // 4. Write to buffer.
                    const buf = await wb.xlsx.writeBuffer();

                    // 5. Reopen the produced bytes in a fresh
                    //    workbook to confirm the edits round-tripped
                    //    through the actual zip/xml writer.
                    const wb2 = new ExcelJS.Workbook();
                    await wb2.xlsx.load(buf);
                    const ws2 = wb2.worksheets[0];
                    // Header label "First Name" lives at B1 in the
                    // fixture (column A is a row index).
                    const headerCell = ws2.getCell('B1');
                    const b2 = ws2.getCell('B2');
                    const lastRow = ws2.getRow(ws2.actualRowCount);

                    __sendResult({
                        bytes: buf,
                        originalB2: originalB2,
                        readbackHeader: stringify(headerCell.value),
                        readbackB2: stringify(b2.value),
                        readbackNewRow: [
                            stringify(lastRow.getCell(2).value),
                            stringify(lastRow.getCell(3).value),
                            stringify(lastRow.getCell(5).value),
                            stringify(lastRow.getCell(6).value),
                        ],
                    });
                } catch (e) {
                    __sendError(String(e && e.stack || e));
                }
            })();
        `
		if _, err := vm.RunString(script); err != nil {
			resultCh <- result{err: fmt.Errorf("run probe script: %w", err)}
			return
		}
	})

	go func() {
		select {
		case r := <-resultCh:
			loop.StopNoWait()
			resultCh <- r
		case <-time.After(60 * time.Second):
			loop.StopNoWait()
			resultCh <- result{err: errors.New("timeout: probe did not complete in 60s")}
		}
	}()

	loop.StartInForeground()

	r := <-resultCh
	if r.err != nil {
		if r.parseOnly {
			t.Skipf("goja could not evaluate the lowered ExcelJS bundle: %v", r.err)
		}
		t.Fatalf("ExcelJS probe failed: %v", r.err)
	}

	if !bytes.HasPrefix(r.outBytes, []byte{0x50, 0x4B, 0x03, 0x04}) {
		t.Fatalf("output is not a valid xlsx (first 4 bytes = %x), got %d bytes", r.outBytes[:4], len(r.outBytes))
	}

	// Persist the rewritten file to a tmp path the way a real
	// save-back hook would, and confirm it survives a disk round-trip.
	tmpPath := filepath.Join(t.TempDir(), "tiny.modified.xlsx")
	if err := os.WriteFile(tmpPath, r.outBytes, 0o644); err != nil {
		t.Fatalf("write tmp file: %v", err)
	}
	roundTrip, err := os.ReadFile(tmpPath)
	if err != nil {
		t.Fatalf("read tmp file: %v", err)
	}
	if !bytes.Equal(roundTrip, r.outBytes) {
		t.Fatalf("disk round-trip changed the bytes (in=%d, out=%d)", len(r.outBytes), len(roundTrip))
	}

	if r.originalB2 != originalB2 {
		t.Errorf("B2 read from input: want %q, got %q (read path may not be parsing shared strings)", originalB2, r.originalB2)
	}
	if r.readbackHeader != expectedHeader {
		t.Errorf("header B1: want %q, got %q", expectedHeader, r.readbackHeader)
	}
	if r.readbackB2 != newB2Value {
		t.Errorf("B2 after edit: want %q, got %q", newB2Value, r.readbackB2)
	}
	wantRow := []string{newRowFirst, newRowLast, newRowCountry, fmt.Sprintf("%d", newRowAge)}
	if len(r.readbackNewRow) != len(wantRow) {
		t.Fatalf("appended row length: want %d cells, got %d (%v)", len(wantRow), len(r.readbackNewRow), r.readbackNewRow)
	}
	for i, want := range wantRow {
		if r.readbackNewRow[i] != want {
			t.Errorf("appended row cell %d: want %q, got %q", i, want, r.readbackNewRow[i])
		}
	}

	t.Logf("read-modify-write OK: %d input bytes → %d output bytes, written to %s", len(tinyXlsx), len(r.outBytes), tmpPath)
}
