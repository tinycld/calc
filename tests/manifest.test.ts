import { describe, expect, it } from 'vitest'
import manifest from '../manifest'

describe('sheets manifest', () => {
    it('declares required identifiers', () => {
        expect(manifest.name).toBe('Sheets')
        expect(manifest.slug).toBe('sheets')
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('has a description', () => {
        expect(manifest.description).toBe('Sheets for your organization')
    })
})
