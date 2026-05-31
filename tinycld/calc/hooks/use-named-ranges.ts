import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { getFormulaBridge } from '../lib/formula/bridge'
import type { NamedRange, NamedRangeKey } from '../lib/named-ranges/types'
import {
    listNamedRanges,
    normalizeExpression,
    normalizeName,
    readNamedRange,
    removeNamedRangeByKey,
    renameNamedRange,
    validateName,
    writeNamedRange,
} from '../lib/named-ranges/y-binding'
import { NAMED_RANGES_MAP } from '../lib/y-doc-bootstrap'

export interface NamedRangeEntry {
    key: NamedRangeKey
    range: NamedRange
}

// ScopedNamedRanges is the per-sheet view of the workbook's named
// ranges: workbook-global entries plus the active sheet's locals,
// with a precomputed normalized-expression index for fast "does this
// selection match a defined name?" lookups. NameBox uses both fields;
// useGridSuggestions only needs `list`.
export interface ScopedNamedRanges {
    list: NamedRangeEntry[]
    // Keyed by normalizeExpression(entry.range.expression). When a
    // sheet-local and a global name share the same expression the
    // local shadows (matches HF's evaluation precedence), which is why
    // we walk `list` (sheet-locals first via `scope === sheetId` test)
    // and skip already-keyed entries.
    byNormalizedExpression: ReadonlyMap<string, NamedRangeEntry>
}

