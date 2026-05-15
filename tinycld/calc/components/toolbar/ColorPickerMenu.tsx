import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { Ban } from 'lucide-react-native'
import type { ComponentType, ReactNode } from 'react'
import { useCallback } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useOpenMenu } from '../../lib/stores/open-menu-store'
import { ToolbarButton } from './ToolbarButton'

// Compact 10-swatch palette retained for the borders sub-picker, which
// sits inside a wider menu and only has room for a single hue per
// column. The fill / text pickers now use the richer COLOR_PALETTE
// matrix below.
export const BORDERS_PALETTE: ReadonlyArray<{ hex: string; label: string }> = [
    { hex: '', label: 'Default' },
    { hex: '#000000', label: 'Black' },
    { hex: '#666666', label: 'Dark gray' },
    { hex: '#B00020', label: 'Red' },
    { hex: '#E64A19', label: 'Orange' },
    { hex: '#F9A825', label: 'Yellow' },
    { hex: '#2E7D32', label: 'Green' },
    { hex: '#1565C0', label: 'Blue' },
    { hex: '#6A1B9A', label: 'Purple' },
    { hex: '#AD1457', label: 'Pink' },
]

// 10-wide grid laid out like Google Sheets:
//   row 0: grayscale (black → white)
//   row 1: saturated hues
//   rows 2-7: 6 lightness ramps per hue (light → dark)
// The empty-string sentinel is handled separately by the menu (rendered
// as an explicit "Clear" affordance at the top — see the Pressable above
// the grid).
// `hex` (rather than `value`) because Reanimated's Babel plugin warns
// whenever it sees `.value` accessed inside an inline `style={…}` prop
// — it can't distinguish a shared value from a plain field, so any
// `swatch.hex` in a style threw the "shared value's .value inside
// reanimated inline style" dev warning. Renaming the field sidesteps
// the syntactic heuristic.
export const COLOR_PALETTE: ReadonlyArray<{ hex: string; label: string }> = [
    { hex: '#000000', label: 'Black' },
    { hex: '#434343', label: 'Dark gray 4' },
    { hex: '#666666', label: 'Dark gray 3' },
    { hex: '#999999', label: 'Dark gray 2' },
    { hex: '#B7B7B7', label: 'Dark gray 1' },
    { hex: '#CCCCCC', label: 'Gray' },
    { hex: '#D9D9D9', label: 'Light gray 1' },
    { hex: '#EFEFEF', label: 'Light gray 2' },
    { hex: '#F3F3F3', label: 'Light gray 3' },
    { hex: '#FFFFFF', label: 'White' },

    { hex: '#980000', label: 'Red berry' },
    { hex: '#FF0000', label: 'Red' },
    { hex: '#FF9900', label: 'Orange' },
    { hex: '#FFFF00', label: 'Yellow' },
    { hex: '#00FF00', label: 'Green' },
    { hex: '#00FFFF', label: 'Cyan' },
    { hex: '#4A86E8', label: 'Cornflower blue' },
    { hex: '#0000FF', label: 'Blue' },
    { hex: '#9900FF', label: 'Purple' },
    { hex: '#FF00FF', label: 'Magenta' },

    { hex: '#E6B8AF', label: 'Light red berry 3' },
    { hex: '#F4CCCC', label: 'Light red 3' },
    { hex: '#FCE5CD', label: 'Light orange 3' },
    { hex: '#FFF2CC', label: 'Light yellow 3' },
    { hex: '#D9EAD3', label: 'Light green 3' },
    { hex: '#D0E0E3', label: 'Light cyan 3' },
    { hex: '#C9DAF8', label: 'Light cornflower blue 3' },
    { hex: '#CFE2F3', label: 'Light blue 3' },
    { hex: '#D9D2E9', label: 'Light purple 3' },
    { hex: '#EAD1DC', label: 'Light magenta 3' },

    { hex: '#DD7E6B', label: 'Light red berry 2' },
    { hex: '#EA9999', label: 'Light red 2' },
    { hex: '#F9CB9C', label: 'Light orange 2' },
    { hex: '#FFE599', label: 'Light yellow 2' },
    { hex: '#B6D7A8', label: 'Light green 2' },
    { hex: '#A2C4C9', label: 'Light cyan 2' },
    { hex: '#A4C2F4', label: 'Light cornflower blue 2' },
    { hex: '#9FC5E8', label: 'Light blue 2' },
    { hex: '#B4A7D6', label: 'Light purple 2' },
    { hex: '#D5A6BD', label: 'Light magenta 2' },

    { hex: '#CC4125', label: 'Light red berry 1' },
    { hex: '#E06666', label: 'Light red 1' },
    { hex: '#F6B26B', label: 'Light orange 1' },
    { hex: '#FFD966', label: 'Light yellow 1' },
    { hex: '#93C47D', label: 'Light green 1' },
    { hex: '#76A5AF', label: 'Light cyan 1' },
    { hex: '#6D9EEB', label: 'Light cornflower blue 1' },
    { hex: '#6FA8DC', label: 'Light blue 1' },
    { hex: '#8E7CC3', label: 'Light purple 1' },
    { hex: '#C27BA0', label: 'Light magenta 1' },

    { hex: '#A61C00', label: 'Dark red berry 1' },
    { hex: '#CC0000', label: 'Dark red 1' },
    { hex: '#E69138', label: 'Dark orange 1' },
    { hex: '#F1C232', label: 'Dark yellow 1' },
    { hex: '#6AA84F', label: 'Dark green 1' },
    { hex: '#45818E', label: 'Dark cyan 1' },
    { hex: '#3C78D8', label: 'Dark cornflower blue 1' },
    { hex: '#3D85C6', label: 'Dark blue 1' },
    { hex: '#674EA7', label: 'Dark purple 1' },
    { hex: '#A64D79', label: 'Dark magenta 1' },

    { hex: '#85200C', label: 'Dark red berry 2' },
    { hex: '#990000', label: 'Dark red 2' },
    { hex: '#B45F06', label: 'Dark orange 2' },
    { hex: '#BF9000', label: 'Dark yellow 2' },
    { hex: '#38761D', label: 'Dark green 2' },
    { hex: '#134F5C', label: 'Dark cyan 2' },
    { hex: '#1155CC', label: 'Dark cornflower blue 2' },
    { hex: '#0B5394', label: 'Dark blue 2' },
    { hex: '#351C75', label: 'Dark purple 2' },
    { hex: '#741B47', label: 'Dark magenta 2' },

    { hex: '#5B0F00', label: 'Dark red berry 3' },
    { hex: '#660000', label: 'Dark red 3' },
    { hex: '#783F04', label: 'Dark orange 3' },
    { hex: '#7F6000', label: 'Dark yellow 3' },
    { hex: '#274E13', label: 'Dark green 3' },
    { hex: '#0C343D', label: 'Dark cyan 3' },
    { hex: '#1C4587', label: 'Dark cornflower blue 3' },
    { hex: '#073763', label: 'Dark blue 3' },
    { hex: '#20124D', label: 'Dark purple 3' },
    { hex: '#4C1130', label: 'Dark magenta 3' },
]

