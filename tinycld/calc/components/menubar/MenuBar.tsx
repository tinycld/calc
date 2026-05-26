import { MenuBar as CoreMenuBar } from '@tinycld/core/ui/menubar'
import type { WorkbookFileActions } from '../../hooks/use-workbook-file-actions'
import type { ToolbarProps } from '../Toolbar'
import { DataMenu } from './DataMenu'
import { EditMenu } from './EditMenu'
import { FileMenu } from './FileMenu'
import { FormatMenu } from './FormatMenu'
import { HelpMenu } from './HelpMenu'
import { ViewMenu } from './ViewMenu'

export interface MenuBarProps extends ToolbarProps {
    workbookId: string
    workbookName: string
    fileActions: WorkbookFileActions
    onClearFormatting: () => void
    onCopy: () => void
    onCut: () => void
    onPaste: () => void
    onPasteValues: () => void
    onPasteFormat: () => void
    onOpenFindReplace: () => void
    onOpenConditionalFormatting: () => void
    allSheets: ReadonlyArray<{ id: string; name: string; hidden?: boolean }>
    onShowSheet: (sheetId: string) => void
    onShowComments: () => void
    /** Read-only viewers (anon share links) see the menu bar as a row of
     *  greyed-out triggers — the menus exist for context but do not open.
     *  Forwarded to CoreMenuBar's allMenusDisabled, which propagates via
     *  context so every MenuBarMenu underneath flips its trigger to
     *  disabled without each per-menu file needing to know. */
    isReadOnly?: boolean
}

export function MenuBar(props: MenuBarProps) {
    return (
        <CoreMenuBar allMenusDisabled={props.isReadOnly}>
            <FileMenu {...props} />
            <EditMenu {...props} />
            <ViewMenu {...props} />
            <FormatMenu {...props} />
            <DataMenu {...props} />
            <HelpMenu />
        </CoreMenuBar>
    )
}
