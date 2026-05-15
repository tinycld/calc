import { useEffect } from 'react'
import { Platform } from 'react-native'
import { useOpenMenuStore } from '../lib/stores/open-menu-store'

// Document-level mousedown handler that closes the active calc menu
// whenever the user clicks anywhere outside a menu's marked subtree.
// "Marked" means the click target has an ancestor with
// data-calc-menu — either "trigger" (a menubar/toolbar trigger; the
// Menu component's own open/swap logic owns that case) or "content"
// (a menu popover's portaled subtree; clicks on Menu.Items live here).
//
// Mount once at the top of the calc shell. Web-only — on native there
// is no equivalent global-click signal and the menus dismiss on
// outside-tap via gluestack's overlay.
export function useOpenMenuOutsideClick(): void {
    const close = useOpenMenuStore((s) => s.close)
    useEffect(() => {
        if (Platform.OS !== 'web') return
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Element | null
            if (target == null) return
            // closest() walks up through portaled subtrees (rendered
            // inside Gluestack's Overlay still share the same DOM tree
            // on web). A click on any marked menu element is preserved
            // — the Menu component itself owns the swap or item-press.
            if (target.closest('[data-calc-menu]')) return
            close()
        }
        document.addEventListener('mousedown', onMouseDown)
        return () => document.removeEventListener('mousedown', onMouseDown)
    }, [close])
}
