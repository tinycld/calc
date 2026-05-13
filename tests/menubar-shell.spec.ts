import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'

test.describe('Calc menubar shell', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('renders six top-level menu triggers above the toolbar', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await page.getByText('Team Scorecard.xlsx').click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 60_000 })

        for (const label of ['File', 'Edit', 'View', 'Format', 'Data', 'Help']) {
            await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
        }
    })
})
