import { Printer } from 'lucide-react-native'
import { ToolbarButton } from './ToolbarButton'

interface PrintButtonProps {
    disabled?: boolean
    onPress: () => void
}

// Toolbar trigger for the Print dialog. Sits next to DownloadMenu; the
// two are siblings — both produce a snapshot of the workbook in some
// user-chosen format.
export function PrintButton({ disabled, onPress }: PrintButtonProps) {
    return (
        <ToolbarButton
            icon={Printer}
            label="Print"
            onPress={onPress}
            disabled={disabled}
        />
    )
}
