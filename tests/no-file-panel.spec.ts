import { expect, test } from '@playwright/test'
import { login, navigateToPackage, ORG_SLUG } from '../../app/tests/e2e/helpers'

// The calc index renders the shared NoFilePanel whenever the user lands
// on /calc without a deep-link (the rail otherwise reopens the last
// edited file). Covers: panel is visible, three cards render with the
// right copy, the New / Browse Recent / Browse All actions all
// navigate. Upload is not exercised here because Playwright's file
// chooser flow is covered by drive's upload specs — the panel's web
// path is a label-wrapped <input type="file"> that delegates to the
// same useCreateDriveItem mutation as the rest of the app.
test.describe('Calc No-File panel', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'calc')
    })

    test('renders the headline, sublabel, and three CTA cards', async ({ page }) => {
        await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible({
            timeout: 30_000,
        })
        await expect(page.getByText('Where the next idea lands.')).toBeVisible()

        await expect(page.getByRole('button', { name: 'New sheet' })).toBeVisible()
        // The web upload card renders as a <label> wrapping a hidden
        // <input type="file">, not a button, so we assert by visible text.
        await expect(page.getByText('Upload files', { exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: 'Recent' })).toBeVisible()
        await expect(page.getByRole('link', { name: 'All' })).toBeVisible()

        // Hint copy underneath the Upload card surfaces the accepted formats.
        await expect(page.getByText('.xlsx, .csv')).toBeVisible()
    })

    test('New sheet creates a workbook and opens it', async ({ page }) => {
        await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible({
            timeout: 30_000,
        })
        await page.getByRole('button', { name: 'New sheet' }).click()

        // router.replace lands on /calc/<id>; Cell A1 mounts after the
        // realtime room opens.
        await page.waitForURL(/\/calc\/[^/]+$/, { timeout: 75_000 })
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 75_000 })
    })

    test('Browse Recent navigates to drive recent view', async ({ page }) => {
        await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible({
            timeout: 30_000,
        })
        await page.getByRole('link', { name: 'Recent' }).click()
        await page.waitForURL(new RegExp(`/a/${ORG_SLUG}/drive/recent/?$`), {
            timeout: 15_000,
        })
    })

    test('Browse All navigates to drive root', async ({ page }) => {
        await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible({
            timeout: 30_000,
        })
        await page.getByRole('link', { name: 'All' }).click()
        await page.waitForURL(new RegExp(`/a/${ORG_SLUG}/drive/?$`), {
            timeout: 15_000,
        })
    })

    test('the rail reopens the last edited workbook', async ({ page }) => {
        // Create a sheet so the rail caches a deep-link.
        await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible({
            timeout: 30_000,
        })
        await page.getByRole('button', { name: 'New sheet' }).click()
        await page.waitForURL(/\/calc\/[^/]+$/, { timeout: 75_000 })
        const editorUrl = page.url()

        // Detour through home, then click the Calc rail icon — we should
        // land back on the file we just created, not on the panel.
        await page.goto(`/a/${ORG_SLUG}`)
        await page.getByTestId('nav-calc').click()
        await page.waitForURL(editorUrl, { timeout: 15_000 })
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 30_000 })
    })
})
