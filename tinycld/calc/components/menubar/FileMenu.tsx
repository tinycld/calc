import { useEditorMount } from '@tinycld/core/lib/editor/editor-mount'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Menu, MenuBarMenu } from '@tinycld/core/ui/menubar'
import { PromptDialog } from '@tinycld/core/ui/PromptDialog'
import { TemplatePickerDialog } from '@tinycld/drive/components/TemplatePickerDialog'
import { useHasTemplates } from '@tinycld/drive/hooks/use-template-items'
import { useCopyDriveItem } from '@tinycld/drive/lib/copy-drive-item'
import { exportItem } from '@tinycld/drive/lib/export-pdf'
import {
    fromTemplateName,
    isTemplateName,
    TEMPLATE_EXTENSIONS,
    toTemplateName,
} from '@tinycld/drive/lib/template-naming'
import { router } from 'expo-router'
import { lazy, Suspense, useState } from 'react'
import type { MenuBarProps } from './MenuBar'
import { SaveVersionDialog } from './SaveVersionDialog'

// Lazy: ShareDialogConnected → ShareDialog → use-contact-suggestions →
// use-packages → static-registry, which reads tinycldConfig at module init.
// Importing it eagerly from this file creates a cycle: tinycld.config.ts
// pulls @tinycld/calc/provider, the provider eagerly imports screens/[id]
// for share-route dispatch, [id] imports this menu, and the menu would then
// re-enter tinycld.config.ts before its exports are bound. Deferring with
// React.lazy breaks the chain — the import doesn't fire until the user
// actually opens the Share dialog.
const ShareDialogConnected = lazy(() => import('@tinycld/drive/components/ShareDialogConnected'))

