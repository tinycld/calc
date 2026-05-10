import { Platform } from 'react-native'

// downloadCsv triggers a "save file" UX for the given CSV text, branching
// per platform:
//
//   Web: build a Blob, allocate an object URL, click a synthetic anchor
//   tag with the `download` attribute. Releases the URL after the click.
//
//   Native (iOS/Android): write the text to a temporary file via
//   expo-file-system, then hand the URI to expo-sharing's share sheet.
//   On platforms where sharing isn't available (rare), throws — callers
//   that want softer behavior should catch.
//
// The function is async so the native branch can await the file write
// before resolving. Web returns immediately after the click.

export async function downloadCsv(filename: string, text: string): Promise<void> {
    if (Platform.OS === 'web') {
        downloadCsvWeb(filename, text)
        return
    }
    await downloadCsvNative(filename, text)
}

function downloadCsvWeb(filename: string, text: string): void {
    if (typeof document === 'undefined') return
    // Prepend a UTF-8 BOM so Excel on Windows opens UTF-8 CSVs correctly
    // (without the BOM it falls back to the system codepage and mangles
    // non-ASCII characters). Other tools tolerate the BOM.
    const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Defer revocation a tick so Firefox's download dialog has time to
    // read the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function downloadCsvNative(filename: string, text: string): Promise<void> {
    const fs = await import('expo-file-system')
    const sharing = await import('expo-sharing')
    // Cast through unknown — the legacy/modern split in expo-file-system
    // surfaces slightly different field shapes per release.
    const fileSystem = fs as unknown as {
        cacheDirectory?: string | null
        documentDirectory?: string | null
        writeAsStringAsync: (uri: string, contents: string, options?: unknown) => Promise<void>
    }
    const dir = fileSystem.cacheDirectory ?? fileSystem.documentDirectory
    if (dir == null) throw new Error('downloadCsv: no writable directory available')
    const uri = `${dir}${filename}`
    await fileSystem.writeAsStringAsync(uri, text)
    const share = sharing as unknown as {
        isAvailableAsync: () => Promise<boolean>
        shareAsync: (uri: string, options?: { mimeType?: string }) => Promise<void>
    }
    const available = await share.isAvailableAsync()
    if (!available) throw new Error('downloadCsv: sharing not available on this device')
    await share.shareAsync(uri, { mimeType: 'text/csv' })
}
