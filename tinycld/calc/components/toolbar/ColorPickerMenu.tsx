import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    BORDERS_PALETTE,
    COLOR_PALETTE,
    ColorPickerGrid,
    type Swatch,
} from '@tinycld/core/ui/color-picker'
import { Menu, useOpenMenu } from '@tinycld/core/ui/menubar'
import { Popover, usePopoverContext } from '@tinycld/core/ui/popover'
import type { ComponentType, ReactNode } from 'react'
import { useCallback } from 'react'
import { View } from 'react-native'
import { ToolbarButton } from './ToolbarButton'

// Re-export the palettes so calc-internal callers (BordersMenu,
// conditional-format StylePicker) keep their existing import path.
// The values now live in core; this file is the calc-toolbar shell.
export { BORDERS_PALETTE, COLOR_PALETTE, type Swatch }

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

// A swatch grid is not a list of commands, so the surface is a Popover.
// It still joins the toolbar's single-open registry through useOpenMenu.
export function ColorPickerMenu({
    color,
    disabled,
    label,
    triggerIcon: Icon,
    triggerOverlay,
    onSetColor,
}: ColorPickerMenuProps) {
    const fg = useThemeColor('foreground')
    const [isOpen, setIsOpen] = useOpenMenu(`toolbar:color:${label}`)

    const onSelect = useCallback(
        (value: string) => {
            onSetColor(value)
            setIsOpen(false)
        },
        [onSetColor, setIsOpen]
    )

    const trigger = (
        <ToolbarButton label={label} disabled={disabled}>
            <View className="items-center justify-center">
                <Icon size={14} color={fg} />
                {triggerOverlay}
            </View>
        </ToolbarButton>
    )

    return (
        <Popover isOpen={isOpen} onOpenChange={setIsOpen} trigger={trigger} title={label}>
            <ColorPickerGrid selected={color} onSelect={onSelect} showClear />
        </Popover>
    )
}

/**
 * The same grid as a submenu body, for the toolbar's More menu once the
 * button folds. Picking closes the whole menu, as choosing a row would.
 */
export function ColorPickerRows({
    color,
    onSetColor,
}: Pick<ColorPickerMenuProps, 'color' | 'onSetColor'>) {
    const { close } = usePopoverContext()
    return (
        <Menu.Custom className="p-2">
            <ColorPickerGrid
                selected={color}
                onSelect={value => {
                    onSetColor(value)
                    close()
                }}
                showClear
            />
        </Menu.Custom>
    )
}
