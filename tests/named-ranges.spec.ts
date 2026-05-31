import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../app/tests/e2e/helpers'
import { openNewSpreadsheet } from './_menubar-helpers'

test.describe('Calc named ranges', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('Data → Named ranges opens the manager dialog', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByLabel('Cell A1', { exact: true }).click()
        await page.getByRole('button', { name: 'Data', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Named ranges…' }).click()
        await expect(page.getByText('Named ranges', { exact: true })).toBeVisible()
        await expect(page.getByText(/No named ranges yet/, { exact: false })).toBeVisible()
    })

    test('Define a workbook-global constant and use it in a formula', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByLabel('Cell A1', { exact: true }).click()
        await page.getByRole('button', { name: 'Data', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Named ranges…' }).click()
        await page.getByRole('button', { name: 'Add name', exact: true }).click()

        await page.getByLabel('Name', { exact: true }).fill('TaxRate')
        await page.getByLabel('Expression', { exact: true }).fill('=0.1')
        await page.getByRole('button', { name: 'Create' }).click()

        await expect(page.getByText('TaxRate', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Close' }).click()

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await page.getByLabel('Cell A1', { exact: true }).click()
        await formulaBar.fill('=100*TaxRate')
        // The autocomplete suggestion popover stays open after `fill`
        // (TaxRate matches the typed prefix). Escape dismisses it so
        // the next Enter commits the formula instead of re-inserting
        // the highlighted suggestion.
        await formulaBar.press('Escape')
        await formulaBar.press('Enter')

        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('10', {
            timeout: 5_000,
        })
    })

    test('Cell context menu → "Define name from selection…" opens the form pre-filled with the selection', async ({
        page,
    }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        // Select A1:A3 by shift-clicking — same pattern the sort/filter
        // context-menu tests use. The "Define from selection" entry
        // pre-fills the expression with the absolute sheet-qualified
        // form of the active selection.
        await page.getByLabel('Cell A1', { exact: true }).click()
        await page.getByLabel('Cell A3', { exact: true }).click({ modifiers: ['Shift'] })

        await page.getByLabel('Cell A2', { exact: true }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Define name from selection…' }).click()

        // The form mounts in edit-create mode. The expression field is
        // pre-filled with the absolute sheet-qualified A1 form of the
        // selection; the scope defaults to Workbook.
        await expect(page.getByLabel('Expression', { exact: true })).toHaveValue(
            '=Sheet1!$A$1:$A$3'
        )
        // ScopeChip flips its background class to `bg-accent` when the
        // option is selected. RN-Web swallows accessibilityState.selected
        // for role="radio" so the only reliable signal in the DOM is the
        // class — match the active styling there.
        await expect(page.getByLabel('Scope Workbook')).toHaveClass(/bg-accent/)

        // Saving the name lands it in the list (round-trip).
        await page.getByLabel('Name', { exact: true }).fill('FirstThree')
        await page.getByRole('button', { name: 'Create' }).click()
        await expect(page.getByText('FirstThree', { exact: true })).toBeVisible()
    })

    test('Cell context menu → "Manage named ranges…" opens the list view', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        await page.getByLabel('Cell A1', { exact: true }).click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Manage named ranges…' }).click()

        await expect(page.getByText('Named ranges', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Add name', exact: true })).toBeVisible()
    })
})
