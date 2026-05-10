import { eq } from '@tanstack/db'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useCreateDriveItem } from '@tinycld/drive/lib/upload-to-drive'
import { router } from 'expo-router'
import { FilePlus2, FileSpreadsheet } from 'lucide-react-native'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { blankWorkbookBlob } from '../lib/blank-workbook'
import { XLSX_MIME_TYPE } from '../types'

export default function CalcIndex() {
    const orgHref = useOrgHref()
    const [driveItems] = useStore('drive_items')
    const create = useCreateDriveItem()

    const { data: items = [] } = useOrgLiveQuery((query, { orgId }) =>
        query
            .from({ item: driveItems })
            .where(({ item }) => eq(item.org, orgId))
            .where(({ item }) => eq(item.mime_type, XLSX_MIME_TYPE))
            .where(({ item }) => eq(item.is_folder, false))
            .orderBy(({ item }) => item.updated, 'desc')
    )

    const handleNew = async () => {
        const result = await create.mutateAsync({
            body: blankWorkbookBlob(),
            name: 'Untitled.xlsx',
            mimeType: XLSX_MIME_TYPE,
        })
        router.push(orgHref('calc/[id]', { id: result.itemId }))
    }

    const isEmpty = items.length === 0

    return (
        <ScrollView className="flex-1 bg-background">
            <View className="p-6 gap-4">
                <View className="flex-row items-center justify-between">
                    <Text
                        accessibilityRole="header"
                        aria-level={2}
                        className="text-2xl font-semibold text-foreground"
                    >
                        Calc
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="New spreadsheet"
                        onPress={handleNew}
                        disabled={create.isPending}
                        className="flex-row items-center gap-2 px-3 py-2 rounded-md bg-accent"
                    >
                        <FilePlus2 size={16} color="white" />
                        <Text className="text-sm font-medium text-accent-foreground">
                            {create.isPending ? 'Creating…' : 'New spreadsheet'}
                        </Text>
                    </Pressable>
                </View>

                <EmptyState isVisible={isEmpty && !create.isPending} />

                <View className="gap-1">
                    {items.map(item => (
                        <WorkbookRow key={item.id} item={item} />
                    ))}
                </View>
            </View>
        </ScrollView>
    )
}

interface EmptyStateProps {
    isVisible: boolean
}

function EmptyState({ isVisible }: EmptyStateProps) {
    if (!isVisible) return null
    return (
        <View className="py-12 items-center gap-2">
            <FileSpreadsheet size={32} color="#888" />
            <Text className="text-sm text-muted-foreground">No spreadsheets yet</Text>
            <Text className="text-xs text-muted-foreground">Create one to get started.</Text>
        </View>
    )
}

interface WorkbookRowProps {
    item: { id: string; name: string; updated: string; size: number }
}

function WorkbookRow({ item }: WorkbookRowProps) {
    const orgHref = useOrgHref()
    return (
        <Pressable
            onPress={() => router.push(orgHref('calc/[id]', { id: item.id }))}
            className="flex-row items-center gap-3 px-3 py-2 rounded-md hover:bg-surface-secondary"
        >
            <FileSpreadsheet size={20} color="#22a06b" />
            <View className="flex-1">
                <Text className="text-sm text-foreground" numberOfLines={1}>
                    {item.name}
                </Text>
                <Text className="text-xs text-muted-foreground">{formatUpdated(item.updated)}</Text>
            </View>
        </Pressable>
    )
}

function formatUpdated(iso: string): string {
    if (!iso) return ''
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleDateString()
}
