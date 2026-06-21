// spreadsheet-templates.spec.ts exercises the drive-backed template flow
// for calc end-to-end, entirely through the UI (no raw PB writes to
// create the template):
//
//   1. Open a fresh workbook, rename it to a unique name, then File →
//      Export as template… → confirm the folder. This creates a
//      `<name>.tmpl.xlsx` drive file from the live workbook.
//   2. Go to the calc index, open the "From template…" picker, find the
//      just-created template by its unique name, and pick it.
//   3. Verify a new workbook opens (a fresh grid mounts).

import { expect, type Page, test } from '@playwright/test'
import { login, navigateToPackage, ORG_SLUG } from '../../tinycld/tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

test.describe('Calc — Spreadsheet templates', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('export a workbook as a template, then create a new one from it', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        // Rename to a unique name so the exported template is easy to find
        // and parallel workers don't collide on the same template name.
        const baseName = `Tmpl Source ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        await renameWorkbook(page, baseName)

        await exportAsTemplate(page)

        // Export keeps us on the current workbook (no navigation). Open the
        // picker in-app from the File menu — a navigateToPackage / goto
        // would tear down the SPA and cancel the on-demand drive_items
        // fetch the picker depends on.
        await page.getByRole('button', { name: 'File', exact: true }).click()
        await page.getByRole('menuitem', { name: 'New from template…' }).click()

        const dialog = page.getByTestId('template-picker-dialog')
        await expect(dialog).toBeVisible()

        const row = dialog.getByLabel(`Create from template: ${baseName}`)
        await expect(row).toBeVisible()
        await row.click()

        // A new workbook opens — a fresh grid mounts.
        await page.waitForURL(new RegExp(`/a/${ORG_SLUG}/calc/[^/]+`))
        await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 10_000 })
    })

    test('New from template… in the File menu opens the picker', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        await page.getByRole('button', { name: 'File', exact: true }).click()
        await page.getByRole('menuitem', { name: 'New from template…' }).click()
        await expect(page.getByTestId('template-picker-dialog')).toBeVisible()
    })
})

async function renameWorkbook(page: Page, name: string): Promise<void> {
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const input = page.getByRole('textbox', { name: 'Rename', exact: true })
    await input.fill(name)
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(page.locator('[data-test-id="calc-workbook-header"]')).toHaveText(name)
}

async function exportAsTemplate(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export as template…' }).click()
    // Export reuses drive's ChooseFolderDialog, titled `Save template
    // "<name>" to`. The confirm control is a RN Pressable (generic, not a
    // button role), so target its label text scoped to the dialog. Confirm
    // at the default folder (My Files / root).
    const dialog = page.getByTestId('choose-folder-dialog')
    await expect(dialog.getByText(/Save template ".*" to/)).toBeVisible()
    await dialog.getByText('Save template', { exact: true }).click()
}
