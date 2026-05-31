// NamedRange is the typed snapshot of one workbook-defined name as it
// lives in the Y.Doc. The `scope` field is the Y.Doc sheet id ('sheet1')
// when the name is sheet-local, or null when the name is workbook-global
// — translated to / from HF's numeric sheet id by FormulaBridge.
//
// The `expression` field is stored in HyperFormula's raw-content form:
// a formula-like string optionally starting with `=`, a constant scalar
// (e.g. '0.085', 'Quarterly'), or an absolute range reference (e.g.
// '=Sheet1!$A$1:$A$10'). HF rejects relative references inside named
// expressions, which matches Excel/Sheets convention.
export interface NamedRange {
    // Original casing as the user typed it. Display only — uniqueness
    // is enforced on the case-insensitive normalized form.
    name: string
    expression: string
    scope: string | null
    comment?: string
}

// NamedRangeKey is the case-insensitive normalized form used as the
// Y.Map key. Always lowercase; consumers should use `normalizeName` to
// derive the key from a display name.
export type NamedRangeKey = string

// ValidationResult is returned by validateName / the form layer so the
// UI can surface a localized error without throwing.
export type ValidationResult = { ok: true } | { ok: false; reason: string }
