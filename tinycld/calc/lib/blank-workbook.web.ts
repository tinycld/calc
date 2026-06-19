// Web materialization of the embedded blank-workbook bytes. The
// browser's Blob constructor accepts an ArrayBuffer part, so we decode
// the base64 and hand back a real Blob for useCreateDriveItem to upload.
//
// Native uses blank-workbook.native.ts instead: React Native's Blob
// implementation throws on ArrayBuffer/ArrayBufferView parts, so there
// we write a temp file and upload by URI. Metro/Vitest pick the right
// file by suffix; both export the same blankWorkbookBody.

import type { UploadBody } from '@tinycld/drive/lib/upload-to-drive'
import { XLSX_MIME_TYPE } from '../types'
import { BLANK_WORKBOOK_BASE64 } from './blank-workbook.bytes'

export function blankWorkbookBody(): UploadBody {
    const bin = atob(BLANK_WORKBOOK_BASE64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i)
    }
    // Slice into a fresh ArrayBuffer to keep TS happy under strict
    // SharedArrayBuffer narrowing — Blob's lib.dom typing rejects
    // Uint8Array<ArrayBufferLike> directly.
    const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
    return new Blob([ab], { type: XLSX_MIME_TYPE })
}
