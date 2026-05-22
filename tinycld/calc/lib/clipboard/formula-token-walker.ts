// Single-pass walker over the A1-shaped tokens in a formula. Shared
// internals between the clipboard rewriter (uniform delta shift) and
// the structural-mutation rewriter (per-token axis-aware shift). The
// walker handles:
//
//   - Double-quoted string literals, with `""` as the embedded-quote
//     escape (Excel/Sheets convention). Tokens inside strings are not
//     emitted to the transform — the bytes pass through verbatim.
//   - A1 tokens: `(\$?)([A-Z]{1,3})(\$?)(\d+)`. Captures the four parts
//     so the transform can preserve per-axis absoluteness.
//   - Identifier-tail guard: a token whose surrounding char is in
//     `[A-Za-z0-9_]` is part of a longer identifier (named range like
//     `Tax2024`, or `_A1`, or `5A1`) and is not handed to the
//     transform — it passes through verbatim.
//   - Sheet-qualified prefixes. The walker parses the FULL prefix
//     (unquoted `Sheet1!` or quoted `'Sheet Name'!` with `''` as the
//     embedded-apostrophe escape) backwards from the `!` and exposes it
//     as one piece. The transform decides what to do with it.
//
// The transform receives `FormulaTokenContext` and returns the
// replacement bytes for the WHOLE token (including any sheetPrefix it
// chooses to re-emit). This lets the structural rewriter swap the
// numeric parts in cross-sheet refs while keeping the prefix bytes
// verbatim, and lets the clipboard rewriter return the token verbatim
// when sheetPrefix is non-empty.

export interface FormulaTokenContext {
    colAbs: boolean
    colLetters: string
    rowAbs: boolean
    rowNum: number
    // Exact bytes of the "Sheet!" or "'Sheet'!" prefix that immediately
    // precedes the A1 token, or "" when the token is unqualified. The
    // walker parses the prefix; the transform decides what to do.
    sheetPrefix: string
}

export type FormulaTokenTransform = (token: FormulaTokenContext) => string

// A1-shaped token: optional $, 1-3 column letters, optional $, ≥1 row
// digit. Sticky (`y`) so we anchor at lastIndex rather than scanning.
const REF_RE = /(\$?)([A-Z]{1,3})(\$?)(\d+)/y

// HF's UNQUOTED_SHEET_NAME_PATTERN — Latin letters incl. Latin-1
// supplement (À-ʯ), digits, underscores. Anything else (spaces, dots,
// parens, apostrophes, CJK, etc.) requires the quoted form in formula
// text. Matched character-by-character when scanning backwards.
const UNQUOTED_SHEET_CHAR = /[A-Za-zÀ-ʯ0-9_]/

const ID_CHAR = /[A-Za-z0-9_]/

interface StringScanResult {
    out: string
    i: number
    inString: boolean
}

// Advance one step while inside a double-quoted string. Handles the
// `""` embedded-quote escape: consumes both chars and stays in-string.
// Returns the closing `"` without escape as end-of-string (inString→false).
function advanceInString(formula: string, i: number, out: string): StringScanResult {
    const ch = formula[i]
    out += ch
    if (ch === '"') {
        if (formula[i + 1] === '"') {
            // `""` escape: consume both, stay in string.
            out += '"'
            return { out, i: i + 2, inString: true }
        }
        return { out, i: i + 1, inString: false }
    }
    return { out, i: i + 1, inString: true }
}

interface QuotedPrefixResult {
    prefixStart: number
    found: boolean
}

// Scan backwards from `bang - 2` for the opening `'` of a quoted sheet
// name, treating `''` as an embedded apostrophe. `bang` is the index of
// the `!`; `formula[bang - 1]` must already be `'` (the closing quote).
function scanQuotedSheetPrefix(formula: string, bang: number): QuotedPrefixResult {
    let q = bang - 2
    while (q >= 0) {
        if (formula[q] === "'") {
            if (q > 0 && formula[q - 1] === "'") {
                // `''` embedded apostrophe: skip both chars.
                q -= 2
                continue
            }
            return { prefixStart: q, found: true }
        }
        q--
    }
    return { prefixStart: 0, found: false }
}

interface UnquotedPrefixResult {
    prefixStart: number
    found: boolean
}

// Scan backwards from `bang - 1` over UNQUOTED_SHEET_CHAR. At least
// one matching char is required for the result to count as a real prefix.
function scanUnquotedSheetPrefix(formula: string, bang: number): UnquotedPrefixResult {
    let q = bang - 1
    while (q >= 0 && UNQUOTED_SHEET_CHAR.test(formula[q])) q--
    if (q < bang - 1) {
        return { prefixStart: q + 1, found: true }
    }
    return { prefixStart: bang, found: false }
}

