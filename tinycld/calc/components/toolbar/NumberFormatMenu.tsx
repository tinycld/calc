import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, Separator } from '@tinycld/core/ui/menu'
import { Check, ChevronDown } from 'lucide-react-native'
import { Fragment, useCallback, useState } from 'react'
import { Text, View } from 'react-native'
import { findPresetByNumFmt, NUMBER_FORMAT_PRESETS } from '../../lib/number-format/presets'
import { ToolbarButton } from './ToolbarButton'

// Re-exported so the Format menubar can render the same preset list
// without duplicating the source-of-truth registry.
export { NUMBER_FORMAT_PRESETS as numberFormatPresets } from '../../lib/number-format/presets'

interface NumberFormatMenuProps {
    currentNumFmt: string | undefined
    disabled: boolean
    onApplyPreset: (id: string) => void
}

// "123 ▾" trigger that opens a menu listing every NUMBER_FORMAT_PRESETS
// entry, grouped by `group`. Active preset gets a leading checkmark;
// non-active rows get an equivalent-width spacer so labels line up.
export function NumberFormatMenu({
    currentNumFmt,
    disabled,
    onApplyPreset,
}: NumberFormatMenuProps) {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')
    const [isOpen, setIsOpen] = useState(false)
    const activeId = findPresetByNumFmt(currentNumFmt)?.id

    const onSelect = useCallback(
        (id: string) => {
            onApplyPreset(id)
            setIsOpen(false)
        },
        [onApplyPreset]
    )

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <Menu.Trigger>
                <ToolbarButton label="Number format" disabled={disabled} width={48}>
                    <View className="flex-row items-center" style={{ gap: 2 }}>
                        <Text style={{ fontSize: 12, color: fg }}>123</Text>
                        <ChevronDown size={12} color={muted} />
                    </View>
                </ToolbarButton>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    {NUMBER_FORMAT_PRESETS.map((preset, index) => {
                        const prev = NUMBER_FORMAT_PRESETS[index - 1]
                        const showSeparator = prev != null && prev.group !== preset.group
                        const isActive = preset.id === activeId
                        return (
                            <Fragment key={preset.id}>
                                {showSeparator ? <Separator /> : null}
                                <Menu.Item onPress={() => onSelect(preset.id)}>
                                    <View
                                        style={{ width: 16, alignItems: 'center' }}
                                        accessibilityElementsHidden
                                    >
                                        {isActive ? <Check size={12} color={fg} /> : null}
                                    </View>
                                    <Menu.ItemTitle>{preset.label}</Menu.ItemTitle>
                                    {preset.sample !== '' ? (
                                        <Text
                                            className="ml-auto"
                                            style={{ fontSize: 12, color: muted }}
                                        >
                                            {preset.sample}
                                        </Text>
                                    ) : null}
                                </Menu.Item>
                            </Fragment>
                        )
                    })}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
