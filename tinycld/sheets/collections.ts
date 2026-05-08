import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection } from 'pbtsdb/core'
import type { SheetsSchema } from './types'

type MergedSchema = Schema & SheetsSchema

export function registerCollections(
    _newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    _core: CoreStores
) {
    return {}
}
