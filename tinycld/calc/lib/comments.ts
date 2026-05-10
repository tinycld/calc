import type { CalcComments } from '../types'

// CommentRow is the subset of fields the UI cares about. Stays
// compatible with the pbtsdb row shape (CalcComments) so we can pass
// liveQuery results through without copying.
export type CommentRow = Pick<
    CalcComments,
    | 'id'
    | 'drive_item'
    | 'sheet_id'
    | 'row'
    | 'col'
    | 'parent_comment'
    | 'body'
    | 'resolved_at'
    | 'author'
    | 'author_name'
    | 'created'
>

// A Thread is a single root comment plus its replies in created order.
// resolvedAt mirrors the root's resolved_at — UI-side resolved/unresolved
// distinction is per-thread, not per-comment (Sheets parity).
export interface Thread {
    root: CommentRow
    replies: CommentRow[]
    resolvedAt: string | null
}

export function cellKey(sheetId: string, row: number, col: number): string {
    return `${sheetId}:${row}:${col}`
}

// groupCommentsByCell partitions a flat row list by (sheet_id, row, col).
// The Map key is "sheet:row:col" so callers can build O(1) lookups.
export function groupCommentsByCell(rows: CommentRow[]): Map<string, CommentRow[]> {
    const out = new Map<string, CommentRow[]>()
    for (const r of rows) {
        const key = cellKey(r.sheet_id, r.row, r.col)
        const bucket = out.get(key)
        if (bucket) {
            bucket.push(r)
        } else {
            out.set(key, [r])
        }
    }
    return out
}

// buildThreads collects the rows for one cell into per-thread groups.
// A row with empty parent_comment is a root; rows whose parent_comment
// matches a known root id are appended as replies in created order.
// Orphan replies (parent missing or unknown) are skipped — better to
// hide a stray reply than render it without context.
export function buildThreads(rowsForCell: CommentRow[]): Thread[] {
    const sorted = [...rowsForCell].sort(compareByCreated)
    const threads = new Map<string, Thread>()
    for (const r of sorted) {
        if (!r.parent_comment) {
            threads.set(r.id, {
                root: r,
                replies: [],
                resolvedAt: r.resolved_at ? r.resolved_at : null,
            })
        }
    }
    for (const r of sorted) {
        if (!r.parent_comment) continue
        const t = threads.get(r.parent_comment)
        if (!t) continue
        t.replies.push(r)
    }
    return Array.from(threads.values()).sort((a, b) => compareByCreated(a.root, b.root))
}

// cellHasUnresolvedThreads returns true iff at least one thread on the
// cell has resolved_at == null. The cell-indicator subscribes to this
// per-cell so a resolve hides the indicator on the next render.
export function cellHasUnresolvedThreads(rowsForCell: CommentRow[] | undefined): boolean {
    if (!rowsForCell || rowsForCell.length === 0) return false
    for (const r of rowsForCell) {
        if (r.parent_comment) continue
        if (!r.resolved_at) return true
    }
    return false
}

function compareByCreated(a: CommentRow, b: CommentRow): number {
    if (a.created < b.created) return -1
    if (a.created > b.created) return 1
    // Stable tiebreaker on id so equal-created rows order deterministically.
    if (a.id < b.id) return -1
    if (a.id > b.id) return 1
    return 0
}
