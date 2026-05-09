import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Bold, Italic } from 'lucide-react-native'
import type { ComponentType } from 'react'
import { Pressable, View } from 'react-native'

interface ToolbarProps {
    disabled: boolean
    isBold: boolean
    isItalic: boolean
    onToggleBold: () => void
    onToggleItalic: () => void
}

export function Toolbar({ disabled, isBold, isItalic, onToggleBold, onToggleItalic }: ToolbarProps) {
    return (
        <View
            className="flex-row items-center bg-surface-secondary border-b border-border"
            style={{ height: 32, paddingHorizontal: 4 }}
        >
            <ToolbarButton icon={Bold} active={isBold} disabled={disabled} onPress={onToggleBold} label="Bold" />
            <ToolbarButton
                icon={Italic}
                active={isItalic}
                disabled={disabled}
                onPress={onToggleItalic}
                label="Italic"
            />
        </View>
    )
}

interface ToolbarButtonProps {
    icon: ComponentType<{ size?: number; color?: string }>
    active: boolean
    disabled: boolean
    onPress: () => void
    label: string
}

function ToolbarButton({ icon: Icon, active, disabled, onPress, label }: ToolbarButtonProps) {
    // useThemeColor (not className) — Lucide icons take a literal `color`
    // string prop.
    const fg = useThemeColor('foreground')
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{ disabled, selected: active }}
            className={`items-center justify-center rounded ${active ? 'bg-accent' : ''}`}
            style={{ width: 28, height: 24, marginHorizontal: 1, opacity: disabled ? 0.4 : 1 }}
        >
            <Icon size={14} color={fg} />
        </Pressable>
    )
}
