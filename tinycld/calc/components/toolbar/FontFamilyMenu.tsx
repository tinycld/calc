import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, useOpenMenu } from '@tinycld/core/ui/menubar'
import { ChevronDown } from 'lucide-react-native'
import { Platform, Text, View } from 'react-native'
import { FONT_FAMILIES, resolveFontFamily } from '../../lib/font-family'
import { ToolbarButton } from './ToolbarButton'

interface FontFamilyMenuProps {
    family: string | undefined
    disabled: boolean
    onSetFamily: (family: string) => void
}

// A cell with no font, in a workbook with no default font, draws in the
// app's default font, which is not one of the listed families, so the
// trigger says "Default" for it. `family` already carries the workbook
// default when the file sets one.
const DEFAULT_LABEL = 'Default'

// Trigger shows the selected cell's font name plus a chevron, as in
// Sheets.
export function FontFamilyMenu({ family, disabled, onSetFamily }: FontFamilyMenuProps) {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')
    const [isOpen, setIsOpen] = useOpenMenu('toolbar:font-family')

    const trigger = (
        <ToolbarButton label="Font" disabled={disabled} width={112}>
            <View className="flex-row items-center justify-between" style={{ gap: 4, width: 96 }}>
                <Text numberOfLines={1} style={{ fontSize: 12, color: fg, flexShrink: 1 }}>
                    {family ?? DEFAULT_LABEL}
                </Text>
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
            title="Font"
        >
            <FontFamilyRows family={family} onSetFamily={onSetFamily} />
        </Menu>
    )
}

/** The font rows alone, for a menu that hosts them itself — the toolbar's More submenu. */
export function FontFamilyRows({
    family,
    onSetFamily,
}: Pick<FontFamilyMenuProps, 'family' | 'onSetFamily'>) {
    return (
        <>
            {FONT_FAMILIES.map(name => (
                <Menu.Item
                    key={name}
                    label={name}
                    isSelected={name === family}
                    onSelect={() => onSetFamily(name)}
                    leading={<FontSample family={name} />}
                />
            ))}
        </>
    )
}

// FontSample previews each family in its own font beside its name.
function FontSample({ family }: { family: string }) {
    const fg = useThemeColor('foreground')
    return (
        <Text
            style={{ fontFamily: resolveFontFamily(family, Platform.OS), fontSize: 13, color: fg }}
        >
            Aa
        </Text>
    )
}
