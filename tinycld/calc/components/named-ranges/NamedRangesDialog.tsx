import { HelpIcon } from '@tinycld/core/components/help/HelpIcon'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { useCallback, useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import type * as Y from 'yjs'
import { useNamedRanges } from '../../hooks/use-named-ranges'
import { useNamedRangesDialogStore } from '../../lib/stores/named-ranges-dialog-store'
import { NamedRangeForm } from './NamedRangeForm'
import { NamedRangesList } from './NamedRangesList'

export interface NamedRangesDialogProps {
    doc: Y.Doc | null
}

// NamedRangesDialog is the workbook's Name Manager. Renders either the
// list of defined names or the create / edit form, switched by the
// dialog store's `mode`. Closes via the backdrop or the X button.
export function NamedRangesDialog({ doc }: NamedRangesDialogProps) {
    const isOpen = useNamedRangesDialogStore(s => s.isOpen)
    const mode = useNamedRangesDialogStore(s => s.mode)
    const editingKey = useNamedRangesDialogStore(s => s.editingKey)
    const prefillName = useNamedRangesDialogStore(s => s.prefillName)
    const prefillExpression = useNamedRangesDialogStore(s => s.prefillExpression)
    const prefillScope = useNamedRangesDialogStore(s => s.prefillScope)
    const close = useNamedRangesDialogStore(s => s.close)
    const goToList = useNamedRangesDialogStore(s => s.goToList)
    const openCreate = useNamedRangesDialogStore(s => s.openCreate)
    const openEdit = useNamedRangesDialogStore(s => s.openEdit)

    const ranges = useNamedRanges(doc)
    const editing = useMemo(() => {
        if (editingKey == null) return null
        return ranges.find(r => r.key === editingKey) ?? null
    }, [editingKey, ranges])

    const title = mode === 'list' ? 'Named ranges' : editing != null ? 'Edit name' : 'Add name'

    const onSaved = useCallback(() => goToList(), [goToList])
    const onCancelForm = useCallback(() => {
        // From edit mode: cancel returns to the list view. If the list
        // is empty (user is creating the very first name), closing the
        // dialog feels more natural — but `goToList` is simpler and
        // matches Excel/Sheets behavior.
        goToList()
    }, [goToList])

    if (!isOpen) return null

    return (
        <Modal isOpen onClose={close}>
            <ModalBackdrop />
            <ModalContent className="w-[560px] p-0 rounded-xl bg-background">
                <View className="px-5 py-4 border-b border-border flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                        <Text className="text-base font-semibold text-foreground">{title}</Text>
                        <HelpIcon topic="calc:named-ranges" />
                    </View>
                    <Pressable
                        onPress={close}
                        accessibilityRole="button"
                        accessibilityLabel="Close"
                        className="px-2"
                    >
                        <Text className="text-foreground">✕</Text>
                    </Pressable>
                </View>
                {mode === 'list' ? (
                    <NamedRangesList doc={doc} onEdit={openEdit} onCreate={() => openCreate()} />
                ) : (
                    <NamedRangeForm
                        doc={doc}
                        initial={editing}
                        prefillName={editing == null ? prefillName : null}
                        prefillExpression={editing == null ? prefillExpression : null}
                        prefillScope={
                            editing == null && prefillScope !== undefined ? prefillScope : null
                        }
                        onSaved={onSaved}
                        onCancel={onCancelForm}
                    />
                )}
            </ModalContent>
        </Modal>
    )
}
