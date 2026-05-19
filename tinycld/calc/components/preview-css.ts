// preview-css.ts is the styling layer for the calc preview surface.
// The server emits stable `tinycld-calc*` class names; this file
// turns those into a theme-aware visual treatment for the read-only
// preview iframe.
//
// The iframe is sandboxed (no scripts, same-origin) so we cannot pull
// theme tokens from the parent. We embed both light and dark palettes
// and switch via `@media (prefers-color-scheme)` — the OS-level
// preference closely matches what the app would pick anyway, and the
// preview is short-lived enough that drift between the two is
// uninteresting.
//
// Layout choices:
//   - tinycld-calc grid uses table-layout: auto so wide cells widen
//     naturally — this is a read-only viewer, not a fixed-grid editor.
//   - row/column headers use a slightly darker background and reduced
//     font size to mirror the on-screen editor.
//   - cell defaults: 1px border, modest padding, vertical-align middle.
export const PREVIEW_CSS = `
:root {
    color-scheme: light dark;
    --tc-fg: #18181b;
    --tc-bg: #ffffff;
    --tc-muted: #71717a;
    --tc-border: #e4e4e7;
    --tc-header-bg: #fafafa;
    --tc-header-fg: #52525b;
    --tc-cell-bg: transparent;
}
@media (prefers-color-scheme: dark) {
    :root {
        --tc-fg: #fafafa;
        --tc-bg: #09090b;
        --tc-muted: #a1a1aa;
        --tc-border: #27272a;
        --tc-header-bg: #18181b;
        --tc-header-fg: #a1a1aa;
        --tc-cell-bg: transparent;
    }
}
html, body { margin: 0; padding: 0; }
body {
    font-family: -apple-system, system-ui, 'Segoe UI', sans-serif;
    font-size: 13px;
    color: var(--tc-fg);
    background: var(--tc-bg);
}
.tinycld-calc {
    width: 100%;
    overflow: auto;
}
.tinycld-calc-sheet + .tinycld-calc-sheet {
    margin-top: 24px;
}
.tinycld-calc-sheet-title {
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 8px 0;
    padding: 4px 0;
}
.tinycld-calc-grid {
    border-collapse: collapse;
    width: auto;
    table-layout: auto;
}
.tinycld-calc-corner,
.tinycld-calc-col-h,
.tinycld-calc-row-h {
    background: var(--tc-header-bg);
    color: var(--tc-header-fg);
    font-weight: normal;
    font-size: 11px;
    text-align: center;
    border: 1px solid var(--tc-border);
    padding: 2px 6px;
    min-width: 28px;
}
.tinycld-calc-col-h { min-width: 80px; }
.tinycld-calc-cell {
    border: 1px solid var(--tc-border);
    padding: 2px 6px;
    background: var(--tc-cell-bg);
    vertical-align: middle;
    min-width: 80px;
    max-width: 320px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.tinycld-calc-cell--bold { font-weight: 600; }
.tinycld-calc-cell--italic { font-style: italic; }
.tinycld-calc-cell--underline { text-decoration: underline; }
.tinycld-calc-cell--strike { text-decoration: line-through; }
.tinycld-calc-cell--align-left { text-align: left; }
.tinycld-calc-cell--align-center { text-align: center; }
.tinycld-calc-cell--align-right { text-align: right; }
.tinycld-calc-cell--valign-top { vertical-align: top; }
.tinycld-calc-cell--valign-middle { vertical-align: middle; }
.tinycld-calc-cell--valign-bottom { vertical-align: bottom; }
.tinycld-calc-cell--wrap { white-space: normal; }
.tinycld-calc-cell--border-top { border-top-width: 2px; }
.tinycld-calc-cell--border-right { border-right-width: 2px; }
.tinycld-calc-cell--border-bottom { border-bottom-width: 2px; }
.tinycld-calc-cell--border-left { border-left-width: 2px; }
/* Per-cell color / fill / font / size overrides. The server emits
   data-* attrs (sanitizer validates the values); modern browsers
   project them onto CSS via typed attr(). Browsers without typed
   attr() support fall back to the boolean class modifiers and the
   --filled fallback below — text remains legible. */
.tinycld-calc-cell[data-color] { color: attr(data-color type(<color>), inherit); }
.tinycld-calc-cell[data-bg] { background: attr(data-bg type(<color>), inherit); }
.tinycld-calc-cell[data-font-size] { font-size: attr(data-font-size type(<length>), inherit); }
.tinycld-calc-cell[data-font-family] { font-family: attr(data-font-family type(<custom-ident> | <string>), inherit); }
/* Fallback shading for cells with a fill attribute on browsers that
   don't yet support typed attr() — fades when the typed rule above
   wins. Boolean .tinycld-calc-cell--filled used to live alongside
   this; it's removed now that data-bg covers all fill cases. */
.tinycld-calc-cell[data-bg]:not([style]) { background-image: linear-gradient(rgba(0, 122, 255, 0.04), rgba(0, 122, 255, 0.04)); }
`
