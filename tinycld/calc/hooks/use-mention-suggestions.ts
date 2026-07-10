import { eq } from '@tanstack/db'
import { useEditorMount } from '@tinycld/core/lib/editor/editor-mount'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import type { MentionSuggestion } from '@tinycld/core/ui/comments'
import { useMemo } from 'react'

// Builds the @-mention candidate pool for a workbook. Subscribes to
// every user_org row in the current org and joins the user record
// for display name + email (the secondary line in the suggestion
// popover). Returns suggestions sorted by display name so the popover
// order is stable across renders.
//
// Replicated from text's identical hook: the logic is fully generic,
// but it hasn't been promoted into core yet and siblings must not
// import from each other, so calc carries its own copy.
//
// The current user is excluded — mentioning yourself is noise and the
// notify hook would drop it anyway, but leaving the entry in the
// popover invites accidental self-mentions.
//
// `disabled` short-circuits the org-roster query without running it.
// Intended for read-only viewer mounts where mention pickers are
// unreachable (calc's member mount always allows mentions today).
export function useMentionSuggestions(
    currentUserOrgId: string,
    options?: { disabled?: boolean }
): MentionSuggestion[] {
    const disabled = options?.disabled === true
    const { capabilities } = useEditorMount()
    const [userOrgCollection, usersCollection] = useStore('user_org', 'users')

    const { data: members = [] } = useOrgLiveQuery(
        (query, { orgId }) => {
            // Guests must not enumerate the org roster — skip the query
            // entirely (returning null runs no query) when mentions are
            // off. Same short-circuit applies for `disabled` (read-only
            // viewer mount).
            if (disabled || !capabilities.canMention) return null
            return query
                .from({ uo: userOrgCollection })
                .join({ u: usersCollection }, ({ uo, u }) => eq(uo.user, u.id))
                .where(({ uo }) => eq(uo.org, orgId))
                .select(({ uo, u }) => ({
                    userOrgId: uo.id,
                    displayName: u.name,
                    email: u.email,
                }))
        },
        [capabilities.canMention, disabled]
    )

    return useMemo(() => {
        const out: MentionSuggestion[] = []
        for (const m of members as Array<{
            userOrgId: string
            displayName: string | null
            email: string | null
        }>) {
            if (m.userOrgId === currentUserOrgId) continue
            const displayName = m.displayName || m.email || 'Unknown'
            out.push({
                userOrgId: m.userOrgId,
                displayName,
                secondary: m.email || undefined,
            })
        }
        out.sort((a, b) => a.displayName.localeCompare(b.displayName))
        return out
    }, [members, currentUserOrgId])
}
