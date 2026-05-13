import { View } from 'react-native'
import type { WorkbookFileActions } from '../../hooks/use-workbook-file-actions'
import type { ToolbarProps } from '../Toolbar'
import { DataMenu } from './DataMenu'
import { EditMenu } from './EditMenu'
import { FileMenu } from './FileMenu'
import { FormatMenu } from './FormatMenu'
import { HelpMenu } from './HelpMenu'
import { ViewMenu } from './ViewMenu'

export interface MenuBarProps extends ToolbarProps {
    workbookName: string
    fileActions: WorkbookFileActions
    onClearFormatting: () => void
    onCopy: () => void
    onCut: () => void
    onPaste: () => void
    onPasteValues: () => void
    onPasteFormat: () => void
    onOpenFindReplace: () => void
    onOpenFunctionList: () => void
    onOpenKeyboardShortcuts: () => void
    allSheets: ReadonlyArray<{ id: string; name: string; hidden?: boolean }>
    onShowSheet: (sheetId: string) => void
}

export function MenuBar(props: MenuBarProps) {
    return (
        <View
            className="flex-row items-center bg-background border-b border-border"
            style={{ height: 28, paddingHorizontal: 4 }}
        >
            <FileMenu {...props} />
            <EditMenu {...props} />
            <ViewMenu {...props} />
            <FormatMenu {...props} />
            <DataMenu {...props} />
            <HelpMenu {...props} />
        </View>
    )
}
