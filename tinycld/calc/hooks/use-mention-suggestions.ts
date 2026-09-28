import { useAuth } from '@tinycld/core/lib/auth'
import { useEditorMountOptional } from '@tinycld/core/lib/editor/editor-mount'
import { useMentionCandidates } from '@tinycld/core/lib/use-mention-candidates'
import type { MentionSuggestion } from '@tinycld/core/ui/comments'

// The @-mention picker's candidate hook for a workbook, delegating to
// core's shared, bounded mention search (`useMentionCandidates`) — see
// that hook's doc comment for why the predicate is a search (role +
// disabled + typed prefix, capped and ordered server-side) rather than
// a full-roster read.
//
// Replicated from text's identical hook: the logic is fully generic,
// but it hasn't been promoted into core yet and siblings must not
// import from each other, so calc carries its own copy.
//
// `query` is the text the user has typed after `@`, handed down by
// CommentComposer, which gets it from MentionInput's `onQueryChange`.
// An empty query runs no request at all: an @-mention popover that
// enumerates the roster the instant someone types `@` is exactly what
// the bounded search exists to prevent.
//
// The signature is `(query) => MentionSuggestion[]` and nothing else,
// because this is passed to CommentComposer AS a hook — see that
// component's `useMentionSuggestions` prop. Everything else it needs
// (the current user to exclude, whether mentions are allowed at all)
// is read from context here, so no caller has to bind arguments and
// the prop can stay a stable module-level function reference.
//
// The identity comes from `useAuth`, not the editor mount. The
// composer is rendered by surfaces that do not all sit under the
// editor screen's EditorMountProvider, and a required
// `useEditorMount()` throws there — which took the whole screen down
// behind the error boundary the moment the drawer opened. Auth sits
// above every one of those surfaces, so the user id is always in
// scope. The mount is consulted only for the editor-scoped
// capability, and optionally: a viewer mount reports
// `canMention: false` and disables the search, because a read-only
// viewer must not enumerate the roster. With no mount in scope there
// is no editor-scoped restriction to apply, so the app-level auth
// gate is the only one that governs — the same rule every other
// authed comments surface runs under.
export function useMentionSuggestions(query: string): MentionSuggestion[] {
    const mount = useEditorMountOptional()
    const { user } = useAuth()

    return useMentionCandidates(query, {
        disabled: mount != null && !mount.capabilities.canMention,
        currentUserId: mount?.identity.userId ?? user.id,
    })
}
