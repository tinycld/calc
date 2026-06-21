// Typecheck target and fallback resolution (Node/Vitest), where no platform
// extension applies. Metro resolves `.web.ts` on web and `.native.ts` on
// iOS/Android, so `import { blankWorkbookBody } from './blank-workbook'`
// lands on the right platform automatically; this file only loads when
// neither suffix matches, where the web Blob path is correct. The logic is
// shared with blank-workbook.web.ts via blank-workbook.shared.ts — see
// blank-workbook.native.ts for why native can't build a Blob from raw bytes.
export { blankWorkbookBody } from './blank-workbook.shared'
