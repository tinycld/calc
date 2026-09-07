import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Menu } from '@tinycld/core/ui/menu'
import { usePopoverContext } from '@tinycld/core/ui/popover'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import type * as Y from 'yjs'
import { useSheetActions } from '../../hooks/use-sheet-actions'
import { useSheetTabsStore } from '../../hooks/use-sheet-tabs-store'
import type { SheetWithId } from '../../hooks/use-y-sheets'
import { parseYCellKey } from '../../lib/y-cell-key'
import { CELLS_MAP } from '../../lib/y-doc-bootstrap'

// 8 preset swatches plus "No color". Hex values are user-chosen and
// survive the round-trip to xlsx, so we store the literal strings —
// not theme tokens. (CLAUDE.md's no-hex rule explicitly exempts
// user-picked colors.)
const SHEET_TAB_SWATCHES: ReadonlyArray<{ hex: string; label: string }> = [
    { hex: '', label: 'No color' },
    { hex: '#EF5350', label: 'Red' },
    { hex: '#FB8C00', label: 'Orange' },
    { hex: '#FDD835', label: 'Yellow' },
    { hex: '#66BB6A', label: 'Green' },
    { hex: '#42A5F5', label: 'Blue' },
    { hex: '#7E57C2', label: 'Purple' },
    { hex: '#EC407A', label: 'Pink' },
    { hex: '#8D6E63', label: 'Brown' },
]

interface SheetTabContextMenuProps {
    doc: Y.Doc | null
    allSheets: SheetWithId[]
    activeSheetId: string
    onSelect: (sheetId: string) => void
}

// SheetTabContextMenu renders the right-click menu for a sheet tab,
// plus the destructive-delete confirm dialog. Single instance for the
// whole tab strip; reads the open-target from useSheetTabsStore so any
// tab can open the same menu without per-tab Menu mounts.
export function SheetTabContextMenu({
    doc,
    allSheets,
    activeSheetId,
    onSelect,
}: SheetTabContextMenuProps) {
    const target = useSheetTabsStore(s => s.contextMenu)
    const closeContextMenu = useSheetTabsStore(s => s.closeContextMenu)
    const startRename = useSheetTabsStore(s => s.startRename)
    const actions = useSheetActions(doc)
    const [pendingDelete, setPendingDelete] = useState<SheetWithId | null>(null)

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open) closeContextMenu()
        },
        [closeContextMenu]
    )

    const sheet = target ? (allSheets.find(s => s.id === target.sheetId) ?? null) : null
    const sheetIndex = sheet ? allSheets.findIndex(s => s.id === sheet.id) : -1
    const visibleCount = allSheets.filter(s => !s.hidden).length

    const onRename = useCallback(() => {
        if (sheet == null) return
        startRename(sheet.id)
    }, [sheet, startRename])

    const onDuplicate = useCallback(() => {
        if (sheet == null) return
        const newId = actions.duplicateSheet(sheet.id)
        if (newId) onSelect(newId)
    }, [sheet, actions, onSelect])

    const performDelete = useCallback(
        (victim: SheetWithId) => {
            // Pick the next visible sheet to focus before mutating —
            // doing it after delete races with the React update.
            const visible = allSheets.filter(s => !s.hidden && s.id !== victim.id)
            if (victim.id === activeSheetId) {
                const fallback = visible[0] ?? allSheets.find(s => s.id !== victim.id)
                if (fallback) onSelect(fallback.id)
            }
            actions.deleteSheet(victim.id)
        },
        [actions, allSheets, activeSheetId, onSelect]
    )

    const onDeleteRequest = useCallback(() => {
        if (sheet == null) return
        if (cellCountOnSheet(doc, sheet.id) > 0) {
            setPendingDelete(sheet)
            return
        }
        performDelete(sheet)
    }, [sheet, doc, performDelete])

    const onMoveLeft = useCallback(() => {
        if (sheet == null || sheetIndex <= 0) return
        actions.reorderSheet(sheet.id, sheetIndex - 1)
    }, [sheet, sheetIndex, actions])

    const onMoveRight = useCallback(() => {
        if (sheet == null || sheetIndex < 0 || sheetIndex >= allSheets.length - 1) return
        actions.reorderSheet(sheet.id, sheetIndex + 1)
    }, [sheet, sheetIndex, allSheets.length, actions])

    const onHide = useCallback(() => {
        if (sheet == null) return
        // Refuse to hide the last visible sheet — would leave the
        // workbook with no rendered grid.
        if (visibleCount <= 1 && !sheet.hidden) return
        if (sheet.id === activeSheetId) {
            const next = allSheets.find(s => !s.hidden && s.id !== sheet.id)
            if (next) onSelect(next.id)
        }
        actions.hideSheet(sheet.id)
    }, [sheet, visibleCount, activeSheetId, allSheets, actions, onSelect])

    const onPickColor = useCallback(
        (value: string) => {
            if (sheet == null) return
            actions.setSheetColor(sheet.id, value === '' ? null : value)
        },
        [sheet, actions]
    )

    const isOpen = target != null && pendingDelete == null
    const anchor = useMemo(
        () => (target ? { x: target.cursor.x, y: target.cursor.y } : undefined),
        [target]
    )
    const canDelete = !(visibleCount <= 1 && sheet?.hidden !== true)
    const canMoveRight = sheetIndex >= 0 && sheetIndex < allSheets.length - 1

    return (
        <>
            <Menu
                isOpen={isOpen}
                onOpenChange={handleOpenChange}
                anchor={anchor}
                placement="top-start"
                presentation="popover"
            >
                <Menu.Item label="Rename" onSelect={onRename} />
                <Menu.Item label="Duplicate" onSelect={onDuplicate} />
                <Menu.Item label="Delete" onSelect={onDeleteRequest} isDisabled={!canDelete} />
                <Menu.Separator />
                <Menu.Item label="Move left" onSelect={onMoveLeft} isDisabled={sheetIndex <= 0} />
                <Menu.Item label="Move right" onSelect={onMoveRight} isDisabled={!canMoveRight} />
                <Menu.Separator />
                <Menu.Item label="Hide" onSelect={onHide} isDisabled={!canDelete} />
                <Menu.Separator />
                <Menu.Sub label="Change color">
                    <Menu.Custom>
                        <SwatchGrid activeColor={sheet?.color} onPick={onPickColor} />
                    </Menu.Custom>
                </Menu.Sub>
            </Menu>
            <DeleteConfirm
                pending={pendingDelete}
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => {
                    if (pendingDelete) performDelete(pendingDelete)
                    setPendingDelete(null)
                }}
            />
        </>
    )
}

