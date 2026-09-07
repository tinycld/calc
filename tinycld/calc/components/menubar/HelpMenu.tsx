import { openHelp, openHelpPackage } from '@tinycld/core/lib/help/open-help'
import { useHelpSearchStore } from '@tinycld/core/lib/help/search-store'
import { useReportIssue } from '@tinycld/core/lib/help/use-report-issue'
import { Menu, MenuBarMenu } from '@tinycld/core/ui/menubar'
import { Platform } from 'react-native'

// Glanceable: one search entry, direct links to the two
// highest-traffic reference topics (keyboard shortcuts and the
// function list), and a breadcrumb to the package's topic index.
// Per-topic entries live in the search palette.
export function HelpMenu() {
    const reportIssue = useReportIssue('calc')
    const searchShortcut = Platform.OS === 'web' ? '⌘/' : undefined

    return (
        <MenuBarMenu menuId="help" label="Help">
            <Menu.Item
                label="Search help…"
                shortcut={searchShortcut}
                onSelect={() => useHelpSearchStore.getState().open()}
            />
            <Menu.Item
                label="Keyboard shortcuts"
                onSelect={() => openHelp('calc:keyboard-shortcuts')}
            />
            <Menu.Item label="Function list" onSelect={() => openHelp('calc:functions')} />
            <Menu.Separator />
            <Menu.Item label="Browse calc help" onSelect={() => openHelpPackage('calc')} />
            <ReportIssueItem onSelect={reportIssue} />
        </MenuBarMenu>
    )
}

function ReportIssueItem({ onSelect }: { onSelect: (() => void) | null }) {
    if (!onSelect) return null
    return <Menu.Item label="Report an issue" onSelect={onSelect} />
}
