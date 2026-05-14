import { useMemo } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { type CalcShortcutDoc, getCalcShortcutDocs } from '../../hooks/use-calc-shortcuts'
import { useMenuDialogsStore } from '../../hooks/use-menu-dialogs-store'
import { displayKeys } from './display-keys'

function groupShortcuts(docs: readonly CalcShortcutDoc[]): Map<string, CalcShortcutDoc[]> {
    const groups = new Map<string, CalcShortcutDoc[]>()
    for (const s of docs) {
        const key = s.group
        const arr = groups.get(key) ?? []
        arr.push(s)
        groups.set(key, arr)
    }
    return groups
}

// KeyboardShortcutsDialog renders the Calc shortcut catalog grouped
// by group label, with descriptions on the left and keyboard glyphs
// on the right. Data comes from `getCalcShortcutDocs`, which derives
// from the same SHORTCUT_DOCS list buildCalcShortcuts registers — no
// hand-maintained second array, no drift possible.
export function KeyboardShortcutsDialog() {
    const isOpen = useMenuDialogsStore(s => s.isKeyboardShortcutsOpen)
    const close = useMenuDialogsStore(s => s.closeKeyboardShortcuts)
    const grouped = useMemo(() => groupShortcuts(getCalcShortcutDocs()), [])

    if (!isOpen) return null
    return (
        <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={close}
            accessibilityLabel="Keyboard shortcuts"
        >
            <View
                accessibilityLabel="Keyboard shortcuts"
                className="flex-1 items-center justify-center bg-black/50"
                {...(typeof document !== 'undefined'
                    ? { role: 'dialog', 'aria-label': 'Keyboard shortcuts' }
                    : {})}
            >
                <View
                    className="w-[600px] max-h-[80vh] bg-background rounded-lg border border-border"
                    style={{ padding: 16 }}
                >
                    <Text className="text-lg font-semibold text-foreground mb-2">
                        Keyboard shortcuts
                    </Text>
                    <ScrollView>
                        {Array.from(grouped.entries()).map(([groupLabel, items]) => (
                            <View key={groupLabel} className="mb-3">
                                <Text className="text-xs uppercase text-muted-foreground mb-1">
                                    {groupLabel}
                                </Text>
                                {items.map(s => (
                                    <View
                                        key={s.id}
                                        className="flex-row items-center justify-between py-1"
                                    >
                                        <Text className="text-sm text-foreground">
                                            {s.description}
                                        </Text>
                                        <Text className="text-xs text-muted-foreground font-mono">
                                            {displayKeys(s.keys)}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        ))}
                    </ScrollView>
                    <Pressable
                        onPress={close}
                        accessibilityRole="button"
                        accessibilityLabel="Close keyboard shortcuts"
                        className="mt-3 self-end px-3 py-1 rounded bg-surface-secondary"
                    >
                        <Text className="text-sm text-foreground">Close</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    )
}
