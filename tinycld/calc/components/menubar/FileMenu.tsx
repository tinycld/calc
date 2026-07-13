import { useEditorMount } from '@tinycld/core/lib/editor/editor-mount'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Menu, MenuBarMenu, MenuShortcut, Separator } from '@tinycld/core/ui/menubar'
import { PromptDialog } from '@tinycld/core/ui/PromptDialog'
import { TemplatePickerDialog } from '@tinycld/drive/components/TemplatePickerDialog'
import { useHasTemplates } from '@tinycld/drive/hooks/use-template-items'
import { useCopyDriveItem } from '@tinycld/drive/lib/copy-drive-item'
import { CSV_TARGET, exportItemToFormat, exportTargetsFor } from '@tinycld/drive/lib/export-pdf'
import {
    fromTemplateName,
    isTemplateName,
    TEMPLATE_EXTENSIONS,
    toTemplateName,
} from '@tinycld/drive/lib/template-naming'
import { router } from 'expo-router'
import { lazy, Suspense, useState } from 'react'
import { XLSX_MIME_TYPE } from '../../types'
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

    // Server-side "Download as" targets for a workbook (PDF, HTML) — the stored
    // .xlsx converted by doctaculous. Reflects the last persisted state. CSV is
    // handled separately below so it can offer the current-sheet / all-sheets
    // split via the export route's optional `sheet` param.
    const exportTargets = exportTargetsFor(XLSX_MIME_TYPE).filter(t => t.to !== 'csv')

    const downloadCsvCurrentSheet = () => {
        exportItemToFormat(props.workbookId, props.workbookName, CSV_TARGET, {
            sheet: props.sheetName,
        })
    }
    const downloadCsvAllSheets = () => {
        exportItemToFormat(props.workbookId, props.workbookName, CSV_TARGET)
    }

    return (
        <>
            <MenuBarMenu menuId="file" label="File">
                <Menu.Item onPress={() => router.push(orgHref('calc'))}>
                    <Menu.ItemTitle>New spreadsheet</Menu.ItemTitle>
                </Menu.Item>
                {hasTemplates && (
                    <Menu.Item onPress={() => setTemplatePickerOpen(true)}>
                        <Menu.ItemTitle>New from template…</Menu.ItemTitle>
                    </Menu.Item>
                )}
                <Menu.Item onPress={() => router.push(orgHref('drive'))}>
                    <Menu.ItemTitle>Open</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={openImport}>
                    <Menu.ItemTitle>Import</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={() => setCopyOpen(true)}>
                    <Menu.ItemTitle>Make a copy</Menu.ItemTitle>
                </Menu.Item>
                {!isAlreadyTemplate && (
                    <Menu.Item onPress={handleExportTemplate}>
                        <Menu.ItemTitle>Export as template…</Menu.ItemTitle>
                    </Menu.Item>
                )}
                {capabilities.canUseFileActions && (
                    <Menu.Item onPress={() => setShareOpen(true)}>
                        <Menu.ItemTitle>Share</Menu.ItemTitle>
                    </Menu.Item>
                )}
                <Menu.Item onPress={() => setSaveVersionOpen(true)}>
                    <Menu.ItemTitle>Save version</Menu.ItemTitle>
                </Menu.Item>
                <Separator />
                <Menu.Sub>
                    <Menu.SubTrigger>
                        <Menu.ItemTitle>Download</Menu.ItemTitle>
                    </Menu.SubTrigger>
                    <Menu.SubContent>
                        {props.onDownloadXlsx != null && (
                            <Menu.Item onPress={props.onDownloadXlsx}>
                                <Menu.ItemTitle>Download as XLSX</Menu.ItemTitle>
                            </Menu.Item>
                        )}
                        <Menu.Item onPress={downloadCsvCurrentSheet}>
                            <Menu.ItemTitle>Download as CSV (current sheet)</Menu.ItemTitle>
                        </Menu.Item>
                        <Menu.Item onPress={downloadCsvAllSheets}>
                            <Menu.ItemTitle>Download as CSV (all sheets)</Menu.ItemTitle>
                        </Menu.Item>
                        {exportTargets.map(target => (
                            <Menu.Item
                                key={target.to}
                                onPress={() =>
                                    exportItemToFormat(props.workbookId, props.workbookName, target)
                                }
                            >
                                <Menu.ItemTitle>Download as {target.label}</Menu.ItemTitle>
                            </Menu.Item>
                        ))}
                    </Menu.SubContent>
                </Menu.Sub>
                <Separator />
                <Menu.Item onPress={() => setRenameOpen(true)}>
                    <Menu.ItemTitle>Rename</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={() => setTrashOpen(true)}>
                    <Menu.ItemTitle>Move to trash</Menu.ItemTitle>
                </Menu.Item>
                <Menu.Item onPress={props.fileActions.openDriveDetails}>
                    <Menu.ItemTitle>Details</Menu.ItemTitle>
                </Menu.Item>
                <Separator />
                <Menu.Item onPress={props.onOpenPrint}>
                    <Menu.ItemTitle>Print</Menu.ItemTitle>
                    <MenuShortcut keys="⌘P" />
                </Menu.Item>
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
