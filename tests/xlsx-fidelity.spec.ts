import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { login, navigateToPackage } from '../../tinycld/tests/e2e/helpers'

// Fidelity of a Google-Sheets-exported workbook: formulas stored as
// shared formulas, M/d/yy date headers, "$" number formats, frozen
// panes, a bordered empty cell, and pivot tables. The fixture
// (tests/assets/google-export.xlsx) is a real Google export with every
// name and amount replaced; its formula results and pivot caches were
// recomputed from the new amounts. Each test uploads its own copy so
// edits never leak between tests.

const FIXTURE = join(import.meta.dirname, 'assets', 'google-export.xlsx')

const cell = (page: Page, label: string) => page.getByLabel(`Cell ${label}`, { exact: true })
const nameBox = (page: Page) => page.getByRole('textbox', { name: 'Name box' })

async function openFixture(page: Page): Promise<void> {
    await navigateToPackage(page, 'calc')
    await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible()
    await page.getByTestId('nofile-upload-input').setInputFiles(FIXTURE)
    await expect(cell(page, 'A1')).toHaveText('W/C code - pay', { timeout: 10_000 })
}

async function jumpTo(page: Page, ref: string): Promise<void> {
    await nameBox(page).fill(ref)
    await nameBox(page).press('Enter')
    await expect(cell(page, ref)).toBeVisible()
}

async function textStyleOf(page: Page, label: string, prop: 'fontFamily' | 'textAlign') {
    return page.evaluate(
        ({ label, prop }) => {
            const el = document.querySelector(`[aria-label="${label}"] div`)
            return el == null ? null : window.getComputedStyle(el)[prop]
        },
        { label: `Cell ${label}`, prop }
    )
}