interface SwatchGridProps {
    activeColor: string | undefined
    onPick: (color: string) => void
}

// A swatch is not a row, so it closes the menu itself once picked.
function SwatchGrid({ activeColor, onPick }: SwatchGridProps) {
    const { close } = usePopoverContext()
    const pick = (hex: string) => {
        onPick(hex)
        close()
    }
    return (
        <View className="flex-row flex-wrap" style={{ width: 5 * 28, padding: 6, gap: 4 }}>
            {SHEET_TAB_SWATCHES.map(swatch => {
                const isActive = (activeColor ?? '') === swatch.hex
                const isDefault = swatch.hex === ''
                return (
                    <Pressable
                        key={swatch.label}
                        onPress={() => pick(swatch.hex)}
                        accessibilityLabel={`Tab color ${swatch.label}`}
                        accessibilityRole="button"
                        style={{
                            width: 20,
                            height: 20,
                            borderRadius: 3,
                            borderWidth: isActive ? 2 : 1,
                            backgroundColor: isDefault ? 'transparent' : swatch.hex,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        className={isActive ? 'border-accent' : 'border-border'}
                    >
                        {isDefault ? (
                            <View className="bg-foreground" style={{ width: 14, height: 1 }} />
                        ) : null}
                    </Pressable>
                )
            })}
        </View>
    )
}

interface DeleteConfirmProps {
    pending: SheetWithId | null
    onCancel: () => void
    onConfirm: () => void
}

function DeleteConfirm({ pending, onCancel, onConfirm }: DeleteConfirmProps) {
    return (
        <ConfirmDialog
            isOpen={pending != null}
            onClose={onCancel}
            onConfirm={onConfirm}
            title="Delete sheet"
            message={`Delete sheet "${pending?.name ?? ''}"? This cannot be undone except by Cmd-Z within the editing session.`}
            confirmLabel="Delete"
            isDestructive
        />
    )
}

// cellCountOnSheet returns the number of cells in the doc whose key
// belongs to sheetId. Used to decide whether the delete action needs
// the destructive-delete confirm dialog. Walks the cells map directly
// rather than going through useYCell — this is a one-shot count, no
// subscription required.
function cellCountOnSheet(doc: Y.Doc | null, sheetId: string): number {
    if (doc == null) return 0
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    let n = 0
    cellsMap.forEach((_, key) => {
        const parsed = parseYCellKey(key)
        if (parsed != null && parsed.sheetId === sheetId) n++
    })
    return n
}
