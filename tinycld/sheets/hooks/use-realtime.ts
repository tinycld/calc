import type { FilePreviewSource } from '@tinycld/core/file-viewer/types'
import { buildAuthedFileURL, getFileToken } from '@tinycld/core/file-viewer/use-authed-file-url'
import { useAuth } from '@tinycld/core/lib/auth'
import { captureException } from '@tinycld/core/lib/errors'
import { type RealtimeRoomHandle, useRealtimeRoom } from '@tinycld/core/lib/realtime/use-realtime-room'
import { useCallback, useRef } from 'react'
import type * as Y from 'yjs'
import { parseWorkbook } from '../lib/xlsx-adapter'
import { bootstrapYDocFromWorkbook, ydocIsEmpty } from '../lib/y-doc-bootstrap'

export interface UseRealtimeOptions {
    // The drive_item.id used as the room identifier.
    workbookId: string

    // The file source for the spreadsheet's .xlsx blob. Used only on
    // first-joiner bootstrap — the bootstrap closure resolves a fresh
    // file token + signed URL imperatively at the moment the empty
    // sync reply arrives, eliminating the prior race where the
    // bootstrap closure could fire before useAuthedFileURL had
    // populated. After bootstrap, the source is unused.
    source: FilePreviewSource | null
}

// useRealtime is the sheets-specific wrapper around core's
// useRealtimeRoom. It supplies the "sheets" roomKind, stamps the
// local awareness slot with sheets-shaped initial state, and wires
// the .xlsx bootstrap path for first joiners.
export function useRealtime({ workbookId, source }: UseRealtimeOptions): RealtimeRoomHandle | null {
    const { user } = useAuth()

    // Capture the latest source via a ref so the bootstrap closure
    // (registered once on first effect mount) sees fresh values
    // without forcing a tear-down/re-open of the WS every render.
    const sourceRef = useRef(source)
    sourceRef.current = source

    const onFirstJoinerBootstrap = useCallback(
        async (doc: Y.Doc) => {
            if (!ydocIsEmpty(doc)) return
            const src = sourceRef.current
            if (src == null) {
                throw new Error('useRealtime bootstrap: source not yet resolved')
            }
            const token = await getFileToken()
            const url = buildAuthedFileURL(src, token)
            if (!url) {
                throw new Error('useRealtime bootstrap: could not build xlsx URL')
            }
            const resp = await fetch(url)
            if (!resp.ok) {
                throw new Error(`xlsx fetch failed: ${resp.status}`)
            }
            const buffer = await resp.arrayBuffer()
            const model = await parseWorkbook(buffer)
            if (!ydocIsEmpty(doc)) return // a peer populated it while we awaited
            try {
                bootstrapYDocFromWorkbook(doc, model)
            } catch (err) {
                captureException('useRealtime: bootstrap write failed', err, { workbookId })
                throw err
            }
        },
        [workbookId]
    )

    return useRealtimeRoom({
        roomKind: 'sheets',
        roomID: workbookId,
        initialAwareness: {
            user: { id: user.id, name: user.name, color: colorForUser(user.id) },
            sheetId: null,
            selection: null,
            editing: null,
        },
        onFirstJoinerBootstrap,
    })
}

// colorForUser produces a deterministic HSL color string from a user id.
// Same user → same color across sessions and across other users' views.
function colorForUser(id: string): string {
    let h = 0
    for (let i = 0; i < id.length; i++) {
        h = (h * 31 + id.charCodeAt(i)) >>> 0
    }
    const hue = h % 360
    return `hsl(${hue}, 70%, 45%)`
}
