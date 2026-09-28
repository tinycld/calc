// @vitest-environment happy-dom
//
// use-mention-suggestions is a thin delegate to core's shared, bounded
// mention search (useMentionCandidates) — see that hook's own test
// (core/tests/unit/use-mention-candidates.test.tsx) for the
// role/disabled/prefix/cap coverage. What's worth asserting here is the
// delegation: the typed `@` query reaches the search verbatim, an
// editor mount's `canMention` capability gates it, the current user id
// passes through so the searcher is excluded from their own results,
// and — the regression this hook was rewritten for — that it renders
// at all with no EditorMountProvider above it.
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Mount = {
    identity: { userId: string }
    capabilities: { canMention: boolean }
} | null

const editorMountMock = vi.fn<() => Mount>(() => ({
    identity: { userId: 'user_me' },
    capabilities: { canMention: true },
}))
const useMentionCandidatesMock = vi.fn(() => [])

vi.mock('@tinycld/core/lib/editor/editor-mount', () => ({
    useEditorMountOptional: () => editorMountMock(),
}))
// Forwards its arguments, so a test can assert HOW the hook calls useAuth —
// notably that it passes no `throwIfAnon: false`, keeping core's throwing
// anonymous default (see core/lib/__tests__/use-auth-anon.test.tsx).
const authMock = vi.fn((_options?: { throwIfAnon: boolean }) => ({ user: { id: 'user_auth' } }))
vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: (options?: { throwIfAnon: boolean }) => authMock(options),
}))
vi.mock('@tinycld/core/lib/use-mention-candidates', () => ({
    useMentionCandidates: (search: string, options?: unknown) =>
        useMentionCandidatesMock(search, options),
}))

import { useMentionSuggestions } from '../tinycld/calc/hooks/use-mention-suggestions'

afterEach(() => {
    cleanup()
    editorMountMock.mockClear()
    authMock.mockClear()
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

    // The regression: the comments composer is rendered by surfaces
    // that are not all under the workbook screen's
    // EditorMountProvider. Reading the mount as a requirement threw
    // there and the error boundary replaced the whole screen. With no
    // mount the hook must still run, fall back to the authed user, and
    // leave the search enabled — the app-level auth gate is the only
    // one that applies.
    it('runs with no editor mount, falling back to the authed user', () => {
        editorMountMock.mockReturnValueOnce(null)
        renderHook(() => useMentionSuggestions('ali'))
        expect(useMentionCandidatesMock).toHaveBeenCalledWith('ali', {
            disabled: false,
            currentUserId: 'user_auth',
        })
    })

    // The mount-less path leaves the search ENABLED, which is only safe
    // because `useAuth()` throws for an anonymous viewer (it defaults to
    // `throwIfAnon: true`), so the hook cannot run at all without an authed
    // identity. That default is core's, and `useAuth` is MOCKED here — making
    // the mock throw and asserting it throws is a tautology, so the assertion
    // lives against the real hook in
    // core/lib/__tests__/use-auth-anon.test.tsx. What this test can pin is the
    // delegation: the hook reads the identity from `useAuth` with no options,
    // so it gets that throwing default rather than opting out of it.
    it('reads the authed identity with no opt-out of the anonymous guard', () => {
        editorMountMock.mockReturnValueOnce(null)
        renderHook(() => useMentionSuggestions('ali'))
        expect(authMock).toHaveBeenCalled()
        for (const [options] of authMock.mock.calls) {
            expect(options?.throwIfAnon).not.toBe(false)
        }
    })
})
