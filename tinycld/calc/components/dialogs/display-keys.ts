import { formatKeys, isApplePlatform } from '@tinycld/core/lib/shortcuts/keys'

// displayKeys renders a `$mod+Shift+x`-style binding string for the
// Keyboard shortcuts help dialog. Modifiers join with `+` regardless
// of platform (so Apple's "⌘+⇧+X" reads the same shape as the Windows
// "Ctrl+Shift+X"), and chord sequences (whitespace-separated combos
// like `t i`) join with a space. The function is the only renderer
// that touches `formatKeys`, so any future change to its output shape
// is contained here. `isApple` is a parameter so a test does not
// depend on the platform of the machine that runs it.
export function displayKeys(keys: string, isApple = isApplePlatform): string {
    return formatKeys(keys, isApple)
        .map(parts => parts.join('+'))
        .join(' ')
}
