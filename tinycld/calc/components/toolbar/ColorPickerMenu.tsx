import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import type { ComponentType, ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { Pressable, View } from 'react-native'
import { ToolbarButton } from './ToolbarButton'

// Shared 10-swatch palette used for both text and fill color pickers.
// The empty-string entry is the "default" swatch — rendered with no
// fill so the user can revert to the cell's natural color.
export const COLOR_PALETTE: ReadonlyArray<{ value: string; label: string }> = [
    { value: '', label: 'Default' },
    { value: '#000000', label: 'Black' },
    { value: '#666666', label: 'Dark gray' },
    { value: '#B00020', label: 'Red' },
    { value: '#E64A19', label: 'Orange' },
    { value: '#F9A825', label: 'Yellow' },
    { value: '#2E7D32', label: 'Green' },
    { value: '#1565C0', label: 'Blue' },
    { value: '#6A1B9A', label: 'Purple' },
    { value: '#AD1457', label: 'Pink' },
]

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
    const [isOpen, setIsOpen] = useState(false)

    const onSelect = useCallback(
        (value: string) => {
            onSetColor(value)
            setIsOpen(false)
        },
        [onSetColor]
    )

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <Menu.Trigger>
                <ToolbarButton label={label} disabled={disabled}>
                    <View className="items-center justify-center">
                        <Icon size={14} color={fg} />
                        {triggerOverlay}
                    </View>
                </ToolbarButton>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <View
                        className="flex-row flex-wrap"
                        style={{ width: 5 * 28, padding: 6, gap: 4 }}
                    >
                        {COLOR_PALETTE.map(swatch => {
                            const isActive = (color ?? '') === swatch.value
                            const isDefault = swatch.value === ''
                            return (
                                <Pressable
                                    key={swatch.label}
                                    onPress={() => onSelect(swatch.value)}
                                    accessibilityLabel={swatch.label}
                                    accessibilityRole="button"
                                    style={{
                                        width: 20,
                                        height: 20,
                                        borderRadius: 3,
                                        borderWidth: isActive ? 2 : 1,
                                        borderColor: isActive ? accent : border,
                                        backgroundColor: isDefault ? 'transparent' : swatch.value,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    {isDefault ? (
                                        <View
                                            style={{
                                                width: 14,
                                                height: 1,
                                                backgroundColor: fg,
                                            }}
                                        />
                                    ) : null}
                                </Pressable>
                            )
                        })}
                    </View>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
