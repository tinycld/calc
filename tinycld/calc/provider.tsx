import { registerPreview, registerShareEditor } from '@tinycld/core/file-viewer/registry'
import { lazy, type ReactNode } from 'react'
import { CalcPreview } from './components/CalcPreview'
import './lib/open-in-calc-action'
import './lib/open-in-calc-drive-action'
import { XLSX_MIME_TYPE } from './types'

// Lazy-import the editor screen so this provider module — eagerly loaded
// by tinycld.config.ts — doesn't pull the screen tree into core's import
// graph (text's equivalent provider used to close a require cycle via
// DocumentToolbar → ImageInsertButton → drive → pocketbase). The share
// editor is rendered behind a Suspense boundary in drive's share/[token].
const CalcEditorFromMount = lazy(() =>
    import('./screens/[id]').then(m => ({ default: m.CalcEditorFromMount }))
)

registerPreview(XLSX_MIME_TYPE, { preview: CalcPreview })

registerShareEditor(XLSX_MIME_TYPE, { component: CalcEditorFromMount })

interface Props {
    children: ReactNode
}

export default function CalcProvider({ children }: Props) {
    return <>{children}</>
}
