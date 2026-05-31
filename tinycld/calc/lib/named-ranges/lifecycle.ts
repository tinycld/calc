// Sheet rename / delete propagation for named ranges. Lives next to
// `y-binding.ts` so the rewrite rules (sheet-prefix walking) stay with
// the rest of the named-ranges data model. Mirrors the pattern used by
// `lib/pivot/lifecycle.ts` for pivot definitions.

import * as Y from 'yjs'
import { NAMED_RANGES_MAP } from '../y-doc-bootstrap'
import { encodeSheetPrefix } from './sheet-prefix'
import { readNamedRange } from './y-binding'

// propagateNamedRangeSheetRename rewrites every named range's
// expression so that any reference to `oldName` (as a sheet prefix on
// a cell or range reference) becomes `newName`. Constants and
// expressions without sheet prefixes are left untouched.
//
// The walker preserves the existing prefix's quoted/unquoted form when
// it's still legal for the new name; otherwise it re-emits with
// quoting normalized for the new name (e.g. a rename from `Sheet1` to
// `My Sheet` requires quoting).
//
// MUST run inside the same LOCAL_ORIGIN transaction as the sheet
// rename so the realtime undo manager treats both as one undoable.
// `propagateSheetRename` in use-sheet-actions handles the outer
// transact wrapper.
export function propagateNamedRangeSheetRename(doc: Y.Doc, oldName: string, newName: string): void {
    if (oldName === newName) return
    const map = doc.getMap<Y.Map<unknown>>(NAMED_RANGES_MAP)
    map.forEach(entry => {
        if (!(entry instanceof Y.Map)) return
        const range = readNamedRange(entry)
        if (range == null) return
        const next = rewriteSheetPrefixInExpression(range.expression, oldName, newName)
        if (next !== range.expression) {
            entry.set('expression', next)
        }
    })
}

// propagateNamedRangeSheetDelete drops sheet-scoped named ranges whose
// scope sheet was just deleted. Workbook-global names whose expression
// references the deleted sheet stay in the doc — HF surfaces `#REF!`
// in dependent cells, matching Excel/Sheets behavior, and the user can
// edit the expression to recover.
export function propagateNamedRangeSheetDelete(doc: Y.Doc, deletedSheetId: string): void {
    const map = doc.getMap<Y.Map<unknown>>(NAMED_RANGES_MAP)
    const toDelete: string[] = []
    map.forEach((entry, key) => {
        const range = readNamedRange(entry)
        if (range == null) return
        if (range.scope === deletedSheetId) toDelete.push(key)
    })
    for (const key of toDelete) map.delete(key)
}

// rewriteSheetPrefixInExpression scans the expression for sheet-prefix
// forms (`OldName!` and `'OldName'!`) immediately followed by an A1
// reference, and rewrites them to the encoded form of newName. Uses a
// hand-rolled scanner (rather than the clipboard token walker) because
// the walker's sheet-prefix detection assumes the `!` sits directly
// before the column letter, which fails when the ref has a leading
// absolute marker like `Sheet1!$A$1`.
//
// String literals (`"…"` with `""` as the embedded-quote escape) are
// skipped so an embedded sheet-name lookalike inside a quoted string
// stays intact.
function rewriteSheetPrefixInExpression(
    expression: string,
    oldName: string,
    newName: string
): string {
    if (expression.length === 0) return expression
    const newPrefix = encodeSheetPrefix(newName)
    const out: string[] = []
    let i = 0
    let inString = false
    while (i < expression.length) {
        const ch = expression[i]
        if (inString) {
            out.push(ch)
            if (ch === '"') {
                if (expression[i + 1] === '"') {
                    out.push('"')
                    i += 2
                    continue
                }
                inString = false
            }
            i++
            continue
        }
        if (ch === '"') {
            inString = true
            out.push(ch)
            i++
            continue
        }
        // Try matching `OldName!` (unquoted) or `'OldName'!` (quoted)
        // followed by an A1-ish reference. The trailing-context guard
        // ensures we don't rewrite `'OldName'` appearing as a sheet
        // name inside a longer identifier (vanishingly rare but cheap
        // to guard).
        const matched = tryMatchSheetPrefix(expression, i, oldName)
        if (matched != null) {
            const afterPrefix = i + matched
            if (isA1Start(expression, afterPrefix)) {
                out.push(newPrefix)
                i = afterPrefix
                continue
            }
        }
        out.push(ch)
        i++
    }
    return out.join('')
}

// tryMatchSheetPrefix returns the length of an `OldName!` or
// `'OldName'!` prefix starting at `pos`, or null when none matches.
// Comparison is case-sensitive (Excel/Sheets treat sheet names as
// case-sensitive for the purposes of formula text).
function tryMatchSheetPrefix(input: string, pos: number, oldName: string): number | null {
    // Quoted form: 'oldName-with-doubled-apostrophes'!
    if (input[pos] === "'") {
        let p = pos + 1
        const decoded: string[] = []
        while (p < input.length) {
            const c = input[p]
            if (c === "'") {
                if (input[p + 1] === "'") {
                    decoded.push("'")
                    p += 2
                    continue
                }
                if (input[p + 1] !== '!') return null
                if (decoded.join('') !== oldName) return null
                return p + 2 - pos
            }
            decoded.push(c)
            p++
        }
        return null
    }
    // Unquoted form: oldName must match starting at pos, followed by `!`.
    if (input.startsWith(oldName, pos) && input[pos + oldName.length] === '!') {
        // Identifier-tail guard: char before pos must not be an ID char
        // (so `FooSheet1!A1` isn't mistaken for `Sheet1!A1`).
        if (pos > 0 && /[A-Za-z0-9_]/.test(input[pos - 1])) return null
        return oldName.length + 1
    }
    return null
}

// isA1Start checks whether the bytes at `pos` start with an A1-shaped
// reference (`$?[A-Z]{1,3}$?\d+`). Used as the trailing-context guard
// for sheet-prefix matching so we don't rewrite a stray `Sheet1!`
// that isn't part of a real cell reference.
function isA1Start(input: string, pos: number): boolean {
    let p = pos
    if (input[p] === '$') p++
    const letterStart = p
    while (p < input.length && /[A-Z]/.test(input[p])) p++
    if (p === letterStart || p - letterStart > 3) return false
    if (input[p] === '$') p++
    if (p >= input.length || !/\d/.test(input[p])) return false
    return true
}
