import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'

test.describe('Calc Format menu', () => {
    test.setTimeout(120_000)
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Clear formatting wipes a styled cell', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await page.getByText('Team Scorecard.xlsx').click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 60_000 })

        const a1 = page.getByLabel('Cell A1', { exact: true })
        await a1.click()
        await page.keyboard.press('Meta+B')

        const styledFontWeight = await a1.evaluate(el => getComputedStyle(el).fontWeight)
        expect(['700', 'bold']).toContain(styledFontWeight)

        await page.getByRole('button', { name: 'Format', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Clear formatting' }).click()

        await expect
            .poll(async () => a1.evaluate(el => getComputedStyle(el).fontWeight))
            .not.toMatch(/^(700|bold)$/)
    })

    test('Text submenu lists Bold, Italic, Underline, Strikethrough', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await page.getByText('Team Scorecard.xlsx').click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 60_000 })

        await page.getByLabel('Cell A1', { exact: true }).click()
        await page.getByRole('button', { name: 'Format', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Text' }).hover()
        await expect(page.getByRole('menuitem', { name: /Bold/ })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: /Italic/ })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: /Underline/ })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: /Strikethrough/ })).toBeVisible()
    })
})
