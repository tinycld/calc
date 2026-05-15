import { useOpenMenuStore } from '../../lib/stores/open-menu-store'

export type MenuBarId = 'file' | 'edit' | 'view' | 'format' | 'data' | 'help'

const MENUBAR_PREFIX = 'menubar:'

export function menuBarRegistryId(id: MenuBarId): string {
    return `${MENUBAR_PREFIX}${id}`
}

// Selectors against the shared open-menu registry. The menubar's
// six top-level menus participate in the same single-open pool as
// the toolbar pickers — opening one closes whichever was open
// elsewhere — but the hover-swap behavior still needs to know
// whether the *currently open* menu is itself a menubar menu, so
// it can hand off to a sibling.

export function useOpenMenuBarId(): MenuBarId | null {
    return useOpenMenuStore((s) => {
        if (s.openId == null) return null
        if (!s.openId.startsWith(MENUBAR_PREFIX)) return null
        return s.openId.slice(MENUBAR_PREFIX.length) as MenuBarId
    })
}

export function useIsMenuBarOpen(id: MenuBarId): boolean {
    const registryId = menuBarRegistryId(id)
    return useOpenMenuStore((s) => s.openId === registryId)
}
