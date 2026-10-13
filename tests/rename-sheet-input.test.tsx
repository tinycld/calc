// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RenameSheetInput } from '../tinycld/calc/components/sheet-tabs/RenameSheetInput'

function input(container: HTMLElement) {
    const el = container.querySelector<HTMLInputElement>('rn-textinput')
    if (!el) throw new Error('no input rendered')
    return el
}

function renderInput() {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    const { container } = render(
        <RenameSheetInput initialValue="Sheet 1" onCommit={onCommit} onCancel={onCancel} />
    )
    return { el: input(container), onCommit, onCancel }
}

describe('RenameSheetInput', () => {
    afterEach(cleanup)

    it('commits the trimmed name on blur', async () => {
        const { el, onCommit, onCancel } = renderInput()
        await act(async () => {
            fireEvent.input(el, { target: { value: '  Budget  ' } })
        })
        fireEvent.focusOut(el)
        expect(onCommit).toHaveBeenCalledWith('Budget')
        expect(onCancel).not.toHaveBeenCalled()
    })

    it('cancels instead of committing an empty name', async () => {
        const { el, onCommit, onCancel } = renderInput()
        await act(async () => {
            fireEvent.input(el, { target: { value: '   ' } })
        })
        fireEvent.focusOut(el)
        expect(onCommit).not.toHaveBeenCalled()
        expect(onCancel).toHaveBeenCalledTimes(1)
    })
})
