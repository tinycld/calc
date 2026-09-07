import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, useOpenMenu } from '@tinycld/core/ui/menubar'
import { ChevronDown } from 'lucide-react-native'
import { Fragment } from 'react'
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
// entry, grouped by `group`. The active preset gets a check mark; the
// others show their sample in the row's right-aligned slot.
export function NumberFormatMenu({
    currentNumFmt,
    disabled,
    onApplyPreset,
}: NumberFormatMenuProps) {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')
    const [isOpen, setIsOpen] = useOpenMenu('toolbar:number-format')
    const activeId = findPresetByNumFmt(currentNumFmt)?.id

    const trigger = (
        <ToolbarButton label="Number format" disabled={disabled} width={48}>
            <View className="flex-row items-center" style={{ gap: 2 }}>
                <Text style={{ fontSize: 12, color: fg }}>123</Text>
                <ChevronDown size={12} color={muted} />
            </View>
        </ToolbarButton>
    )

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen} trigger={trigger} title="Number format">
            <PresetRows activeId={activeId} onSelect={onApplyPreset} />
        </Menu>
    )
}

function PresetRows({
    activeId,
    onSelect,
}: {
    activeId: string | undefined
    onSelect: (id: string) => void
}) {
    return NUMBER_FORMAT_PRESETS.map((preset, index) => {
        const prev = NUMBER_FORMAT_PRESETS[index - 1]
        const startsGroup = prev != null && prev.group !== preset.group
        return (
            <Fragment key={preset.id}>
                <GroupSeparator isVisible={startsGroup} />
                <Menu.Item
                    label={preset.label}
                    shortcut={preset.sample === '' ? undefined : preset.sample}
                    isSelected={preset.id === activeId}
                    onSelect={() => onSelect(preset.id)}
                />
            </Fragment>
        )
    })
}

function GroupSeparator({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return <Menu.Separator />
}
