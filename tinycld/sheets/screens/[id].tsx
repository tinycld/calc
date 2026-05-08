import { eq } from '@tanstack/db'
import { useQuery } from '@tanstack/react-query'
import { useAuthedFileURL } from '@tinycld/core/file-viewer/use-authed-file-url'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Grid } from '../components/Grid'
import { parseWorkbook, type WorkbookModel } from '../lib/xlsx-adapter'
import { useWorkbookStore } from '../stores/workbook-store'

export default function SheetsDetail() {
    const { id } = useLocalSearchParams<{ id: string }>()
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

    const source = item
        ? {
              collectionId: 'drive_items',
              recordId: item.id,
              fileName: item.file,
              displayName: item.name,
              mimeType: item.mime_type,
              size: item.size,
          }
        : undefined

    const { url, isLoading: isTokenLoading } = useAuthedFileURL(source)

    const {
        data: parsedWorkbook,
        isLoading: isParseLoading,
        error: parseError,
    } = useQuery<WorkbookModel>({
        queryKey: ['sheets', 'workbook', item?.id, item?.file],
        queryFn: async () => {
            const resp = await fetch(url)
            if (!resp.ok) throw new Error(`Could not download spreadsheet (${resp.status})`)
            const buffer = await resp.arrayBuffer()
            return parseWorkbook(buffer)
        },
        enabled: !!url,
    })

    // Seed the editable workbook store the first time the parsed model
    // arrives. Re-seeding on subsequent fetches would clobber unsaved
    // edits — only seed if we haven't already.
    const setWorkbook = useWorkbookStore((s) => s.setWorkbook)
    const discardWorkbook = useWorkbookStore((s) => s.discardWorkbook)
    const hasWorkbook = useWorkbookStore((s) => (item?.id ? s.workbooks[item.id] != null : false))

    useEffect(() => {
        if (parsedWorkbook && item?.id && !hasWorkbook) {
            setWorkbook(item.id, parsedWorkbook)
        }
    }, [parsedWorkbook, item?.id, hasWorkbook, setWorkbook])

    useEffect(() => {
        const sheetId = item?.id
        if (!sheetId) return
        return () => discardWorkbook(sheetId)
    }, [item?.id, discardWorkbook])

    const firstSheetName = useWorkbookStore((s) => (item?.id ? (s.workbooks[item.id]?.sheets[0]?.name ?? null) : null))

    if (isItemLoading || !item) {
        return <CenteredMessage label="Loading spreadsheet…" spinner />
    }

    if (isTokenLoading || isParseLoading || !hasWorkbook) {
        return <CenteredMessage label="Opening…" spinner />
    }

    if (parseError) {
        return <CenteredMessage label={`Could not open spreadsheet: ${parseError.message}`} />
    }

    if (firstSheetName == null) {
        return <CenteredMessage label="Spreadsheet is empty." />
    }

    return (
        <View className="flex-1 bg-background">
            <View className="px-4 py-2 border-b border-border flex-row items-center gap-3">
                <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                    {item.name}
                </Text>
                <Text className="text-xs text-muted-foreground">{firstSheetName}</Text>
            </View>
            <Grid workbookId={item.id} sheetIndex={0} />
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
