// Filesystem-safe filename: replaces characters disallowed by macOS /
// Windows / Linux with underscore, collapses runs, and trims edge
// underscores. Browser download dialogs already coerce some of these
// but the native (expo-file-system) write path needs it cleaned first.
const RESERVED = new Set('\\/:*?"<>|')

function isUnsafeChar(ch: string): boolean {
    return RESERVED.has(ch) || ch.charCodeAt(0) <= 0x1f
}

export function sanitizeFilename(name: string): string {
    const cleaned = Array.from(name, ch => (isUnsafeChar(ch) ? '_' : ch)).join('')
    return cleaned.replace(/_+/g, '_').replace(/^_|_$/g, '') || 'sheet'
}
