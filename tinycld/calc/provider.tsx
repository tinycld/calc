import { registerPreview, registerShareEditor } from '@tinycld/core/file-viewer/registry'
import type { ReactNode } from 'react'
import { CalcPreview } from './components/CalcPreview'
import './lib/open-in-calc-action'
import './lib/open-in-calc-drive-action'
import { CalcEditorFromMount } from './screens/[id]'
import { XLSX_MIME_TYPE } from './types'

registerPreview(XLSX_MIME_TYPE, { preview: CalcPreview })

registerShareEditor(XLSX_MIME_TYPE, { component: CalcEditorFromMount })

interface Props {
    children: ReactNode
}

export default function CalcProvider({ children }: Props) {
    return <>{children}</>
}
