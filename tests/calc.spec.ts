import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'

test.describe('Calc', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('opening a sheet renders cells in the correct columns', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await expect(page.getByRole('heading', { level: 2, name: 'Calc' }).first()).toBeVisible()
        await page.getByText('Team Scorecard.xlsx').click()

        await expect(page.getByText('Name', { exact: true })).toBeVisible()
        await expect(page.getByText('Role', { exact: true })).toBeVisible()
        await expect(page.getByText('Score', { exact: true })).toBeVisible()

        await expect(page.getByText('Alice', { exact: true })).toBeVisible()
        await expect(page.getByText('Engineer', { exact: true })).toBeVisible()
        await expect(page.getByText('Bob', { exact: true })).toBeVisible()
        await expect(page.getByText('Designer', { exact: true })).toBeVisible()
        await expect(page.getByText('Carol', { exact: true })).toBeVisible()
        await expect(page.getByText('Manager', { exact: true })).toBeVisible()

        // Verify columns are correctly aligned by reading the DOM. A1
        // (Name) and B1 (Role) should be at viewport-x positions exactly
        // CELL_WIDTH (96px) apart.
        const positions = await page.evaluate(() => {
            const find = (text: string) => {
                for (const el of Array.from(document.querySelectorAll('div'))) {
                    if (el.textContent === text && el.children.length === 0) {
                        const cell = el.parentElement
                        if (cell) {
                            const rect = cell.getBoundingClientRect()
                            return { left: rect.left, width: rect.width }
                        }
                    }
                }
                return null
            }
            return { name: find('Name'), role: find('Role'), score: find('Score') }
        })
        expect(positions.name).not.toBeNull()
        expect(positions.role).not.toBeNull()
        expect(positions.score).not.toBeNull()
        if (positions.name && positions.role && positions.score) {
            expect(positions.role.left - positions.name.left).toBeCloseTo(96, 0)
            expect(positions.score.left - positions.role.left).toBeCloseTo(96, 0)
        }
    })

    test('+ New spreadsheet creates and opens an empty sheet', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await page.getByText('New spreadsheet').click()

        await page.waitForURL(/\/calc\/[^/]+$/, { timeout: 15_000 })
        // Header columns are virtualized — only the ones in the viewport
        // render. A through E are always visible at default viewport width.
        await expect(page.getByText('A', { exact: true })).toBeVisible()
        await expect(page.getByText('E', { exact: true })).toBeVisible()
    })

    test('=SUM() over a range displays the computed total', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await page.getByText('New spreadsheet').click()
        await page.waitForURL(/\/calc\/[^/]+$/, { timeout: 15_000 })

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Cells fire onPress → first press selects, second press opens the
        // editor. The formula bar always edits the selected cell, so a
        // single click + typing into the formula bar is the simplest way
        // to drive cell input from a test.
        await typeIntoCell(page, formulaBar, 'A1', '2')
        await typeIntoCell(page, formulaBar, 'A2', '3')
        await typeIntoCell(page, formulaBar, 'A3', '=SUM(A1:A2)')

        // After the Enter commit, A3 stays selected. Move the selection
        // away by clicking B1 so a re-click on A3 lands as "select" (not
        // "select-then-edit"), and so the formula bar shows A3's formula
        // text rather than B1's empty draft.
        await page.getByLabel('Cell B1', { exact: true }).click()
        await page.getByLabel('Cell A3', { exact: true }).click()
        await expect(formulaBar).toHaveValue('=SUM(A1:A2)')
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveText('5')
    })
})

async function typeIntoCell(
    page: import('@playwright/test').Page,
    formulaBar: import('@playwright/test').Locator,
    cellLabel: string,
    value: string
): Promise<void> {
    await page.getByLabel(`Cell ${cellLabel}`, { exact: true }).click()
    await formulaBar.fill(value)
    await formulaBar.press('Enter')
}
