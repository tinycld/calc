import { Menu } from '@tinycld/core/ui/menu'
import { Pressable, Text } from 'react-native'
import { useOpenMenuStore } from '../../lib/stores/open-menu-store'
import { type MenuBarId, menuBarRegistryId, useOpenMenuBarId } from './menubar-store'

interface MenuBarTriggerProps {
    label: string
    menuId: MenuBarId
}

// MenuBarTrigger is the styled label-only button that opens one of the
// menubar menus. Hovering it while another *menubar* menu is already
// open swaps to this one — that's the Sheets/Excel menubar feel where
// the user runs the pointer along the row and the popovers slide
// along. The hover is no-op when no menubar menu is open (a cold
// cursor passing the row doesn't start opening menus) and also no-op
// when a non-menubar menu — e.g. a toolbar color picker — is open,
// since the user is interacting with a different control.
export function MenuBarTrigger({ label, menuId }: MenuBarTriggerProps) {
    const openMenuBarId = useOpenMenuBarId()
    const open = useOpenMenuStore((s) => s.open)

    const handleHoverIn = () => {
        if (openMenuBarId != null && openMenuBarId !== menuId) {
            open(menuBarRegistryId(menuId))
        }
    }

    return (
        <Menu.Trigger>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                onHoverIn={handleHoverIn}
                className="px-3 h-7 justify-center rounded hover:bg-surface-secondary"
                {...(typeof document !== 'undefined'
                    ? { 'data-calc-menu': 'trigger' }
                    : {})}
            >
                <Text className="text-sm text-foreground">{label}</Text>
            </Pressable>
        </Menu.Trigger>
    )
}
