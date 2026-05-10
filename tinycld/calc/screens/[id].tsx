import { eq } from '@tanstack/db'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { CommentsProvider } from '../components/grid/CommentsContext'
import { Grid } from '../components/Grid'
import { SheetTabs } from '../components/SheetTabs'
import { useCellComments } from '../hooks/use-cell-comments'
import { useFormulaBridge } from '../hooks/use-formula-bridge'
import { useRealtime } from '../hooks/use-realtime'
import { useUndoManager } from '../hooks/use-undo-manager'
import { useWorkbook, WorkbookProvider } from '../hooks/use-workbook-context'
import { useYSheets } from '../hooks/use-y-sheets'

export default function CalcDetail() {
    const { id, sheet: sheetParam } = useLocalSearchParams<{ id: string; sheet?: string }>()
    const [driveItems] = useStore('drive_items')

    const { data: items = [], isLoading: isItemLoading } = useOrgLiveQuery(
        (query, { orgId }) =>
            query
                .from({ item: driveItems })
                .where(({ item }) => eq(item.org, orgId))
                .where(({ item }) => eq(item.id, id ?? '')),
        [id]
    )

    const item = items[0]

    // Open the realtime room as soon as we have a workbook id. The
    // server populates the doc from the source .xlsx before the first
    // SyncReply arrives, so the client never needs the file source.
    const room = useRealtime({ workbookId: item?.id ?? '' })

    if (isItemLoading || !item) {
        return <CenteredMessage label="Loading spreadsheet…" spinner />
    }

    if (room == null || !room.isReady) {
        return <CenteredMessage label="Opening…" spinner />
    }

    return (
        <WorkbookProvider
            doc={room.doc}
            awareness={room.awareness}
            isReady={room.isReady}
            isConnected={room.isConnected}
        >
            <DetailContent itemName={item.name} workbookId={item.id} sheetParam={sheetParam} />
        </WorkbookProvider>
    )
}

interface DetailContentProps {
    itemName: string
    workbookId: string
    sheetParam: string | undefined
}

function DetailContent({ itemName, workbookId, sheetParam }: DetailContentProps) {
    const { doc, isConnected } = useWorkbook()
    const undoState = useUndoManager(doc)
    useFormulaBridge(doc)
    const sheets = useYSheets(doc)
    const orgHref = useOrgHref()
    const comments = useCellComments(workbookId)

    // Resolve the active sheet from the URL query, falling back to the
    // first sheet when the param is missing or stale (peer-renamed,
    // future delete). Don't write the fallback to the URL — only
    // explicit clicks update it (otherwise every workbook URL would
    // get dirtied on first load).
    const activeSheet = sheets.find(s => s.id === sheetParam) ?? sheets[0] ?? null

    const onSelect = useCallback(
        (nextSheetId: string) => {
            router.replace(orgHref('calc/[id]', { id: workbookId, sheet: nextSheetId }))
        },
        [orgHref, workbookId]
    )

    if (activeSheet == null) {
        return <CenteredMessage label="Spreadsheet is empty." />
    }

    return (
        <CommentsProvider value={comments}>
            <View className="flex-1 bg-background">
                <View className="px-4 py-2 border-b border-border flex-row items-center gap-3">
                    <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                        {itemName}
                    </Text>
                    <ConnectionStatus isConnected={isConnected} />
                </View>
                <Grid sheetId={activeSheet.id} driveItemId={workbookId} undoState={undoState} />
                <SheetTabs sheets={sheets} activeSheetId={activeSheet.id} onSelect={onSelect} />
            </View>
        </CommentsProvider>
    )
}

interface CenteredMessageProps {
    label: string
    spinner?: boolean
}

function CenteredMessage({ label, spinner }: CenteredMessageProps) {
    return (
        <View className="flex-1 items-center justify-center gap-3 bg-background">
            {spinner ? <ActivityIndicator /> : null}
            <Text className="text-sm text-muted-foreground">{label}</Text>
        </View>
    )
}

function ConnectionStatus({ isConnected }: { isConnected: boolean }) {
    if (isConnected) return null
    return (
        <View className="flex-row items-center gap-1">
            <ActivityIndicator size="small" />
            <Text className="text-xs text-muted-foreground">Reconnecting…</Text>
        </View>
    )
}
