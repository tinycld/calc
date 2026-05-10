import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, Separator } from '@tinycld/core/ui/menu'
import { ChevronDown, Pin } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'
import { columnLabel } from '../../lib/workbook-types'
import { ToolbarButton } from './ToolbarButton'

interface FreezeMenuProps {
    disabled: boolean
    frozenRows: number
    frozenCols: number
    // Bottom row of the active selection (or the anchor row when there
    // is no range). Drives the "Freeze up to row N" item; absent (null)
    // hides the dynamic item.
    selectionBottomRow: number | null
    selectionRightCol: number | null
    onSetFrozenRows: (n: number) => void
    onSetFrozenCols: (n: number) => void
    onUnfreeze: () => void
}

// FreezeMenu is the toolbar's "View / Freeze" dropdown. Items are
// fixed-count (1 row, 2 rows, 1 column, 2 columns) plus dynamic
// freeze-to-selection items, plus Unfreeze (enabled only when
// something is currently frozen).
export function FreezeMenu({
    disabled,
    frozenRows,
    frozenCols,
    selectionBottomRow,
    selectionRightCol,
    onSetFrozenRows,
    onSetFrozenCols,
    onUnfreeze,
}: FreezeMenuProps) {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')
    const [isOpen, setIsOpen] = useState(false)

    const hasFreeze = frozenRows > 0 || frozenCols > 0
    const showFreezeToRow = selectionBottomRow != null && selectionBottomRow > 0
    const showFreezeToCol = selectionRightCol != null && selectionRightCol > 0

    // Inline arrow callbacks — the Menu items unmount when the menu
    // closes, so a fresh callback identity per render isn't a perf
    // concern (no memoized child below the Menu.Item).
    const freeze = (n: number, axis: 'rows' | 'cols') => {
        if (axis === 'rows') onSetFrozenRows(n)
        else onSetFrozenCols(n)
        setIsOpen(false)
    }
    const unfreezeAndClose = () => {
        onUnfreeze()
        setIsOpen(false)
    }

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <Menu.Trigger>
                <ToolbarButton label="Freeze" disabled={disabled} width={36}>
                    <View className="flex-row items-center" style={{ gap: 2 }}>
                        <Pin size={14} color={fg} />
                        <ChevronDown size={10} color={muted} />
                    </View>
                </ToolbarButton>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <Menu.Item onPress={() => freeze(1, 'rows')}>
                        <Menu.ItemTitle>Freeze 1 row</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={() => freeze(2, 'rows')}>
                        <Menu.ItemTitle>Freeze 2 rows</Menu.ItemTitle>
                    </Menu.Item>
                    {showFreezeToRow && (
                        <Menu.Item onPress={() => freeze(selectionBottomRow, 'rows')}>
                            <Menu.ItemTitle>Freeze up to row {selectionBottomRow}</Menu.ItemTitle>
                        </Menu.Item>
                    )}
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={() => freeze(1, 'cols')}>
                        <Menu.ItemTitle>Freeze 1 column</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={() => freeze(2, 'cols')}>
                        <Menu.ItemTitle>Freeze 2 columns</Menu.ItemTitle>
                    </Menu.Item>
                    {showFreezeToCol && (
                        <Menu.Item onPress={() => freeze(selectionRightCol, 'cols')}>
                            <Menu.ItemTitle>
                                Freeze up to column {columnLabel(selectionRightCol)}
                            </Menu.ItemTitle>
                        </Menu.Item>
                    )}
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={unfreezeAndClose} isDisabled={!hasFreeze}>
                        <Menu.ItemTitle>Unfreeze</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
