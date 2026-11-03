import type { AutomationDefinitions } from '@tinycld/core/lib/automation/types'
import { type CalcSchema, XLSX_MIME_TYPE } from './types'

// Mirrors text's declaration, with one schema difference: calc_comments has
// NO quoted_text — a sheet comment is anchored to a cell (sheet_id/row/col)
// rather than to a passage of prose.
//
// No ownerField, for the same reason as text: `author` would auto-detect and
// scope personal rules to whoever wrote the comment, firing "when I comment"
// instead of "when someone comments on my workbook".
// server/automation.go registers a resolver over the workbook's participants
// that supersedes it.
//
// One action: add a row to a spreadsheet. A workbook is a drive item, so the
// param picks from drive_items, limited to spreadsheets, and can make a new
// one. server/automation.go writes the row (append_row_write.go).
const automation = {
    triggers: [
        {
            id: 'comment-added',
            label: 'A comment is added to a spreadsheet',
            collection: 'calc_comments',
            on: 'create',
            fields: [
                { key: 'body', label: 'Comment' },
                { key: 'author_name', label: 'Commenter' },
                { key: 'drive_item', label: 'Spreadsheet' },
                { key: 'sheet_id', label: 'Sheet' },
                { key: 'row', label: 'Row' },
                { key: 'col', label: 'Column' },
            ],
        },
    ],
    actions: [
        {
            id: 'append-row',
            label: 'Add a row to a spreadsheet',
            kind: 'native',
            params: [
                {
                    key: 'workbook',
                    type: 'relation',
                    relationTarget: 'drive_items',
                    label: 'Spreadsheet',
                    relationMatch: { mime_type: XLSX_MIME_TYPE, is_folder: false },
                    relationCreate: {
                        label: 'New spreadsheet',
                        nameField: 'name',
                        nameSuffix: '.xlsx',
                        ownerField: 'created_by',
                        values: { mime_type: XLSX_MIME_TYPE, is_folder: false },
                    },
                },
                // Empty means the first sheet a person can see.
                { key: 'sheet', type: 'text', label: 'Sheet' },
            ],
        },
    ],
} satisfies AutomationDefinitions<CalcSchema>

export default automation
