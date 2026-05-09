import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Text, View } from 'react-native'

// Sidebar for the Calc package. Rendered in the workspace drawer
// when a user is on any /a/<orgSlug>/calc/... route.
//
// Replace with real navigation (folders, favorites, filters, etc). See
// @tinycld/calendar or @tinycld/mail sidebars for richer examples.

export default function CalcSidebar() {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')

    return (
        <View className="p-3 gap-2">
            <Text style={{ color: fg, fontSize: 14, fontWeight: '600' }}>Calc</Text>
            <Text style={{ color: muted, fontSize: 12 }}>Replace this with your package's sidebar nav.</Text>
        </View>
    )
}
