// @vitest-environment happy-dom
//
// use-mention-suggestions is a thin delegate to core's shared, bounded
// mention search (useMentionCandidates) — see that hook's own test
// (core/tests/unit/use-mention-candidates.test.tsx) for the
// role/disabled/prefix/cap coverage. What's worth asserting here is the
// delegation: the typed `@` query reaches the search verbatim, the
// editor's `canMention` capability gates it, and the current user id
// passes through so the searcher is excluded from their own results.
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const editorMountMock = vi.fn(() => ({
    identity: { userId: 'user_me' },
    capabilities: { canMention: true },
}))
const useMentionCandidatesMock = vi.fn(() => [])

vi.mock('@tinycld/core/lib/editor/editor-mount', () => ({
    useEditorMount: () => editorMountMock(),
}))
vi.mock('@tinycld/core/lib/use-mention-candidates', () => ({
    useMentionCandidates: (search: string, options?: unknown) =>
        useMentionCandidatesMock(search, options),
}))

import { useMentionSuggestions } from '../tinycld/calc/hooks/use-mention-suggestions'

afterEach(() => {
    cleanup()
    editorMountMock.mockClear()
    useMentionCandidatesMock.mockClear()
})

describe('useMentionSuggestions', () => {
    it('passes the typed query through to the search', () => {
        renderHook(() => useMentionSuggestions('ali'))
        expect(useMentionCandidatesMock).toHaveBeenCalledWith('ali', {
            disabled: false,
            currentUserId: 'user_me',
        })
    })

    // An empty query means no `@` trigger is active. useMentionCandidates
    // treats that as "run no request", which is the whole point of the
    // bounded search — assert the empty string still reaches it rather
    // than being turned into a roster read here.
    it('passes an empty query through rather than widening the search', () => {
        renderHook(() => useMentionSuggestions(''))
        expect(useMentionCandidatesMock).toHaveBeenCalledWith('', {
            disabled: false,
            currentUserId: 'user_me',
        })
    })

    it('disables the search when the editor capability forbids mentions', () => {
        editorMountMock.mockReturnValueOnce({
            identity: { userId: 'user_me' },
            capabilities: { canMention: false },
        })
        renderHook(() => useMentionSuggestions('ali'))
        expect(useMentionCandidatesMock).toHaveBeenCalledWith('ali', {
            disabled: true,
            currentUserId: 'user_me',
        })
    })
})
