# jsvendor build helpers

The `*.bundle.js` and `*.lowered.js` files in the parent directory are
committed pre-built artifacts. Source entry points and build steps live here
so they can be regenerated.

## yjs.bundle.js

```sh
# from this directory:
./build-yjs.sh
```

`build-yjs.sh` bundles `yjs-entry.js` (which re-exports the symbols the Go
server uses) plus its transitive yjs imports into a single self-contained
IIFE that attaches to `globalThis.Y`, then prepends a `crypto.getRandomValues`
shim (yjs reads it at module-eval time and goja has no `crypto` global).

Bun must be invoked from a directory whose `node_modules/` resolves `yjs` —
the script uses the linked app shell at `../../../../tinycld/`. Run
`bun install` there first if needed.

Goja (>= the version pinned in `server/go.mod`) supports the modern JS the
yjs output uses (optional chaining, nullish coalescing, classes, etc.); no
Babel-lowering pass is needed.

## exceljs.lowered.js

The ExcelJS bundle was Babel-lowered with
`@babel/plugin-transform-async-generator-functions` and
`@babel/plugin-transform-async-to-generator` because ExcelJS's source ships
`async function*` and `for await`, which goja's parser rejects. The lowering
step is preserved as a checked-in artifact (no regeneration script today).
If ExcelJS is upgraded, re-lower with the same Babel plugins.
