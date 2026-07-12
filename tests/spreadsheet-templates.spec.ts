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
import { openNewSpreadsheet, waitForTemplateItem } from './_menubar-helpers'

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

        // The template must actually exist server-side before the menu can
        // offer it. exportAsTemplate confirms the folder dialog, but the
        // ChooseFolderDialog closes on click *before* the copy mutation's
        // create resolves — so at that point the `.tmpl.xlsx` row may not
        // exist yet. Confirm it landed with a read-only query (writes still
        // go through the UI; this is a read-only assertion) so we're never
        // waiting on a menu item for a row that isn't there.
        await waitForTemplateItem(page, `${baseName}.tmpl.xlsx`)

        // Export keeps us on the current workbook (no navigation). Open the
        // picker in-app from the File menu — a navigateToPackage / goto
        // would tear down the SPA and cancel the on-demand drive_items
        // fetch the picker depends on.
        //
        // "New from template…" is gated on useHasTemplates — a live query
        // over drive_items. Even after the row exists server-side it reaches
        // the already-mounted query only on the next realtime redelivery, so
        // the item can render a beat after the menu first opens. Re-open the
        // menu until the reactive query has observed the template and the
        // item renders (instead of spending the whole test budget on a
        // single open that fired one tick too early — the pre-existing
        // flake), then click it.
        await openFileMenuWithTemplates(page)
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
})

// Note: the "New from template…" entry points (File menu + index trigger)
// are hidden until the org has at least one `.tmpl.xlsx`, so the
// round-trip test above is what exercises the visible path. The
// hidden-when-empty behavior is covered deterministically by the
// useHasTemplates unit test (the shared e2e DB can't guarantee a
// template-free org once another test has exported one).

// Opens the File menu and waits for its "New from template…" item, which
// useHasTemplates renders only once its mounted drive_items live query has
// observed the just-exported `.tmpl.xlsx`. The row exists by now (the caller
// waited on it), but it reaches that persistently-mounted query only on the
// next realtime redelivery — which can land a beat after the menu first
// opens. Re-opening the menu each poll re-renders the popover against the
// freshest query result, so the item shows the moment the query catches up
// instead of the first open winning or losing the whole wait. Escape closes
// the menu between attempts so each open is a clean open, not a toggle-shut
// of an already-open menu.
async function openFileMenuWithTemplates(page: Page): Promise<void> {
    const item = page.getByRole('menuitem', { name: 'New from template…' })
    await expect(async () => {
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'File', exact: true }).click()
        await expect(item).toBeVisible({ timeout: 1_000 })
    }).toPass({ timeout: 20_000 })
}

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
