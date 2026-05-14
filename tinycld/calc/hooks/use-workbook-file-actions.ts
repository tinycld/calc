import { and, eq } from '@tanstack/db'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCurrentUserOrg } from '@tinycld/core/lib/use-current-user-org'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useOrgSlug } from '@tinycld/core/lib/use-org-slug'
import { router } from 'expo-router'
import { newRecordId } from 'pbtsdb/core'
import { useCallback } from 'react'
import { useMenuDialogsStore } from './use-menu-dialogs-store'

export interface WorkbookFileActions {
    rename: (newName: string) => void
    makeCopy: (copyName: string) => void
    moveToTrash: () => void
    openDriveDetails: () => void
}

// Self-contained wrappers around the drive_items collection. We
// intentionally don't go through @tinycld/drive/hooks/useDriveMutations
// because that hook needs a heavy bundle of context (orgId, userOrgId,
// itemsById, stateByItem, …) only populated inside the drive UI; calc's
// standalone workbook screen has none of it.
//
// `rename` writes through pbtsdb directly. `moveToTrash` mirrors
// drive's `trashMutation` flow — writes a `trashed_at` timestamp onto a
// `drive_item_state` row keyed by (item, user_org), upserting if
// needed, then navigates the user back to the calc index so they
// aren't left looking at the trashed workbook.
//
// `makeCopy` doesn't immediately mutate — it stashes the desired
// copy name plus the source workbook's current parent in the menu
// dialogs store, which the CopyToFolderDialog reads to open the
// folder picker pre-selected at the source's folder. The picker
// fires the real useCopyDriveItem mutation when the user confirms.
// This indirection exists so the user can choose a destination
// before the workbook is duplicated, matching Sheets' behavior.
export function useWorkbookFileActions(workbookId: string): WorkbookFileActions {
    const [driveItemsCollection, driveItemStateCollection] = useStore(
        'drive_items',
        'drive_item_state'
    )
    const orgSlug = useOrgSlug()
    const userOrg = useCurrentUserOrg(orgSlug)
    const userOrgId = userOrg?.id ?? ''
    const orgHref = useOrgHref()
    const openCopyDialog = useMenuDialogsStore(s => s.openCopyDialog)

    const { data: existingStateRows = [] } = useOrgLiveQuery(
        (query, scope) =>
            query
                .from({ state: driveItemStateCollection })
                .where(({ state }) =>
                    and(eq(state.item, workbookId), eq(state.user_org, scope.userOrgId))
                ),
        [workbookId]
    )
    const existingState = existingStateRows[0]

    const { data: workbookRows = [] } = useOrgLiveQuery(
        (query, scope) =>
            query
                .from({ item: driveItemsCollection })
                .where(({ item }) => and(eq(item.org, scope.orgId), eq(item.id, workbookId)))
                .select(({ item }) => ({ parent: item.parent })),
        [workbookId]
    )
    const sourceParentId = workbookRows[0]?.parent ?? ''

    const renameMutation = useMutation({
        mutationFn: mutation(function* (newName: string) {
            yield driveItemsCollection.update(workbookId, draft => {
                draft.name = newName
            })
        }),
    })

    const rename = useCallback(
        (newName: string) => renameMutation.mutate(newName),
        [renameMutation]
    )

    const makeCopy = useCallback(
        (copyName: string) => {
            openCopyDialog({ copyName, sourceParentId })
        },
        [openCopyDialog, sourceParentId]
    )

    const trashMutation = useMutation({
        mutationFn: mutation(function* () {
            const trashedAt = new Date().toISOString()
            if (existingState) {
                yield driveItemStateCollection.update(existingState.id, (draft) => {
                    draft.trashed_at = trashedAt
                })
            } else {
                yield driveItemStateCollection.insert({
                    id: newRecordId(),
                    item: workbookId,
                    user_org: userOrgId,
                    is_starred: false,
                    trashed_at: trashedAt,
                    last_viewed_at: '',
                })
            }
        }),
        onSuccess: () => {
            router.replace(orgHref('calc'))
        },
    })

    const moveToTrash = useCallback(() => trashMutation.mutate(), [trashMutation])

    const openDriveDetails = useCallback(() => {
        router.push(orgHref('drive', { item: workbookId }))
    }, [orgHref, workbookId])

    return { rename, makeCopy, moveToTrash, openDriveDetails }
}
