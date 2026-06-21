// SDK 55 moved the URI-string file API (writeAsStringAsync, cacheDirectory) to
// the `/legacy` entry; the bare import's new File/Directory API has no
// cacheDirectory string, so it would throw "no writable directory available".
import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

// downloadCsv (native) writes the CSV text to a file in the platform's
// cache directory via expo-file-system, then hands the URI to
// expo-sharing's share sheet. On iOS the user gets the system share
// sheet (Save to Files, AirDrop, Mail, etc.); on Android they get the
// system intent picker.
//
// On platforms where sharing isn't available (rare — emulator quirks,
// stripped builds) the file is still on disk but the user has no way
// to extract it, so we log the path as a developer aid and return
// without throwing.

// Cast through unknown — the legacy/modern split in expo-file-system
// surfaces slightly different field shapes per release.
const fileSystem = FileSystem as unknown as {
    cacheDirectory?: string | null
    documentDirectory?: string | null
    writeAsStringAsync: (uri: string, contents: string, options?: unknown) => Promise<void>
}
const sharing = Sharing as unknown as {
    isAvailableAsync: () => Promise<boolean>
    shareAsync: (
        uri: string,
        options?: { mimeType?: string; dialogTitle?: string; UTI?: string }
    ) => Promise<void>
}

export async function downloadCsv(filename: string, text: string): Promise<void> {
    const dir = fileSystem.cacheDirectory ?? fileSystem.documentDirectory
    if (dir == null) throw new Error('downloadCsv: no writable directory available')
    const safeName = filename.replace(/[/\\]/g, '_')
    const uri = `${dir}${safeName}`
    await fileSystem.writeAsStringAsync(uri, text)
    if (!(await sharing.isAvailableAsync())) {
        return
    }
    await sharing.shareAsync(uri, {
        mimeType: 'text/csv',
        dialogTitle: 'Save CSV',
        UTI: 'public.comma-separated-values-text',
    })
}
