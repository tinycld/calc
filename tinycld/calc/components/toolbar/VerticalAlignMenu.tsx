import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, useOpenMenu } from '@tinycld/core/ui/menubar'
import {
    AlignVerticalJustifyCenter,
    AlignVerticalJustifyEnd,
    AlignVerticalJustifyStart,
    ChevronDown,
    type LucideIcon,
} from 'lucide-react-native'
import { View } from 'react-native'
import type { VerticalAlign } from '../../hooks/grid/use-grid-format-controls'
import { ToolbarButton } from './ToolbarButton'

const ALIGN_OPTIONS: ReadonlyArray<{
    value: VerticalAlign
    icon: LucideIcon
    label: string
}> = [
    { value: 'top', icon: AlignVerticalJustifyStart, label: 'Align top' },
    { value: 'middle', icon: AlignVerticalJustifyCenter, label: 'Align middle' },
    { value: 'bottom', icon: AlignVerticalJustifyEnd, label: 'Align bottom' },
]

interface VerticalAlignMenuProps {
    align: VerticalAlign | undefined
    disabled: boolean
    onSetAlign: (align: VerticalAlign) => void
}

// Trigger shows the active vertical alignment (bottom, the spreadsheet
// default, when the cell sets none) plus a chevron, as in Sheets.
export function VerticalAlignMenu({ align, disabled, onSetAlign }: VerticalAlignMenuProps) {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')
    const [isOpen, setIsOpen] = useOpenMenu('toolbar:vertical-align')

    const ActiveIcon =
        ALIGN_OPTIONS.find(o => o.value === (align ?? 'bottom'))?.icon ?? AlignVerticalJustifyEnd

    const trigger = (
        <ToolbarButton label="Vertical align" disabled={disabled} width={36}>
            <View className="flex-row items-center" style={{ gap: 2 }}>
                <ActiveIcon size={14} color={fg} />
                <ChevronDown size={10} color={muted} />
            </View>
        </ToolbarButton>
    )

    return (
        <Menu
            isOpen={isOpen}
            onOpenChange={setIsOpen}
            trigger={trigger}
            presentation="popover"
            title="Vertical align"
        >
            <VerticalAlignRows align={align} onSetAlign={onSetAlign} />
        </Menu>
    )
}

/** The alignment rows alone, for a menu that hosts them itself — the toolbar's More submenu. */
export function VerticalAlignRows({
    align,
    onSetAlign,
}: Pick<VerticalAlignMenuProps, 'align' | 'onSetAlign'>) {
    const active = align ?? 'bottom'
    return (
        <>
            {ALIGN_OPTIONS.map(option => (
                <Menu.Item
                    key={option.value}
                    label={option.label}
                    icon={option.icon}
                    isSelected={option.value === active}
                    onSelect={() => onSetAlign(option.value)}
                />
            ))}
        </>
    )
}
