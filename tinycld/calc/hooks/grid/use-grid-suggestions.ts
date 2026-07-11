import { useCallback, useMemo, useRef } from 'react'
import type * as Y from 'yjs'
import type { FormulaSpecialKey } from '../../components/FormulaBar'
import { HEADER_HEIGHT, ROW_HEADER_WIDTH } from '../../components/grid/constants'
import {
    filterSuggestions,
    parseFunctionToken,
    type SuggestionItem,
} from '../../lib/formula/autocomplete'
import { useSheetMerges } from '../use-cell-merge'
import { useFormulaFunctionNames } from '../use-formula-function-names'
import { useGridStore, useGridStoreApi } from '../use-grid-store'
import { useNamedRanges, useScopedNamedRanges } from '../use-named-ranges'

export interface SuggestionAnchor {
    left: number
    top: number
    width?: number
}

export interface GridSuggestions {
    items: SuggestionItem[]
    selectedIndex: number
    anchor: SuggestionAnchor | null
    onSelect: (item: SuggestionItem) => void
    onHover: (index: number) => void
    // onSpecialKey is consumed by the FormulaBar AND the in-cell
    // editor (forwarded down through Body → Cell). It must be a
    // stable identity so memo'd cells don't re-render on every
    // keystroke — see the suggestionItemsRef below.
    onSpecialKey: (key: FormulaSpecialKey) => boolean
}

interface UseGridSuggestionsArgs {
    doc: Y.Doc | null
    sheetId: string
    colOffsets: Float64Array
    rowOffsets: Float64Array
    scrollX: number
    scrollY: number
}

