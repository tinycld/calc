import { Menu } from '@tinycld/core/ui/menu'
import { useCallback, useEffect, useRef } from 'react'
import { Platform, Pressable, StyleSheet, type View } from 'react-native'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '../../lib/dimensions'

interface HandleContextMenuProps {
    onAutosizeCol: (col: number) => void
    // onResetCol/onResetRow are wired to the same setYColWidth/setYRowHeight
    // setters so writing the default deletes the entry — see lib/dimensions.ts.
    onResetCol: (col: number, width: number) => void
    onResetRow: (row: number, height: number) => void
}

// Single small menu shared by every column- and row-resize handle.
// Right-click (web) sets the target via the store; selecting an item
// dispatches and closes. Native users don't currently get this menu —
// long-press on a 6px handle isn't a practical mobile gesture, and
// the drag-to-resize gesture already covers the common case.
export function HandleContextMenu({
    onAutosizeCol,
    onResetCol,
    onResetRow,
}: HandleContextMenuProps) {
    const target = useGridStore(s => s.handleMenu)
    const store = useGridStoreApi()
    const onClose = useCallback(() => store.getState().closeHandleMenu(), [store])
    const contentRef = useRef<View | null>(null)

    useEffect(() => {
        if (Platform.OS !== 'web') return
        if (target == null) return
        if (typeof document === 'undefined') return
        const handler = (event: PointerEvent) => {
            const targetNode = event.target as Node | null
            const node = contentRef.current as unknown as Node | null
            if (targetNode && node?.contains(targetNode)) return
            onClose()
        }
        document.addEventListener('pointerdown', handler, true)
        return () => {
            document.removeEventListener('pointerdown', handler, true)
        }
    }, [target, onClose])

    const isOpen = target != null
    const triggerPos = target
        ? { x: target.cursor.x, y: target.cursor.y, width: 0, height: 0 }
        : null

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open) onClose()
        },
        [onClose]
    )

    const onAutosizeItem = useCallback(() => {
        if (target == null || target.axis !== 'col') return
        onAutosizeCol(target.index)
        onClose()
    }, [target, onAutosizeCol, onClose])

    const onResetItem = useCallback(() => {
        if (target == null) return
        if (target.axis === 'col') {
            onResetCol(target.index, DEFAULT_COL_WIDTH)
        } else {
            onResetRow(target.index, DEFAULT_ROW_HEIGHT)
        }
        onClose()
    }, [target, onResetCol, onResetRow, onClose])

    const isCol = target?.axis === 'col'

    return (
        <Menu isOpen={isOpen} onOpenChange={handleOpenChange} triggerPosition={triggerPos}>
            <Menu.Portal>
                {Platform.OS !== 'web' && (
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                )}
                <Menu.Content ref={contentRef} placement="bottom" align="start">
                    {isCol && (
                        <Menu.Item onPress={onAutosizeItem}>
                            <Menu.ItemTitle>Auto-fit column width</Menu.ItemTitle>
                        </Menu.Item>
                    )}
                    <Menu.Item onPress={onResetItem}>
                        <Menu.ItemTitle>
                            {isCol ? 'Reset to default width' : 'Reset to default height'}
                        </Menu.ItemTitle>
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
