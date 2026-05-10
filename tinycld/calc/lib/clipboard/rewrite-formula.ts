import { columnLabel } from '../workbook-types'

// rewriteFormula shifts the relative A1 refs inside a formula by
// (deltaRow, deltaCol), preserving per-axis absoluteness (the `$`
// prefix). Used by the paste path so a copied `=A1+B1` lands as
// `=B2+C2` when pasted one row down and one column right.
//
// Invariants:
//   - Tokens inside double-quoted string literals are never rewritten.
//     Excel/Sheets escape `"` inside strings as `""`, which this parser
//     honours (toggle the inside-string flag only on un-paired quotes).
//   - Sheet-qualified refs (`Sheet2!A1`, `'My Sheet'!A1`) pass through
//     opaquely — cross-sheet rewriting is a v1 non-goal. We detect them
//     by scanning the chars immediately preceding the potential ref
//     token: if we see a `!`, skip rewriting that token.
//   - Function names (SUM, LEN, IF) don't match the ref regex because
//     it requires at least one digit after the column letters. `=SUM`
//     stays put.
//   - A shifted axis that would land below 1 substitutes the whole
//     token with the literal `#REF!`, matching the error token the
//     formula engine surfaces when a ref dangles.
//   - When the input does not start with `=` we treat it as a non-formula
//     and return it verbatim. The caller (deserialize) only invokes this
//     on cells where kind === 'formula', so this is defensive.
//
// The implementation is a hand-rolled walker (rather than HyperFormula's
// transform API) because the rules are small, the tests are exhaustive,
// and we don't want a license-keyed engine on the critical path of every
// paste.

// A1-shaped token: optional $, 1-3 column letters, optional $, ≥1 row
// digit. Captures the four parts so we can apply the delta per-axis.
const REF_RE = /(\$?)([A-Z]{1,3})(\$?)(\d+)/y

export interface RewriteFormulaOptions {
    // Optional bounds for the destination. Out-of-bounds shifts always
    // catch the row < 1 / col < 1 case automatically; an upper bound is
    // accepted for future use but not enforced today (the calc grid has
    // no hard upper bound).
    maxRow?: number
    maxCol?: number
}

export function rewriteFormula(
    formula: string,
    deltaRow: number,
    deltaCol: number,
    _opts?: RewriteFormulaOptions
): string {
    if (!formula.startsWith('=')) return formula
    if (deltaRow === 0 && deltaCol === 0) return formula

    let out = ''
    let i = 0
    let inString = false

    while (i < formula.length) {
        const ch = formula[i]

        if (inString) {
            // Inside a double-quoted literal. A `"` either closes the
            // string or, if doubled, is an escaped quote that emits a
            // single `"` and stays inside the string.
            out += ch
            if (ch === '"') {
                if (formula[i + 1] === '"') {
                    out += '"'
                    i += 2
                    continue
                }
                inString = false
            }
            i++
            continue
        }

        if (ch === '"') {
            inString = true
            out += ch
            i++
            continue
        }

        // Try to match an A1-shaped token starting at i. The sticky
        // flag (`y`) anchors the match at lastIndex.
        REF_RE.lastIndex = i
        const m = REF_RE.exec(formula)
        if (m == null) {
            out += ch
            i++
            continue
        }

        // Sheet-qualified refs (`Sheet2!A1`) pass through. The `!`
        // immediately precedes the column-letter run; check the char
        // before the match start (skipping the optional `$`).
        const colStart = m[1] === '$' ? m.index + 1 : m.index
        if (colStart > 0 && formula[colStart - 1] === '!') {
            out += m[0]
            i = m.index + m[0].length
            continue
        }

        // Skip rewriting when the token is part of a longer
        // identifier — either a letter/digit/underscore immediately
        // before or after. Without the preceding check, a named-range
        // token like `FOO1` (which can ship inside imported xlsx
        // formulas) would have its tail mangled as if it were a
        // cell ref. Excelize/Sheets named ranges are alphanumeric +
        // underscore so this is a sufficient gate.
        const tail = i + m[0].length
        if (tail < formula.length) {
            const next = formula[tail]
            if (/[A-Za-z0-9_]/.test(next)) {
                out += m[0]
                i = tail
                continue
            }
        }
        if (m.index > 0) {
            const prev = formula[m.index - 1]
            if (/[A-Za-z0-9_]/.test(prev)) {
                out += m[0]
                i = tail
                continue
            }
        }

        const colAbs = m[1] === '$'
        const colLetters = m[2]
        const rowAbs = m[3] === '$'
        const rowNum = Number(m[4])

        const col = letterToCol(colLetters)
        const nextCol = colAbs ? col : col + deltaCol
        const nextRow = rowAbs ? rowNum : rowNum + deltaRow

        if (nextCol < 1 || nextRow < 1) {
            out += '#REF!'
            i = tail
            continue
        }

        const colPart = `${colAbs ? '$' : ''}${columnLabel(nextCol)}`
        const rowPart = `${rowAbs ? '$' : ''}${nextRow}`
        out += `${colPart}${rowPart}`
        i = tail
    }

    return out
}

// Inverse of columnLabel: "A" → 1, "Z" → 26, "AA" → 27.
function letterToCol(letters: string): number {
    let n = 0
    for (let k = 0; k < letters.length; k++) {
        n = n * 26 + (letters.charCodeAt(k) - 64)
    }
    return n
}
