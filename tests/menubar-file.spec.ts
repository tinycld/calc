import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'

test.describe('Calc File menu', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Rename updates the workbook header', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await page.getByText('Team Scorecard.xlsx').click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 60_000 })

        page.once('dialog', async (dialog) => {
            expect(dialog.type()).toBe('prompt')
            await dialog.accept('Renamed Scorecard')
        })

        await page.getByRole('button', { name: 'File', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Rename' }).click()

        await expect(page.getByText('Renamed Scorecard', { exact: true })).toBeVisible({
            timeout: 15_000,
        })
    })

    test('Download submenu lists CSV and XLSX options', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await page.getByText('Team Scorecard.xlsx').click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 60_000 })

        await page.getByRole('button', { name: 'File', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Download' }).hover()
        await expect(page.getByRole('menuitem', { name: 'Download as XLSX' })).toBeVisible()
        await expect(
            page.getByRole('menuitem', { name: 'Download as CSV (current sheet)' })
        ).toBeVisible()
        await expect(
            page.getByRole('menuitem', { name: 'Download as CSV (all sheets)' })
        ).toBeVisible()
    })

    test('Print opens the print dialog', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await page.getByText('Team Scorecard.xlsx').click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 60_000 })

        await page.getByRole('button', { name: 'File', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Print' }).click()
        await expect(page.getByRole('dialog', { name: /Print/i })).toBeVisible()
    })
})
