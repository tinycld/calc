import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { ComponentType, ReactNode } from 'react'
import { forwardRef } from 'react'
import { Pressable, View } from 'react-native'

export interface ToolbarButtonProps {
    icon?: ComponentType<{ size?: number; color?: string }>
    children?: ReactNode
    active?: boolean
    disabled?: boolean
    onPress?: () => void
    label: string
    width?: number
}

// Shared toolbar button. The icon prop is the common case (Lucide
// component); for buttons whose visual is text or a composition (e.g.
// the "123 ▾" format menu trigger), pass `children` instead.
//
// `forwardRef` is required so this can serve as a Menu.Trigger child:
// the trigger reads the wrapper's measured rect via the ref to
// position the popover.
export const ToolbarButton = forwardRef<View, ToolbarButtonProps>(function ToolbarButton(
    { icon: Icon, children, active = false, disabled = false, onPress, label, width = 28 },
    ref
) {
    const fg = useThemeColor('foreground')
    return (
        <Pressable
            ref={ref}
            onPress={onPress}
            disabled={disabled}
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{ disabled, selected: active }}
            className={`items-center justify-center rounded ${active ? 'bg-accent' : ''}`}
            style={{ width, height: 24, marginHorizontal: 1, opacity: disabled ? 0.4 : 1 }}
        >
            {Icon != null ? <Icon size={14} color={fg} /> : children}
        </Pressable>
    )
})

export function ToolbarDivider() {
    return <View className="bg-border" style={{ width: 1, height: 16, marginHorizontal: 4 }} />
}