interface SheetPrefixResult {
    sheetPrefix: string
    prefixStart: number
    // True when the identifier-tail guard fired after prefix resolution;
    // the caller should emit m[0] verbatim and skip the transform.
    verbatim: boolean
}

// Parse a sheet-qualified prefix backwards from colStart. colStart is
// the index of the first column letter in the A1 match (skipping any
// leading `$`). Returns the prefix bytes and where they start, or an
// empty prefix when none is present or the guard fires.
function parseSheetPrefix(formula: string, colStart: number): SheetPrefixResult {
    const noPrefix: SheetPrefixResult = { sheetPrefix: '', prefixStart: colStart, verbatim: false }

    if (colStart === 0 || formula[colStart - 1] !== '!') return noPrefix

    const bang = colStart - 1
    let prefixStart: number
    let found: boolean

    if (bang > 0 && formula[bang - 1] === "'") {
        // Quoted form: scan back for the matching opening "'",
        // treating "''" as an embedded apostrophe (which
        // belongs to the name, not the delimiter).
        ;({ prefixStart, found } = scanQuotedSheetPrefix(formula, bang))
    } else {
        // Unquoted form: scan back over the unquoted-name char
        // class. At least one char is required for it to be a
        // real prefix.
        ;({ prefixStart, found } = scanUnquotedSheetPrefix(formula, bang))
    }

    if (!found) return noPrefix

    const sheetPrefix = formula.slice(prefixStart, colStart)

    // If we resolved a prefix, the identifier-tail guard on the
    // LEFT side has to be re-checked against the char before
    // the prefix — `FOO'Sheet'!A1` shouldn't be treated as a
    // sheet-qualified ref because `FOO` glues onto the quoted
    // name. (In practice formulas don't look like this, but
    // matching the same guard keeps the walker robust.)
    if (prefixStart > 0 && ID_CHAR.test(formula[prefixStart - 1])) {
        return { sheetPrefix: '', prefixStart: colStart, verbatim: true }
    }

    return { sheetPrefix, prefixStart, verbatim: false }
}

export function walkFormulaTokens(formula: string, transform: FormulaTokenTransform): string {
    if (!formula.startsWith('=')) return formula

    let out = ''
    let i = 0
    let inString = false

    while (i < formula.length) {
        const ch = formula[i]

        if (inString) {
            ;({ out, i, inString } = advanceInString(formula, i, out))
            continue
        }

        if (ch === '"') {
            inString = true
            out += ch
            i++
            continue
        }

        REF_RE.lastIndex = i
        const m = REF_RE.exec(formula)
        if (m == null) {
            out += ch
            i++
            continue
        }

        const tail = i + m[0].length

        // Identifier-tail guard: a letter/digit/underscore on either
        // side of the match means the A1-shape is just the suffix of a
        // longer identifier (named range, etc.) — pass through verbatim.
        if (tail < formula.length && ID_CHAR.test(formula[tail])) {
            out += m[0]
            i = tail
            continue
        }
        if (m.index > 0 && ID_CHAR.test(formula[m.index - 1])) {
            out += m[0]
            i = tail
            continue
        }

        // Parse a sheet-qualified prefix backwards from the token.
        // colStart is the index of the first column letter (skipping
        // the optional `$`); the prefix's `!` sits immediately before
        // colStart when present.
        const colStart = m[1] === '$' ? m.index + 1 : m.index
        const { sheetPrefix, verbatim } = parseSheetPrefix(formula, colStart)

        if (verbatim) {
            out += m[0]
            i = tail
            continue
        }

        const ctx: FormulaTokenContext = {
            colAbs: m[1] === '$',
            colLetters: m[2],
            rowAbs: m[3] === '$',
            rowNum: Number(m[4]),
            sheetPrefix,
        }

        // The transform owns the token's full output bytes. We rewind
        // out to the start of the prefix (if any) so we don't double-
        // emit characters the transform decides to re-include.
        if (sheetPrefix !== '') {
            out = out.slice(0, out.length - sheetPrefix.length)
        }
        out += transform(ctx)
        i = tail
    }

    return out
}

// Inverse of columnLabel: "A" → 1, "Z" → 26, "AA" → 27. Lives here so
// both rewriters can share it — the walker hands the transform the raw
// letters, and the transform converts to a numeric column when it
// needs to do arithmetic.
export function letterToCol(letters: string): number {
    let n = 0
    for (let k = 0; k < letters.length; k++) {
        n = n * 26 + (letters.charCodeAt(k) - 64)
    }
    return n
}
