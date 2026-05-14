import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'

// End-to-end: open a fresh workbook, type a small dataset, insert a
// pivot via the toolbar, drag fields into Rows + Values, assert the
// rendered output, mutate the source range and confirm recompute.
//
// Selectors are adjusted from the plan's illustrative spec to match
// the actual built components:
//   - Toolbar entry uses accessibilityLabel="Insert pivot table"
//     (PivotInsertButton wraps a ToolbarButton with that label — not
//     "Pivot table" as in the plan).
//   - Dialog field labels are "Source range" + "New sheet name". The
//     submit button is labeled "Create pivot table" (not just "Create").
//     All come from NewPivotDialog.tsx.
//   - Cells in the source grid carry accessibilityLabel="Cell A1"
//     and friends (calc.spec.ts convention); we type into cells via
//     the formula bar, never via a per-cell role textbox.
//   - Sheet tabs render with accessibilityLabel="Sheet <name>"; we
//     locate them with getByLabel rather than getByRole('tab') so we
//     don't depend on RN-Web compiling the role+name pair the way
//     Playwright expects.
//   - FieldList shortcut buttons keep the plan's labels:
//     "Add <field> to R" / "Add <field> to V".
test.describe('Calc pivot tables', () => {
    test.setTimeout(180_000)

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('insert pivot, build fields, recompute on source change', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Small dataset on Sheet1: a 2-column / 3-row table. Header
        // row (Region, Sales) plus two data rows so the pivot has
        // something to group and aggregate.
        await typeIntoCell(page, formulaBar, 'A1', 'Region')
        await typeIntoCell(page, formulaBar, 'B1', 'Sales')
        await typeIntoCell(page, formulaBar, 'A2', 'East')
        await typeIntoCell(page, formulaBar, 'B2', '10')
        await typeIntoCell(page, formulaBar, 'A3', 'West')
        await typeIntoCell(page, formulaBar, 'B3', '20')

        // Open the insert dialog.
        await page.getByRole('button', { name: 'Insert pivot table' }).click()

        // Fill the form. TextInput's accessibilityLabel mirrors the
        // form field label, so getByLabel matches.
        const sourceInput = page.getByLabel('Source range', { exact: true })
        await expect(sourceInput).toBeVisible()
        await sourceInput.fill('Sheet1!A1:B3')

        const targetInput = page.getByLabel('New sheet name', { exact: true })
        await targetInput.fill('Summary')

        await page.getByRole('button', { name: 'Create pivot table' }).click()

        // After Create:
        //   1. addSheet creates the output sheet (named "Summary")
        //   2. writePivot stores the def under doc.getMap('pivots')
        //   3. meta.set(PIVOT_SHEET_KEY, pivotId) tags the new sheet
        //   4. onActivateSheet routes the URL to ?sheet=<newId>
        //   5. usePivotPanelStore.open(newId) opens the side panel
        // The pivot has no row/col/value fields yet, so PivotGrid
        // renders the empty state with "Configure your pivot".
        await expect(page.getByLabel('Sheet Summary')).toBeVisible({ timeout: 15_000 })
        await expect(page.getByText('Configure your pivot')).toBeVisible({ timeout: 30_000 })

        // Drag fields in via the FieldList click shortcuts on the
        // side panel. Labels mirror the plan: "Add <field> to R/C/V/F".
        await page.getByLabel('Add Region to R').click()
        await page.getByLabel('Add Sales to V').click()

        // Pivot output renders. Region values plus the grand-total row
        // (rowGrandTotals defaults to true on a freshly-built pivot).
        await expect(page.getByText('East', { exact: true })).toBeVisible()
        await expect(page.getByText('West', { exact: true })).toBeVisible()
        await expect(page.getByText('Grand Total').first()).toBeVisible()

        // Sum aggregation: East=10, West=20, Grand Total=30.
        // 30 appears twice (column-total row + row-totals column intersect),
        // so just confirm at least one appears.
        await expect(page.getByText('30', { exact: true }).first()).toBeVisible()

        // Mutate the source: switch back to Sheet1, set B2 to 99. The
        // pivot engine subscribes to the source range via the Y.Doc
        // bindings, so the recompute propagates when we come back to
        // the Summary tab.
        await page.getByLabel('Sheet Sheet1').first().click()
        await typeIntoCell(page, formulaBar, 'B2', '99')

        // Switch back to the pivot sheet — recompute should have run.
        // East=99, West=20, Grand Total=119. (119 appears twice — at the
        // row-totals column intersect and the column-total row.)
        await page.getByLabel('Sheet Summary').first().click()
        await expect(page.getByText('119', { exact: true }).first()).toBeVisible({
            timeout: 15_000,
        })
    })
})

async function typeIntoCell(
    page: import('@playwright/test').Page,
    formulaBar: import('@playwright/test').Locator,
    cellLabel: string,
    value: string
): Promise<void> {
    await page.getByLabel(`Cell ${cellLabel}`, { exact: true }).click()
    await formulaBar.fill(value)
    await formulaBar.press('Enter')
}

// Click "New spreadsheet" on the calc index and wait for the workbook
// detail screen to mount. Mirrors the helper in calc.spec.ts — kept
// inline so this spec is self-contained.
async function openNewSpreadsheet(page: import('@playwright/test').Page): Promise<void> {
    await expect(page.getByRole('heading', { level: 2, name: 'Calc' }).first()).toBeVisible({
        timeout: 30_000,
    })
    await page.getByRole('button', { name: 'New spreadsheet' }).click()
    await page.waitForURL(/\/calc\/[^/]+$/, { timeout: 75_000 })
    await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 75_000 })
}
