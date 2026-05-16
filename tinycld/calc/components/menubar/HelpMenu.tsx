import { Menu, MenuBarMenu, MenuShortcut } from '@tinycld/core/ui/menubar'
import { Linking, Platform } from 'react-native'
import type { MenuBarProps } from './MenuBar'

const DOCS_URL = 'https://tinycld.org/docs'

function openDocs() {
    void Linking.openURL(DOCS_URL)
}

export function HelpMenu(props: MenuBarProps) {
    return (
        <MenuBarMenu menuId="help" label="Help">
            <Menu.Item onPress={openDocs}>
                <Menu.ItemTitle>Documentation</Menu.ItemTitle>
            </Menu.Item>
            <Menu.Item onPress={props.onOpenFunctionList}>
                <Menu.ItemTitle>Function list</Menu.ItemTitle>
            </Menu.Item>
            {Platform.OS === 'web' && (
                <Menu.Item onPress={props.onOpenKeyboardShortcuts}>
                    <Menu.ItemTitle>Keyboard shortcuts</Menu.ItemTitle>
                    <MenuShortcut keys="⌘/" />
                </Menu.Item>
            )}
        </MenuBarMenu>
    )
}
