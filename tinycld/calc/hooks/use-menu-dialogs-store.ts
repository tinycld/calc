import { create } from '@tinycld/core/lib/store'

interface MenuDialogsState {
    isFunctionListOpen: boolean
    isKeyboardShortcutsOpen: boolean
    openFunctionList: () => void
    closeFunctionList: () => void
    openKeyboardShortcuts: () => void
    closeKeyboardShortcuts: () => void
}

export const useMenuDialogsStore = create<MenuDialogsState>()((set) => ({
    isFunctionListOpen: false,
    isKeyboardShortcutsOpen: false,
    openFunctionList: () => set({ isFunctionListOpen: true }),
    closeFunctionList: () => set({ isFunctionListOpen: false }),
    openKeyboardShortcuts: () => set({ isKeyboardShortcutsOpen: true }),
    closeKeyboardShortcuts: () => set({ isKeyboardShortcutsOpen: false }),
}))
