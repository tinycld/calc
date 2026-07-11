import { Platform, Pressable } from 'react-native'
import type { GridStoreApi } from '../../hooks/grid-store'
import { HEADER_HEIGHT, ROW_HEADER_WIDTH } from './constants'

interface CornerCellProps {
    store: GridStoreApi
    rowCount: number
    colCount: number
}

export function CornerCell({ store, rowCount, colCount }: CornerCellProps) {
    const webProps =
        Platform.OS === 'web'
            ? {
                  onKeyDown: (e: { key: string; preventDefault: () => void }) => {
                      if (e.key === 'Delete' || e.key === 'Backspace') {
                          e.preventDefault()
                          store.getState().clearSelection()
                      }
                  },
              }
            : {}
    return (
        <Pressable
            accessibilityLabel="Select all cells"
            className="bg-surface-secondary border-r border-b border-border web:outline-none"
            style={{ width: ROW_HEADER_WIDTH, height: HEADER_HEIGHT }}
            onPress={() => store.getState().selectAll(rowCount, colCount)}
            {...webProps}
        />
    )
}
