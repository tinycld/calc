import { Menu } from '@tinycld/core/ui/menu'
import { Pressable, Text } from 'react-native'
import { type MenuBarId, useMenuBarStore } from './menubar-store'

interface MenuBarTriggerProps {
    label: string
    menuId: MenuBarId
}

// MenuBarTrigger is the styled label-only button that opens one of the
// menubar menus. Hovering it while another menu is already open swaps
// to this one — that's the Sheets/Excel menubar feel where the user
// runs the pointer along the row and the popovers slide along. The
// hover is no-op when no menu is open, so a cold cursor passing the
// row doesn't start opening menus.
export function MenuBarTrigger({ label, menuId }: MenuBarTriggerProps) {
    const openMenuId = useMenuBarStore(s => s.openMenuId)
    const open = useMenuBarStore(s => s.open)

    const handleHoverIn = () => {
        if (openMenuId != null && openMenuId !== menuId) {
            open(menuId)
        }
    }

    return (
        <Menu.Trigger>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                onHoverIn={handleHoverIn}
                className="px-3 h-7 justify-center rounded hover:bg-surface-secondary"
            >
                <Text className="text-sm text-foreground">{label}</Text>
            </Pressable>
        </Menu.Trigger>
    )
}
