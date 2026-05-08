import { eq } from '@tanstack/db'
import { useQuery } from '@tanstack/react-query'
import { useAuthedFileURL } from '@tinycld/core/file-viewer/use-authed-file-url'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useLocalSearchParams } from 'expo-router'
import { ActivityIndicator, Text, View } from 'react-native'
import { Grid } from '../components/Grid'
import { parseWorkbook, type WorkbookModel } from '../lib/xlsx-adapter'

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
        data: workbook,
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

    if (isItemLoading || !item) {
        return <CenteredMessage label="Loading spreadsheet…" spinner />
    }

    if (isTokenLoading || isParseLoading) {
        return <CenteredMessage label="Opening…" spinner />
    }

    if (parseError) {
        return <CenteredMessage label={`Could not open spreadsheet: ${parseError.message}`} />
    }

    if (!workbook || workbook.sheets.length === 0) {
        return <CenteredMessage label="Spreadsheet is empty." />
    }

    const firstSheet = workbook.sheets[0]

    return (
        <View className="flex-1 bg-background">
            <View className="px-4 py-2 border-b border-border flex-row items-center gap-3">
                <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                    {item.name}
                </Text>
                <Text className="text-xs text-muted-foreground">{firstSheet.name}</Text>
            </View>
            <Grid sheet={firstSheet} />
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
