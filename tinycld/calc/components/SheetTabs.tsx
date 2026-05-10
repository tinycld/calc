import { Pressable, ScrollView, Text, View } from 'react-native'
import type { SheetWithId } from '../hooks/use-y-sheets'

const TAB_HEIGHT = 28
const TAB_MIN_WIDTH = 80
const TAB_MAX_WIDTH = 200

interface SheetTabsProps {
    sheets: SheetWithId[]
    activeSheetId: string
    onSelect: (sheetId: string) => void
}

// SheetTabs renders Excel-style file-folder tabs along the bottom of
// the workbook. Pure presentation: parent owns the active state and
// passes it in. Returns null when there's nothing to switch between
// (zero or one sheet).
//
// The strip sits on a 1px bottom border that runs the full width.
// Active tab uses bg-background (visually flush with the grid above
// it, "elevated" toward the user). Inactive tabs use
// bg-surface-secondary with muted text and a top divider so the
// stack reads as folder tabs in front of a back wall.
export function SheetTabs({ sheets, activeSheetId, onSelect }: SheetTabsProps) {
    if (sheets.length < 2) return null

    return (
        <View className="border-t border-border bg-surface-secondary">
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ alignItems: 'flex-end' }}
            >
                {sheets.map(sheet => {
                    const isActive = sheet.id === activeSheetId
                    return (
                        <Pressable
                            key={sheet.id}
                            onPress={() => onSelect(sheet.id)}
                            accessibilityRole="tab"
                            accessibilityState={{ selected: isActive }}
                            accessibilityLabel={`Sheet ${sheet.name}`}
                            style={{
                                height: TAB_HEIGHT,
                                minWidth: TAB_MIN_WIDTH,
                                maxWidth: TAB_MAX_WIDTH,
                            }}
                            className={
                                isActive
                                    ? 'flex-row items-center justify-center px-3 bg-background border-l border-r border-t border-border rounded-t-md'
                                    : 'flex-row items-center justify-center px-3 bg-surface-secondary border-r border-border'
                            }
                        >
                            <Text
                                numberOfLines={1}
                                className={
                                    isActive
                                        ? 'text-xs font-medium text-foreground'
                                        : 'text-xs text-muted-foreground'
                                }
                            >
                                {sheet.name}
                            </Text>
                        </Pressable>
                    )
                })}
            </ScrollView>
        </View>
    )
}
