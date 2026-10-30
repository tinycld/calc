import { Dialog } from '@tinycld/core/ui/dialog'
import { Controller, FormErrorSummary, useForm, zodResolver } from '@tinycld/core/ui/form'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useRef } from 'react'
import type { TextInputInstance } from 'react-native'
import { Text, View } from 'react-native'
import type * as Y from 'yjs'
import type { SelectedCell } from '../../hooks/grid-store'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import { setYCellLink, useYCell } from '../../hooks/use-y-cell'
import { linkUrlSchema } from './link-url-schema'

interface LinkDialogProps {
    doc: Y.Doc | null
    sheetId: string
}

// LinkDialog adds, changes or removes the link on one cell. It opens
// from the toolbar's Link button and from the link chip's Edit action;
// an empty URL removes the link.
export function LinkDialog({ doc, sheetId }: LinkDialogProps) {
    const target = useGridStore(s => s.linkTarget)
    if (target == null || doc == null) return null
    // Keyed on the cell so each open seeds the form from that cell.
    return (
        <LinkDialogForm
            key={`${target.row}:${target.col}`}
            doc={doc}
            sheetId={sheetId}
            target={target}
        />
    )
}

interface LinkDialogFormProps {
    doc: Y.Doc
    sheetId: string
    target: SelectedCell
}

function LinkDialogForm({ doc, sheetId, target }: LinkDialogFormProps) {
    const { close, control, errors, isSubmitted, onSubmit, title } = useLinkDialogForm(
        doc,
        sheetId,
        target
    )
    // The dialog focuses this on open; an input's own autoFocus fires
    // before the dialog's surface is in the page and is lost.
    const inputRef = useRef<TextInputInstance>(null)
    return (
        <Dialog
            isOpen
            onClose={close}
            title={title}
            size="md"
            testID="calc-link-dialog"
            initialFocusRef={inputRef}
        >
            <Dialog.Body contentClassName="px-5 pb-3 gap-2">
                <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
                <Text className="text-sm font-semibold text-foreground">Link</Text>
                <View className="flex-row border border-border rounded-lg px-3 py-2.5">
                    <Controller
                        control={control}
                        name="url"
                        render={({ field }) => (
                            <PlainInput
                                ref={inputRef}
                                value={field.value}
                                onChangeText={field.onChange}
                                onBlur={field.onBlur}
                                placeholder="https://example.com"
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="url"
                                onSubmitEditing={onSubmit}
                                accessibilityLabel="Link"
                                testID="calc-link-url"
                                className="flex-1 text-foreground"
                            />
                        )}
                    />
                </View>
            </Dialog.Body>
            <Dialog.Footer>
                <Dialog.CancelButton onPress={close} />
                <Dialog.ActionButton label="Apply" onPress={onSubmit} />
            </Dialog.Footer>
        </Dialog>
    )
}

function useLinkDialogForm(doc: Y.Doc, sheetId: string, target: SelectedCell) {
    const store = useGridStoreApi()
    const cell = useYCell(doc, sheetId, target.row, target.col)
    const {
        control,
        handleSubmit,
        formState: { errors, isSubmitted },
    } = useForm({
        resolver: zodResolver(linkUrlSchema),
        defaultValues: { url: cell?.link ?? '' },
    })
    const close = () => store.getState().closeLinkDialog()
    const onSubmit = handleSubmit(({ url }) => {
        setYCellLink(doc, sheetId, target.row, target.col, url === '' ? null : url)
        close()
    })
    const title = cell?.link == null ? 'Insert link' : 'Edit link'
    return { close, control, errors, isSubmitted, onSubmit, title }
}
