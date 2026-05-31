// Shared helpers for encoding a sheet name into its formula-text
// prefix form (e.g. `Sheet1!` or `'Quarterly Sales'!`). Three sites
// previously had near-identical copies of this logic:
//   - lib/named-ranges/lifecycle.ts (sheet rename rewrite)
//   - components/NameBox.tsx (selection → expression)
//   - components/grid/CellContextMenu.tsx ("Define from selection")
// Keeping them in lockstep was easy to forget; pulled here so future
// edits to the quoting rule (e.g. additional escape characters) land
// in one place.

// SHEET_NAME_UNQUOTED matches sheet names that need no quoting: a
// letter or underscore followed by letters, digits, and underscores.
// Anything else (spaces, punctuation, leading digit) gets the
// single-quoted form with `''` as the embedded-apostrophe escape.
const SHEET_NAME_UNQUOTED = /^[A-Za-z_][A-Za-z0-9_]*$/

// encodeSheetPrefix returns the prefix form including the trailing `!`,
// suitable for splicing in front of an A1 reference. Examples:
//   `Sheet1`           → `Sheet1!`
//   `Top Line`         → `'Top Line'!`
//   `Bob's Numbers`    → `'Bob''s Numbers'!`
export function encodeSheetPrefix(name: string): string {
    if (SHEET_NAME_UNQUOTED.test(name)) return `${name}!`
    return `'${name.replace(/'/g, "''")}'!`
}

// encodeSheetName returns the prefix WITHOUT the trailing `!` — used
// by selection-to-expression callers that want to splice the prefix
// in front of `!$A$1` literally.
export function encodeSheetName(name: string): string {
    if (SHEET_NAME_UNQUOTED.test(name)) return name
    return `'${name.replace(/'/g, "''")}'`
}
