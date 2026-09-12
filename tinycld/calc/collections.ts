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
// `collectionOptions` literal defeats `alwaysExpand` inference in pbtsdb 0.8.0.
const indexing = {
    autoIndex: 'eager' as const,
    defaultIndexType: BasicIndex,
}

export function registerCollections(
    newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    coreStores: CoreStores
) {
    const calc_comments = newCollection('calc_comments', {
        omitOnInsert: ['created', 'updated'] as const,
        relations: { author: coreStores.users },
        alwaysExpand: ['author'],
        collectionOptions: indexing,
    })
    return { calc_comments }
}
