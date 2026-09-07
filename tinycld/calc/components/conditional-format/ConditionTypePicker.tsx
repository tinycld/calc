// Dropdown for the 18 CF condition types. Grouped into Empty / Text /
// Number / Date / Custom-formula sections matching Sheets' selector.
// The trigger button shows the currently selected option's label so
// the user can scan-read the rule editor without expanding the menu.

import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { ChevronDown } from 'lucide-react-native'
import { Fragment } from 'react'
import { Pressable, Text } from 'react-native'
import type { CFConditionType } from '../../lib/conditional-format/types'

interface Group {
    title: string
    options: ReadonlyArray<{ value: CFConditionType; label: string }>
}

const GROUPS: readonly Group[] = [
    {
        title: 'Empty',
        options: [
            { value: 'isEmpty', label: 'Cell is empty' },
            { value: 'isNotEmpty', label: 'Cell is not empty' },
        ],
    },
    {
        title: 'Text',
        options: [
            { value: 'textContains', label: 'Text contains' },
            { value: 'textDoesNotContain', label: 'Text does not contain' },
            { value: 'textStartsWith', label: 'Text starts with' },
            { value: 'textEndsWith', label: 'Text ends with' },
            { value: 'textEquals', label: 'Text is exactly' },
        ],
    },
    {
        title: 'Date',
        options: [
            { value: 'dateIs', label: 'Date is' },
            { value: 'dateBefore', label: 'Date is before' },
            { value: 'dateAfter', label: 'Date is after' },
        ],
    },
    {
        title: 'Number',
        options: [
            { value: 'numberEquals', label: 'Equal to' },
            { value: 'numberNotEquals', label: 'Not equal to' },
            { value: 'numberGreater', label: 'Greater than' },
            { value: 'numberGreaterOrEqual', label: 'Greater than or equal to' },
            { value: 'numberLess', label: 'Less than' },
            { value: 'numberLessOrEqual', label: 'Less than or equal to' },
            { value: 'numberBetween', label: 'Is between' },
            { value: 'numberNotBetween', label: 'Is not between' },
        ],
    },
    {
        title: 'Formula',
        options: [{ value: 'customFormula', label: 'Custom formula is' }],
    },
]

interface ConditionTypePickerProps {
    value: CFConditionType
    onChange: (type: CFConditionType) => void
    disabled?: boolean
}

export function ConditionTypePicker({ value, onChange, disabled }: ConditionTypePickerProps) {
    const muted = useThemeColor('muted-foreground')

    const trigger = (
        <Pressable
            disabled={disabled}
            className="flex-row items-center justify-between rounded border border-border bg-background px-2 py-1.5"
            accessibilityLabel="Choose condition"
        >
            <Text className="text-sm text-foreground" numberOfLines={1}>
                {labelFor(value)}
            </Text>
            <ChevronDown size={14} color={muted} />
        </Pressable>
    )

    return (
        <Menu trigger={trigger} placement="bottom-start" title="Condition">
            <ConditionGroups value={value} onChange={onChange} />
        </Menu>
    )
}

function ConditionGroups({ value, onChange }: Omit<ConditionTypePickerProps, 'disabled'>) {
    return GROUPS.map((group, index) => (
        <Fragment key={group.title}>
            <GroupSeparator isVisible={index > 0} />
            <Menu.Section label={group.title}>
                {group.options.map(opt => (
                    <Menu.Item
                        key={opt.value}
                        label={opt.label}
                        isSelected={opt.value === value}
                        onSelect={() => onChange(opt.value)}
                    />
                ))}
            </Menu.Section>
        </Fragment>
    ))
}

function GroupSeparator({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return <Menu.Separator />
}

function labelFor(value: CFConditionType): string {
    for (const g of GROUPS) {
        for (const o of g.options) {
            if (o.value === value) return o.label
        }
    }
    return value
}
