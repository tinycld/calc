import { registerPreview, registerPublicPreview, registerShareEditor } from '@tinycld/core/file-viewer/registry'
import type { ReactNode } from 'react'
import { CalcPreview } from './components/CalcPreview'
import { PREVIEW_CSS } from './components/preview-css'
import './lib/open-in-calc-action'
import './lib/open-in-calc-drive-action'
import { CalcEditorFromMount } from './screens/[id]'
import { XLSX_MIME_TYPE } from './types'

registerPreview(XLSX_MIME_TYPE, { preview: CalcPreview })

// Public (anonymous share-link) preview config. Core's generic
// PublicDocumentPreview fetches via the share-session render endpoint and
// styles the fragment with this CSS — calc never enters drive's frontend.
registerPublicPreview(XLSX_MIME_TYPE, {
    css: PREVIEW_CSS,
    isEmpty: html => !html.includes('tinycld-calc-grid'),
    anchorKind: 'calc_cell',
})

registerShareEditor(XLSX_MIME_TYPE, { component: CalcEditorFromMount })

interface Props {
    children: ReactNode
}

export default function CalcProvider({ children }: Props) {
    return <>{children}</>
}
