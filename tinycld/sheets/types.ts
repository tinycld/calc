export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Sheets owns no PocketBase collection of its own — spreadsheet files live in
// drive_items (provided by @tinycld/drive). The schema contributes nothing.
// Keep as `Record<never, never>` (not `Record<string, never>`, which would
// narrow the merged schema's string keys to `never` everywhere).
export type SheetsSchema = Record<never, never>
