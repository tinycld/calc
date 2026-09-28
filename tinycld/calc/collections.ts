import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection } from 'pbtsdb/core'
import { BasicIndex } from 'pbtsdb/core'
import type { CalcSchema } from './types'

// Replace (not intersect) the generated entries for calc's own collections —
// a plain intersection would merge each overlapping entry field-wise, letting
// a generated `any` absorb any typed override (see drive's collections.ts).
type MergedSchema = Omit<Schema, keyof CalcSchema> & CalcSchema

// Hoisted rather than written inline at each call site: an inline
// `collectionOptions` literal defeats `alwaysFetchRelations` inference in pbtsdb.
const indexing = {
    autoIndex: 'eager' as const,
    defaultIndexType: BasicIndex,
}

// Every collection syncs on demand and subscribes per query (pbtsdb 0.10):
// only the rows a live query asks for enter the store, and realtime covers
// exactly those rows. The server emits a delete to a subscription a row
// leaves, so a filtered view stays correct across updates.
const onDemand = { syncMode: 'on-demand', realtime: 'query' } as const

export function registerCollections(
    newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    coreStores: CoreStores
) {
    const calc_comments = newCollection('calc_comments', {
        omitOnInsert: ['created', 'updated'] as const,
        ...onDemand,
        relations: { author: coreStores.users },
        collectionOptions: indexing,
    })
    return { calc_comments }
}
