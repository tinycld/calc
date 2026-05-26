import type { EditorMount } from '@tinycld/core/lib/editor/editor-mount'
import {
    type RealtimeRoomHandle,
    useRealtimeRoom,
} from '@tinycld/core/lib/realtime/use-realtime-room'

export interface UseRealtimeOptions {
    // The drive_item.id used as the room identifier.
    workbookId: string
    // Identity and credential come from the caller (the screen) which has
    // access to the auth context before EditorMountProvider is established.
    identity: EditorMount['identity']
    realtimeCredential: EditorMount['realtimeCredential']
}

// useRealtime is the calc-specific wrapper around core's
// useRealtimeRoom. It supplies the "calc" roomKind and stamps the
// local awareness slot with calc-shaped initial state.
//
// The server (calc/server/bootstrap_hook.go) populates the room's Y.Doc
// from the source .xlsx before the first SyncReply goes out, so the
// client never needs to fetch or parse xlsx bytes.
export function useRealtime({
    workbookId,
    identity,
    realtimeCredential,
}: UseRealtimeOptions): RealtimeRoomHandle | null {
    return useRealtimeRoom({
        roomKind: 'calc',
        roomID: workbookId,
        initialAwareness: {
            // Anon visitors fall back to displayName for the awareness id; two
            // guests with the same name share a cursor color, which is fine.
            user: {
                id: identity.userId ?? identity.displayName,
                name: identity.displayName,
                color: identity.color,
            },
            sheetId: null,
            selection: null,
            editing: null,
        },
        shareSession:
            realtimeCredential.kind === 'shareSession' ? realtimeCredential.token : undefined,
    })
}

// colorForUser produces a deterministic HSL color string from a user id.
// Same user → same color across sessions and across other users' views.
export function colorForUser(id: string): string {
    let h = 0
    for (let i = 0; i < id.length; i++) {
        h = (h * 31 + id.charCodeAt(i)) >>> 0
    }
    const hue = h % 360
    return `hsl(${hue}, 70%, 45%)`
}
