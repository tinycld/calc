// Web/Node materialization of the embedded blank-workbook bytes, shared by
// blank-workbook.web.ts (Metro web) and blank-workbook.ts (the typecheck /
// Node / Vitest fallback). Kept in a platform-suffix-free file so neither
// importer has to name `./blank-workbook.web` — a hard `.web` specifier is
// unresolvable in a native (Android/iOS) build and breaks the bundle.
//
// Native uses blank-workbook.native.ts instead: React Native's Blob
// implementation throws on ArrayBuffer/ArrayBufferView parts, so there we
// write a temp file and upload by URI.

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
