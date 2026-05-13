import { Menu, Separator } from '@tinycld/core/ui/menu'
import type { MenuBarProps } from './MenuBar'
import { MenuBarTrigger } from './MenuBarTrigger'
import { MenuShortcut } from './MenuShortcut'

export function EditMenu(props: MenuBarProps) {
    return (
        <Menu>
            <MenuBarTrigger label="Edit" />
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <Menu.Item onPress={props.onUndo} isDisabled={!props.canUndo}>
                        <Menu.ItemTitle>Undo</Menu.ItemTitle>
                        <MenuShortcut keys="⌘Z" />
                    </Menu.Item>
                    <Menu.Item onPress={props.onRedo} isDisabled={!props.canRedo}>
                        <Menu.ItemTitle>Redo</Menu.ItemTitle>
                        <MenuShortcut keys="⌘Y" />
                    </Menu.Item>
                    <Separator />
                    <Menu.Item onPress={props.onCut} isDisabled={props.disabled}>
                        <Menu.ItemTitle>Cut</Menu.ItemTitle>
                        <MenuShortcut keys="⌘X" />
                    </Menu.Item>
                    <Menu.Item onPress={props.onCopy} isDisabled={props.disabled}>
                        <Menu.ItemTitle>Copy</Menu.ItemTitle>
                        <MenuShortcut keys="⌘C" />
                    </Menu.Item>
                    <Menu.Item onPress={props.onPaste} isDisabled={props.disabled}>
                        <Menu.ItemTitle>Paste</Menu.ItemTitle>
                        <MenuShortcut keys="⌘V" />
                    </Menu.Item>
                    <Menu.Sub>
                        <Menu.SubTrigger>
                            <Menu.ItemTitle>Paste special</Menu.ItemTitle>
                        </Menu.SubTrigger>
                        <Menu.SubContent>
                            <Menu.Item onPress={props.onPasteValues} isDisabled={props.disabled}>
                                <Menu.ItemTitle>Values only</Menu.ItemTitle>
                                <MenuShortcut keys="⌘⇧V" />
                            </Menu.Item>
                            <Menu.Item onPress={props.onPasteFormat} isDisabled={props.disabled}>
                                <Menu.ItemTitle>Format only</Menu.ItemTitle>
                                <MenuShortcut keys="⌘⌥V" />
                            </Menu.Item>
                        </Menu.SubContent>
                    </Menu.Sub>
                    <Separator />
                    <Menu.Item onPress={props.onOpenFindReplace}>
                        <Menu.ItemTitle>Find and replace</Menu.ItemTitle>
                        <MenuShortcut keys="⌘⇧H" />
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
