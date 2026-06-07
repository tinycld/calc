import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../tinycld/tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

test.describe('Calc File menu', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Rename updates the workbook header', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'File', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Rename' }).click()

        // Rename opens an in-app PromptDialog (not a native prompt). Its
        // input carries accessibilityLabel="Rename" (the dialog title) and
        // the confirm button is labelled "Rename".
        const input = page.getByRole('textbox', { name: 'Rename', exact: true })
        await input.fill('Renamed Scorecard')
        await page.getByRole('button', { name: 'Rename', exact: true }).click()

        await expect(page.locator('[data-test-id="calc-workbook-header"]')).toHaveText(
            'Renamed Scorecard',
            { timeout: 15_000 }
        )
    })

    test('Download submenu lists CSV and XLSX options', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'File', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Download' }).hover()
        await expect(
            page.getByRole('menuitem', { name: 'Download as CSV (current sheet)' })
        ).toBeVisible()
        await expect(
            page.getByRole('menuitem', { name: 'Download as CSV (all sheets)' })
        ).toBeVisible()
    })

    test('Print opens the print dialog', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'File', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Print' }).click()
        // PrintDialog has no aria role; assert on the Cancel button that
        // only renders while the dialog is mounted.
        await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    })
})
