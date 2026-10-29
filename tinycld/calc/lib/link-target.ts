// internalLinkTarget returns the address a link inside the workbook
// points at, in the form the name box jump reads, or null for a link
// that leaves the workbook. Such links are stored as "#Sheet2!A1".
export function internalLinkTarget(url: string): string | null {
    if (!url.startsWith('#')) return null
    const target = url.slice(1)
    const bang = target.lastIndexOf('!')
    if (bang < 0 || target.includes(':')) return target
    // The sheet-qualified jump takes a range; a single cell is a
    // one-cell range.
    return `${target}:${target.slice(bang + 1)}`
}
