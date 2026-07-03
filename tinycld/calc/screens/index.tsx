import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { captureException } from '@tinycld/core/lib/errors'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useToastStore } from '@tinycld/core/lib/stores/toast-store'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { NoFilePanel } from '@tinycld/drive/components/NoFilePanel'
import { TemplatePickerDialog } from '@tinycld/drive/components/TemplatePickerDialog'
import { useHasTemplates } from '@tinycld/drive/hooks/use-template-items'
import { useCopyDriveItem } from '@tinycld/drive/lib/copy-drive-item'
import { fromTemplateName, TEMPLATE_EXTENSIONS } from '@tinycld/drive/lib/template-naming'
import { useCreateBlankDriveItem, useCreateDriveItem } from '@tinycld/drive/lib/upload-to-drive'
import { router } from 'expo-router'
import { LayoutTemplate } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { CsvImportDialog } from '../components/CsvImportDialog'
import { useCsvImportStore } from '../lib/csv/import-store'
import { XLSX_MIME_TYPE } from '../types'

export default function CalcIndex() {
    const orgHref = useOrgHref()
    const create = useCreateDriveItem()
    const createBlank = useCreateBlankDriveItem()
    const copyTemplate = useCopyDriveItem()
    const setPendingImport = useCsvImportStore(s => s.set)
    const addToast = useToastStore(s => s.addToast)
    const hasTemplates = useHasTemplates(TEMPLATE_EXTENSIONS.xlsx)
    const [pickedCsv, setPickedCsv] = useState<{ text: string; name: string } | null>(null)
    const [isPickerOpen, setPickerOpen] = useState(false)

    // "New from template" copies a `.tmpl.xlsx` file into a fresh
    // workbook (named after the template minus its `.tmpl` marker) and
    // opens it; the server bootstraps the room from the copied source.
    const handlePickTemplate = useCallback(
        (item: { id: string; name: string }) => {
            copyTemplate.mutate(
                {
                    sourceItemId: item.id,
                    newName: fromTemplateName(item.name, TEMPLATE_EXTENSIONS.xlsx),
                },
                {
                    onSuccess: result => {
                        setPickerOpen(false)
                        router.replace(orgHref('calc/[id]', { id: result.itemId }))
                    },
                }
            )
        },
        [copyTemplate, orgHref]
    )

    const handleCreateNew = useCallback(() => {
        void (async () => {
            const result = await createBlank.mutateAsync({
                name: 'Untitled.xlsx',
                mimeType: XLSX_MIME_TYPE,
            })
            router.replace(orgHref('calc/[id]', { id: result.itemId }))
        })()
    }, [createBlank, orgHref])

    const handleUpload = useCallback(
        (files: File[]) => {
            void handleUploadFiles({
                files,
                createMutation: create.mutateAsync,
                setPickedCsv,
                orgHref,
                addToast,
            })
        },
        [create, orgHref, addToast]
    )

    const handleCsvImportConfirm = useCallback(
        async (rows: string[][]) => {
            const filename = pickedCsv?.name ?? 'imported.csv'
            setPickedCsv(null)
            if (rows.length === 0) return
            const baseName = stripCsvExtension(filename) || 'Imported'
            const result = await createBlank.mutateAsync({
                name: `${baseName}.xlsx`,
                mimeType: XLSX_MIME_TYPE,
            })
            setPendingImport(result.itemId, { rows, mode: 'new-sheet' })
            router.replace(orgHref('calc/[id]', { id: result.itemId }))
        },
        [pickedCsv, createBlank, orgHref, setPendingImport]
    )

    return (
        <>
            <DocumentTitle pkg="Calc" />
            <NoFilePanel
                headline="A fresh sheet."
                sublabel="Where the next idea lands."
                newLabel="New sheet"
                uploadHint=".xlsx, .csv"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onCreateNew={handleCreateNew}
                onUpload={handleUpload}
                isPending={create.isPending || copyTemplate.isPending}
            />
            <View className="absolute right-6 top-6">
                <TemplatePickerTrigger
                    isVisible={hasTemplates}
                    onPress={() => setPickerOpen(true)}
                    disabled={create.isPending || copyTemplate.isPending}
                />
            </View>
            <TemplatePickerDialog
                open={isPickerOpen}
                extension={TEMPLATE_EXTENSIONS.xlsx}
                onClose={() => setPickerOpen(false)}
                onPick={handlePickTemplate}
                isPending={copyTemplate.isPending}
            />
            <CsvImportDialog
                isOpen={pickedCsv != null}
                sourceText={pickedCsv?.text ?? null}
                showTargetChooser={false}
                onCancel={() => setPickedCsv(null)}
                onConfirm={({ rows }) => {
                    void handleCsvImportConfirm(rows)
                }}
            />
        </>
    )
}

