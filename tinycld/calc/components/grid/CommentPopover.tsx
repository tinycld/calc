import { useAuth } from '@tinycld/core/lib/auth'
import { errorToString } from '@tinycld/core/lib/errors'
import { FormErrorSummary, TextAreaInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { Popover } from '@tinycld/core/ui/popover'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useCommentMutations } from '../../hooks/use-comment-mutations'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import type { CommentRow, Thread } from '../../lib/comments'
import { useCommentsContext } from './CommentsContext'

interface CommentPopoverProps {
    driveItemId: string
    sheetId: string
}

const replySchema = z.object({
    body: z.string().trim().min(1, 'Required').max(4000),
})

type ReplyFormValues = z.infer<typeof replySchema>

const editSchema = z.object({
    body: z.string().trim().min(1, 'Required').max(4000),
})

type EditFormValues = z.infer<typeof editSchema>

// Anchored at the cursor where the user opened the popover (or at the
// cell rect center for the keyboard shortcut path). A comment thread is
// not a list of commands, so it is a Popover rather than a Menu.
export function CommentPopover({ driveItemId, sheetId }: CommentPopoverProps) {
    const target = useGridStore(s => s.commentTarget)
    const store = useGridStoreApi()
    const ctx = useCommentsContext()

    const onClose = useCallback(() => store.getState().closeCommentPopover(), [store])

    const isOpen = target != null
    const anchor = useMemo(
        () => (target ? { x: target.cursor.x, y: target.cursor.y } : undefined),
        [target]
    )

    const handleOpenChange = useCallback(
        (open: boolean) => {
            if (!open) onClose()
        },
        [onClose]
    )

    const threads = target && ctx ? ctx.getThreads(sheetId, target.cell.row, target.cell.col) : []

    return (
        <Popover
            isOpen={isOpen}
            onOpenChange={handleOpenChange}
            anchor={anchor}
            presentation="popover"
            width={320}
            title="Comments"
        >
            <OpenPopoverBody
                target={target}
                driveItemId={driveItemId}
                sheetId={sheetId}
                threads={threads}
                onClose={onClose}
            />
        </Popover>
    )
}

function OpenPopoverBody({
    target,
    ...rest
}: Omit<PopoverBodyProps, 'row' | 'col'> & {
    target: { cell: { row: number; col: number } } | null
}) {
    if (target == null) return null
    return <PopoverBody {...rest} row={target.cell.row} col={target.cell.col} />
}

interface PopoverBodyProps {
    driveItemId: string
    sheetId: string
    row: number
    col: number
    threads: Thread[]
    onClose: () => void
}

function PopoverBody({ driveItemId, sheetId, row, col, threads, onClose }: PopoverBodyProps) {
    const { add, reply, editBody, resolve, reopen, remove } = useCommentMutations()
    const { user } = useAuth()
    const currentUserId = user.id

    // Prefer the most-recent unresolved thread so the "Re-open" path
    // doesn't accidentally reopen the oldest one when multiple resolved
    // threads exist on the cell. Falls back to the most-recent thread
    // overall when nothing is unresolved.
    const activeThread =
        [...threads].reverse().find(t => t.resolvedAt == null) ??
        threads[threads.length - 1] ??
        null
    const isResolved = activeThread != null && activeThread.resolvedAt != null

    const {
        control,
        handleSubmit,
        reset,
        formState: { errors, isSubmitted },
    } = useForm<ReplyFormValues>({
        resolver: zodResolver(replySchema),
        defaultValues: { body: '' },
        mode: 'onChange',
    })

    const onSubmit = handleSubmit(values => {
        if (activeThread == null) {
            add.mutate(
                { driveItemId, sheetId, row, col, body: values.body },
                {
                    onSuccess: () => {
                        reset({ body: '' })
                    },
                }
            )
            return
        }
        reply.mutate(
            {
                driveItemId,
                sheetId,
                row,
                col,
                parentId: activeThread.root.id,
                body: values.body,
            },
            {
                onSuccess: () => {
                    reset({ body: '' })
                },
            }
        )
    })

    const onResolve = useCallback(() => {
        if (activeThread == null) return
        resolve.mutate({ id: activeThread.root.id }, { onSuccess: onClose })
    }, [activeThread, resolve, onClose])

    const onReopen = useCallback(() => {
        if (activeThread == null) return
        reopen.mutate({ id: activeThread.root.id })
    }, [activeThread, reopen])

    const submitError = add.error ?? reply.error
    const submitErrorText = submitError ? errorToString(submitError) : null

    return (
        <View>
            <View className="flex-row items-center justify-between px-3 py-2 border-b border-border">
                <Text className="text-sm font-semibold text-foreground">Comments</Text>
                {activeThread ? (
                    isResolved ? (
                        <Pressable
                            onPress={onReopen}
                            accessibilityLabel="Re-open comment"
                            className="px-2 py-1"
                        >
                            <Text className="text-xs font-semibold text-primary">Re-open</Text>
                        </Pressable>
                    ) : (
                        <Pressable
                            onPress={onResolve}
                            accessibilityLabel="Resolve comment"
                            className="px-2 py-1"
                        >
                            <Text className="text-xs font-semibold text-primary">Resolve</Text>
                        </Pressable>
                    )
                ) : null}
            </View>
            <ScrollView style={{ maxHeight: 320 }}>
                {threads.length === 0 ? (
                    <View className="px-3 py-4">
                        <Text className="text-xs text-muted-foreground">
                            Be the first to comment
                        </Text>
                    </View>
                ) : (
                    threads.map(thread => (
                        <ThreadView
                            key={thread.root.id}
                            thread={thread}
                            currentUserId={currentUserId}
                            onEdit={(id, body) => editBody.mutate({ id, body })}
                            onDelete={id => remove.mutate({ id })}
                        />
                    ))
                )}
            </ScrollView>
            <View className="px-3 py-2 border-t border-border">
                <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
                {submitErrorText ? (
                    <Text className="text-xs text-danger mb-2">{submitErrorText}</Text>
                ) : null}
                <TextAreaInput
                    control={control}
                    name="body"
                    placeholder={activeThread ? 'Reply…' : 'Add a comment…'}
                    autoFocus
                    numberOfLines={3}
                />
                <View className="flex-row justify-end gap-2 mt-2">
                    <Pressable
                        onPress={onClose}
                        accessibilityLabel="Cancel comment"
                        className="px-3 py-1.5 rounded-md"
                    >
                        <Text className="text-xs font-semibold text-muted-foreground">Cancel</Text>
                    </Pressable>
                    <Pressable
                        onPress={onSubmit}
                        accessibilityLabel="Post comment"
                        className="px-3 py-1.5 rounded-md bg-primary"
                        disabled={add.isPending || reply.isPending}
                        style={{ opacity: add.isPending || reply.isPending ? 0.6 : 1 }}
                    >
                        <Text className="text-xs font-semibold text-primary-foreground">
                            {activeThread ? 'Reply' : 'Comment'}
                        </Text>
                    </Pressable>
                </View>
            </View>
        </View>
    )
}

