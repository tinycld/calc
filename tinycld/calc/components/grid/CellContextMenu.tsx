import { Menu, Separator } from '@tinycld/core/ui/menu'
import { useCallback, useEffect, useRef } from 'react'
import { Platform, Pressable, StyleSheet, type View } from 'react-native'
import type * as Y from 'yjs'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import { setYCell } from '../../hooks/use-y-cell'
import { effectiveRange, forEachCellInRange } from '../../lib/selection-range'
import { readCellStyle, toggleCellFontAttrInRange } from './style-helpers'

interface CellContextMenuProps {
    doc: Y.Doc | null
    sheetId: string
}

// Single Menu instance shared by every cell. Mounted in Grid so cells
// stay free of any per-cell Menu overhead. Positioned at the
// cursor/touch coordinates via Menu's triggerPosition prop (a 0×0
// "trigger rect" anchored at the click point produces a popover that
// drops down to the bottom-right of the cursor, with edge-flip handled
// by Menu.Content).
export function CellContextMenu({ doc, sheetId }: CellContextMenuProps) {
    const target = useGridStore(s => s.contextTarget)
    // Read the live selection so range-aware menu actions (clear,
    // toggle bold/italic) cover every cell currently highlighted.
    // openCellContextMenu has already collapsed the range to a single
    // cell when the right-click landed outside any prior range, so
    // this naturally reduces to single-cell when there's no range.
    const selected = useGridStore(s => s.selected)
    const selectionRange = useGridStore(s => s.selectionRange)
    const store = useGridStoreApi()
    const onClose = useCallback(() => store.getState().closeCellContextMenu(), [store])
    const contentRef = useRef<View | null>(null)

    // Web: dismiss on any pointerdown outside the menu content.
    // Mirrors the pattern in @tinycld/core/components/ContextMenu —
    // Gluestack's overlay scrim is unreliable for outside-click
    // dismissal (clicks can land on cells underneath).
    //
    // Native: a Pressable absolute-fill scrim inside Menu.Portal handles
    // taps outside; rendered conditionally below.
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

    const range = effectiveRange(selected, selectionRange)

    const onClear = useCallback(() => {
        if (range == null || doc == null) return
        forEachCellInRange(range, (row, col) => {
            setYCell(doc, sheetId, row, col, '')
        })
    }, [doc, sheetId, range])

    const onToggleBold = useCallback(() => {
        if (range == null) return
        toggleCellFontAttrInRange(doc, sheetId, range, 'bold')
    }, [doc, sheetId, range])

    const onToggleItalic = useCallback(() => {
        if (range == null) return
        toggleCellFontAttrInRange(doc, sheetId, range, 'italic')
    }, [doc, sheetId, range])

    // Indicator labels reflect the anchor cell only — that's the cell
    // the user sees outlined and is the natural reference point for
    // "is this currently bold?". The mixed-toggle action will still
    // promote the whole range when needed.
    const currentStyle = target
        ? readCellStyle(doc, sheetId, target.cell.row, target.cell.col)
        : undefined
    const isBold = currentStyle?.font?.bold === true
    const isItalic = currentStyle?.font?.italic === true

    return (
        <Menu isOpen={isOpen} onOpenChange={handleOpenChange} triggerPosition={triggerPos}>
            <Menu.Portal>
                {Platform.OS !== 'web' && (
                    <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                )}
                <Menu.Content ref={contentRef} placement="bottom" align="start">
                    <Menu.Item onPress={onClear}>
                        <Menu.ItemTitle>Clear contents</Menu.ItemTitle>
                    </Menu.Item>
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={onToggleBold}>
                        <Menu.ItemTitle>{isBold ? 'Remove bold' : 'Bold'}</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={onToggleItalic}>
                        <Menu.ItemTitle>{isItalic ? 'Remove italic' : 'Italic'}</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
