import { type Control, Controller } from '@tinycld/core/ui/form'
import { Pressable, Text, View } from 'react-native'
import type { PrintConfig } from '../../lib/print/types'

interface PrintScopeFieldsProps {
    control: Control<PrintConfig>
    sheets: Array<{ id: string; name: string }>
    selectionAvailable: boolean
}

// Sheet picker + range picker for the print dialog. The "current
// selection" radio auto-disables when the parent reports no usable
// selection (no selection at all, or selection on a different sheet
// than the one being printed).
export function PrintScopeFields({
    control,
    sheets,
    selectionAvailable,
}: PrintScopeFieldsProps) {
    return (
        <View style={{ gap: 12 }}>
            <View>
                <Text className="text-sm font-medium text-foreground mb-2">Sheets</Text>
                <Controller
                    control={control}
                    name="scope.sheets"
                    render={({ field }) => (
                        <View style={{ gap: 6 }}>
                            <RadioRow
                                label="Current sheet"
                                checked={field.value === 'current'}
                                onPress={() => field.onChange('current')}
                            />
                            <RadioRow
                                label="All sheets"
                                checked={field.value === 'all'}
                                onPress={() => field.onChange('all')}
                            />
                            <RadioRow
                                label={`Pick specific (${sheets.length})`}
                                checked={typeof field.value === 'object'}
                                onPress={() =>
                                    field.onChange({
                                        ids:
                                            typeof field.value === 'object'
                                                ? field.value.ids
                                                : sheets.length > 0
                                                  ? [sheets[0].id]
                                                  : [],
                                    })
                                }
                            />
                            {typeof field.value === 'object' ? (
                                <View style={{ paddingLeft: 24, gap: 4 }}>
                                    {sheets.map(s => {
                                        const checked = field.value.ids.includes(s.id)
                                        return (
                                            <CheckboxRow
                                                key={s.id}
                                                label={s.name}
                                                checked={checked}
                                                onPress={() => {
                                                    const next = checked
                                                        ? field.value.ids.filter(
                                                              id => id !== s.id,
                                                          )
                                                        : [...field.value.ids, s.id]
                                                    field.onChange({ ids: next })
                                                }}
                                            />
                                        )
                                    })}
                                </View>
                            ) : null}
                        </View>
                    )}
                />
            </View>
            <View>
                <Text className="text-sm font-medium text-foreground mb-2">Range</Text>
                <Controller
                    control={control}
                    name="scope.range"
                    render={({ field }) => (
                        <View style={{ gap: 6 }}>
                            <RadioRow
                                label="Used range"
                                checked={field.value === 'used'}
                                onPress={() => field.onChange('used')}
                            />
                            <RadioRow
                                label="Current selection"
                                checked={field.value === 'selection'}
                                disabled={!selectionAvailable}
                                onPress={() => field.onChange('selection')}
                            />
                        </View>
                    )}
                />
            </View>
        </View>
    )
}

interface RowProps {
    label: string
    checked: boolean
    disabled?: boolean
    onPress: () => void
}

function RadioRow({ label, checked, disabled, onPress }: RowProps) {
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ checked, disabled: !!disabled }}
            className={`flex-row items-center ${disabled ? 'opacity-50' : ''}`}
        >
            <View
                className={`w-4 h-4 rounded-full border ${
                    checked ? 'bg-accent border-accent' : 'border-border'
                }`}
            />
            <Text className="ml-2 text-sm text-foreground">{label}</Text>
        </Pressable>
    )
}

function CheckboxRow({ label, checked, onPress }: RowProps) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            className="flex-row items-center"
        >
            <View
                className={`w-4 h-4 border ${
                    checked ? 'bg-accent border-accent' : 'border-border'
                }`}
            />
            <Text className="ml-2 text-sm text-foreground">{label}</Text>
        </Pressable>
    )
}
