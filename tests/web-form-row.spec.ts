import { expect, type Page, test } from '@playwright/test'
import {
    clickSidebarItem,
    fillAndSend,
    login,
    navigateToPackage,
    publishForm,
    visitAnonymously,
} from '@tinycld/core/e2e-helpers'

/**
 * The job-form case into a spreadsheet: a web form's destination adds a row
 * to a workbook it made from the destination dialog. The first submission
 * lands while the workbook is closed; the second while it is open, and the
 * row shows without a reload.
 */

function builder(page: Page) {
    return page.getByRole('dialog').filter({ hasText: /^(New rule|Edit rule)/ })
}

function param(page: Page, label: string) {
    return builder(page).getByText(label, { exact: true }).locator('..')
}

function cell(page: Page, ref: string) {
    return page.getByLabel(`Cell ${ref}`, { exact: true })
}

// Opens a workbook the way calc.spec.ts does: Drive's Recent view, then the
// row's "Open in Calc". A calc spec may not import drive's helpers.
async function openWorkbook(page: Page, name: string) {
    await navigateToPackage(page, 'drive', {
        waitFor: page.getByTestId('package-sidebar-mounted'),
    })
    await clickSidebarItem(page, 'Recent')
    // The frozen My Files screen stays mounted; wait for Recent to be the
    // visible one before targeting a row.
    await expect(page.getByRole('heading', { name: 'Recent', level: 1 }).first()).toBeVisible()
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click({
        button: 'right',
    })
    await page.getByRole('menuitem', { name: 'Open in Calc' }).click()
    await expect(cell(page, 'A1')).toBeVisible()
}

test('web form submissions become spreadsheet rows', async ({ page, browser }) => {
    const stamp = Date.now()
    const book = `Leads ${stamp}`
    await login(page)
    const url = await publishForm(page, `Jobs ${stamp}`)

    await page.getByTestId('web-form-add-destination').click()
    await builder(page).getByText('add action', { exact: true }).click()
    await page.getByText('Add a row to a spreadsheet', { exact: true }).click()
    await param(page, 'Spreadsheet').getByText('Select…', { exact: true }).click()
    await page.getByPlaceholder('Search…').fill(book)
    await page.getByTestId('relation-picker-create').click()
    await expect(param(page, 'Spreadsheet')).toContainText(`${book}.xlsx`)
    await builder(page).getByText('Save', { exact: true }).click()
    await expect(builder(page)).toBeHidden()

    const first = await visitAnonymously(browser, url)
    await fillAndSend(first, first, `First ${stamp}`)
    await expect(first.getByTestId('web-form-confirmation')).toBeVisible()

    await openWorkbook(page, `${book}.xlsx`)
    await expect(cell(page, 'A1')).toHaveText('Sent at')
    await expect(cell(page, 'B1')).toHaveText('Name')
    await expect(cell(page, 'C1')).toHaveText('CV')
    await expect(cell(page, 'B2')).toHaveText(`First ${stamp}`)
    await expect(cell(page, 'C2')).toHaveText('resume.pdf')

    // Open now: the next row arrives in the live grid.
    const second = await visitAnonymously(browser, url)
    await fillAndSend(second, second, `Second ${stamp}`)
    await expect(second.getByTestId('web-form-confirmation')).toBeVisible()
    await expect(cell(page, 'B3')).toHaveText(`Second ${stamp}`)
})
