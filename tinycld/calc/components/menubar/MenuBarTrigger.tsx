import { Menu } from '@tinycld/core/ui/menu'
import { Pressable, Text } from 'react-native'

interface MenuBarTriggerProps {
    label: string
}

export function MenuBarTrigger({ label }: MenuBarTriggerProps) {
    return (
        <Menu.Trigger>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={label}
                className="px-3 h-7 justify-center rounded hover:bg-surface-secondary"
            >
                <Text className="text-sm text-foreground">{label}</Text>
            </Pressable>
        </Menu.Trigger>
    )
}
