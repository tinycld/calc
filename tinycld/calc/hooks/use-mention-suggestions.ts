import { useEditorMount } from '@tinycld/core/lib/editor/editor-mount'
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
// comes from useEditorMount, so no caller has to bind arguments and
// the prop can stay a stable module-level function reference.
//
// A viewer mount reports `canMention: false`, which disables the
// search; guests must not enumerate the roster at all.
export function useMentionSuggestions(query: string): MentionSuggestion[] {
    const { identity, capabilities } = useEditorMount()

    return useMentionCandidates(query, {
        disabled: !capabilities.canMention,
        currentUserId: identity.userId,
    })
}
