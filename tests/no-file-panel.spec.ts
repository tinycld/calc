import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage, ORG_SLUG } from '../../tinycld/tests/e2e/helpers'

// The calc index renders the shared NoFilePanel whenever the user lands
// on /calc without a deep-link (the rail otherwise reopens the last
// edited file). Covers: panel is visible, three cards render with the
// right copy, the New / Browse Recent / Browse All actions all
// navigate, and Upload drops the file into a new workbook the user
// can immediately edit.
test.describe('Calc No-File panel', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'calc')
    })

    test('renders the headline, sublabel, and three CTA cards', async ({ page }) => {
        await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible()
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
        await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible()
        await page.getByRole('button', { name: 'New sheet' }).click()

        // router.replace lands on /calc/<id>; Cell A1 mounts after the
        // realtime room opens.
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 10_000 })
    })

    test('Upload xlsx creates a workbook whose cells are editable', async ({ page }) => {
        await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible()

        // The upload card hides its <input type="file"> behind a label
        // wrapper; target the panel's input by testid — a bare
        // input[type="file"] selector also matches frozen sibling screens the
        // app shell keeps mounted (freezeOnBlur), tripping strict mode. The
        // fixture is the seeded tests/assets/tiny.xlsx (10-row people list with
        // distinctive cell values like 'Dulce' and 'Hashimoto').
        const fixturePath = join(import.meta.dirname, 'assets', 'tiny.xlsx')
        await page.getByTestId('nofile-upload-input').setInputFiles(fixturePath)

        // Single .xlsx upload skips the CSV preview dialog and routes
        // straight to the editor.
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 10_000 })

        // Header row + body cells from tiny.xlsx must render — proves
        // the upload landed and the editor loaded it for editing.
        await expect(page.getByText('First Name', { exact: true })).toBeVisible()
        await expect(page.getByText('Dulce', { exact: true })).toBeVisible()
        await expect(page.getByText('Hashimoto', { exact: true })).toBeVisible()
    })

    test('Browse Recent navigates to drive recent view', async ({ page }) => {
        await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible()
        await page.getByRole('link', { name: 'Recent' }).click()
        await page.waitForURL(new RegExp(`/a/${ORG_SLUG}/drive/recent/?$`))
    })

    test('Browse All navigates to drive root', async ({ page }) => {
        await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible()
        await page.getByRole('link', { name: 'All' }).click()
        await page.waitForURL(new RegExp(`/a/${ORG_SLUG}/drive/?$`))
    })

    test('the rail reopens the last edited workbook', async ({ page }) => {
        // Create a sheet so the rail caches a deep-link.
        await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible()
        await page.getByRole('button', { name: 'New sheet' }).click()
        // Wait for the grid to actually render, not just the URL to change. The
        // rail's deep-link is cached only once the workbook's drive item loads;
        // the sheet becoming interactive (Cell A1 visible) is the
        // user-perceptible proof the file opened, so gate on that before
        // navigating away — gating on the URL alone races the cache write.
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 10_000 })
        const editorUrl = page.url()

        // Detour through home, then click the Calc rail icon — we should
        // land back on the file we just created, not on the panel.
        await page.goto(`/a/${ORG_SLUG}`)
        await page.getByTestId('nav-calc').click()
        await page.waitForURL(editorUrl)
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 10_000 })
    })
})
