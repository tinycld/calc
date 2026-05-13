import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { router } from 'expo-router'
import { useCallback } from 'react'

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
// `rename` writes through pbtsdb directly. `moveToTrash` and `makeCopy`
// are placeholders that log a warning — the File-menu task in the
// menubar plan will land their real implementations alongside the UI
// that invokes them.
export function useWorkbookFileActions(workbookId: string): WorkbookFileActions {
    const [driveItemsCollection] = useStore('drive_items')
    const orgHref = useOrgHref()

    const renameMutation = useMutation({
        mutationFn: mutation(function* (newName: string) {
            yield driveItemsCollection.update(workbookId, (draft) => {
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
            console.warn('useWorkbookFileActions.makeCopy is not implemented yet', {
                workbookId,
                copyName,
            })
        },
        [workbookId]
    )

    const moveToTrash = useCallback(() => {
        console.warn('useWorkbookFileActions.moveToTrash is not implemented yet', {
            workbookId,
        })
    }, [workbookId])

    const openDriveDetails = useCallback(() => {
        router.push(orgHref('drive', { item: workbookId }))
    }, [orgHref, workbookId])

    return { rename, makeCopy, moveToTrash, openDriveDetails }
}
