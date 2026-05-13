import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { useFormulaFunctionNames } from '../../hooks/use-formula-function-names'
import { useMenuDialogsStore } from '../../hooks/use-menu-dialogs-store'

// FunctionListDialog renders the registered HyperFormula function
// names so users can browse the available formulas. The list is just
// names (no descriptions) — that's all `useFormulaFunctionNames`
// surfaces today; richer entries can grow this without changing the
// menu wiring.
export function FunctionListDialog() {
    const isOpen = useMenuDialogsStore(s => s.isFunctionListOpen)
    const close = useMenuDialogsStore(s => s.closeFunctionList)
    const names = useFormulaFunctionNames()

    if (!isOpen) return null
    return (
        <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={close}
            accessibilityLabel="Function list"
        >
            <View
                accessibilityRole="dialog"
                accessibilityLabel="Function list"
                className="flex-1 items-center justify-center bg-black/50"
            >
                <View
                    className="w-[500px] max-h-[80vh] bg-background rounded-lg border border-border"
                    style={{ padding: 16 }}
                >
                    <Text className="text-lg font-semibold text-foreground mb-2">
                        Function list
                    </Text>
                    <ScrollView>
                        {names.map(name => (
                            <Text
                                key={name}
                                className="text-sm text-foreground font-mono py-0.5"
                            >
                                {name}
                            </Text>
                        ))}
                    </ScrollView>
                    <Pressable
                        onPress={close}
                        accessibilityRole="button"
                        accessibilityLabel="Close function list"
                        className="mt-3 self-end px-3 py-1 rounded bg-surface-secondary"
                    >
                        <Text className="text-sm text-foreground">Close</Text>
                    </Pressable>
                </View>
            </View>
        </Modal>
    )
}
