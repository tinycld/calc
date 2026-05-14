import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { Menu, Separator } from '@tinycld/core/ui/menu'
import { router } from 'expo-router'
import type { MenuBarProps } from './MenuBar'
import { MenuBarMenu } from './MenuBarMenu'
import { MenuShortcut } from './MenuShortcut'

export function FileMenu(props: MenuBarProps) {
    const orgHref = useOrgHref()
    // The CSV import flow lives on the calc index screen (it owns the
    // file-picker and the staged-rows handoff via `setPendingImport`).
    // From the detail screen we just bounce back to the index — opening
    // the picker there matches Sheets' "Import" behavior.
    const openImport = () => router.push(orgHref('calc'))

    const promptThen = (label: string, defaultValue: string, run: (v: string) => void) => () => {
        const v = typeof window !== 'undefined' ? window.prompt(label, defaultValue) : null
        if (v != null && v.trim() !== '') run(v.trim())
    }

    const confirmThen = (msg: string, run: () => void) => () => {
        const ok = typeof window !== 'undefined' ? window.confirm(msg) : true
        if (ok) run()
    }

    return (
        <MenuBarMenu menuId="file" label="File">
            <Menu.Item onPress={() => router.push(orgHref('calc'))}>
                <Menu.ItemTitle>New spreadsheet</Menu.ItemTitle>
            </Menu.Item>
            <Menu.Item onPress={() => router.push(orgHref('drive'))}>
                <Menu.ItemTitle>Open</Menu.ItemTitle>
            </Menu.Item>
            <Menu.Item onPress={openImport}>
                <Menu.ItemTitle>Import</Menu.ItemTitle>
            </Menu.Item>
            <Menu.Item
                onPress={promptThen('Copy name', `${props.workbookName} (copy)`, v =>
                    props.fileActions.makeCopy(v)
                )}
            >
                <Menu.ItemTitle>Make a copy</Menu.ItemTitle>
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
                    <Menu.Item onPress={props.onDownloadCsvCurrent}>
                        <Menu.ItemTitle>Download as CSV (current sheet)</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={props.onDownloadCsvAll}>
                        <Menu.ItemTitle>Download as CSV (all sheets)</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.SubContent>
            </Menu.Sub>
            <Separator />
            <Menu.Item
                onPress={promptThen('Rename', props.workbookName, v =>
                    props.fileActions.rename(v)
                )}
            >
                <Menu.ItemTitle>Rename</Menu.ItemTitle>
            </Menu.Item>
            <Menu.Item
                onPress={confirmThen('Move this spreadsheet to trash?', () =>
                    props.fileActions.moveToTrash()
                )}
            >
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
    )
}
