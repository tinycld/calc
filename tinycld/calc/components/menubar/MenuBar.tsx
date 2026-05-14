import { useEffect } from 'react'
import { View } from 'react-native'
import type { WorkbookFileActions } from '../../hooks/use-workbook-file-actions'
import type { ToolbarProps } from '../Toolbar'
import { DataMenu } from './DataMenu'
import { EditMenu } from './EditMenu'
import { FileMenu } from './FileMenu'
import { FormatMenu } from './FormatMenu'
import { HelpMenu } from './HelpMenu'
import { useMenuBarStore } from './menubar-store'
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
    useMenuBarOutsideClick()

    return (
        <View
            className="flex-row items-center bg-background border-b border-border"
            style={{ height: 28, paddingHorizontal: 4 }}
            {...(typeof document !== 'undefined' ? { 'data-menubar': 'row' } : {})}
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

// Closes the active menubar menu when the user mouses-down anywhere
// outside the menubar row or an open popover's content. Replaces the
// per-menu `<Menu.Overlay />` backdrop — that overlay intercepted
// clicks on sibling triggers and broke the "click another menu →
// swap instantly" flow.
//
// Web-only. On native there's no equivalent global-click signal and
// the menus are dismissed by tapping outside the popover, which
// gluestack's Modal handles via onRequestClose.
function useMenuBarOutsideClick(): void {
    const close = useMenuBarStore(s => s.close)
    useEffect(() => {
        if (typeof document === 'undefined') return
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Element | null
            if (target == null) return
            // closest() walks the DOM upward including portaled subtrees.
            // A click on a menubar trigger row, on a Menu.Content
            // popover, or on a submenu pop-out lands inside one of these
            // markers and is preserved.
            if (target.closest('[data-menubar]')) return
            close()
        }
        document.addEventListener('mousedown', onMouseDown)
        return () => document.removeEventListener('mousedown', onMouseDown)
    }, [close])
}
