import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

test.describe('Calc View menu', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Freeze submenu lists row and column options', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'View', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Freeze' }).hover()
        await expect(page.getByRole('menuitem', { name: '1 row' })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: '1 column' })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: 'Unfreeze' })).toBeVisible()
    })

    test('Hidden sheets submenu reads "(no hidden sheets)" when none', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByRole('button', { name: 'View', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Hidden sheets' }).hover()
        await expect(page.getByRole('menuitem', { name: /no hidden sheets/i })).toBeVisible()
    })
})
