// Entry point for the yjs bundle the Go server runs in goja.
//
// Bun bundles this file (and its transitive yjs imports) into a
// single self-contained IIFE that attaches the surface the Go side
// needs to globalThis.Y.
//
// We export only the symbols the persistence path actually uses, to
// keep the bundle small and the contract narrow.
//
// The crypto shim that yjs needs at module-eval time is prepended to
// the bundle by the build script (see ./build-yjs.sh) — it can't live
// here because ESM hoists all `import` statements above any top-level
// statements, so the shim wouldn't run before yjs's module body.

import * as Y from 'yjs'

globalThis.Y = {
    Doc: Y.Doc,
    Map: Y.Map,
    Array: Y.Array,
    Text: Y.Text,
    applyUpdate: Y.applyUpdate,
    encodeStateAsUpdate: Y.encodeStateAsUpdate,
    encodeStateVector: Y.encodeStateVector,
    transact: Y.transact,
}
