import { NoFilePanel } from '@tinycld/core/components/NoFilePanel'
import { captureException } from '@tinycld/core/lib/errors'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useToastStore } from '@tinycld/core/lib/stores/toast-store'
import { useCreateDriveItem } from '@tinycld/drive/lib/upload-to-drive'
import { router } from 'expo-router'
import { useCallback, useState } from 'react'
import { CsvImportDialog } from '../components/CsvImportDialog'
import { blankWorkbookBlob } from '../lib/blank-workbook'
import { useCsvImportStore } from '../lib/csv/import-store'
import { XLSX_MIME_TYPE } from '../types'

export default function CalcIndex() {
    const orgHref = useOrgHref()
    const create = useCreateDriveItem()
    const setPendingImport = useCsvImportStore(s => s.set)
    const addToast = useToastStore(s => s.addToast)
    const [pickedCsv, setPickedCsv] = useState<{ text: string; name: string } | null>(null)

    const handleCreateNew = useCallback(() => {
        void (async () => {
            const result = await create.mutateAsync({
                body: blankWorkbookBlob(),
                name: 'Untitled.xlsx',
                mimeType: XLSX_MIME_TYPE,
            })
            router.replace(orgHref('calc/[id]', { id: result.itemId }))
        })()
    }, [create, orgHref])

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
            const result = await create.mutateAsync({
                body: blankWorkbookBlob(),
                name: `${baseName}.xlsx`,
                mimeType: XLSX_MIME_TYPE,
            })
            setPendingImport(result.itemId, { rows, mode: 'new-sheet' })
            router.replace(orgHref('calc/[id]', { id: result.itemId }))
        },
        [pickedCsv, create, orgHref, setPendingImport]
    )

    return (
        <>
            <NoFilePanel
                kind="calc"
                onCreateNew={handleCreateNew}
                onUpload={handleUpload}
                isPending={create.isPending}
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
    const fs = await import('expo-file-system')
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
