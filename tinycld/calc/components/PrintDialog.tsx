import {
    FormErrorSummary,
    useForm,
    zodResolver,
} from '@tinycld/core/ui/form'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { useCallback, useMemo } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type * as Y from 'yjs'
import { useYSheets } from '../hooks/use-y-sheets'
import { handlePrint } from '../lib/print/handle-print'
import { renderPrintHtml } from '../lib/print/render-print-html'
import {
    type PrintSelection,
    snapshotForPrint,
} from '../lib/print/snapshot'
import {
    DEFAULT_PRINT_CONFIG,
    type PrintConfig,
    printConfigSchema,
} from '../lib/print/types'
import { PrintLayoutFields } from './print/PrintLayoutFields'
import { PrintPageFields } from './print/PrintPageFields'
import { PrintScopeFields } from './print/PrintScopeFields'

export interface PrintDialogProps {
    isOpen: boolean
    onClose: () => void
    doc: Y.Doc
    currentSheetId: string
    currentSelection: PrintSelection | null
}

// PrintDialog opens from the toolbar's PrintButton. It captures a fresh
// PrintConfig via React Hook Form, snapshots the live Y.Doc at submit
// time, renders the HTML once, and hands it off to the platform's
// print path (handle-print). The dialog stays open while the print
// flow runs — on web the print container + window.print() happens in
// front of it; on native the system print sheet covers it.
export function PrintDialog({
    isOpen,
    onClose,
    doc,
    currentSheetId,
    currentSelection,
}: PrintDialogProps) {
    const sheets = useYSheets(doc)
    const sheetList = useMemo(
        () => sheets.map(s => ({ id: s.id, name: s.name })),
        [sheets],
    )
    const selectionAvailable =
        currentSelection != null && currentSelection.sheetId === currentSheetId

    const {
        control,
        handleSubmit,
        watch,
        formState: { errors, isSubmitted, isSubmitting },
    } = useForm<PrintConfig>({
        resolver: zodResolver(printConfigSchema),
        defaultValues: DEFAULT_PRINT_CONFIG,
        mode: 'onChange',
    })

    const scopeValue = watch('scope.sheets')

    const submitDisabled =
        typeof scopeValue === 'object' && scopeValue.ids.length === 0

    const onSubmit = useCallback(
        async (config: PrintConfig) => {
            const snapshot = snapshotForPrint(doc, {
                sheetsScope: config.scope.sheets,
                currentSheetId,
                range: config.scope.range,
                currentSelection,
            })
            const html = renderPrintHtml(snapshot, config)
            await handlePrint(html)
            onClose()
        },
        [doc, currentSheetId, currentSelection, onClose],
    )

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalBackdrop />
            <ModalContent className="w-[520px] max-h-[640px] p-0 rounded-xl bg-background">
                <View className="px-5 pt-4 pb-3 border-b border-border">
                    <Text className="text-base font-semibold text-foreground">
                        Print
                    </Text>
                </View>
                <ScrollView
                    className="px-5 py-4"
                    style={{ maxHeight: 480 }}
                >
                    <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
                    <View style={{ gap: 16 }}>
                        <PrintScopeFields
                            control={control}
                            sheets={sheetList}
                            selectionAvailable={selectionAvailable}
                        />
                        <PrintPageFields control={control} />
                        <PrintLayoutFields control={control} />
                    </View>
                </ScrollView>
                <View
                    className="flex-row justify-end px-5 py-3 border-t border-border"
                    style={{ gap: 8 }}
                >
                    <Pressable
                        onPress={onClose}
                        accessibilityRole="button"
                        className="px-3 py-2 rounded-md border border-border bg-background"
                    >
                        <Text className="text-sm text-foreground">Cancel</Text>
                    </Pressable>
                    <Pressable
                        onPress={handleSubmit(onSubmit)}
                        disabled={submitDisabled || isSubmitting}
                        accessibilityRole="button"
                        className="px-3 py-2 rounded-md bg-accent disabled:opacity-50"
                    >
                        <Text className="text-sm text-accent-foreground">
                            Print
                        </Text>
                    </Pressable>
                </View>
            </ModalContent>
        </Modal>
    )
}
