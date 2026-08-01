import { useEditorMount } from '@tinycld/core/lib/editor/editor-mount'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import type { MentionSuggestion } from '@tinycld/core/ui/comments'
import { useMemo } from 'react'

// Builds the @-mention candidate pool for a workbook. Subscribes to
// every user record and projects display name + email (the secondary
// line in the suggestion popover). Returns suggestions sorted by
// display name so the popover order is stable across renders.
//
// Replicated from text's identical hook: the logic is fully generic,
// but it hasn't been promoted into core yet and siblings must not
// import from each other, so calc carries its own copy.
//
// The current user is excluded — mentioning yourself is noise and the
// notify hook would drop it anyway, but leaving the entry in the
// popover invites accidental self-mentions.
//
// `disabled` short-circuits the roster query without running it.
// Intended for read-only viewer mounts where mention pickers are
// unreachable (calc's member mount always allows mentions today).
export function useMentionSuggestions(
    currentUserId: string,
    options?: { disabled?: boolean }
): MentionSuggestion[] {
    const disabled = options?.disabled === true
    const { capabilities } = useEditorMount()
    const [usersCollection] = useStore('users')

    const { data: members = [] } = useOrgLiveQuery(
        query => {
            // Guests must not enumerate the roster — skip the query
            // entirely (returning null runs no query) when mentions are
            // off. Same short-circuit applies for `disabled` (read-only
            // viewer mount).
            if (disabled || !capabilities.canMention) return null
            return query.from({ u: usersCollection }).select(({ u }) => ({
                userId: u.id,
                displayName: u.name,
                email: u.email,
            }))
        },
        [capabilities.canMention, disabled]
    )

    return useMemo(() => {
        const out: MentionSuggestion[] = []
        for (const m of members as Array<{
            userId: string
            displayName: string | null
            email: string | null
        }>) {
            if (m.userId === currentUserId) continue
            const displayName = m.displayName || m.email || 'Unknown'
            out.push({
                userId: m.userId,
                displayName,
                secondary: m.email || undefined,
            })
        }
        out.sort((a, b) => a.displayName.localeCompare(b.displayName))
        return out
    }, [members, currentUserId])
}
