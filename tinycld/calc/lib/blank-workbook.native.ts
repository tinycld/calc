// Native materialization of the embedded blank-workbook bytes. React
// Native's Blob implementation throws "Creating blobs from 'ArrayBuffer'
// and 'ArrayBufferView' are not supported" (BlobManager.createFromParts),
// so we can't hand useCreateDriveItem an in-memory Blob the way web does.
// Instead we write the base64 straight to a cache-directory file (no
// decode needed — expo-file-system writes base64 natively) and return
// the documented native UploadBody shape `{ uri, name, type }`, which
// RN's FormData polyfill turns into the multipart file part.

import type { UploadBody } from '@tinycld/drive/lib/upload-to-drive'
// SDK 55 moved the URI-string file API (writeAsStringAsync, cacheDirectory,
// EncodingType) to the `/legacy` entry; the new File/Directory API is a
// different shape with no cacheDirectory string, so the bare import returns
// undefined for it and this throws "no writable directory available". The
// legacy surface is exactly what writing the seed bytes here needs.
import * as FileSystem from 'expo-file-system/legacy'
import { XLSX_MIME_TYPE } from '../types'
import { BLANK_WORKBOOK_BASE64 } from './blank-workbook.bytes'

// Cast through unknown — expo-file-system's release-to-release field shapes
// differ; the legacy entry still exposes the surface used below.
const fileSystem = FileSystem as unknown as {
    cacheDirectory?: string | null
    documentDirectory?: string | null
    writeAsStringAsync: (
        uri: string,
        contents: string,
        options?: { encoding?: string }
    ) => Promise<void>
    EncodingType?: { Base64?: string }
}

// Monotonic per-session counter so two rapid creates can't race on the
// same temp path. RN reads the file lazily during the upload request, so
// reusing a path while a prior upload is still in flight could ship the
// wrong bytes; a fresh suffix each call avoids that.
let writeSeq = 0

export async function blankWorkbookBody(): Promise<UploadBody> {
    const dir = fileSystem.cacheDirectory ?? fileSystem.documentDirectory
    if (dir == null) {
        throw new Error('blankWorkbookBody: no writable directory available')
    }
    const uri = `${dir}blank-workbook-${writeSeq++}.xlsx`
    await fileSystem.writeAsStringAsync(uri, BLANK_WORKBOOK_BASE64, {
        encoding: fileSystem.EncodingType?.Base64 ?? 'base64',
    })
    return { uri, name: 'Untitled.xlsx', type: XLSX_MIME_TYPE }
}
