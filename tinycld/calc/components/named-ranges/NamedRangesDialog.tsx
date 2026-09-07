import { HelpIcon } from '@tinycld/core/components/help/HelpIcon'
import { Dialog } from '@tinycld/core/ui/dialog'
import { useCallback, useMemo } from 'react'
import { View } from 'react-native'
import type * as Y from 'yjs'
import { type NamedRangeEntry, useNamedRanges } from '../../hooks/use-named-ranges'
import type { NamedRangeKey } from '../../lib/named-ranges/types'
import { useNamedRangesDialogStore } from '../../lib/stores/named-ranges-dialog-store'
import { NamedRangeForm } from './NamedRangeForm'
import { NamedRangesList } from './NamedRangesList'

export interface NamedRangesDialogProps {
    doc: Y.Doc | null
}

// NamedRangesDialog is the workbook's Name Manager. Renders either the
// list of defined names or the create / edit form, switched by the
// dialog store's `mode`.
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

    return (
        <Dialog
            isOpen={isOpen}
            onClose={close}
            title={title}
            size="xl"
            testID="named-ranges-dialog"
        >
            <View className="px-5 pb-1 flex-row">
                <HelpIcon topic="calc:named-ranges" />
            </View>
            <Dialog.Body contentClassName="pb-2">
                <NamedRangesContent
                    mode={mode}
                    doc={doc}
                    editing={editing}
                    prefillName={prefillName}
                    prefillExpression={prefillExpression}
                    prefillScope={prefillScope}
                    onEdit={openEdit}
                    onCreate={() => openCreate()}
                    onSaved={onSaved}
                    onCancelForm={onCancelForm}
                />
            </Dialog.Body>
        </Dialog>
    )
}

interface NamedRangesContentProps {
    mode: 'list' | 'edit'
    doc: Y.Doc | null
    editing: NamedRangeEntry | null
    prefillName: string | null
    prefillExpression: string | null
    prefillScope: string | null | undefined
    onEdit: (key: NamedRangeKey) => void
    onCreate: () => void
    onSaved: () => void
    onCancelForm: () => void
}

function NamedRangesContent({
    mode,
    doc,
    editing,
    prefillName,
    prefillExpression,
    prefillScope,
    onEdit,
    onCreate,
    onSaved,
    onCancelForm,
}: NamedRangesContentProps) {
    if (mode === 'list') return <NamedRangesList doc={doc} onEdit={onEdit} onCreate={onCreate} />
    return (
        <NamedRangeForm
            doc={doc}
            initial={editing}
            prefillName={editing == null ? prefillName : null}
            prefillExpression={editing == null ? prefillExpression : null}
            prefillScope={editing == null && prefillScope !== undefined ? prefillScope : null}
            onSaved={onSaved}
            onCancel={onCancelForm}
        />
    )
}
