import { describe, expect, it } from 'vitest'
import { linkUrlSchema } from '../tinycld/calc/components/link/link-url-schema'

describe('linkUrlSchema', () => {
    it('adds https:// to a bare domain', () => {
        expect(linkUrlSchema.parse({ url: 'example.com/a' }).url).toBe('https://example.com/a')
    })

    it('accepts mailto links', () => {
        expect(linkUrlSchema.parse({ url: 'mailto:a@b.co' }).url).toBe('mailto:a@b.co')
    })

    it('accepts a link to a place in the workbook as it is', () => {
        expect(linkUrlSchema.parse({ url: '#Sheet2!A1' }).url).toBe('#Sheet2!A1')
    })

    it('accepts an empty URL, which removes the link', () => {
        expect(linkUrlSchema.parse({ url: '  ' }).url).toBe('')
    })

    it('rejects text that is not a link', () => {
        expect(linkUrlSchema.safeParse({ url: 'not a link' }).success).toBe(false)
        expect(linkUrlSchema.safeParse({ url: 'javascript:alert(1)' }).success).toBe(false)
    })
})
