import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, useOpenMenu } from '@tinycld/core/ui/menubar'
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    ChevronDown,
    type LucideIcon,
} from 'lucide-react-native'
import { View } from 'react-native'
import type { HorizontalAlign } from '../../hooks/grid/use-grid-format-controls'
import { ToolbarButton } from './ToolbarButton'

const ALIGN_OPTIONS: ReadonlyArray<{
    value: HorizontalAlign
    icon: LucideIcon
    label: string
}> = [
    { value: 'left', icon: AlignLeft, label: 'Align left' },
    { value: 'center', icon: AlignCenter, label: 'Align center' },
    { value: 'right', icon: AlignRight, label: 'Align right' },
]

interface HorizontalAlignMenuProps {
    align: HorizontalAlign | undefined
    disabled: boolean
    onSetAlign: (align: HorizontalAlign) => void
}

// Trigger displays the active alignment's icon (defaulting to "left")
// plus a chevron, matching Google Sheets. Three rows beside the trigger,
// so the menu stays a popover on every breakpoint.
export function HorizontalAlignMenu({ align, disabled, onSetAlign }: HorizontalAlignMenuProps) {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')
    const [isOpen, setIsOpen] = useOpenMenu('toolbar:horizontal-align')

    const active = align ?? 'left'
    const ActiveIcon = ALIGN_OPTIONS.find(o => o.value === active)?.icon ?? AlignLeft

    const trigger = (
        <ToolbarButton label="Horizontal align" disabled={disabled} width={36}>
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
            title="Horizontal align"
        >
            {ALIGN_OPTIONS.map(option => (
                <Menu.Item
                    key={option.value}
                    label={option.label}
                    icon={option.icon}
                    isSelected={option.value === active}
                    onSelect={() => onSetAlign(option.value)}
                />
            ))}
        </Menu>
    )
}
