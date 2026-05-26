import type { EditorMount } from '@tinycld/core/lib/editor/editor-mount'
import {
    type RealtimeRoomHandle,
    useRealtimeRoom,
} from '@tinycld/core/lib/realtime/use-realtime-room'

export { colorForUser } from '@tinycld/core/lib/util/color'

export interface CalcServerHello {
    readOnly: boolean
}

// calcReadOnly narrows the room's opaque serverHello to calc's shape.
// Defaults to NOT read-only until the frame arrives (the editor starts
// editable and locks down only if the server says read-only) — matches
// text's typedServerHello posture.
export function calcReadOnly(room: RealtimeRoomHandle | null): boolean {
    if (room == null || room.serverHello == null) return false
    const hello = room.serverHello as Partial<CalcServerHello>
    return hello.readOnly === true
}

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
