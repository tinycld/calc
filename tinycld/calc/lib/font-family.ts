type GenericFamily = 'sans-serif' | 'serif' | 'monospace'

interface FontInfo {
    generic: GenericFamily
    // Metric-compatible or look-alike fonts, tried before the generic
    // family. Carlito and the Liberation fonts ship with most Linux
    // desktops and keep line breaks identical to the Office originals.
    fallbacks: string[]
}

const KNOWN_FONTS: Record<string, FontInfo> = {
    arial: { generic: 'sans-serif', fallbacks: ['Liberation Sans', 'Helvetica'] },
    calibri: { generic: 'sans-serif', fallbacks: ['Carlito'] },
    cambria: { generic: 'serif', fallbacks: ['Caladea', 'Georgia'] },
    consolas: { generic: 'monospace', fallbacks: ['Menlo'] },
    'courier new': { generic: 'monospace', fallbacks: ['Liberation Mono', 'Courier'] },
    courier: { generic: 'monospace', fallbacks: ['Courier New'] },
    georgia: { generic: 'serif', fallbacks: [] },
    helvetica: { generic: 'sans-serif', fallbacks: ['Helvetica Neue', 'Arial'] },
    'times new roman': { generic: 'serif', fallbacks: ['Liberation Serif', 'Times'] },
    times: { generic: 'serif', fallbacks: ['Times New Roman'] },
    'trebuchet ms': { generic: 'sans-serif', fallbacks: [] },
    verdana: { generic: 'sans-serif', fallbacks: [] },
}

// FONT_FAMILIES is the list the toolbar offers. Every entry resolves to
// a sensible fallback on every platform.
export const FONT_FAMILIES = [
    'Arial',
    'Calibri',
    'Cambria',
    'Consolas',
    'Courier New',
    'Georgia',
    'Helvetica',
    'Times New Roman',
    'Trebuchet MS',
    'Verdana',
]

const NATIVE_GENERIC: Record<GenericFamily, { ios?: string; android?: string }> = {
    'sans-serif': {},
    serif: { ios: 'Times New Roman', android: 'serif' },
    monospace: { ios: 'Courier New', android: 'monospace' },
}

// resolveFontFamily turns a cell's font name into a fontFamily value.
// On web it is a CSS stack, so a font the machine lacks falls back to
// a font of the same kind instead of the browser's default serif. On
// native, fontFamily takes one installed font only (an unknown name is
// an error on iOS), so the cell gets a family the platform is known to
// have, or undefined for the system font.
export function resolveFontFamily(name: string, platform: string): string | undefined {
    const info = KNOWN_FONTS[name.toLowerCase()] ?? { generic: 'sans-serif', fallbacks: [] }
    if (platform === 'web') {
        return [name, ...info.fallbacks].map(quoteFamily).concat(info.generic).join(', ')
    }
    const generic = NATIVE_GENERIC[info.generic]
    return platform === 'ios' ? generic.ios : platform === 'android' ? generic.android : undefined
}

function quoteFamily(family: string): string {
    return family.includes(' ') ? `"${family}"` : family
}
