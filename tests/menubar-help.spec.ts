import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'

test.describe('Calc Help menu', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Keyboard shortcuts opens a dialog listing Calc shortcuts', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await page.getByText('Team Scorecard.xlsx').click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 60_000 })

        await page.getByRole('button', { name: 'Help', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click()

        const dialog = page.getByRole('dialog', { name: /Keyboard shortcuts/i })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByText('Copy', { exact: true })).toBeVisible()
        await expect(dialog.getByText('Find', { exact: true })).toBeVisible()
    })

    test('Function list opens a dialog listing formula functions', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await page.getByText('Team Scorecard.xlsx').click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 60_000 })

        await page.getByRole('button', { name: 'Help', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Function list' }).click()

        const dialog = page.getByRole('dialog', { name: /Function list/i })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByText('SUM', { exact: true })).toBeVisible()
    })
})