// useNamedRanges returns the live, sorted list of named ranges in the
// workbook. Re-renders when any entry is added, removed, renamed, or
// has its expression / scope / comment changed. Snapshot caching by
// key + field equality keeps unrelated cell edits from churning the
// list identity (which would re-render any consumer subscribed to it).
export function useNamedRanges(doc: Y.Doc | null): NamedRangeEntry[] {
    const subscribe = useCallback(
        (onChange: () => void) => {
            if (doc == null) return () => {}
            const map = doc.getMap<Y.Map<unknown>>(NAMED_RANGES_MAP)
            const handler = () => onChange()
            map.observeDeep(handler)
            return () => map.unobserveDeep(handler)
        },
        [doc]
    )

    const snapshotRef = useRef<NamedRangeEntry[]>([])
    const getSnapshot = useCallback((): NamedRangeEntry[] => {
        if (doc == null) return snapshotRef.current
        const next = listNamedRanges(doc)
        const prev = snapshotRef.current
        if (sameNamedRanges(prev, next)) return prev
        snapshotRef.current = next
        return next
    }, [doc])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// deriveScopedNamedRanges is the pure work behind useScopedNamedRanges.
// Extracted so tests can exercise the ordering + lookup-map logic
// without spinning up a renderer.
//
// Sheet-locals take precedence over globals when expressions collide:
// the map is populated locals-first so a later global doesn't overwrite
// a local entry.
export function deriveScopedNamedRanges(
    ranges: readonly NamedRangeEntry[],
    sheetId: string
): ScopedNamedRanges {
    const locals: NamedRangeEntry[] = []
    const globals: NamedRangeEntry[] = []
    for (const entry of ranges) {
        if (entry.range.scope === sheetId) locals.push(entry)
        else if (entry.range.scope == null) globals.push(entry)
    }
    const list = locals.concat(globals)
    const byNormalizedExpression = new Map<string, NamedRangeEntry>()
    for (const entry of list) {
        const key = normalizeExpression(entry.range.expression)
        if (!byNormalizedExpression.has(key)) {
            byNormalizedExpression.set(key, entry)
        }
    }
    return { list, byNormalizedExpression }
}

// useScopedNamedRanges narrows useNamedRanges to the entries in scope
// for the active sheet AND builds the normalized-expression lookup
// map used by NameBox's display-label match. Centralizes the scope
// filter so callers don't each re-derive it (and share the array
// identity, which matters for downstream memoization).
export function useScopedNamedRanges(
    ranges: NamedRangeEntry[],
    sheetId: string
): ScopedNamedRanges {
    return useMemo(() => deriveScopedNamedRanges(ranges, sheetId), [ranges, sheetId])
}

// useNamedRangePreview returns the live evaluated value of a named
// range, or undefined when the bridge hasn't started yet / the name is
// unknown to HF. Subscribes to FormulaBridge's valuesUpdated emitter so
// the preview re-reads whenever HF recomputes — covering both name
// edits and changes to the cells the name references.
export function useNamedRangePreview(
    doc: Y.Doc | null,
    name: string,
    scope: string | null
): unknown {
    // Cache the last snapshot per (name, scope) so getSnapshot returns
    // a stable value when nothing has changed (useSyncExternalStore
    // re-renders on referential inequality).
    const snapshotRef = useRef<{ name: string; scope: string | null; value: unknown }>({
        name: '',
        scope: null,
        value: undefined,
    })

    const subscribe = useCallback(
        (onChange: () => void) => {
            if (doc == null) return () => {}
            const bridge = getFormulaBridge(doc)
            if (bridge == null) return () => {}
            return bridge.subscribeToValuesUpdated(onChange)
        },
        [doc]
    )

    const getSnapshot = useCallback((): unknown => {
        if (doc == null) return undefined
        const bridge = getFormulaBridge(doc)
        if (bridge == null) return undefined
        const next = bridge.getNamedExpressionValue(name, scope)
        const prev = snapshotRef.current
        if (prev.name === name && prev.scope === scope && samePreviewValue(prev.value, next)) {
            return prev.value
        }
        snapshotRef.current = { name, scope, value: next }
        return next
    }, [doc, name, scope])

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// samePreviewValue treats two HF preview values as equal. For scalars
// it's Object.is; for HF's DetailedCellError shape it compares by the
// stable error-code string (`.value` like `#NAME?` / `#REF!`) — HF
// returns a fresh DetailedCellError instance per evaluation, so
// Object.is would always fail and force a re-render even when the
// underlying error is unchanged.
function samePreviewValue(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true
    if (isDetailedCellError(a) && isDetailedCellError(b)) {
        return a.value === b.value
    }
    return false
}

function isDetailedCellError(v: unknown): v is { value: string } {
    return typeof v === 'object' && v !== null && 'value' in v && typeof v.value === 'string'
}

export interface NamedRangeMutations {
    // Returns { ok: true, key } on success or { ok: false, reason } on
    // validation / duplicate / HF-rejection. The form layer mirrors the
    // reason into a field error.
    create(input: NamedRange): { ok: true; key: NamedRangeKey } | { ok: false; reason: string }
    update(
        existingKey: NamedRangeKey,
        input: NamedRange
    ): { ok: true; key: NamedRangeKey } | { ok: false; reason: string }
    remove(key: NamedRangeKey): void
}

// useNamedRangeMutations returns create / update / remove actions
// scoped to the supplied doc. Every write runs inside a LOCAL_ORIGIN
// transaction so the realtime undo manager captures it. The bridge
// observer on NAMED_RANGES_MAP picks the change up and forwards it
// into HF.
//
// Validation pipeline:
//   1. Name shape (validateName) — empty / illegal char / A1-shape.
//   2. Uniqueness within scope (case-insensitive).
//   3. HF acceptance (try/catch on the eventual bridge reconcile).
//      Step 3 is best-effort — the user sees the rejection only on
//      the next evaluation. Most expression problems are caught by
//      hf.validateFormula in the form layer before this runs.
export function useNamedRangeMutations(doc: Y.Doc | null): NamedRangeMutations {
    return useMemo<NamedRangeMutations>(() => {
        if (doc == null) {
            return {
                create: () => ({ ok: false, reason: 'No document' }),
                update: () => ({ ok: false, reason: 'No document' }),
                remove: () => {},
            }
        }
        return {
            create(input) {
                const result = validateName(input.name)
                if (!result.ok) return { ok: false, reason: result.reason }
                const dup = isDuplicateName(doc, input.name, input.scope, null)
                if (dup) {
                    return {
                        ok: false,
                        reason: `A name "${input.name.trim()}" already exists in this scope.`,
                    }
                }
                let key: NamedRangeKey = ''
                doc.transact(() => {
                    key = writeNamedRange(doc, input)
                }, LOCAL_ORIGIN)
                return { ok: true, key }
            },
            update(existingKey, input) {
                const result = validateName(input.name)
                if (!result.ok) return { ok: false, reason: result.reason }
                const dup = isDuplicateName(doc, input.name, input.scope, existingKey)
                if (dup) {
                    return {
                        ok: false,
                        reason: `A name "${input.name.trim()}" already exists in this scope.`,
                    }
                }
                let key: NamedRangeKey | null = existingKey
                doc.transact(() => {
                    const nextKey = renameNamedRange(doc, existingKey, input.name)
                    if (nextKey == null) {
                        key = null
                        return
                    }
                    // After renameNamedRange, the entry lives at nextKey.
                    // Update expression / scope / comment via writeNamedRange,
                    // which overwrites the Y.Map at the same key.
                    writeNamedRange(doc, input)
                    // If the rename moved the entry to a new key AND the
                    // input retained the old display name (shouldn't happen
                    // — caller passes the new name — but defensive), clean up.
                    if (nextKey !== existingKey && nextKey !== normalizeName(input.name)) {
                        removeNamedRangeByKey(doc, existingKey)
                    }
                    key = normalizeName(input.name)
                }, LOCAL_ORIGIN)
                if (key == null) {
                    return {
                        ok: false,
                        reason: `A name "${input.name.trim()}" already exists in this scope.`,
                    }
                }
                return { ok: true, key }
            },
            remove(key) {
                doc.transact(() => {
                    removeNamedRangeByKey(doc, key)
                }, LOCAL_ORIGIN)
            },
        }
    }, [doc])
}

// isDuplicateName returns true if a name (case-insensitive) is already
// taken within the same scope. Workbook-global and sheet-local scopes
// are independent — a local name and a global name can share the same
// identifier.
//
// Single normalize + single map lookup; no separate findExistingKey
// pass.
function isDuplicateName(
    doc: Y.Doc,
    name: string,
    scope: string | null,
    exceptKey: NamedRangeKey | null
): boolean {
    const key = normalizeName(name)
    if (key === exceptKey) return false
    const map = doc.getMap<Y.Map<unknown>>(NAMED_RANGES_MAP)
    const existing = readNamedRange(map.get(key))
    if (existing == null) return false
    return existing.scope === scope
}

function sameNamedRanges(a: NamedRangeEntry[], b: NamedRangeEntry[]): boolean {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
        const x = a[i]
        const y = b[i]
        if (x.key !== y.key) return false
        if (x.range.name !== y.range.name) return false
        if (x.range.expression !== y.range.expression) return false
        if (x.range.scope !== y.range.scope) return false
        if (x.range.comment !== y.range.comment) return false
    }
    return true
}
