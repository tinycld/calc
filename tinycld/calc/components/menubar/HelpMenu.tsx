import { Menu } from '@tinycld/core/ui/menu'
import type { MenuBarProps } from './MenuBar'
import { MenuBarTrigger } from './MenuBarTrigger'

export function HelpMenu(_props: MenuBarProps) {
    return (
        <Menu>
            <MenuBarTrigger label="Help" />
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    {null}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
