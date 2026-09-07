import { Dialog } from '@tinycld/core/ui/dialog'
import { FormErrorSummary, TextInput, useForm, zodResolver } from '@tinycld/core/ui/form'
import { useEffect } from 'react'
import { type NewPivotFormValues, newPivotSchema } from './new-pivot-dialog-helpers'

export interface NewPivotDialogProps {
    visible: boolean
    defaultSourceRange: string
    defaultTargetSheetName: string
    onCancel: () => void
    onCreate: (args: NewPivotFormValues) => void
}

// NewPivotDialog is the modal surface for the toolbar's "Pivot table"
// button. The two text fields (source range + target sheet name) are
// pre-filled from the current selection and active sheet, and validated
// via the newPivotSchema in new-pivot-dialog-helpers.ts. On submit we
// hand the parsed/trimmed values to the caller — sheet creation, doc
// write, and panel-open all live in PivotInsertButton so this component
// stays a pure form/UI shell.
//
// The caller controls visibility; the form re-syncs its defaults whenever
// the dialog becomes visible so re-opening lands on the most recent
// selection.
export function NewPivotDialog({
    visible,
    defaultSourceRange,
    defaultTargetSheetName,
    onCancel,
    onCreate,
}: NewPivotDialogProps) {
    const {
        control,
        handleSubmit,
        reset,
        formState: { errors, isSubmitted, isValid },
    } = useForm<NewPivotFormValues>({
        resolver: zodResolver(newPivotSchema),
        defaultValues: {
            sourceRange: defaultSourceRange,
            targetSheetName: defaultTargetSheetName,
        },
        mode: 'onChange',
    })

    // When the dialog re-opens, refresh the defaults so the user gets
    // the current selection/sheet rather than whatever was sitting in
    // the form from the previous open. `reset` re-seeds defaults and
    // clears the dirty/submitted state in one call.
    useEffect(() => {
        if (!visible) return
        reset({
            sourceRange: defaultSourceRange,
            targetSheetName: defaultTargetSheetName,
        })
    }, [visible, defaultSourceRange, defaultTargetSheetName, reset])

    const onSubmit = handleSubmit(values => {
        onCreate({
            sourceRange: values.sourceRange.trim(),
            targetSheetName: values.targetSheetName.trim(),
        })
    })

    return (
        <Dialog
            isOpen={visible}
            onClose={onCancel}
            title="Insert pivot table"
            size="md"
            testID="new-pivot-dialog"
        >
            <Dialog.Body>
                <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
                <TextInput
                    control={control}
                    name="sourceRange"
                    label="Source range"
                    placeholder="Sheet1!A1:E100"
                    hint="The data range to summarize."
                    autoFocus
                    autoCapitalize="none"
                />
                <TextInput
                    control={control}
                    name="targetSheetName"
                    label="New sheet name"
                    hint="The pivot output will live on this sheet."
                />
            </Dialog.Body>
            <Dialog.Footer>
                <Dialog.CancelButton onPress={onCancel} />
                <Dialog.ActionButton
                    label="Create pivot table"
                    onPress={onSubmit}
                    isDisabled={!isValid}
                    testID="create-pivot-table"
                />
            </Dialog.Footer>
        </Dialog>
    )
}
