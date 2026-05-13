# calc

Spreadsheets for your organization.

A feature package for the [tinycld](https://github.com/tinycld/tinycld)
ecosystem. Lives as a standalone git repo alongside the
[`tinycld`](https://github.com/tinycld/tinycld) app shell and other sibling
packages (`contacts`, `mail`, `calendar`, `drive`,
`google-takeout-import`). The app shell bundles `@tinycld/core` inside it
— there is no separate core repo to clone.

## What it does

Stores spreadsheets as `.xlsx` files in `@tinycld/drive` and edits them
collaboratively. Workbooks open from the drive UI (calc registers an xlsx
preview + an "Open in Calc" file action) or from the dedicated `/a/<org>/calc`
index. The grid handles cell editing, formulas (via HyperFormula), styling
(font, fill, alignment, borders, number formats), structural mutations (insert
/ delete rows and columns, with formula-reference rewriting), copy / cut /
paste with marching-ants cut indicator, fill-handle series detection, column /
row resize, undo / redo, per-cell threaded comments, and live presence
(cursors, selections, who's-editing-what).

Calc depends on `@tinycld/drive` — the drive_item record is the spreadsheet's
identity, the drive share rules govern who can open the room, and the xlsx
blob attached to the drive_item is the source of truth that survives across
sessions.

## Menus

A Sheets-style menubar sits above the toolbar:

- **File** — New spreadsheet, Open, Import, Make a copy (disabled until
  server-side blob copy lands), Download (XLSX / CSV current / CSV all),
  Rename, Move to trash, Details, Print.
- **Edit** — Undo, Redo, Cut, Copy, Paste, Paste special (Values only,
  Format only), Find and replace.
- **View** — Freeze (rows / columns / up to selection / Unfreeze), Hidden
  sheets (re-show a hidden tab).
- **Format** — Number (preset registry), Text (Bold / Italic / Underline /
  Strikethrough with active-state check), Alignment (Left / Center / Right),
  Font size, Merge cells, Clear formatting (⌘\\).
- **Data** — Sort range, Create / Remove filter.
- **Help** — Documentation (`tinycld.org/docs`), Function list (every
  HyperFormula function name), Keyboard shortcuts (⌘/).

The toolbar is trimmed to the core formatting controls (Undo/Redo, number
format, currency / percent / decimal stepper, font size, bold / italic /
underline / strike, text color, fill color, borders, horizontal alignment,
find). Sort, filter, merge, freeze, download, and print are menu-only.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Client (React Native / web)                                         │
│                                                                      │
│   Grid / Toolbar / FormulaBar / SheetTabs / CommentPopover           │
│                       │                                              │
│                       ▼                                              │
│   hooks/use-y-cell  use-y-sheets  use-grid-store  use-realtime       │
│                       │                                              │
│                       ▼                                              │
│   Y.Doc  (sheets Y.Map, cells Y.Map, awareness, undo manager)        │
│                       │                                              │
│                       │  HyperFormula bridge mirrors formulas        │
│                       │  in/out of the doc (FORMULA_ORIGIN)          │
│                       │                                              │
│                       ▼                                              │
│   @tinycld/core useRealtimeRoom  ── WebSocket ──┐                    │
└─────────────────────────────────────────────────┼────────────────────┘
                                                  │
┌─────────────────────────────────────────────────┼────────────────────┐
│  Server (Go, PocketBase + tinycld.org/core)     │                    │
│                                                 ▼                    │
│   core/realtime  broker  (roomKind "calc")                           │
│                       │                                              │
│                       ▼                                              │
│   calc Runtime  (per-room server-side ycrdt.Doc; same shape as TS)   │
│        │   ▲                                                         │
│        │   │  bootstrapHook: on first open, parse xlsx blob and      │
│        │   │  stamp sheets + cells into the doc BEFORE SyncReply     │
│        │   │  ┌────────────────────────────────────────────────┐     │
│        │   └──┤ drive_items.file  (xlsx blob in PocketBase)     │    │
│        │      └────────────────────────────────────────────────┘     │
│        ▼                                                             │
│   SaveCoordinator  (debounce 3s, ceiling 15s, teardown 30s)          │
│        │                                                             │
│        ▼                                                             │
│   persist.SaveRoom: read original xlsx → snapshot ycrdt.Doc →        │
│                     overlay (sheets, dimensions, row/col sizes,      │
│                     row styles, cells, formulas, comments) →         │
│                     write back via excelize → save drive_items.file  │
└──────────────────────────────────────────────────────────────────────┘
```

### Y.Doc as the shared format

The wire format and the in-memory format are the same: a Yjs document with
two top-level `Y.Map`s, mirrored byte-for-byte on the client (yjs) and the
server (`github.com/skyterra/y-crdt`).

**`sheets`** — keyed by stable sheet id (`sheet1`, `sheet2`, …). Each value
is a `Y.Map` with:

- `name: string`
- `position: number` — render order
- `rowCount`, `colCount: number` — extent, written back to xlsx
  `<dimension>` (unioned with the original, never shrunk)
- `colWidths?: Record<number, number>`, `rowHeights?: Record<number, number>`
  — sparse pixel overrides; `0` means hidden
- `rowStyles?: Record<number, CellStyle>` — sparse row-level styling

**`cells`** — keyed by `${sheetId}:${row}:${col}` (see
`lib/y-cell-key.ts` and `parseCellKey` in `server/runtime.go`). Each value
is a `Y.Map` per cell:

- `kind: 'string' | 'number' | 'boolean' | 'date' | 'formula'` — semantic
  type, distinct from `typeof raw` so an ISO date string and literal text
  remain distinguishable
- `raw: string | number | boolean | null` — Yjs-serializable scalar (no
  `Date` — dates are ISO strings)
- `display: string` — cached `formatCell(kind, raw, formula, numFmt)` so
  non-formatter readers (server serializer, alternate clients) render
  identically without re-running the formatter
- `formula?: string` — present only for `kind === 'formula'`
- `style?: Y.Map` — nested `font` / `fill` / `alignment` / `borders` group
  maps plus scalar `numFmt`. Absent groups and absent keys mean
  "untracked" — the serializer leaves the source xlsx attribute alone

Both sides share a canonical bootstrap: `bootstrapYDocFromWorkbook` in
`tinycld/calc/lib/y-doc-bootstrap.ts` and `BootstrapYDocFromWorkbook` in
`server/bootstrap.go` produce identical doc shapes from the same parsed
`WorkbookModel`. The client never parses xlsx — when a room opens, the
server has already stamped the doc and the first `SyncReply` carries
populated state.

The `style` `Y.Map` shape is intentionally additive: a new attribute
lands as one field in TS `CellStyle`, one field in Go `CellStyle`, one
reader in `server/bootstrap.go::readWorkbookCellStyle`, and one writer
in `persist.go`. Nothing in between needs to change.

### Realtime room lifecycle

Calc registers itself as a `realtime.RoomKind` named `"calc"` (see
`server/realtime_authorize.go`). For each `drive_item.id` clients reach
via `useRealtimeRoom({ roomKind: 'calc', roomID: driveItemID, … })`:

1. **Authorize** — the room rejects clients without a `drive_shares` row
   linking them to the item.
2. **Bootstrap** — on first open, `Runtime.NewDoc` invokes the bootstrap
   hook, which loads `drive_items.file`, parses the xlsx with `excelize`,
   and seeds the `Y.Doc` via `BootstrapYDocFromWorkbook` — all
   synchronously, before the broker sends `SyncReply`. Empty / missing
   files yield an empty doc that the next save will materialize from
   scratch.
3. **Updates** — every `MsgDocUpdate` is folded into the server's doc
   via `ycrdt.ApplyUpdate` and rebroadcast.
4. **Save** — the `SaveCoordinator` watches doc updates and triggers
   `SaveRoom` on a 3-second debounce, 15-second ceiling, or 30-second
   teardown when the last client leaves. Failures retry with exponential
   backoff (1s, 2s, 4s, 8s, 16s, 30s cap).

`SaveRoom` reads the current xlsx bytes off `drive_items`, snapshots the
server-side `Y.Doc` (`Snapshot()` walks the `sheets` and `cells` maps
into Go structs), and applies the snapshot on top of the original
workbook via `excelize` — renaming or appending sheets, growing
dimensions, applying row/column sizes and styles, writing each cell's
formula or value, then writing classic xlsx cell notes for the threaded
comments. The resulting bytes replace `drive_items.file`; PocketBase
renames the on-disk blob to a fresh hash so the prior version isn't
overwritten in place.

### Why server-side bootstrap

Bootstrap happens server-side (not client-side) so the wire shape clients
see is canonical regardless of join order — there is no "first joiner
parses xlsx, everyone else syncs from peer" race, and a peer dropping
mid-edit doesn't strand the next joiner with stale state. The client
package has no xlsx parser at all; `excelize` is a Go-only dependency.

### Formula evaluation

HyperFormula runs client-side only. The `FormulaBridge`
(`lib/formula/bridge.ts`) mirrors the `Y.Doc`'s cells into HF on bootstrap,
attaches a `valuesUpdated` listener, and writes cached scalars back into
each formula cell's `raw` tagged with `FORMULA_ORIGIN`. The `observeDeep`
callback short-circuits on that origin so HF never re-receives its own
outputs. The server stores the cached scalar in `raw` but does no
evaluation of its own — the formula text is the source of truth and any
client recomputes from there.

### Comments

Comments are not in the `Y.Doc`. They live in a regular PocketBase
collection, `calc_comments` (see `pb-migrations/`), one row per thread
root or reply. The grid subscribes via `useCellComments` with
`useOrgLiveQuery`; mutations go through `useMutation`. On save,
`SaveRoom` snapshots the threads and writes them into the xlsx as
classic cell notes (one-way: app → xlsx; external editor notes are
overwritten).

### Server package layout

```
server/
    register.go           Register(app) — wires realtime + API
    realtime_authorize.go RoomKind "calc"; drive_shares-based access
    runtime.go            per-room ycrdt.Doc registry; Snapshot()
    bootstrap.go          ReadWorkbookFromXLSX, BootstrapYDocFromWorkbook
    bootstrap_hook.go     production bootstrap closure (load drive_items file)
    save_coordinator.go   debounce / ceiling / teardown save state machine
    persist.go            SaveRoom — Y.Doc snapshot → xlsx via excelize
    comments.go           CommentRow loader; classic xlsx cell-note writer
    snapshot.go           Go-side YDocSnapshot / SheetMeta / CellEntry shapes
    api.go                GET /api/calc/preview/:id (thumbnail / file preview)
```

Go module: `tinycld.org/packages/calc`. Imports `tinycld.org/core/realtime`
through the standard go.mod replace directive the app shell installs.

### Client package layout

```
tinycld/calc/
    manifest.ts        package manifest (slug, nav, provider, server, deps)
    provider.tsx       registers CalcPreview for xlsx mime + drive actions
    collections.ts     calc_comments pbtsdb registration
    types.ts           CalcSchema (for MergedSchema) + CalcComments row shape
    seed.ts            sample data
    screens/
        index.tsx      workbook list + "new spreadsheet"
        [id].tsx       editor — opens room, mounts Grid + SheetTabs
    components/
        Grid.tsx, Body, Cell, CellContextMenu, ColumnHeader, RowHeader,
        CornerCell, CommentPopover, CommentIndicator,
        CutMarchingAntsOverlay, Toolbar (+ submenus), FormulaBar,
        SheetTabs, CalcPreview
        menubar/
            MenuBar.tsx, MenuBarTrigger.tsx, MenuShortcut.tsx,
            FileMenu, EditMenu, ViewMenu, FormatMenu, DataMenu, HelpMenu
        dialogs/
            FunctionListDialog.tsx, KeyboardShortcutsDialog.tsx
    hooks/
        use-realtime.ts            calc-flavored useRealtimeRoom
        use-workbook-context.tsx   provider with doc + awareness
        use-y-cell.ts              read/write a single cell with origin tagging
        use-y-sheets.ts            sheets + sparse dim/style overrides
        use-grid-store.tsx         zustand store for grid UI state
        use-formula-bridge.ts      mounts FormulaBridge to the doc
        use-cell-comments.ts       live calc_comments per workbook
        use-presence.ts            awareness selection/editing
        use-undo-manager.ts        Y.UndoManager wired to typing
        use-clipboard.ts           copy/cut/paste (web + native adapters)
        use-column-resize.ts, use-row-resize.ts
        use-calc-shortcuts.ts      keyboard handler + shortcut docs
        use-clear-formatting.ts    wipe cell styles in a range (⌘\)
        use-menu-dialogs-store.ts  zustand for Function list / Shortcuts dialogs
        use-workbook-file-actions.ts  rename / trash / details from File menu
    lib/
        workbook-types.ts          CellKind, CellStyle, formatCell
        y-doc-bootstrap.ts         SHEETS_MAP / CELLS_MAP / readYCell / bootstrap
        y-cell-key.ts              ${sheet}:${row}:${col} keying
        structural-mutations.ts    insert/delete row/col (in a Y.Doc transaction)
        formula/
            bridge.ts              HyperFormula ↔ Y.Doc mirror
            rewrite-on-structural-mutation.ts
            normalize.ts, origins.ts, autocomplete.ts, function-names.ts
        clipboard/                 web + native adapters, TSV/HTML codecs
        fill/detect-series.ts      fill-handle pattern detection
        number-format/             presets + formatter
        sheet-styles.ts, dimensions.ts, border-presets.ts, cell-style-render.ts
        comments.ts                comment thread grouping
        blank-workbook.ts          minimal xlsx for "new spreadsheet"
```

## Development

```sh
# Clone the app shell and this package as siblings
cd ~/code/tinycld
git clone git@github.com:tinycld/tinycld.git
git clone git@github.com:tinycld/calc.git

# Install deps in the app shell
cd tinycld
pnpm install

# Link this package (and its dependency, @tinycld/drive) into the app shell
pnpm run packages:link ../drive
pnpm run packages:link ../calc

# Run the full stack
pnpm run dev
```

## Standalone checks

From this directory, with `node_modules` symlinked to `../tinycld/node_modules`:

```sh
ln -s ../tinycld/node_modules node_modules

pnpm run lint        # biome (config lives in the app shell)
```

Typechecking is best done from inside `tinycld/` after this package is linked
in — the app shell's tsconfig pulls in `expo`'s base config, `uniwind` type
augments, and the live `~/types/pbSchema` generated from PocketBase, none of
which a standalone `tsc` invocation in this package can see:

```sh
cd ../tinycld
pnpm run typecheck
pnpm run test:unit       # vitest, including this package's tests/
pnpm run test:go         # go test on this package's server/
```

## CI

`.github/workflows/ci.yml` runs lint, typecheck, and vitest on every push to
`main` and every PR. It clones `tinycld/tinycld@main` into a sibling
directory, installs the app shell's deps, links this package in, and runs
the checks — exactly what a developer does locally.

## Package anatomy

- `manifest.ts` — single source of truth for capabilities (routes, nav,
  collections, migrations, provider, server module, package dependencies)
- `package.json` — name, exports map, peer deps (yjs, y-protocols,
  hyperformula, numfmt, pbtsdb, @tanstack/db, expo-clipboard, …)
- `pb-migrations/` — PocketBase migrations (symlinked into the app shell's
  server on `packages:generate`)
- `server/` — Go server module, registered by the generator
- `tests/` — vitest unit tests (sibling tests run from the app shell)
- `tinycld/calc/` — TypeScript source (screens, components, hooks, lib)
