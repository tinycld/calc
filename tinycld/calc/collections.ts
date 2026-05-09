import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection } from 'pbtsdb/core'
import type { CalcSchema } from './types'

type MergedSchema = Schema & CalcSchema

export function registerCollections(
    _newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    _core: CoreStores
) {
    return {}
}
