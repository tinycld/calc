import { Menu } from '@tinycld/core/ui/menu'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { MenuBarTrigger } from './MenuBarTrigger'
import { type MenuBarId, useMenuBarStore } from './menubar-store'

interface MenuBarMenuProps {
    menuId: MenuBarId
    label: string
    children: ReactNode
}

// MenuBarMenu binds one top-level menu to the shared menubar store.
// All six menus consume the same controlled state so that:
//   1. Clicking another trigger while one is open swaps cleanly
//      (Menu.Trigger fires onOpenChange(true) for the new menu;
//      our setter implicitly closes whatever was open before).
//   2. Hovering another trigger while one is open swaps without
//      clicking (see MenuBarTrigger's onHoverIn).
//   3. A document-level outside-click handler in MenuBar can close
//      the active menu without each menu rendering its own
//      Menu.Overlay (which would intercept clicks on sibling
//      triggers and break the swap behavior).
//
// The data-menubar="content" wrapper marks Menu.Content's portaled
// subtree as "part of the menubar", so the document handler in
// MenuBar can recognise clicks that should NOT close (e.g. clicking
// a Menu.Item or a Menu.SubTrigger inside the popover).
export function MenuBarMenu({ menuId, label, children }: MenuBarMenuProps) {
    const isOpen = useMenuBarStore(s => s.openMenuId === menuId)
    const open = useMenuBarStore(s => s.open)
    const close = useMenuBarStore(s => s.close)

    return (
        <Menu isOpen={isOpen} onOpenChange={next => (next ? open(menuId) : close())}>
            <MenuBarTrigger label={label} menuId={menuId} />
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <View
                        {...(typeof document !== 'undefined'
                            ? { 'data-menubar': 'content' }
                            : {})}
                    >
                        {children}
                    </View>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