export function FileMenu(props: MenuBarProps) {
    const orgHref = useOrgHref()
    const { capabilities } = useEditorMount()
    const copyTemplate = useCopyDriveItem()
    const hasTemplates = useHasTemplates(TEMPLATE_EXTENSIONS.xlsx)
    const [isSaveVersionOpen, setSaveVersionOpen] = useState(false)
    const [isCopyOpen, setCopyOpen] = useState(false)
    const [isRenameOpen, setRenameOpen] = useState(false)
    const [isTrashOpen, setTrashOpen] = useState(false)
    const [isShareOpen, setShareOpen] = useState(false)
    const [isTemplatePickerOpen, setTemplatePickerOpen] = useState(false)

    // "New from template" copies a `.tmpl.xlsx` file into a fresh workbook
    // and opens it — same flow as the index-screen picker.
    const handlePickTemplate = (item: { id: string; name: string }) => {
        copyTemplate.mutate(
            {
                sourceItemId: item.id,
                newName: fromTemplateName(item.name, TEMPLATE_EXTENSIONS.xlsx),
            },
            {
                onSuccess: result => {
                    setTemplatePickerOpen(false)
                    router.push(orgHref('calc/[id]', { id: result.itemId }))
                },
            }
        )
    }

    // "Export as template" reuses the folder-picker copy flow (which
    // force-flushes the live room first), saving the current workbook as a
    // `.tmpl.xlsx`. Hidden when it's already a template.
    const isAlreadyTemplate = isTemplateName(props.workbookName, TEMPLATE_EXTENSIONS.xlsx)
    const handleExportTemplate = () => {
        props.fileActions.exportAsTemplate(
            toTemplateName(props.workbookName, TEMPLATE_EXTENSIONS.xlsx)
        )
    }
    // The CSV import flow lives on the calc index screen (it owns the
    // file-picker and the staged-rows handoff via `setPendingImport`).
    // From the detail screen we just bounce back to the index — opening
    // the picker there matches Sheets' "Import" behavior.
    const openImport = () => router.push(orgHref('calc'))

    const handleCopy = (name: string) => {
        props.fileActions.makeCopy(name)
        setCopyOpen(false)
    }

    const handleRename = (name: string) => {
        props.fileActions.rename(name)
        setRenameOpen(false)
    }

    const handleTrash = () => {
        props.fileActions.moveToTrash()
        setTrashOpen(false)
    }

    // Exports the stored .xlsx blob to PDF on the server (omnidoc),
    // reflecting the last persisted state like the XLSX/CSV downloads.
    const downloadPdf = () => {
        exportItem(props.workbookId, props.workbookName, 'pdf')
    }

    return (
        <>
            <MenuBarMenu menuId="file" label="File">
                <Menu.Item label="New spreadsheet" onSelect={() => router.push(orgHref('calc'))} />
                <NewFromTemplateItem
                    isVisible={hasTemplates}
                    onSelect={() => setTemplatePickerOpen(true)}
                />
                <Menu.Item label="Open" onSelect={() => router.push(orgHref('drive'))} />
                <Menu.Item label="Import" onSelect={openImport} />
                <Menu.Item label="Make a copy" onSelect={() => setCopyOpen(true)} />
                <ExportTemplateItem
                    isVisible={!isAlreadyTemplate}
                    onSelect={handleExportTemplate}
                />
                <ShareItem
                    isVisible={capabilities.canUseFileActions}
                    onSelect={() => setShareOpen(true)}
                />
                <Menu.Item label="Save version" onSelect={() => setSaveVersionOpen(true)} />
                <Menu.Separator />
                <Menu.Sub label="Download">
                    <DownloadXlsxItem onSelect={props.onDownloadXlsx} />
                    <Menu.Item
                        label="Download as CSV (current sheet)"
                        onSelect={props.onDownloadCsvCurrent}
                    />
                    <Menu.Item
                        label="Download as CSV (all sheets)"
                        onSelect={props.onDownloadCsvAll}
                    />
                    <Menu.Item label="Download as PDF" onSelect={downloadPdf} />
                </Menu.Sub>
                <Menu.Separator />
                <Menu.Item label="Rename" onSelect={() => setRenameOpen(true)} />
                <Menu.Item label="Move to trash" onSelect={() => setTrashOpen(true)} />
                <Menu.Item label="Details" onSelect={props.fileActions.openDriveDetails} />
                <Menu.Separator />
                <Menu.Item label="Print" shortcut="⌘P" onSelect={props.onOpenPrint} />
            </MenuBarMenu>
            <TemplatePickerDialog
                open={isTemplatePickerOpen}
                extension={TEMPLATE_EXTENSIONS.xlsx}
                onClose={() => setTemplatePickerOpen(false)}
                onPick={handlePickTemplate}
                isPending={copyTemplate.isPending}
            />
            <SaveVersionDialog
                isOpen={isSaveVersionOpen}
                onClose={() => setSaveVersionOpen(false)}
                workbookId={props.workbookId}
            />
            <PromptDialog
                isOpen={isCopyOpen}
                onClose={() => setCopyOpen(false)}
                onSubmit={handleCopy}
                title="Make a copy"
                placeholder="Copy name"
                defaultValue={`${props.workbookName} (copy)`}
                confirmLabel="Create copy"
                required
            />
            <PromptDialog
                isOpen={isRenameOpen}
                onClose={() => setRenameOpen(false)}
                onSubmit={handleRename}
                title="Rename"
                defaultValue={props.workbookName}
                confirmLabel="Rename"
                required
            />
            <ConfirmDialog
                isOpen={isTrashOpen}
                onClose={() => setTrashOpen(false)}
                onConfirm={handleTrash}
                title="Move to trash"
                message="This spreadsheet will be moved to the trash. You can restore it from Drive within the retention window."
                confirmLabel="Move to trash"
                isDestructive
            />
            {capabilities.canUseFileActions && isShareOpen && (
                <Suspense fallback={null}>
                    <ShareDialogConnected
                        open={isShareOpen}
                        itemId={props.workbookId}
                        itemName={props.workbookName}
                        onClose={() => setShareOpen(false)}
                    />
                </Suspense>
            )}
        </>
    )
}

interface OptionalItemProps {
    isVisible: boolean
    onSelect: () => void
}

function NewFromTemplateItem({ isVisible, onSelect }: OptionalItemProps) {
    if (!isVisible) return null
    return <Menu.Item label="New from template…" onSelect={onSelect} />
}

function ExportTemplateItem({ isVisible, onSelect }: OptionalItemProps) {
    if (!isVisible) return null
    return <Menu.Item label="Export as template…" onSelect={onSelect} />
}

function ShareItem({ isVisible, onSelect }: OptionalItemProps) {
    if (!isVisible) return null
    return <Menu.Item label="Share" onSelect={onSelect} />
}

function DownloadXlsxItem({ onSelect }: { onSelect: (() => void) | undefined }) {
    if (onSelect == null) return null
    return <Menu.Item label="Download as XLSX" onSelect={onSelect} />
}
