// Y.Doc read/write helpers for named ranges. The bridge layer
// (lib/formula/bridge.ts) consumes these on bootstrap and on observed
// edits; the hooks layer (hooks/use-named-ranges.ts) wraps the writers
// in NAMED_RANGES_ORIGIN transactions so the bridge skips its own
// writebacks.
//
// HF naming rules (enforced here so the form layer can show errors
// before a write hits HF):
//
//   - Must start with a Unicode letter or `_`.
//   - Subsequent chars: Unicode letter / digit / `_` / `.`.
//   - Must NOT look like an A1 reference (e.g. `Q4`, `YEAR2023`) or
//     R1C1 reference (e.g. `R4C5`, `RC`). Case-insensitive comparison.
//   - Unique within a scope (case-insensitive). Workbook-global and
//     sheet-local scopes are independent — a local name shadows a
//     global of the same name within that sheet's evaluation context.

import * as Y from 'yjs'
import { NAMED_RANGES_MAP } from '../y-doc-bootstrap'
import type { NamedRange, NamedRangeKey, ValidationResult } from './types'

// normalizeName is the case-insensitive key used to index NAMED_RANGES_MAP.
// Lowercasing matches HF's case-insensitive lookup. Trimming guards
// against UI inputs with surrounding whitespace.
export function normalizeName(name: string): NamedRangeKey {
    return name.trim().toLowerCase()
}

// normalizeExpression strips a leading `=`, uppercases, and trims so two
// formula strings can be compared up to case + absolute markers. Used
// by the NameBox display path to match the current selection's encoded
// expression against defined ranges. Cheap (single allocation, no
// regex backtracking) so it's safe in a per-render lookup table.
export function normalizeExpression(expr: string): string {
    return expr.replace(/^=/, '').toUpperCase().trim()
}

// A1 and R1C1 lookalikes get rejected so HF doesn't choke on
// `addNamedExpression`. The patterns are deliberately narrow — Excel's
// column space tops out at three letters (XFD), so anything wider
// (e.g. `Tax2024` → 3 letters but `Year2023` → 4 letters) is fine as a
// name. R1C1 follows Excel's convention: `R`, optional digits, `C`,
// optional digits.
const A1_RE = /^[A-Z]{1,3}\d+$/i
const R1C1_RE = /^R\d*C\d*$/i
// First char: letter or underscore. Unicode-aware to match HF's
// permissive identifier rule.
const FIRST_CHAR_RE = /^[\p{L}_]/u
// Continuation chars: letters / digits / `_` / `.`.
const CONTINUE_RE = /^[\p{L}\p{N}_.]+$/u

export function validateName(name: string): ValidationResult {
    const trimmed = name.trim()
    if (trimmed.length === 0) {
        return { ok: false, reason: 'Name cannot be empty.' }
    }
    if (!FIRST_CHAR_RE.test(trimmed[0])) {
        return { ok: false, reason: 'Name must start with a letter or underscore.' }
    }
    if (!CONTINUE_RE.test(trimmed)) {
        return {
            ok: false,
            reason: 'Name can contain only letters, digits, underscores, and periods.',
        }
    }
    if (A1_RE.test(trimmed)) {
        return {
            ok: false,
            reason: 'Name cannot look like a cell reference (e.g. A1 or Q4).',
        }
    }
    if (R1C1_RE.test(trimmed)) {
        return {
            ok: false,
            reason: 'Name cannot look like an R1C1 reference.',
        }
    }
    return { ok: true }
}

// readNamedRange decodes one Y.Map entry into a typed NamedRange.
// Returns null when the entry is malformed (missing required fields,
// wrong types) — the caller's `forEach` skips it rather than blowing up.
export function readNamedRange(entry: unknown): NamedRange | null {
    if (!(entry instanceof Y.Map)) return null
    const name = entry.get('name')
    const expression = entry.get('expression')
    const scope = entry.get('scope')
    const comment = entry.get('comment')
    if (typeof name !== 'string' || name.length === 0) return null
    if (typeof expression !== 'string') return null
    if (scope !== null && typeof scope !== 'string') return null
    return {
        name,
        expression,
        scope: typeof scope === 'string' ? scope : null,
        comment: typeof comment === 'string' ? comment : undefined,
    }
}

