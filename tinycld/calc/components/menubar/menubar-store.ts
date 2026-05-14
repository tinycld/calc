import { create } from '@tinycld/core/lib/store'

export type MenuBarId = 'file' | 'edit' | 'view' | 'format' | 'data' | 'help'

interface MenuBarState {
    openMenuId: MenuBarId | null
    open: (id: MenuBarId) => void
    close: () => void
    /**
     * Toggle a specific menu. Clicking the currently-open menu closes
     * it; clicking any other menu swaps to it.
     */
    toggle: (id: MenuBarId) => void
}

// Local to calc's menubar — shared across the six top-level menus so
// they can hand off cleanly. When one is open, hovering or clicking
// another trigger swaps instantly (Sheets/Excel menubar feel) rather
// than requiring the user to dismiss the first one first.
export const useMenuBarStore = create<MenuBarState>()(set => ({
    openMenuId: null,
    open: id => set({ openMenuId: id }),
    close: () => set({ openMenuId: null }),
    toggle: id =>
        set(state => ({
            openMenuId: state.openMenuId === id ? null : id,
        })),
}))
