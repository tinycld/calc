import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { ChooseFolderDialog } from '@tinycld/drive/components/ChooseFolderDialog'
import { useCopyDriveItem } from '@tinycld/drive/lib/copy-drive-item'
import { router } from 'expo-router'
import { useMenuDialogsStore } from '../../hooks/use-menu-dialogs-store'

interface CopyToFolderDialogProps {
    /**
     * Source workbook id. The dialog only inspects the menubar store
     * (open/close + the desired copy name + the source's current
     * parent), so the workbook id is passed in separately by the
     * detail screen rather than re-resolved from the store.
     */
    workbookId: string
}

// CopyToFolderDialog presents drive's "Choose a folder" picker pre-
// selected at the source workbook's current parent, and on confirm
// runs the useCopyDriveItem mutation. On success the user is
// navigated to the new copy.
//
// The dialog is opened by useWorkbookFileActions.makeCopy (which
// pushes `{ copyName, sourceParentId }` into useMenuDialogsStore).
// Mounted from screens/[id].tsx alongside the other calc dialogs.
export function CopyToFolderDialog({ workbookId }: CopyToFolderDialogProps) {
    const pending = useMenuDialogsStore(s => s.pendingCopy)
    const close = useMenuDialogsStore(s => s.closeCopyDialog)
    const copyDriveItem = useCopyDriveItem()
    const orgHref = useOrgHref()

    if (pending == null) return null

    const handleMove = (targetFolderId: string) => {
        copyDriveItem.mutate(
            {
                sourceItemId: workbookId,
                newName: pending.copyName,
                parentId: targetFolderId,
            },
            {
                onSuccess: result => {
                    router.replace(orgHref('calc/[id]', { id: result.itemId }))
                },
            }
        )
    }

    return (
        <ChooseFolderDialog
            open
            itemName={pending.copyName}
            excludeId=""
            initialSelectedId={pending.sourceParentId}
            onMove={handleMove}
            onClose={close}
            title={`Copy “${pending.copyName}” to`}
            confirmLabel="Copy here"
        />
    )
}