interface ThreadViewProps {
    thread: Thread
    currentUserId: string
    onEdit: (id: string, body: string) => void
    onDelete: (id: string) => void
}

function ThreadView({ thread, currentUserId, onEdit, onDelete }: ThreadViewProps) {
    const dim = thread.resolvedAt != null
    return (
        <View className={`px-3 py-2 ${dim ? 'opacity-60' : ''}`}>
            <CommentLine
                comment={thread.root}
                isOwn={thread.root.author === currentUserId}
                onEdit={onEdit}
                onDelete={onDelete}
            />
            {thread.replies.map(reply => (
                <View key={reply.id} className="mt-2 ml-2">
                    <CommentLine
                        comment={reply}
                        isOwn={reply.author === currentUserId}
                        onEdit={onEdit}
                        onDelete={onDelete}
                    />
                </View>
            ))}
            {thread.resolvedAt != null && (
                <Text className="text-xs text-muted-foreground italic mt-1">
                    Resolved {formatTimestamp(thread.resolvedAt)}
                </Text>
            )}
        </View>
    )
}

interface CommentLineProps {
    comment: CommentRow
    isOwn: boolean
    onEdit: (id: string, body: string) => void
    onDelete: (id: string) => void
}

function CommentLine({ comment, isOwn, onEdit, onDelete }: CommentLineProps) {
    const [editing, setEditing] = useState(false)
    const { control, handleSubmit, reset } = useForm<EditFormValues>({
        resolver: zodResolver(editSchema),
        defaultValues: { body: comment.body },
        mode: 'onChange',
    })

    const onSave = handleSubmit(values => {
        onEdit(comment.id, values.body)
        setEditing(false)
    })

    const onCancel = useCallback(() => {
        reset({ body: comment.body })
        setEditing(false)
    }, [reset, comment.body])

    if (editing) {
        return (
            <View>
                <TextAreaInput control={control} name="body" autoFocus numberOfLines={2} />
                <View className="flex-row justify-end gap-2">
                    <Pressable
                        onPress={onCancel}
                        accessibilityLabel="Cancel edit"
                        className="px-2 py-1"
                    >
                        <Text className="text-xs font-semibold text-muted-foreground">Cancel</Text>
                    </Pressable>
                    <Pressable
                        onPress={onSave}
                        accessibilityLabel="Save edit"
                        className="px-2 py-1"
                    >
                        <Text className="text-xs font-semibold text-primary">Save</Text>
                    </Pressable>
                </View>
            </View>
        )
    }

    return (
        <View>
            <View className="flex-row items-baseline gap-2">
                <Text className="text-xs font-semibold text-foreground">{comment.author_name}</Text>
                <Text className="text-xs text-muted-foreground">
                    {formatTimestamp(comment.created)}
                </Text>
                {isOwn ? (
                    <View className="flex-row gap-2 ml-auto">
                        <Pressable
                            onPress={() => setEditing(true)}
                            accessibilityLabel="Edit comment"
                        >
                            <Text className="text-xs text-muted-foreground">Edit</Text>
                        </Pressable>
                        <Pressable
                            onPress={() => onDelete(comment.id)}
                            accessibilityLabel="Delete comment"
                        >
                            <Text className="text-xs text-danger">Delete</Text>
                        </Pressable>
                    </View>
                ) : null}
            </View>
            <Text className="text-sm text-foreground mt-0.5">{comment.body}</Text>
        </View>
    )
}

function formatTimestamp(iso: string): string {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString()
}
