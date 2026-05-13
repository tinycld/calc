import { Menu } from '@tinycld/core/ui/menu'
import { Linking } from 'react-native'
import type { MenuBarProps } from './MenuBar'
import { MenuBarTrigger } from './MenuBarTrigger'
import { MenuShortcut } from './MenuShortcut'

const DOCS_URL = 'https://tinycld.org/docs'

function openDocs() {
    void Linking.openURL(DOCS_URL)
}

export function HelpMenu(props: MenuBarProps) {
    return (
        <Menu>
            <MenuBarTrigger label="Help" />
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <Menu.Item onPress={openDocs}>
                        <Menu.ItemTitle>Documentation</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={props.onOpenFunctionList}>
                        <Menu.ItemTitle>Function list</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={props.onOpenKeyboardShortcuts}>
                        <Menu.ItemTitle>Keyboard shortcuts</Menu.ItemTitle>
                        <MenuShortcut keys="⌘/" />
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
