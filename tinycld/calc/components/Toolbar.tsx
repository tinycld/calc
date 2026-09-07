import { ResponsiveToolbar, type ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    AlignLeft,
    ArrowLeft,
    ArrowRight,
    Baseline,
    Bold,
    DollarSign,
    Grid3x3,
    Hash,
    Italic,
    type LucideIcon,
    PaintBucket,
    Paintbrush,
    Percent,
    Redo,
    Search,
    Strikethrough,
    Underline,
    Undo,
} from 'lucide-react-native'
import { memo } from 'react'
import { Text, View } from 'react-native'
import type * as Y from 'yjs'
import type { HorizontalAlign } from '../hooks/grid/use-grid-format-controls'
import type { BorderPresetId } from '../lib/border-presets'
import { findPresetByNumFmt } from '../lib/number-format/presets'
import type { CellBorders } from '../lib/workbook-types'
import { PivotTableIcon } from './icons'
import { usePivotInsert } from './pivot/PivotInsertButton'
import { BordersMenu, BordersRows } from './toolbar/BordersMenu'
import { ColorPickerRows } from './toolbar/ColorPickerMenu'
import { FillColorMenu } from './toolbar/FillColorMenu'
import { FontSizeRows, FontSizeStepper } from './toolbar/FontSizeStepper'
import { HorizontalAlignMenu, HorizontalAlignRows } from './toolbar/HorizontalAlignMenu'
import { NumberFormatMenu, NumberFormatRows } from './toolbar/NumberFormatMenu'
import { TextColorMenu } from './toolbar/TextColorMenu'
import { ToolbarButton } from './toolbar/ToolbarButton'

export interface ToolbarProps {
    // Selection-based disable for the formatting buttons. Undo/Redo
    // ignore this — you can undo without a selected cell.
    disabled: boolean

    canUndo: boolean
    canRedo: boolean
    onUndo: () => void
    onRedo: () => void

    isBold: boolean
    isItalic: boolean
    isUnderline: boolean
    isStrike: boolean
    onToggleBold: () => void
    onToggleItalic: () => void
    onToggleUnderline: () => void
    onToggleStrike: () => void

    currentNumFmt: string | undefined
    onApplyPreset: (id: string) => void
    onApplyCurrency: () => void
    onApplyPercent: () => void
    onDecreaseDecimal: () => void
    onIncreaseDecimal: () => void

    fontSize: number | undefined
    onSetFontSize: (size: number) => void

    fontColor: string | undefined
    onSetFontColor: (color: string) => void

    fillColor: string | undefined
    onSetFillColor: (color: string) => void

    borders: CellBorders | undefined
    onSetBorders: (presetId: BorderPresetId) => void

    horizontalAlign: HorizontalAlign | undefined
    onSetHorizontalAlign: (align: HorizontalAlign) => void

    isFormatPainterActive: boolean
    onActivateFormatPainter: () => void

    onOpenFind: () => void

    onDownloadCsvCurrent: () => void
    onDownloadCsvAll: () => void
    onDownloadXlsx?: () => void

    onOpenPrint: () => void

    // Sort opens the modal SortDialog. Filter toggles the filter view
    // on the active selection (creates if none, removes if present).
    onOpenSort: () => void
    onToggleFilter: () => void
    isFilterActive: boolean

    // Opens the Name Manager dialog in list mode. Lives on ToolbarProps
    // (and through it MenuBarProps) so the Data menu entry can dispatch
    // without each menu file needing a Y.Doc handle.
    onOpenNamedRanges: () => void

    onMergeAll: () => void
    onMergeHorizontal: () => void
    onMergeVertical: () => void
    onUnmerge: () => void

    frozenRows: number
    frozenCols: number
    selectionBottomRow: number | null
    selectionRightCol: number | null
    onSetFrozenRows: (n: number) => void
    onSetFrozenCols: (n: number) => void
    onUnfreeze: () => void

    // Pivot table insert. `doc` is null while the realtime room is
    // still handshaking; the button stays disabled until the doc
    // arrives. The defaults pre-fill the new-pivot dialog with the
    // current selection / active sheet name; onPivotSheetActivated
    // switches the workbook to the freshly-created output sheet.
    doc: Y.Doc | null
    pivotSourceRangeDefault: string
    pivotTargetSheetNameDefault: string
    onPivotSheetActivated: (sheetId: string) => void
}

