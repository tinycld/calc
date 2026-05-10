import { Menu, Separator } from '@tinycld/core/ui/menu'
import { Merge } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { Platform, Pressable, StyleSheet } from 'react-native'
import { ToolbarButton } from './ToolbarButton'

interface MergeMenuProps {
    disabled: boolean
    onMergeAll: () => void
    onMergeHorizontal: () => void
    onMergeVertical: () => void
    onUnmerge: () => void
}

export function MergeMenu({
    disabled,
    onMergeAll,
    onMergeHorizontal,
    onMergeVertical,
    onUnmerge,
}: MergeMenuProps) {
    const [isOpen, setIsOpen] = useState(false)
    const close = useCallback(() => setIsOpen(false), [])

    const choose = useCallback(
        (fn: () => void) => () => {
            fn()
            close()
        },
        [close]
    )

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <Menu.Trigger>
                <ToolbarButton label="Merge cells" icon={Merge} disabled={disabled} />
            </Menu.Trigger>
            <Menu.Portal>
                {Platform.OS !== 'web' && (
                    <Pressable style={StyleSheet.absoluteFill} onPress={close} />
                )}
                <Menu.Content placement="bottom" align="start">
                    <Menu.Item onPress={choose(onMergeAll)}>
                        <Menu.ItemTitle>Merge all</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={choose(onMergeHorizontal)}>
                        <Menu.ItemTitle>Merge horizontally</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={choose(onMergeVertical)}>
                        <Menu.ItemTitle>Merge vertically</Menu.ItemTitle>
                    </Menu.Item>
                    <Separator className="my-1 mx-2" />
                    <Menu.Item onPress={choose(onUnmerge)}>
                        <Menu.ItemTitle>Unmerge</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
