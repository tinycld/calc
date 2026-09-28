import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { createCollection } from 'pbtsdb/core'
import { describe, expect, it, vi } from 'vitest'
import { registerCollections } from '../tinycld/calc/collections'

// Records every (name, options) pair registerCollections passes to
// newCollection, so we can assert the on-demand + query realtime pattern
// without standing up a real pbtsdb collection.
type NewCollectionArgs = [name: string, options: Record<string, unknown>]

function spyNewCollection() {
    const calls: NewCollectionArgs[] = []
    const factory = vi.fn((name: string, options: Record<string, unknown> = {}) => {
        calls.push([name, options])
        return { __name: name, __options: options }
    })
    return { factory, calls }
}

const fakeCoreStores = { users: { __name: 'users' } } as unknown as CoreStores

describe('calc registerCollections', () => {
    it('registers every collection on-demand with per-query realtime', () => {
        const { factory, calls } = spyNewCollection()
        registerCollections(
            factory as unknown as ReturnType<typeof createCollection>,
            fakeCoreStores
        )

        const expectedNames = ['calc_comments']
        expect(calls.map(([name]) => name)).toEqual(expectedNames)

        for (const [, options] of calls) {
            expect(options.syncMode).toBe('on-demand')
            expect(options.realtime).toBe('query')
        }
    })
})