// memo'd so that selection-range churn during a drag (which only
// affects the Grid body's range tint and overlays) doesn't re-render
// the entire toolbar subtree of menus, color pickers, and font
// stepper. All ToolbarProps callbacks must be stable references —
// see Grid.tsx where the inline arrows are wrapped in useCallback.
export const Toolbar = memo(ToolbarImpl)

const SEPARATOR: ToolbarItem = { type: 'separator' }

// The formatting row on the shared ResponsiveToolbar: what does not fit the
// width folds into a More menu, the pickers and popovers as submenus of the
// same rows and panels. The pivot dialog is hoisted out of its button so it
// stays mounted while the button is folded away.
function ToolbarImpl(props: ToolbarProps) {
    const pivot = usePivotInsert({
        doc: props.doc,
        defaultSourceRange: props.pivotSourceRangeDefault,
        defaultTargetSheetName: props.pivotTargetSheetNameDefault,
        onActivateSheet: props.onPivotSheetActivated,
    })
    const items = useToolbarItems(props, pivot)

    return (
        <View
            className="overflow-visible"
            {...(typeof document !== 'undefined' ? { 'data-test-id': 'calc-toolbar' } : {})}
        >
            <ResponsiveToolbar
                items={items}
                height={32}
                gap={0}
                className="bg-surface-secondary border-b border-border px-1"
            />
            {pivot.dialog}
        </View>
    )
}