const SWATCH_SIZE = 18
const SWATCH_GAP = 4
const GRID_PADDING = 8
const GRID_COLS = 10
const GRID_WIDTH = GRID_COLS * SWATCH_SIZE + (GRID_COLS - 1) * SWATCH_GAP + GRID_PADDING * 2

interface ColorPickerMenuProps {
    color: string | undefined
    disabled: boolean
    label: string
    triggerIcon: ComponentType<{ size?: number; color?: string }>
    // Optional render slot drawn under the trigger icon — used by the
    // text-color and fill-color buttons to show an underline bar tinted
    // to the active swatch (matches the Google Sheets affordance).
    triggerOverlay?: ReactNode
    onSetColor: (color: string) => void
}

export function ColorPickerMenu({
    color,
    disabled,
    label,
    triggerIcon: Icon,
    triggerOverlay,
    onSetColor,
}: ColorPickerMenuProps) {
    const fg = useThemeColor('foreground')
    const border = useThemeColor('border')
    const accent = useThemeColor('accent')
    const [isOpen, setIsOpen] = useOpenMenu(`toolbar:color:${label}`)

    const onSelect = useCallback(
        (value: string) => {
            onSetColor(value)
            setIsOpen(false)
        },
        [onSetColor, setIsOpen]
    )

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <View
                {...(typeof document !== 'undefined'
                    ? { 'data-calc-menu': 'trigger' }
                    : {})}
            >
                <Menu.Trigger>
                    <ToolbarButton label={label} disabled={disabled}>
                        <View className="items-center justify-center">
                            <Icon size={14} color={fg} />
                            {triggerOverlay}
                        </View>
                    </ToolbarButton>
                </Menu.Trigger>
            </View>
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <View
                        style={{ width: GRID_WIDTH, padding: GRID_PADDING, gap: 6 }}
                        {...(typeof document !== 'undefined'
                            ? { 'data-calc-menu': 'content' }
                            : {})}
                    >
                        <Pressable
                            onPress={() => onSelect('')}
                            accessibilityLabel="Clear"
                            accessibilityRole="button"
                            className="flex-row items-center rounded"
                            style={{ paddingVertical: 6, paddingHorizontal: 4, gap: 8 }}
                        >
                            <Ban size={14} color={fg} />
                            <Text style={{ fontSize: 13, color: fg }}>Clear</Text>
                        </Pressable>
                        <View style={{ height: 1, backgroundColor: border }} />
                        <View className="flex-row flex-wrap" style={{ gap: SWATCH_GAP }}>
                            {COLOR_PALETTE.map(swatch => {
                                const isActive = (color ?? '') === swatch.hex
                                return (
                                    <Pressable
                                        key={swatch.label}
                                        onPress={() => onSelect(swatch.hex)}
                                        accessibilityLabel={swatch.label}
                                        accessibilityRole="button"
                                        style={{
                                            width: SWATCH_SIZE,
                                            height: SWATCH_SIZE,
                                            borderRadius: SWATCH_SIZE / 2,
                                            borderWidth: isActive ? 2 : 1,
                                            borderColor: isActive ? accent : border,
                                            backgroundColor: swatch.hex,
                                        }}
                                    />
                                )
                            })}
                        </View>
                    </View>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
