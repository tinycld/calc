import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'

test.describe('Sheets', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('list screen shows the seeded sheet', async ({ page }) => {
        await navigateToPackage(page, 'sheets')
        await expect(page.getByRole('heading', { level: 2, name: 'Sheets' }).first()).toBeVisible()
        await expect(page.getByText('Team Roster.xlsx')).toBeVisible()
    })

    test('opening a sheet renders cells in the correct columns', async ({ page }) => {
        await navigateToPackage(page, 'sheets')
        await page.getByText('Team Roster.xlsx').click()

        // Header row (row 1): Name | Role | Score in columns A, B, C.
        await expect(page.getByText('Name', { exact: true })).toBeVisible()
        await expect(page.getByText('Role', { exact: true })).toBeVisible()
        await expect(page.getByText('Score', { exact: true })).toBeVisible()

        // Data rows.
        await expect(page.getByText('Alice', { exact: true })).toBeVisible()
        await expect(page.getByText('Engineer', { exact: true })).toBeVisible()
        await expect(page.getByText('Bob', { exact: true })).toBeVisible()
        await expect(page.getByText('Designer', { exact: true })).toBeVisible()
        await expect(page.getByText('Carol', { exact: true })).toBeVisible()
        await expect(page.getByText('Manager', { exact: true })).toBeVisible()

        // Verify columns are correctly aligned by reading the DOM. A1
        // (Name) and B1 (Role) should be at viewport-x positions exactly
        // CELL_WIDTH (96px) apart. Pre-fix this assertion failed because
        // the body shifted right relative to the header.
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
        await navigateToPackage(page, 'sheets')
        await page.getByText('New spreadsheet').click()

        // Navigates to /a/<org>/sheets/<id>.
        await page.waitForURL(/\/sheets\/[^/]+$/, { timeout: 15_000 })
        // The title on the detail screen reflects the deduped filename
        // "Untitled.xlsx" (or "Untitled (1).xlsx" if the test ran before).
        await expect(page.getByText(/Untitled.*\.xlsx/)).toBeVisible({ timeout: 10_000 })
        // Empty sheet still renders the column header letters.
        await expect(page.getByText('A', { exact: true })).toBeVisible()
        await expect(page.getByText('Z', { exact: true })).toBeVisible()
    })
})
