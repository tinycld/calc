// normalizeColor handles excelize-style hex colors. Excelize stores
// colors as "FFRRGGBB" (8 hex digits including alpha) or "RRGGBB" (no
// alpha). Both need a leading `#` to be valid RN/CSS color values.
//
// "FF000000" → "#000000" (alpha is opaque — drop it; consumers accept
// 6/8 digit hex but the leading FF is the common case so we strip it
// for readability).
export function normalizeColor(value: string): string {
    if (value.startsWith('#')) return value
    const upper = value.toUpperCase()
    if (/^[0-9A-F]{8}$/.test(upper)) {
        if (upper.startsWith('FF')) {
            return `#${upper.slice(2)}`
        }
        return `#${upper}`
    }
    if (/^[0-9A-F]{6}$/.test(upper)) {
        return `#${upper}`
    }
    return value
}
