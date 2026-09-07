import { Menu, MenuBarMenu } from '@tinycld/core/ui/menubar'
import type { MenuBarProps } from './MenuBar'

export function EditMenu(props: MenuBarProps) {
    return (
        <MenuBarMenu menuId="edit" label="Edit">
            <Menu.Item
                label="Undo"
                shortcut="⌘Z"
                onSelect={props.onUndo}
                isDisabled={!props.canUndo}
            />
            <Menu.Item
                label="Redo"
                shortcut="⌘Y"
                onSelect={props.onRedo}
                isDisabled={!props.canRedo}
            />
            <Menu.Separator />
            <Menu.Item
                label="Cut"
                shortcut="⌘X"
                onSelect={props.onCut}
                isDisabled={props.disabled}
            />
            <Menu.Item
                label="Copy"
                shortcut="⌘C"
                onSelect={props.onCopy}
                isDisabled={props.disabled}
            />
            <Menu.Item
                label="Paste"
                shortcut="⌘V"
                onSelect={props.onPaste}
                isDisabled={props.disabled}
            />
            <Menu.Sub label="Paste special">
                <Menu.Item
                    label="Values only"
                    shortcut="⌘⌥V"
                    onSelect={props.onPasteValues}
                    isDisabled={props.disabled}
                />
                <Menu.Item
                    label="Format only"
                    shortcut="⌘⇧V"
                    onSelect={props.onPasteFormat}
                    isDisabled={props.disabled}
                />
            </Menu.Sub>
            <Menu.Separator />
            <Menu.Item label="Find and replace" shortcut="⌘⇧H" onSelect={props.onOpenFindReplace} />
        </MenuBarMenu>
    )
}