interface TemplatePickerTriggerProps {
    isVisible: boolean
    onPress: () => void
    disabled?: boolean
}

// Opens the drive-backed template picker (lists `.tmpl.xlsx` files).
// Positioned top-right, mirroring text's index trigger. Renders nothing
// until the org has at least one template — no point offering "From
// template…" when the picker would only show an empty state.
function TemplatePickerTrigger({ isVisible, onPress, disabled }: TemplatePickerTriggerProps) {
    const foreground = useThemeColor('foreground')
    if (!isVisible) return null
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="From template…"
            onPress={onPress}
            disabled={disabled}
            className="flex-row items-center gap-2 px-3 py-2 rounded-md border border-border bg-background hover:border-foreground/40 disabled:opacity-50"
        >
            <LayoutTemplate size={16} color={foreground} />
            <Text className="text-sm font-medium text-foreground">From template…</Text>
        </Pressable>
    )
}

interface UploadHandlerArgs {
    files: File[]
    createMutation: ReturnType<typeof useCreateDriveItem>['mutateAsync']
    setPickedCsv: (csv: { text: string; name: string } | null) => void
    orgHref: ReturnType<typeof useOrgHref>
    addToast: ReturnType<typeof useToastStore.getState>['addToast']
}

async function handleUploadFiles({
    files,
    createMutation,
    setPickedCsv,
    orgHref,
    addToast,
}: UploadHandlerArgs): Promise<void> {
    const single = files.length === 1
    const csvSingles: File[] = []
    const xlsxFiles: File[] = []
    for (const f of files) {
        if (isCsvLike(f)) csvSingles.push(f)
        else xlsxFiles.push(f)
    }

    if (single && csvSingles.length === 1) {
        const [file] = csvSingles
        if (!file) return
        try {
            const text = await readFileText(file)
            setPickedCsv({ text, name: file.name })
        } catch (err) {
            captureException('calc-upload-read-csv', err, { name: file.name })
            addToast({
                title: 'Could not read CSV',
                body: `${file.name} could not be read.`,
                variant: 'error',
                duration: 6000,
            })
        }
        return
    }

    const createdIds: string[] = []
    const failures: string[] = []
    for (const file of [...xlsxFiles, ...csvSingles]) {
        try {
            const result = await createMutation({
                body: file,
                name: file.name,
                mimeType: file.type || (isCsvLike(file) ? 'text/csv' : XLSX_MIME_TYPE),
            })
            createdIds.push(result.itemId)
        } catch (err) {
            captureException('calc-upload-file', err, { name: file.name })
            failures.push(file.name)
        }
    }

    if (failures.length > 0) {
        addToast({
            title: failures.length === files.length ? 'Upload failed' : 'Some files failed',
            body:
                failures.length === 1
                    ? `${failures[0]} could not be uploaded.`
                    : `${failures.length} files could not be uploaded: ${failures.slice(0, 3).join(', ')}${failures.length > 3 ? '…' : ''}`,
            variant: 'error',
            duration: 8000,
        })
    }

    const [firstId] = createdIds
    if (single && firstId) {
        router.replace(orgHref('calc/[id]', { id: firstId }))
        return
    }
    if (createdIds.length > 0) {
        router.replace(orgHref('drive/recent'))
    }
}

// Reads a picked file's bytes as text. Web's <input type="file"> returns
// a real Blob, so Blob.text() works. NoFilePanel's native picker hands
// us a { uri, name, type } shim cast as File — Blob.text() is undefined
// there, and we have to read via expo-file-system. Branching on
// duck-type rather than Platform.OS keeps tests honest: a unit test that
// constructs a real Blob still hits the web path.
async function readFileText(file: File): Promise<string> {
    if (typeof file.text === 'function') return file.text()
    const uri = (file as unknown as { uri?: string }).uri
    if (!uri) throw new Error('readFileText: picked file has neither .text() nor a uri')
    // SDK 55 moved readAsStringAsync to the `/legacy` entry; the new default
    // export has no such method, so the bare import would read undefined.
    const fs = await import('expo-file-system/legacy')
    const reader = fs as unknown as { readAsStringAsync: (uri: string) => Promise<string> }
    return reader.readAsStringAsync(uri)
}

export function isCsvLike(file: File): boolean {
    const name = file.name.toLowerCase()
    if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) return true
    const type = (file.type || '').toLowerCase()
    return type === 'text/csv' || type === 'text/tab-separated-values' || type === 'text/plain'
}

function stripCsvExtension(name: string): string {
    return name.replace(/\.(csv|tsv|txt)$/i, '')
}
