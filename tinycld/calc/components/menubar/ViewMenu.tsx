import { Menu, MenuBarMenu } from '@tinycld/core/ui/menubar'
import type { MenuBarProps } from './MenuBar'

export function ViewMenu(props: MenuBarProps) {
    const hiddenSheets = props.allSheets.filter(s => s.hidden)

    return (
        <MenuBarMenu menuId="view" label="View">
            <Menu.Sub label="Freeze">
                <Menu.Item label="No rows" onSelect={() => props.onSetFrozenRows(0)} />
                <Menu.Item label="1 row" onSelect={() => props.onSetFrozenRows(1)} />
                <Menu.Item label="2 rows" onSelect={() => props.onSetFrozenRows(2)} />
                <FreezeUpToItem
                    axis="row"
                    index={props.selectionBottomRow}
                    onSelect={props.onSetFrozenRows}
                />
                <Menu.Separator />
                <Menu.Item label="No columns" onSelect={() => props.onSetFrozenCols(0)} />
                <Menu.Item label="1 column" onSelect={() => props.onSetFrozenCols(1)} />
                <Menu.Item label="2 columns" onSelect={() => props.onSetFrozenCols(2)} />
                <FreezeUpToItem
                    axis="column"
                    index={props.selectionRightCol}
                    onSelect={props.onSetFrozenCols}
                />
                <Menu.Separator />
                <Menu.Item label="Unfreeze" onSelect={props.onUnfreeze} />
            </Menu.Sub>
            <Menu.Item label="Show comments" onSelect={props.onShowComments} />
            <Menu.Sub label="Hidden sheets">
                <HiddenSheetItems sheets={hiddenSheets} onShow={props.onShowSheet} />
            </Menu.Sub>
        </MenuBarMenu>
    )
}

function FreezeUpToItem({
    axis,
    index,
    onSelect,
}: {
    axis: 'row' | 'column'
    index: number | null | undefined
    onSelect: (index: number) => void
}) {
    if (index == null) return null
    return <Menu.Item label={`Up to ${axis} ${index}`} onSelect={() => onSelect(index)} />
}

function HiddenSheetItems({
    sheets,
    onShow,
}: {
    sheets: MenuBarProps['allSheets']
    onShow: (sheetId: string) => void
}) {
    if (sheets.length === 0) return <Menu.Item label="(no hidden sheets)" isDisabled />
    return sheets.map(s => <Menu.Item key={s.id} label={s.name} onSelect={() => onShow(s.id)} />)
}