// listNamedRanges returns every named range in the doc, paired with its
// Y.Map key (the normalized name). Stable order: sorted by key so the
// list UI renders deterministically. Returns [] when the map is empty
// or absent.
export function listNamedRanges(doc: Y.Doc): Array<{ key: NamedRangeKey; range: NamedRange }> {
    const map = doc.getMap<Y.Map<unknown>>(NAMED_RANGES_MAP)
    const out: Array<{ key: NamedRangeKey; range: NamedRange }> = []
    map.forEach((entry, key) => {
        const r = readNamedRange(entry)
        if (r != null) out.push({ key, range: r })
    })
    out.sort((a, b) => a.key.localeCompare(b.key))
    return out
}

// findExistingKey returns the existing key under `name` (case-insensitive)
// or null if no entry exists. Used by mutation helpers to decide whether
// to overwrite vs. reject as a duplicate.
export function findExistingKey(doc: Y.Doc, name: string): NamedRangeKey | null {
    const key = normalizeName(name)
    const map = doc.getMap<Y.Map<unknown>>(NAMED_RANGES_MAP)
    return map.has(key) ? key : null
}

// writeNamedRange persists a NamedRange into the doc under its
// normalized key, replacing any existing entry. Callers must wrap this
// in a Y.Doc transaction tagged NAMED_RANGES_ORIGIN — the bridge relies
// on the origin to skip its own observer.
//
// Returns the normalized key written. Throws if the name fails
// validation; the form layer is expected to validate first and only
// reach this on the happy path.
export function writeNamedRange(doc: Y.Doc, range: NamedRange): NamedRangeKey {
    const result = validateName(range.name)
    if (!result.ok) {
        throw new Error(`Invalid named range: ${result.reason}`)
    }
    const key = normalizeName(range.name)
    const map = doc.getMap<Y.Map<unknown>>(NAMED_RANGES_MAP)
    const entry = new Y.Map<unknown>()
    entry.set('name', range.name.trim())
    entry.set('expression', range.expression)
    entry.set('scope', range.scope)
    if (range.comment != null && range.comment.trim() !== '') {
        entry.set('comment', range.comment.trim())
    }
    map.set(key, entry)
    return key
}

// removeNamedRangeByKey removes a named range by its normalized key.
// No-op when no entry exists. Like writeNamedRange, must run inside a
// NAMED_RANGES_ORIGIN transaction.
export function removeNamedRangeByKey(doc: Y.Doc, key: NamedRangeKey): void {
    const map = doc.getMap<Y.Map<unknown>>(NAMED_RANGES_MAP)
    if (map.has(key)) map.delete(key)
}

// renameNamedRange changes the original-casing display name without
// changing the canonical key (when the lowercase form is unchanged) OR
// moves the entry to a new key (when the casing change also changes
// the lowercase form, e.g. via diacritics — vanishingly rare for ASCII
// names but supported for correctness). Used by the form layer when
// the user edits a name in place.
//
// Returns the new key. Returns null if the destination key collides
// with an existing entry that isn't `existingKey`.
export function renameNamedRange(
    doc: Y.Doc,
    existingKey: NamedRangeKey,
    nextName: string
): NamedRangeKey | null {
    const result = validateName(nextName)
    if (!result.ok) {
        throw new Error(`Invalid named range: ${result.reason}`)
    }
    const map = doc.getMap<Y.Map<unknown>>(NAMED_RANGES_MAP)
    const entry = map.get(existingKey)
    if (!(entry instanceof Y.Map)) return existingKey
    const nextKey = normalizeName(nextName)
    if (nextKey !== existingKey && map.has(nextKey)) return null
    entry.set('name', nextName.trim())
    if (nextKey !== existingKey) {
        // Move the entry by clone-and-delete; Y.Map.set on a new key
        // does not move the existing value.
        const cloned = new Y.Map<unknown>()
        entry.forEach((v, k) => {
            cloned.set(k, v)
        })
        map.set(nextKey, cloned)
        map.delete(existingKey)
    }
    return nextKey
}
