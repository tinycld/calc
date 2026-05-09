import { registerPreview } from '@tinycld/core/file-viewer/registry'
import type { ReactNode } from 'react'
import { SheetsPreview } from './components/SheetsPreview'
import './lib/open-in-sheets-action'
import './lib/open-in-sheets-drive-action'
import { XLSX_MIME_TYPE } from './types'

registerPreview(XLSX_MIME_TYPE, { preview: SheetsPreview })

interface Props {
    children: ReactNode
}

export default function SheetsProvider({ children }: Props) {
    return <>{children}</>
}