test.describe('Calc xlsx import fidelity', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('imported formulas calculate and keep their formats', async ({ page }) => {
        await openFixture(page)
        await jumpTo(page, 'C34')
        await expect(cell(page, 'C34')).toHaveText('$7,800.87')
        // =C1 on a date header formats through the cell's M/d/yyyy format.
        await jumpTo(page, 'C37')
        await expect(cell(page, 'C37')).toHaveText('12/6/2024')
        await jumpTo(page, 'BD2')
        await expect(cell(page, 'BD2')).toHaveText('1.52%')
        await jumpTo(page, 'BC34')
        await expect(cell(page, 'BC34')).toHaveText('$420,323.55')
    })

    test('cells render in their font, bottom-aligned, numbers right', async ({ page }) => {
        await openFixture(page)
        expect(await textStyleOf(page, 'A2', 'fontFamily')).toContain('Calibri')
        expect(await textStyleOf(page, 'C2', 'textAlign')).toBe('right')
        expect(await textStyleOf(page, 'A2', 'textAlign')).toBe('left')
    })

    test('the editor starts from the plain value and keeps the cell font', async ({ page }) => {
        await openFixture(page)
        await cell(page, 'D2').click()
        await expect(page.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('969.39')
        // Double-click past the end of the right-aligned value.
        const d2 = await cell(page, 'D2').boundingBox()
        if (d2 == null) throw new Error('D2 has no box')
        await cell(page, 'D2').dblclick({ position: { x: d2.width - 2, y: d2.height / 2 } })
        const editor = page.locator('input:focus')
        await expect(editor).toHaveValue('969.39')
        expect(await editor.evaluate(el => window.getComputedStyle(el).fontFamily)).toContain(
            'Calibri'
        )
        // A double-click past the text puts the caret at the end (no word
        // selected), and the input fits inside the row.
        const caret = await editor.evaluate(el => {
            const input = el as HTMLInputElement
            return {
                start: input.selectionStart,
                end: input.selectionEnd,
                length: input.value.length,
                height: input.getBoundingClientRect().height,
                rowHeight: input.parentElement?.getBoundingClientRect().height ?? 0,
            }
        })
        expect(caret.start).toBe(caret.length)
        expect(caret.end).toBe(caret.length)
        expect(caret.height).toBeLessThanOrEqual(caret.rowHeight)
        // Committing without a change keeps the number and its format.
        await editor.press('Enter')
        await expect(cell(page, 'D2')).toHaveText('$969.39')
    })

    test('a double-click puts the caret where the pointer is', async ({ page }) => {
        await openFixture(page)
        // The boundary after "Avery" in "Avery Stone", measured in the
        // font the cell draws with; the cell's text starts 4px in.
        const x = await page.evaluate(() => {
            const host = document.querySelector('[aria-label="Cell B2"]')
            const text = host?.querySelector('div')
            const context = document.createElement('canvas').getContext('2d')
            if (text == null || context == null) return 0
            context.font = window.getComputedStyle(text).font
            return 4 + context.measureText('Avery').width
        })
        await cell(page, 'B2').dblclick({ position: { x, y: 10 } })
        const caret = await page
            .locator('input:focus')
            .evaluate(el => (el as HTMLInputElement).selectionStart)
        expect(caret).toBe(5)
    })

    test('a typed US date stays a date and date math works', async ({ page }) => {
        await openFixture(page)
        await jumpTo(page, 'A36')
        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await formulaBar.fill('12/31/2025')
        await formulaBar.press('Enter')
        await cell(page, 'B36').click()
        await formulaBar.fill('=A36+1')
        await formulaBar.press('Enter')
        await expect(cell(page, 'A36')).toHaveText('12/31/2025')
        await expect(cell(page, 'B36')).toHaveText('1/1/2026')
    })

    test('Enter after a run of Tabs returns to the starting column', async ({ page }) => {
        await openFixture(page)
        await jumpTo(page, 'A36')
        await page.keyboard.type('a')
        await page.keyboard.press('Tab')
        await page.keyboard.type('b')
        await page.keyboard.press('Tab')
        await page.keyboard.type('c')
        await page.keyboard.press('Enter')
        await expect(nameBox(page)).toHaveValue('A37')
        await expect(cell(page, 'C36')).toHaveText('c')
    })

    test('a link can be added, opened from its chip, and removed', async ({ page }) => {
        await openFixture(page)
        await jumpTo(page, 'A35')
        await page.getByRole('button', { name: 'Insert link' }).click()
        const url = page.getByRole('textbox', { name: 'Link' })
        await expect(url).toBeFocused()
        await url.fill('example.com/docs')
        await page.getByRole('button', { name: 'Apply' }).click()
        await expect(cell(page, 'A35')).toHaveText('https://example.com/docs')
        const chip = page.getByTestId('calc-link-chip')
        await expect(chip).toContainText('https://example.com/docs')
        await chip.getByRole('button', { name: 'Remove link' }).click()
        await expect(chip).toHaveCount(0)
    })

    test('font family and vertical alignment apply from the toolbar', async ({ page }) => {
        await openFixture(page)
        await cell(page, 'A2').click()
        await page.getByRole('button', { name: 'Font', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Georgia' }).click()
        await expect.poll(() => textStyleOf(page, 'A2', 'fontFamily')).toContain('Georgia')
        await page.getByRole('button', { name: 'Vertical align' }).click()
        await page.getByRole('menuitem', { name: 'Align top' }).click()
        await expect
            .poll(() =>
                page.evaluate(() => {
                    const el = document.querySelector('[aria-label="Cell A2"]')
                    return el == null ? null : window.getComputedStyle(el).justifyContent
                })
            )
            .toBe('flex-start')
    })

    test('long text runs on into empty cells to its right', async ({ page }) => {
        await openFixture(page)
        await jumpTo(page, 'A35')
        await page.keyboard.type('A long note that is wider than one column')
        await page.keyboard.press('Enter')
        const widths = await page.evaluate(() => {
            const host = document.querySelector('[aria-label="Cell A35"]')
            const text = host?.querySelector('div')
            return {
                cell: host?.getBoundingClientRect().width ?? 0,
                text: text?.getBoundingClientRect().width ?? 0,
            }
        })
        expect(widths.text).toBeGreaterThan(widths.cell)
        // The run-on text must not take the clicks of the cell under it.
        await cell(page, 'B35').click()
        await expect(nameBox(page)).toHaveValue('B35')
    })

    test('a sheet opens with A1 selected, and a first click on it only selects', async ({
        page,
    }) => {
        await openFixture(page)
        await expect(nameBox(page)).toHaveValue('A1')
        // The source text ends in a space; the formula bar keeps it.
        await expect(page.getByRole('textbox', { name: 'Formula bar' })).toHaveValue(
            'W/C code - pay '
        )
        await cell(page, 'A1').click()
        // Still a cell, not the editor that replaces it while editing.
        await expect(cell(page, 'A1')).toHaveText('W/C code - pay')
        await cell(page, 'A1').click()
        await expect(cell(page, 'A1')).toHaveCount(0)
    })

    test('the name box scrolls a far cell into view', async ({ page }) => {
        await openFixture(page)
        await nameBox(page).fill('BG38')
        await nameBox(page).press('Enter')
        await expect(cell(page, 'BG38')).toBeInViewport()
        await expect(cell(page, 'BG38')).toHaveText('$425,717.05')
    })

    // The detail sheet carries an autoFilter over A1:BY35 with no
    // criteria, so it imports as an active filter that hides nothing.
    test("the file's filter imports and can be removed", async ({ page }) => {
        await openFixture(page)
        const dataMenu = page.getByRole('button', { name: 'Data', exact: true })
        await dataMenu.click()
        await page.getByRole('menuitem', { name: 'Remove filter' }).click()
        await expect(cell(page, 'A2')).toBeVisible()
        await dataMenu.click()
        await expect(page.getByRole('menuitem', { name: 'Create a filter' })).toBeVisible()
    })

    test('the filter header row has filter buttons that open the column filter', async ({
        page,
    }) => {
        await openFixture(page)
        await page.getByRole('button', { name: 'Filter column 2', exact: true }).click()
        await expect(page.getByText('Filter column B', { exact: true })).toBeVisible()
        // The press opens the filter; it does not select the cell under it.
        await expect(nameBox(page)).toHaveValue('A1')
    })

    test('sheets keep the file setting for gridlines', async ({ page }) => {
        await openFixture(page)
        const bottomBorder = (label: string) =>
            page.evaluate(l => {
                const el = document.querySelector(`[aria-label="Cell ${l}"]`)
                return el == null ? null : window.getComputedStyle(el).borderBottomWidth
            }, label)
        expect(await bottomBorder('A2')).toBe('1px')
        await page.getByLabel('Sheet Summary both $ and Hours', { exact: true }).click()
        await expect(cell(page, 'A15')).toHaveText('Asbestos - 5473')
        expect(await bottomBorder('A15')).toBe('0px')
    })

    test('pivot values use the format the file gives them', async ({ page }) => {
        await openFixture(page)
        await page.getByLabel('Sheet Summary both $ and Hours pivot', { exact: true }).click()
        await expect(page.getByText('$420,323.55', { exact: true })).toBeVisible()
        // "SUM of Employee" sums a text column to 0, shown in the pivot's
        // "$" format as in Excel and Sheets.
        await expect(page.getByText('$0.00', { exact: true }).first()).toBeVisible()
    })

    test('imported formulas and editing work at phone size', async ({ page }) => {
        await openFixture(page)
        await page.setViewportSize({ width: 390, height: 844 })
        await jumpTo(page, 'C34')
        await expect(cell(page, 'C34')).toHaveText('$7,800.87')
        await jumpTo(page, 'D2')
        await expect(page.getByRole('textbox', { name: 'Formula bar' })).toHaveValue('969.39')
    })
})