function useToolbarItems(
    props: ToolbarProps,
    pivot: ReturnType<typeof usePivotInsert>
): ToolbarItem[] {
    const {
        disabled,
        canUndo,
        canRedo,
        onUndo,
        onRedo,
        isBold,
        isItalic,
        isUnderline,
        isStrike,
        onToggleBold,
        onToggleItalic,
        onToggleUnderline,
        onToggleStrike,
        currentNumFmt,
        onApplyPreset,
        onApplyCurrency,
        onApplyPercent,
        onDecreaseDecimal,
        onIncreaseDecimal,
        fontSize,
        onSetFontSize,
        fontColor,
        onSetFontColor,
        fillColor,
        onSetFillColor,
        borders,
        onSetBorders,
        horizontalAlign,
        onSetHorizontalAlign,
        isFormatPainterActive,
        onActivateFormatPainter,
        onOpenFind,
    } = props

    // One button: in the row as a ToolbarButton, in the More menu as a row.
    const button = (
        key: string,
        icon: LucideIcon,
        label: string,
        onPress: () => void,
        options: { isDisabled?: boolean; isActive?: boolean } = {}
    ): ToolbarItem => ({
        type: 'custom',
        key,
        element: (
            <ToolbarButton
                icon={icon}
                active={options.isActive}
                disabled={options.isDisabled}
                onPress={onPress}
                label={label}
            />
        ),
        overflow: { label, icon, onPress, isDisabled: options.isDisabled },
    })

    return [
        button('undo', Undo, 'Undo', onUndo, { isDisabled: !canUndo }),
        button('redo', Redo, 'Redo', onRedo, { isDisabled: !canRedo }),
        SEPARATOR,
        button('format-painter', Paintbrush, 'Format painter', onActivateFormatPainter, {
            isDisabled: disabled,
            isActive: isFormatPainterActive,
        }),
        {
            type: 'custom',
            key: 'number-format',
            element: (
                <NumberFormatMenu
                    currentNumFmt={currentNumFmt}
                    disabled={disabled}
                    onApplyPreset={onApplyPreset}
                />
            ),
            overflow: {
                label: 'Number format',
                icon: Hash,
                isDisabled: disabled,
                children: (
                    <NumberFormatRows
                        activeId={findPresetByNumFmt(currentNumFmt)?.id}
                        onSelect={onApplyPreset}
                    />
                ),
            },
        },
        button('currency', DollarSign, 'Format as currency', onApplyCurrency, {
            isDisabled: disabled,
        }),
        button('percent', Percent, 'Format as percent', onApplyPercent, { isDisabled: disabled }),
        {
            type: 'custom',
            key: 'decimal-decrease',
            element: (
                <ToolbarButton
                    disabled={disabled}
                    onPress={onDecreaseDecimal}
                    label="Decrease decimal places"
                    width={32}
                >
                    <DecimalIcon direction="decrease" />
                </ToolbarButton>
            ),
            overflow: {
                label: 'Decrease decimal places',
                icon: ArrowLeft,
                onPress: onDecreaseDecimal,
                isDisabled: disabled,
            },
        },
        {
            type: 'custom',
            key: 'decimal-increase',
            element: (
                <ToolbarButton
                    disabled={disabled}
                    onPress={onIncreaseDecimal}
                    label="Increase decimal places"
                    width={32}
                >
                    <DecimalIcon direction="increase" />
                </ToolbarButton>
            ),
            overflow: {
                label: 'Increase decimal places',
                icon: ArrowRight,
                onPress: onIncreaseDecimal,
                isDisabled: disabled,
            },
        },
        SEPARATOR,
        {
            type: 'custom',
            key: 'font-size',
            element: (
                <FontSizeStepper size={fontSize} disabled={disabled} onSetSize={onSetFontSize} />
            ),
            overflow: {
                label: 'Font size',
                isDisabled: disabled,
                children: <FontSizeRows size={fontSize} onSetSize={onSetFontSize} />,
            },
        },
        SEPARATOR,
        button('bold', Bold, 'Bold', onToggleBold, { isDisabled: disabled, isActive: isBold }),
        button('italic', Italic, 'Italic', onToggleItalic, {
            isDisabled: disabled,
            isActive: isItalic,
        }),
        button('underline', Underline, 'Underline', onToggleUnderline, {
            isDisabled: disabled,
            isActive: isUnderline,
        }),
        button('strike', Strikethrough, 'Strikethrough', onToggleStrike, {
            isDisabled: disabled,
            isActive: isStrike,
        }),
        {
            type: 'custom',
            key: 'text-color',
            element: (
                <TextColorMenu color={fontColor} disabled={disabled} onSetColor={onSetFontColor} />
            ),
            overflow: {
                label: 'Text color',
                icon: Baseline,
                isDisabled: disabled,
                children: <ColorPickerRows color={fontColor} onSetColor={onSetFontColor} />,
            },
        },
        {
            type: 'custom',
            key: 'fill-color',
            element: (
                <FillColorMenu color={fillColor} disabled={disabled} onSetColor={onSetFillColor} />
            ),
            overflow: {
                label: 'Fill color',
                icon: PaintBucket,
                isDisabled: disabled,
                children: <ColorPickerRows color={fillColor} onSetColor={onSetFillColor} />,
            },
        },
        {
            type: 'custom',
            key: 'borders',
            element: (
                <BordersMenu borders={borders} disabled={disabled} onSetBorders={onSetBorders} />
            ),
            overflow: {
                label: 'Borders',
                icon: Grid3x3,
                isDisabled: disabled,
                children: <BordersRows borders={borders} onSetBorders={onSetBorders} />,
            },
        },
        SEPARATOR,
        {
            type: 'custom',
            key: 'align',
            element: (
                <HorizontalAlignMenu
                    align={horizontalAlign}
                    disabled={disabled}
                    onSetAlign={onSetHorizontalAlign}
                />
            ),
            overflow: {
                label: 'Horizontal align',
                icon: AlignLeft,
                isDisabled: disabled,
                children: (
                    <HorizontalAlignRows
                        align={horizontalAlign}
                        onSetAlign={onSetHorizontalAlign}
                    />
                ),
            },
        },
        SEPARATOR,
        button('find', Search, 'Find and replace', onOpenFind),
        SEPARATOR,
        {
            type: 'custom',
            key: 'pivot',
            element: (
                <ToolbarButton
                    icon={PivotTableIcon}
                    label="Insert pivot table"
                    disabled={pivot.isDisabled}
                    onPress={pivot.open}
                />
            ),
            overflow: {
                label: 'Insert pivot table',
                onPress: pivot.open,
                isDisabled: pivot.isDisabled,
            },
        },
    ]
}

// DecimalIcon is a lightweight composition: ".0" text plus a left or
// right arrow. Lucide doesn't ship the Google-Sheets-style "decrease /
// increase decimal" glyph, and pulling in react-native-svg just for
// this would be heavier than a Text + arrow stack.
function DecimalIcon({ direction }: { direction: 'increase' | 'decrease' }) {
    const fg = useThemeColor('foreground')
    const Arrow = direction === 'increase' ? ArrowRight : ArrowLeft
    return (
        <View className="flex-row items-center" style={{ gap: 1 }}>
            <Text style={{ fontSize: 11, fontFamily: 'monospace', color: fg }}>.0</Text>
            <Arrow size={10} color={fg} />
        </View>
    )
}
