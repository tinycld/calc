import { describe, expect, it } from 'vitest'
import { usePrintDialog } from '../tinycld/calc/hooks/use-print-dialog'

describe('usePrintDialog', () => {
    it('starts closed', () => {
        const state = usePrintDialog.getState()
        expect(state.isOpen).toBe(false)
    })

    it('opens and closes', () => {
        usePrintDialog.getState().open()
        expect(usePrintDialog.getState().isOpen).toBe(true)
        usePrintDialog.getState().close()
        expect(usePrintDialog.getState().isOpen).toBe(false)
    })
})
