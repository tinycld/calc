import { Platform } from 'react-native'
import { caretIndexAtX, type TextAlign } from './caret-at-x'

// The cell's horizontal padding, which the editor keeps too.
const CELL_PADDING = 4

let measureCanvas: HTMLCanvasElement | null = null

// caretFromPress returns where the editor's caret should go for a press
// at `clientX` on a cell, so a click opens the editor with the caret
// under the pointer, as in Sheets. It measures `text` (the editor's
// text) in the font the cell draws with. Web only: native has no way to
// measure text here, so it returns undefined and the caret goes to the
// end.
export function caretFromPress(
    cellElement: unknown,
    clientX: number | undefined,
    text: string,
    align: TextAlign
): number | undefined {
    if (Platform.OS !== 'web' || clientX == null || typeof document === 'undefined')
        return undefined
    if (!(cellElement instanceof HTMLElement)) return undefined
    const rect = cellElement.getBoundingClientRect()
    const textElement = cellElement.querySelector('div')
    const font = textElement == null ? '' : window.getComputedStyle(textElement).font
    measureCanvas ??= document.createElement('canvas')
    const context = measureCanvas.getContext('2d')
    if (context == null || font === '') return undefined
    context.font = font
    return caretIndexAtX(
        text,
        clientX - rect.left - CELL_PADDING,
        rect.width - 2 * CELL_PADDING,
        align,
        s => context.measureText(s).width
    )
}
