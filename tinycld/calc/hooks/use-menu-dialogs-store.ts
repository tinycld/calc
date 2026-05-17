import { create } from '@tinycld/core/lib/store'

interface MenuDialogsState {
    isFunctionListOpen: boolean
    openFunctionList: () => void
    closeFunctionList: () => void
}

export const useMenuDialogsStore = create<MenuDialogsState>()(set => ({
    isFunctionListOpen: false,
    openFunctionList: () => set({ isFunctionListOpen: true }),
    closeFunctionList: () => set({ isFunctionListOpen: false }),
}))
