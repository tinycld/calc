// Web entry — Metro resolves this file for `import './blank-workbook'` on
// web. The actual Blob-building logic lives in blank-workbook.shared.ts so
// the platform-suffix-free fallback (blank-workbook.ts) can reuse it without
// hard-importing a `.web` specifier (which a native build can't resolve).
export { blankWorkbookBody } from './blank-workbook.shared'
