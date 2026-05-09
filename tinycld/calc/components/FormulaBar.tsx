import { useCallback } from 'react'
import { Text, TextInput, View } from 'react-native'

interface FormulaBarProps {
    cellLabel: string | null
    value: string
    disabled: boolean
    onChange: (next: string) => void
    onCommit: () => void
    onCancel: () => void
}

// FormulaBar is a controlled input. The Grid owns the value (either the
// committed cell display, or the in-progress edit-session draft) and
// hands it down here; this component just renders + dispatches.
//
// "Always editing the selected cell" is the spreadsheet convention —
// any keystroke here implicitly opens an edit session in the Grid via
// onChange. There is no separate enter-edit-mode step for the formula
// bar, so it behaves the same way Excel/Sheets do.
export function FormulaBar({ cellLabel, value, disabled, onChange, onCommit, onCancel }: FormulaBarProps) {
    const onKeyPress = useCallback(
        (e: { nativeEvent: { key?: string } }) => {
            // RN-Web surfaces Escape via onKeyPress; the in-cell editor
            // does the same trick (see Grid.tsx CellEditor).
            const key = e.nativeEvent.key
            if (key === 'Escape') onCancel()
        },
        [onCancel]
    )

    return (
        <View
            className="flex-row items-center bg-background border-b border-border"
            style={{ height: 28, paddingHorizontal: 4 }}
        >
            <View
                className="bg-surface-secondary border border-border items-center justify-center rounded"
                style={{ width: 56, height: 22, marginRight: 6 }}
            >
                <Text className="text-xs text-muted-foreground" style={{ fontFamily: 'monospace' }}>
                    {cellLabel ?? ''}
                </Text>
            </View>
            <TextInput
                value={value}
                editable={!disabled}
                onChangeText={onChange}
                onSubmitEditing={onCommit}
                onBlur={onCommit}
                onKeyPress={onKeyPress}
                accessibilityLabel="Formula bar"
                style={{ flex: 1, height: 22, fontSize: 12, paddingHorizontal: 4 }}
                className="text-foreground"
            />
        </View>
    )
}
