import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ExternalLink, Pencil, Unlink } from 'lucide-react-native'
import { Linking, Pressable, Text, View } from 'react-native'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import { useWorkbook } from '../../hooks/use-workbook-context'
import { setYCellLink, useYCell } from '../../hooks/use-y-cell'
import { useYSheets } from '../../hooks/use-y-sheets'
import { internalLinkTarget } from '../../lib/link-target'
import { primaryAnchor } from '../../lib/selection-range'
import { tryJumpToAddress } from '../NameBox'

interface LinkChipOverlayProps {
    sheetId: string
    colOffsets: Float64Array
    rowOffsets: Float64Array
    readOnly: boolean
    // Set when the chip is drawn over a split (frozen) grid rather than
    // inside one scrolling pane: cells past the frozen rows/columns are
    // moved by the pane's scroll offset, frozen ones are not.
    split?: { scrollX: number; scrollY: number; frozenRows: number; frozenCols: number }
    // Switches sheets, for a link to a cell on another sheet.
    onActivateSheet: (sheetId: string) => void
}

// LinkChipOverlay shows the link of the selected cell in a chip below
// it, as Sheets does: the URL opens the link, and the icons edit or
// remove it. A click on the cell itself only selects it, so a link
// never opens by accident.
export function LinkChipOverlay({
    sheetId,
    colOffsets,
    rowOffsets,
    readOnly,
    split,
    onActivateSheet,
}: LinkChipOverlayProps) {
    const { doc } = useWorkbook()
    const anchor = useGridStore(s =>
        s.editSession == null && s.linkTarget == null ? primaryAnchor(s.selection) : null
    )
    const cell = useYCell(doc, sheetId, anchor?.row ?? 0, anchor?.col ?? 0)
    const sheets = useYSheets(doc)
    const store = useGridStoreApi()
    if (anchor == null || cell?.link == null) return null
    const openLink = (url: string) => {
        const target = internalLinkTarget(url)
        if (target == null) {
            void Linking.openURL(url)
            return
        }
        tryJumpToAddress(store, sheets, sheetId, target, onActivateSheet)
    }
    const scrollX = split != null && anchor.col > split.frozenCols ? split.scrollX : 0
    const scrollY = split != null && anchor.row > split.frozenRows ? split.scrollY : 0
    return (
        <LinkChip
            url={cell.link}
            left={(colOffsets[anchor.col - 1] ?? 0) - scrollX}
            top={(rowOffsets[anchor.row] ?? 0) + 4 - scrollY}
            readOnly={readOnly}
            onOpen={() => openLink(cell.link ?? '')}
            onRemove={() => {
                if (doc != null) setYCellLink(doc, sheetId, anchor.row, anchor.col, null)
            }}
        />
    )
}

interface LinkChipProps {
    url: string
    onOpen: () => void
    left: number
    top: number
    readOnly: boolean
    onRemove: () => void
}

function LinkChip({ url, onOpen, left, top, readOnly, onRemove }: LinkChipProps) {
    const store = useGridStoreApi()
    const linkColor = useThemeColor('link')
    const muted = useThemeColor('muted-foreground')
    return (
        <View
            style={{ position: 'absolute', left, top, maxWidth: 360, zIndex: 20 }}
            className="flex-row items-center gap-2 px-2 py-1 rounded-md border border-border bg-background shadow-sm"
            testID="calc-link-chip"
        >
            <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Open ${url}`}
                onPress={onOpen}
                className="flex-row items-center gap-1 shrink"
            >
                <ExternalLink size={12} color={linkColor} />
                <Text numberOfLines={1} style={{ color: linkColor }} className="text-xs underline">
                    {url}
                </Text>
            </Pressable>
            <ChipAction
                isVisible={!readOnly}
                label="Edit link"
                onPress={() => store.getState().openLinkDialog()}
            >
                <Pencil size={12} color={muted} />
            </ChipAction>
            <ChipAction isVisible={!readOnly} label="Remove link" onPress={onRemove}>
                <Unlink size={12} color={muted} />
            </ChipAction>
        </View>
    )
}

interface ChipActionProps {
    isVisible: boolean
    label: string
    onPress: () => void
    children: React.ReactNode
}

function ChipAction({ isVisible, label, onPress, children }: ChipActionProps) {
    if (!isVisible) return null
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            hitSlop={6}
        >
            {children}
        </Pressable>
    )
}