// useGridSuggestions owns the autocomplete-popover machinery: items
// derivation, popover-open computation, anchor calculation, key
// router, and the suggestion-index reset effect.
//
// Items are NOT in the Zustand store because they're derived from
// `functionNames` (a heavyweight upstream that the store factory
// shouldn't know about). Index, dismissedDraft, and active surface
// ARE in the store — different callers (FormulaBar focus, Esc on the
// in-cell editor, hover on a list item) all converge on the same
// state, which is what stores are for.
export function useGridSuggestions({
    doc,
    sheetId,
    colOffsets,
    rowOffsets,
    scrollX,
    scrollY,
}: UseGridSuggestionsArgs): GridSuggestions {
    const merges = useSheetMerges(doc, sheetId)
    const store = useGridStoreApi()
    const editSession = useGridStore(s => s.editSession)
    const dismissedDraft = useGridStore(s => s.dismissedDraft)
    const selectedIndex = useGridStore(s => s.suggestionIndex)
    const activeSurface = useGridStore(s => s.activeSurface)
    const formulaBarRect = useGridStore(s => s.formulaBarRect)
    const bodyTop = useGridStore(s => s.bodyTop)

    const functionNames = useFormulaFunctionNames()
    const namedRanges = useNamedRanges(doc)
    const scopedNames = useScopedNamedRanges(namedRanges, sheetId)

    // Named-range names in scope for the active sheet (globals +
    // this-sheet locals). Suggestions filter the merged list and
    // sort names ahead of functions in filterSuggestions.
    const namedRangeNames = useMemo<string[]>(
        () => scopedNames.list.map(r => r.range.name),
        [scopedNames]
    )

    const items = useMemo<SuggestionItem[]>(() => {
        if (editSession == null) return []
        if (functionNames.length === 0 && namedRangeNames.length === 0) return []
        const t = parseFunctionToken(editSession.draft, store.refs.editCursor.current.end)
        if (t == null) return []
        return filterSuggestions(functionNames, namedRangeNames, t.token)
    }, [editSession, functionNames, namedRangeNames, store])

    // Reset suggestionIndex whenever the items list identity changes —
    // the user is now looking at a different list and starting from 0 is
    // the expected UX. Done during render (React's sanctioned "adjust
    // state when an input changes" pattern) rather than an effect: the
    // index lives in the shared store, and a ref tracks the previous
    // items identity so the reset fires exactly on change, not on every
    // render.
    const prevItemsRef = useRef(items)
    if (prevItemsRef.current !== items) {
        prevItemsRef.current = items
        store.getState().setSuggestionIndex(0)
    }

    // Mirror the latest items into a ref so onSpecialKey can be a
    // stable identity. Without this, items would be a dep of
    // onSpecialKey, onSpecialKey identity would change every
    // keystroke (because items recompute when editSession.draft
    // changes), and every memo'd <Cell> would receive a new prop
    // through Body and re-render — defeating the per-keystroke perf
    // contract.
    const itemsRef = useRef(items)
    itemsRef.current = items

    const onSpecialKey = useCallback(
        (key: FormulaSpecialKey): boolean => {
            const state = store.getState()
            if (state.editSession == null) return false
            const list = itemsRef.current
            // Recompute popoverOpen from live state so a stale React
            // closure can't claim a key the popover no longer wants.
            const isOpen = list.length > 0 && state.dismissedDraft !== state.editSession.draft
            if (!isOpen) return false
            if (key === 'ArrowDown') {
                state.moveSuggestion(1, list.length)
                return true
            }
            if (key === 'ArrowUp') {
                state.moveSuggestion(-1, list.length)
                return true
            }
            if (key === 'Tab' || key === 'Enter') {
                const item = list[state.suggestionIndex]
                if (item == null) return false
                if (item.kind === 'name') state.insertName(item.name)
                else state.insertFunction(item.name)
                return true
            }
            if (key === 'Escape') {
                state.dismissSuggestions()
                return true
            }
            return false
        },
        [store]
    )

    const onSelect = useCallback(
        (item: SuggestionItem) => {
            const state = store.getState()
            if (item.kind === 'name') state.insertName(item.name)
            else state.insertFunction(item.name)
        },
        [store]
    )

    const onHover = useCallback(
        (index: number) => store.getState().setSuggestionIndex(index),
        [store]
    )

    const popoverOpen =
        editSession != null && items.length > 0 && dismissedDraft !== editSession.draft

    const anchor = useMemo<SuggestionAnchor | null>(() => {
        if (!popoverOpen || editSession == null) return null
        // The Grid stacks (top to bottom): menubar, toolbar, optional
        // status banners, formula bar, column header, body. Their
        // individual heights have changed multiple times and the
        // banners are conditional, so summing layout constants drifts
        // out of date silently. `bodyTop` is the body row container's
        // measured y inside the Grid root — equal to the bottom of the
        // column header, i.e. (formula-bar bottom) + HEADER_HEIGHT —
        // so all popover anchors can be expressed against it.
        if (bodyTop == null) return null
        if (activeSurface === 'bar') {
            if (formulaBarRect == null) return null
            return {
                left: ROW_HEADER_WIDTH + formulaBarRect.left,
                top: bodyTop - HEADER_HEIGHT,
                width: Math.min(220, Math.max(140, formulaBarRect.width)),
            }
        }
        const colLeft = colOffsets[editSession.col - 1] ?? 0
        // If the editing cell is the anchor of a vertical merge, the
        // popover must drop below the merge's full footprint — using
        // the anchor row's own bottom would put the popover inside the
        // merged span and cover the text the user just typed. Covered
        // (non-anchor) cells never enter edit mode, so only the anchor
        // case needs handling here.
        const mergeForCell = merges.find(
            m => m.anchorRow === editSession.row && m.anchorCol === editSession.col
        )
        const bottomRow =
            mergeForCell != null
                ? mergeForCell.anchorRow + mergeForCell.rowSpan - 1
                : editSession.row
        const rowBottom = rowOffsets[bottomRow] ?? 0
        return {
            left: ROW_HEADER_WIDTH + colLeft - scrollX,
            top: bodyTop + rowBottom - scrollY,
            width: 220,
        }
    }, [
        popoverOpen,
        editSession,
        activeSurface,
        formulaBarRect,
        bodyTop,
        merges,
        colOffsets,
        rowOffsets,
        scrollX,
        scrollY,
    ])

    return {
        items,
        selectedIndex,
        anchor,
        onSelect,
        onHover,
        onSpecialKey,
    }
}
