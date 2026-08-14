import type { AutomationDefinitions } from '@tinycld/core/lib/automation/types'
import type { CalcSchema } from './types'

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
// No actions — nothing record-shaped in calc closes a visible loop; cell
// values are collaborative operations, not rows a rule could write.
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
} satisfies AutomationDefinitions<CalcSchema>

export default automation
