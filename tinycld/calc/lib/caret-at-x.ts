export type TextAlign = 'left' | 'center' | 'right'

// caretIndexAtX returns the caret position in `text` nearest to `x`, for
// text laid out in a box `boxWidth` wide with the given alignment. `x`
// is measured from the box's left edge (inside its padding); `measure`
// gives the drawn width of a string in the box's font. Used to open the
// cell editor with the caret where the user clicked, as Sheets does.
export function caretIndexAtX(
    text: string,
    x: number,
    boxWidth: number,
    align: TextAlign,
    measure: (s: string) => number
): number {
    if (text === '') return 0
    const textWidth = measure(text)
    const start =
        align === 'right'
            ? boxWidth - textWidth
            : align === 'center'
              ? (boxWidth - textWidth) / 2
              : 0
    const offset = x - start
    if (offset <= 0) return 0
    if (offset >= textWidth) return text.length
    let previous = 0
    for (let i = 1; i <= text.length; i++) {
        const width = measure(text.slice(0, i))
        if (width >= offset) {
            return offset - previous < width - offset ? i - 1 : i
        }
        previous = width
    }
    return text.length
}
