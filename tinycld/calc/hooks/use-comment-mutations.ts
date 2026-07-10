import { useBaseCommentMutations } from '@tinycld/core/lib/comments'
import { useEditorMount } from '@tinycld/core/lib/editor/editor-mount'
import { useStore } from '@tinycld/core/lib/pocketbase'
import type { CalcComments } from '../types'

export interface AddCommentArgs {
    driveItemId: string
    sheetId: string
    row: number
    col: number
    body: string
}

export interface ReplyArgs extends AddCommentArgs {
    parentId: string
}

// Calc-side comment mutations. Closes over the calc_comments collection
// and shapes the insert with the cell anchor (sheet_id / row / col).
// Wired with the shared comment_mentions collection so any
// `[[@user_org_id]]` token in the body yields a notify-triggering row
// alongside the comment insert.
export function useCommentMutations() {
    const [calcCommentsCollection, commentMentionsCollection] = useStore(
        'calc_comments',
        'comment_mentions'
    )
    const { identity } = useEditorMount()

    return useBaseCommentMutations<
        Omit<CalcComments, 'created' | 'updated'>,
        AddCommentArgs,
        ReplyArgs
    >({
        insertRow: row => calcCommentsCollection.insert(row),
        updateRow: (id, mutator) => calcCommentsCollection.update(id, mutator),
        deleteRow: id => calcCommentsCollection.delete(id),
        buildInsert: (base, args) => ({
            ...base,
            sheet_id: args.sheetId,
            row: args.row,
            col: args.col,
        }),
        mentions: {
            commentCollection: 'calc_comments',
            insertMention: row => commentMentionsCollection.insert(row),
        },
        // commentor+ roles always have userOrgId; author_name resolves from
        // displayName so email is unused here.
        identity: {
            userOrgId: identity.userOrgId ?? '',
            displayName: identity.displayName,
            email: '',
        },
    })
}
