import { Menu } from '@tinycld/core/ui/menu'
import type { MenuBarProps } from './MenuBar'
import { MenuBarTrigger } from './MenuBarTrigger'

export function DataMenu(props: MenuBarProps) {
    return (
        <Menu>
            <MenuBarTrigger label="Data" />
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <Menu.Item onPress={props.onOpenSort} isDisabled={props.disabled}>
                        <Menu.ItemTitle>Sort range</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={props.onToggleFilter} isDisabled={props.disabled}>
                        <Menu.ItemTitle>
                            {props.isFilterActive ? 'Remove filter' : 'Create a filter'}
                        </Menu.ItemTitle>
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
