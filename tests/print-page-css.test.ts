import { describe, expect, it } from 'vitest'
import { buildPageCss } from '../tinycld/calc/lib/print/page-css'
import { DEFAULT_PRINT_CONFIG } from '../tinycld/calc/lib/print/types'

describe('buildPageCss', () => {
    it('emits an @page rule with portrait orientation', () => {
        const css = buildPageCss({
            ...DEFAULT_PRINT_CONFIG,
            page: { ...DEFAULT_PRINT_CONFIG.page, orientation: 'portrait' },
        })
        expect(css).toContain('@page')
        expect(css).toContain('size: portrait')
    })

    it('emits landscape orientation', () => {
        const css = buildPageCss({
            ...DEFAULT_PRINT_CONFIG,
            page: { ...DEFAULT_PRINT_CONFIG.page, orientation: 'landscape' },
        })
        expect(css).toContain('size: landscape')
    })

    it('emits margins for each margin preset', () => {
        const normal = buildPageCss({
            ...DEFAULT_PRINT_CONFIG,
            page: { ...DEFAULT_PRINT_CONFIG.page, margins: 'normal' },
        })
        const narrow = buildPageCss({
            ...DEFAULT_PRINT_CONFIG,
            page: { ...DEFAULT_PRINT_CONFIG.page, margins: 'narrow' },
        })
        const wide = buildPageCss({
            ...DEFAULT_PRINT_CONFIG,
            page: { ...DEFAULT_PRINT_CONFIG.page, margins: 'wide' },
        })
        expect(normal).toMatch(/margin:\s*0\.75in/)
        expect(narrow).toMatch(/margin:\s*0\.25in/)
        expect(wide).toMatch(/margin:\s*1in/)
    })

    it('omits gridlines when showGridlines is false', () => {
        const css = buildPageCss({
            ...DEFAULT_PRINT_CONFIG,
            layout: { ...DEFAULT_PRINT_CONFIG.layout, showGridlines: false },
        })
        expect(css).not.toMatch(/table\.grid\s+td\s*\{[^}]*border:/)
    })

    it('emits gridlines td border when showGridlines is true', () => {
        const css = buildPageCss({
            ...DEFAULT_PRINT_CONFIG,
            layout: { ...DEFAULT_PRINT_CONFIG.layout, showGridlines: true },
        })
        expect(css).toMatch(/table\.grid\s+td.*\{[^}]*border:\s*1px solid #ccc/)
    })

    it('keeps rows together with break-inside: avoid', () => {
        const css = buildPageCss(DEFAULT_PRINT_CONFIG)
        expect(css).toMatch(/tr\s*\{[^}]*break-inside:\s*avoid/)
    })

    it('uses table-header-group for thead so repeat-rows print on each page', () => {
        const css = buildPageCss(DEFAULT_PRINT_CONFIG)
        expect(css).toMatch(/thead\s*\{[^}]*display:\s*table-header-group/)
    })

    it('omits zoom for actual scaling', () => {
        const css = buildPageCss({
            ...DEFAULT_PRINT_CONFIG,
            page: { ...DEFAULT_PRINT_CONFIG.page, scaling: 'actual' },
        })
        expect(css).not.toMatch(/zoom:/)
        expect(css).not.toMatch(/transform:\s*scale/)
    })

    it('emits a fit-width hint when scaling is fit-width', () => {
        const css = buildPageCss({
            ...DEFAULT_PRINT_CONFIG,
            page: { ...DEFAULT_PRINT_CONFIG.page, scaling: 'fit-width' },
        })
        expect(css).toMatch(/table\.grid\s*\{[^}]*width:\s*100%/)
    })
})
