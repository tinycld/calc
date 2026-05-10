# Calc MVP Gap Assessment

Comparison of the current `@tinycld/calc` implementation against leading online
spreadsheets (Google Sheets, Excel Online) to identify what's missing for a
minimum viable product.

## What's already solid

The collaborative core is in good shape:

- Yjs-backed real-time sync with presence cursors
- Threaded comments persisted in PocketBase
- Undo/redo wired to the right Y.Maps
- HyperFormula with ~390 functions including cross-sheet refs
- 13 number-format presets
- Full font / border / alignment / wrap styling
- Insert / delete rows + columns
- Multi-range selection
- `.xlsx` as the on-disk format

## MUST-HAVE gaps (block basic usability)

These block the basic "open a spreadsheet and get work done" flow. Listed in
recommended implementation order.

1. ~~**Formula reference rewriting on insert/delete**~~ — **done.** Each
   `insertRows` / `insertColumns` / `deleteRows` / `deleteColumns` now rewrites
   formula refs (across all sheets, including cross-sheet refs into the mutated
   sheet) atomically with the cell shift inside the same `doc.transact`. See
   `lib/formula/rewrite-on-structural-mutation.ts`.

2. **Copy / Cut / Paste** — `hooks/grid-store.ts` has no clipboard handlers at
   all. The #1 usability blocker. Users can't move data around, can't paste from
   email / web / another sheet, can't duplicate rows. Needs Cmd-C/X/V,
   paste-from-system-clipboard (TSV from Excel/Sheets, plain text, internal rich
   format with styles + formulas + ref-shifting).

3. **Fill handle / autofill** — `components/grid/overlays.tsx` mentions it in a
   comment but there's no implementation. Drag-to-fill (numbers, dates, formulas
   with relative-ref shifting, series detection) is table-stakes; without it
   formula-heavy workflows are unbearable.

4. **Find & replace** — For this we need to investigate how keyboard shortcuts work
   and hook into the standard ctrl-f and control-r.  we also need to add a toolbar
   

5. **Sort & filter** — neither exists. A sheet of more than ~30 rows is useless
   without at minimum: sort range by column asc/desc, and a filter view (header
   dropdowns hiding rows by value).

6. **Freeze rows/columns** — absent. Any sheet wider than a screen needs a
   frozen header row to be navigable.

7. **Sheet management UI** — `components/SheetTabs.tsx` only renders selection;
   add / rename / delete / duplicate / reorder aren't wired up. New workbooks
   are stuck with whatever sheets the xlsx import produced.

8. **Merge cells** — absent. Even basic title rows in templates assume this
   exists.

9. **Keyboard shortcuts for formatting** — Cmd-B / Cmd-I / Cmd-U for bold /
   italic / underline. Trivial to add, glaring when missing.

10. **CSV export (and ideally import)** — the only format is xlsx round-trip.
    Users routinely need CSV for downstream tools; one-evening add.

## Strong second tier (expected, not strictly MVP)

Not ship-blockers, but the difference between "MVP" and "competitive":

- Conditional formatting
- Data validation (dropdowns especially)
- Named ranges
- Print / PDF export
- Image embedding

## Third tier

- Charts
- Pivot tables
- Protected ranges
- Drawing / shapes

## Recommendation

The first six items in the MUST-HAVE list get to "I can actually use this for a
real task." The rest get to "I'm not embarrassed to demo this next to Sheets."

Item 1 (formula rewrite on structural mutation) shipped on the `xlsx-persistence-gaps`
branch — that was the most contained and most urgent of the must-haves.
