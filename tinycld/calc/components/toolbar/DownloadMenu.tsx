import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { ChevronDown, Download } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { View } from 'react-native'
import { ToolbarButton } from './ToolbarButton'

interface DownloadMenuProps {
    disabled?: boolean
    onDownloadCsvCurrent: () => void
    onDownloadCsvAll: () => void
    onDownloadXlsx?: () => void
}

// "↓ ▾" trigger that opens a menu listing the export choices. The XLSX
// item is conditional — when the parent doesn't supply the handler the
// row is hidden rather than rendered disabled, keeping the menu tight.
export function DownloadMenu({
    disabled,
    onDownloadCsvCurrent,
    onDownloadCsvAll,
    onDownloadXlsx,
}: DownloadMenuProps) {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')
    const [isOpen, setIsOpen] = useState(false)

    const wrap = useCallback(
        (handler: () => void) => () => {
            handler()
            setIsOpen(false)
        },
        []
    )

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <Menu.Trigger>
                <ToolbarButton label="Download" disabled={disabled} width={40}>
                    <View className="flex-row items-center" style={{ gap: 2 }}>
                        <Download size={14} color={fg} />
                        <ChevronDown size={12} color={muted} />
                    </View>
                </ToolbarButton>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    {onDownloadXlsx != null ? (
                        <Menu.Item onPress={wrap(onDownloadXlsx)}>
                            <Menu.ItemTitle>Download as XLSX</Menu.ItemTitle>
                        </Menu.Item>
                    ) : null}
                    <Menu.Item onPress={wrap(onDownloadCsvCurrent)}>
                        <Menu.ItemTitle>Download as CSV (current sheet)</Menu.ItemTitle>
                    </Menu.Item>
                    <Menu.Item onPress={wrap(onDownloadCsvAll)}>
                        <Menu.ItemTitle>Download as CSV (all sheets)</Menu.ItemTitle>
                    </Menu.Item>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
