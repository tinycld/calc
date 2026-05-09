import { eq } from '@tanstack/db'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useMemo } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Grid } from '../components/Grid'
import { SheetTabs } from '../components/SheetTabs'
import { useRealtime } from '../hooks/use-realtime'
import { useUndoManager } from '../hooks/use-undo-manager'
import { useWorkbook, WorkbookProvider } from '../hooks/use-workbook-context'
import { useYSheets } from '../hooks/use-y-sheets'

export default function SheetsDetail() {
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

    // Memoize so the bootstrap closure inside useRealtime sees a
    // stable reference; useRealtime re-reads via ref on demand.
    const source = useMemo(() => {
        if (!item) return null
        return {
            collectionId: 'drive_items',
            recordId: item.id,
            fileName: item.file,
            displayName: item.name,
            mimeType: item.mime_type,
            size: item.size,
        }
    }, [item])

    // Open the realtime room as soon as we have a workbook id. The
    // file source is used only on first-joiner bootstrap; subsequent
    // joiners get the doc from existing peers and ignore it.
    const room = useRealtime({ workbookId: item?.id ?? '', source })

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
    useUndoManager(doc)
    const sheets = useYSheets(doc)
    const orgHref = useOrgHref()

    // Resolve the active sheet from the URL query, falling back to the
    // first sheet when the param is missing or stale (peer-renamed,
    // future delete). Don't write the fallback to the URL — only
    // explicit clicks update it (otherwise every workbook URL would
    // get dirtied on first load).
    const activeSheet = sheets.find((s) => s.id === sheetParam) ?? sheets[0] ?? null

    const onSelect = useCallback(
        (nextSheetId: string) => {
            router.replace(orgHref('sheets/[id]', { id: workbookId, sheet: nextSheetId }))
        },
        [orgHref, workbookId]
    )

    if (activeSheet == null) {
        return <CenteredMessage label="Spreadsheet is empty." />
    }

    return (
        <View className="flex-1 bg-background">
            <View className="px-4 py-2 border-b border-border flex-row items-center gap-3">
                <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                    {itemName}
                </Text>
                <ConnectionStatus isConnected={isConnected} />
            </View>
            <Grid sheetId={activeSheet.id} />
            <SheetTabs sheets={sheets} activeSheetId={activeSheet.id} onSelect={onSelect} />
        </View>
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
