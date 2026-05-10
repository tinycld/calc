import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import {
    Grid3x3,
    Square,
    SquareDashed,
    SquareSplitHorizontal,
    SquareSplitVertical,
} from 'lucide-react-native'
import type { ComponentType } from 'react'
import { useCallback, useState } from 'react'
import { Pressable, View } from 'react-native'
import type { BorderPresetId } from '../../lib/border-presets'
import type { CellBorders } from '../../lib/workbook-types'
import { ToolbarButton } from './ToolbarButton'

interface Option {
    id: BorderPresetId
    label: string
    icon: ComponentType<{ size?: number; color?: string }>
}

// Five common border patterns. The id identifies the preset; the actual
// per-cell CellBorders patch is computed by applyBorderPreset so that
// outer / top / bottom treat a multi-cell selection as a single block
// (only the perimeter cells contribute their outward-facing edge)
// rather than stamping every cell identically.
const OPTIONS: readonly Option[] = [
    { id: 'all', label: 'All borders', icon: Grid3x3 },
    { id: 'outer', label: 'Outer', icon: Square },
    { id: 'top', label: 'Top', icon: SquareSplitVertical },
    { id: 'bottom', label: 'Bottom', icon: SquareSplitHorizontal },
    { id: 'none', label: 'No borders', icon: SquareDashed },
]

interface BordersMenuProps {
    borders: CellBorders | undefined
    disabled: boolean
    onSetBorders: (presetId: BorderPresetId) => void
}

export function BordersMenu({ borders, disabled, onSetBorders }: BordersMenuProps) {
    const fg = useThemeColor('foreground')
    const accent = useThemeColor('accent')
    const [isOpen, setIsOpen] = useState(false)

    const onSelect = useCallback(
        (id: BorderPresetId) => {
            onSetBorders(id)
            setIsOpen(false)
        },
        [onSetBorders]
    )

    const activeId = matchActiveOption(borders)

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <Menu.Trigger>
                <ToolbarButton label="Borders" icon={Grid3x3} disabled={disabled} />
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <View className="flex-row items-center" style={{ padding: 4, gap: 2 }}>
                        {OPTIONS.map(option => {
                            const Icon = option.icon
                            const isActive = option.id === activeId
                            return (
                                <Pressable
                                    key={option.id}
                                    onPress={() => onSelect(option.id)}
                                    accessibilityLabel={option.label}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: isActive }}
                                    className={`items-center justify-center rounded ${isActive ? 'bg-accent' : ''}`}
                                    style={{
                                        width: 28,
                                        height: 24,
                                        borderWidth: isActive ? 1 : 0,
                                        borderColor: accent,
                                    }}
                                >
                                    <Icon size={14} color={fg} />
                                </Pressable>
                            )
                        })}
                    </View>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

// matchActiveOption reports which preset (if any) describes the
// current borders state. The "outer" and "all" options share an
// identical spec for single-cell scope (no inner edges to draw),
// so "all" wins the tie — keeping the highlight stable.
function matchActiveOption(b: CellBorders | undefined): BorderPresetId | undefined {
    const top = b?.top === true
    const right = b?.right === true
    const bottom = b?.bottom === true
    const left = b?.left === true
    if (top && right && bottom && left) return 'all'
    if (!top && !right && !bottom && !left) return 'none'
    if (top && !right && !bottom && !left) return 'top'
    if (!top && !right && bottom && !left) return 'bottom'
    return undefined
}
