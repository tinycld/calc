// Re-export entry. Metro resolves `.web.ts` on web and `.native.ts` on
// iOS/Android, so `import { blankWorkbookBody } from './blank-workbook'`
// lands on the right platform automatically. This file is the typecheck
// target and the fallback resolution (Node/Vitest), where the web Blob
// path is correct — see blank-workbook.native.ts for why native can't
// build a Blob from raw bytes.
export { blankWorkbookBody } from './blank-workbook.web'
