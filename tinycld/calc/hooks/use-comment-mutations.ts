import { useAuth } from '@tinycld/core/lib/auth'
import { useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { newRecordId } from 'pbtsdb/core'

export interface AddCommentArgs {
    driveItemId: string
    sheetId: string
    row: number
    col: number
    body: string
}

export interface ReplyArgs {
    driveItemId: string
    sheetId: string
    row: number
    col: number
    parentId: string
    body: string
}

// Wraps the basic CRUD over calc_comments rows. Each mutation is a
// generator-based useMutation so the underlying pbtsdb Transaction is
// awaited before the consumer's onSuccess fires (matches the pattern in
// useUserPreference / contacts/screens/new). Author identity is read
// once at hook level — we snapshot author_name into the row so a
// removed user still renders something on future reads.
export function useCommentMutations() {
    const [calcCommentsCollection] = useStore('calc_comments')
    const { user } = useAuth()
    const { userOrgId } = useCurrentRole()

    // The migration declares author_name required (max 200). An empty
    // user.name would otherwise produce a silent PB validation error
    // (the popover surfaces it now via mutation.error, but we'd rather
    // post under a recognizable label than reject the post outright).
    const authorName = user.name || user.email || 'Anonymous'

    const add = useMutation({
        mutationFn: function* (args: AddCommentArgs) {
            yield calcCommentsCollection.insert({
                id: newRecordId(),
                drive_item: args.driveItemId,
                sheet_id: args.sheetId,
                row: args.row,
                col: args.col,
                parent_comment: '',
                body: args.body,
                resolved_at: '',
                author: userOrgId,
                author_name: authorName,
            })
        },
    })

    const reply = useMutation({
        mutationFn: function* (args: ReplyArgs) {
            yield calcCommentsCollection.insert({
                id: newRecordId(),
                drive_item: args.driveItemId,
                sheet_id: args.sheetId,
                row: args.row,
                col: args.col,
                parent_comment: args.parentId,
                body: args.body,
                resolved_at: '',
                author: userOrgId,
                author_name: authorName,
            })
        },
    })

    const editBody = useMutation({
        mutationFn: function* (args: { id: string; body: string }) {
            yield calcCommentsCollection.update(args.id, draft => {
                draft.body = args.body
            })
        },
    })

    const resolve = useMutation({
        mutationFn: function* (args: { id: string }) {
            yield calcCommentsCollection.update(args.id, draft => {
                draft.resolved_at = new Date().toISOString()
            })
        },
    })

    const reopen = useMutation({
        mutationFn: function* (args: { id: string }) {
            yield calcCommentsCollection.update(args.id, draft => {
                draft.resolved_at = ''
            })
        },
    })

    const remove = useMutation({
        mutationFn: function* (args: { id: string }) {
            yield calcCommentsCollection.delete(args.id)
        },
    })

    return { add, reply, editBody, resolve, reopen, remove }
}
