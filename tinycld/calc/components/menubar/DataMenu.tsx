import { Menu, MenuBarMenu } from '@tinycld/core/ui/menubar'
import type { MenuBarProps } from './MenuBar'

export function DataMenu(props: MenuBarProps) {
    const filterLabel = props.isFilterActive ? 'Remove filter' : 'Create a filter'
    return (
        <MenuBarMenu menuId="data" label="Data">
            <Menu.Item label="Sort range" onSelect={props.onOpenSort} isDisabled={props.disabled} />
            <Menu.Item
                label={filterLabel}
                onSelect={props.onToggleFilter}
                isDisabled={props.disabled}
            />
            <Menu.Separator />
            <Menu.Item label="Named ranges…" onSelect={props.onOpenNamedRanges} />
        </MenuBarMenu>
    )
}
