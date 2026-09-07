import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, MenuBarMenu } from '@tinycld/core/ui/menubar'
import { Check } from 'lucide-react-native'
import { View } from 'react-native'
import { numberFormatPresets } from '../toolbar/NumberFormatMenu'
import type { MenuBarProps } from './MenuBar'

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 18, 24, 36]

// A leading check rather than the row's `isSelected` trailing check: the
// text-style rows also carry a shortcut, which the trailing check would
// replace.
function CheckedIndicator({ isOn }: { isOn: boolean }) {
    const fg = useThemeColor('foreground')
    if (!isOn) return <View style={{ width: 14 }} />
    return <Check size={14} color={fg} />
}

export function FormatMenu(props: MenuBarProps) {
    return (
        <MenuBarMenu menuId="format" label="Format">
            <Menu.Sub label="Number">
                <NumberPresetItems
                    onApplyPreset={props.onApplyPreset}
                    isDisabled={props.disabled}
                />
            </Menu.Sub>
            <Menu.Sub label="Text">
                <Menu.Item
                    label="Bold"
                    shortcut="⌘B"
                    leading={<CheckedIndicator isOn={props.isBold} />}
                    onSelect={props.onToggleBold}
                    isDisabled={props.disabled}
                />
                <Menu.Item
                    label="Italic"
                    shortcut="⌘I"
                    leading={<CheckedIndicator isOn={props.isItalic} />}
                    onSelect={props.onToggleItalic}
                    isDisabled={props.disabled}
                />
                <Menu.Item
                    label="Underline"
                    shortcut="⌘U"
                    leading={<CheckedIndicator isOn={props.isUnderline} />}
                    onSelect={props.onToggleUnderline}
                    isDisabled={props.disabled}
                />
                <Menu.Item
                    label="Strikethrough"
                    shortcut="⌘⇧X"
                    leading={<CheckedIndicator isOn={props.isStrike} />}
                    onSelect={props.onToggleStrike}
                    isDisabled={props.disabled}
                />
            </Menu.Sub>
            <Menu.Sub label="Alignment">
                <Menu.Item
                    label="Left"
                    isSelected={props.horizontalAlign === 'left'}
                    onSelect={() => props.onSetHorizontalAlign('left')}
                    isDisabled={props.disabled}
                />
                <Menu.Item
                    label="Center"
                    isSelected={props.horizontalAlign === 'center'}
                    onSelect={() => props.onSetHorizontalAlign('center')}
                    isDisabled={props.disabled}
                />
                <Menu.Item
                    label="Right"
                    isSelected={props.horizontalAlign === 'right'}
                    onSelect={() => props.onSetHorizontalAlign('right')}
                    isDisabled={props.disabled}
                />
            </Menu.Sub>
            <Menu.Sub label="Font size">
                <FontSizeItems
                    fontSize={props.fontSize}
                    onSetFontSize={props.onSetFontSize}
                    isDisabled={props.disabled}
                />
            </Menu.Sub>
            <Menu.Sub label="Merge cells">
                <Menu.Item
                    label="Merge all"
                    onSelect={props.onMergeAll}
                    isDisabled={props.disabled}
                />
                <Menu.Item
                    label="Merge horizontally"
                    onSelect={props.onMergeHorizontal}
                    isDisabled={props.disabled}
                />
                <Menu.Item
                    label="Merge vertically"
                    onSelect={props.onMergeVertical}
                    isDisabled={props.disabled}
                />
                <Menu.Item label="Unmerge" onSelect={props.onUnmerge} isDisabled={props.disabled} />
            </Menu.Sub>
            <Menu.Separator />
            <Menu.Item
                label="Conditional formatting…"
                onSelect={props.onOpenConditionalFormatting}
            />
            <Menu.Separator />
            <Menu.Item
                label="Clear formatting"
                shortcut="⌘\"
                onSelect={props.onClearFormatting}
                isDisabled={props.disabled}
            />
        </MenuBarMenu>
    )
}

function NumberPresetItems({
    onApplyPreset,
    isDisabled,
}: {
    onApplyPreset: (id: string) => void
    isDisabled: boolean
}) {
    return numberFormatPresets.map(preset => (
        <Menu.Item
            key={preset.id}
            label={preset.label}
            onSelect={() => onApplyPreset(preset.id)}
            isDisabled={isDisabled}
        />
    ))
}

function FontSizeItems({
    fontSize,
    onSetFontSize,
    isDisabled,
}: {
    fontSize: number | undefined
    onSetFontSize: (size: number) => void
    isDisabled: boolean
}) {
    return FONT_SIZES.map(size => (
        <Menu.Item
            key={size}
            label={String(size)}
            isSelected={fontSize === size}
            onSelect={() => onSetFontSize(size)}
            isDisabled={isDisabled}
        />
    ))
}
