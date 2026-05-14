import { create } from '@tinycld/core/lib/store'

interface PendingCopy {
    copyName: string
    sourceParentId: string
}

interface MenuDialogsState {
    isFunctionListOpen: boolean
    isKeyboardShortcutsOpen: boolean
    pendingCopy: PendingCopy | null
    openFunctionList: () => void
    closeFunctionList: () => void
    openKeyboardShortcuts: () => void
    closeKeyboardShortcuts: () => void
    openCopyDialog: (pending: PendingCopy) => void
    closeCopyDialog: () => void
}

export const useMenuDialogsStore = create<MenuDialogsState>()(set => ({
    isFunctionListOpen: false,
    isKeyboardShortcutsOpen: false,
    pendingCopy: null,
    openFunctionList: () => set({ isFunctionListOpen: true }),
    closeFunctionList: () => set({ isFunctionListOpen: false }),
    openKeyboardShortcuts: () => set({ isKeyboardShortcutsOpen: true }),
    closeKeyboardShortcuts: () => set({ isKeyboardShortcutsOpen: false }),
    openCopyDialog: pending => set({ pendingCopy: pending }),
    closeCopyDialog: () => set({ pendingCopy: null }),
}))
