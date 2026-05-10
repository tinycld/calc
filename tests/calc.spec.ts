import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '../../../../tests/e2e/helpers'

test.describe('Calc', () => {
    // Bump the test timeout: tests that hit "New spreadsheet" wait on a
    // drive_items create round-trip plus a Y.Doc realtime handshake, and
    // both can be slow under parallel-worker contention against a single
    // dev backend. The default 30s leaves no headroom.
    test.setTimeout(120_000)

    test.beforeEach(async ({ page }) => {
        await login(page)
    })

    test('opening a sheet renders cells in the correct columns', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await expect(page.getByRole('heading', { level: 2, name: 'Calc' }).first()).toBeVisible()
        await page.getByText('Team Scorecard.xlsx').click()

        await expect(page.getByText('Name', { exact: true })).toBeVisible()
        await expect(page.getByText('Role', { exact: true })).toBeVisible()
        await expect(page.getByText('Score', { exact: true })).toBeVisible()

        await expect(page.getByText('Alice', { exact: true })).toBeVisible()
        await expect(page.getByText('Engineer', { exact: true })).toBeVisible()
        await expect(page.getByText('Bob', { exact: true })).toBeVisible()
        await expect(page.getByText('Designer', { exact: true })).toBeVisible()
        await expect(page.getByText('Carol', { exact: true })).toBeVisible()
        await expect(page.getByText('Manager', { exact: true })).toBeVisible()

        // Verify columns are correctly aligned by reading the DOM. A1
        // (Name) and B1 (Role) should be at viewport-x positions exactly
        // CELL_WIDTH (96px) apart.
        const positions = await page.evaluate(() => {
            const find = (text: string) => {
                for (const el of Array.from(document.querySelectorAll('div'))) {
                    if (el.textContent === text && el.children.length === 0) {
                        const cell = el.parentElement
                        if (cell) {
                            const rect = cell.getBoundingClientRect()
                            return { left: rect.left, width: rect.width }
                        }
                    }
                }
                return null
            }
            return { name: find('Name'), role: find('Role'), score: find('Score') }
        })
        expect(positions.name).not.toBeNull()
        expect(positions.role).not.toBeNull()
        expect(positions.score).not.toBeNull()
        if (positions.name && positions.role && positions.score) {
            expect(positions.role.left - positions.name.left).toBeCloseTo(96, 0)
            expect(positions.score.left - positions.role.left).toBeCloseTo(96, 0)
        }
    })

    test('+ New spreadsheet creates and opens an empty sheet', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)
        // Header columns are virtualized — only the ones in the viewport
        // render. A through E are always visible at default viewport width.
        await expect(page.getByText('A', { exact: true })).toBeVisible()
        await expect(page.getByText('E', { exact: true })).toBeVisible()
    })

    test('dragging a column-resize handle widens the column', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        // Headers A and B are absolute-positioned. Capture their start
        // positions, drag the boundary handle ~100px right, then verify
        // both A widened and B shifted right by the same amount.
        const before = await readHeaderRects(page)
        expect(before.A).not.toBeNull()
        expect(before.B).not.toBeNull()

        // The resize handle is a transparent absolute element straddling
        // the right edge of column A. We can locate it by the cursor
        // style react-native-web emits inline.
        const handles = page.locator('div[style*="cursor: col-resize"]')
        const aHandle = handles.first()
        await aHandle.waitFor({ state: 'attached' })
        const box = await aHandle.boundingBox()
        if (box == null) throw new Error('resize handle has no box')
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 })
        await page.mouse.up()

        const after = await readHeaderRects(page)
        if (before.A && after.A) {
            expect(after.A.width - before.A.width).toBeCloseTo(100, 0)
        }
        if (before.B && after.B) {
            expect(after.B.left - before.B.left).toBeCloseTo(100, 0)
        }
    })

    test('double-clicking the column-resize handle autosizes to fit content', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        await typeIntoCell(page, formulaBar, 'A1', 'a fairly long string that should autosize')

        const before = await readHeaderRects(page)
        expect(before.A).not.toBeNull()

        const handles = page.locator('div[style*="cursor: col-resize"]')
        const aHandle = handles.first()
        const box = await aHandle.boundingBox()
        if (box == null) throw new Error('resize handle has no box')
        await aHandle.dblclick()

        const after = await readHeaderRects(page)
        if (before.A && after.A) {
            // Autosize should grow column A — exact width depends on
            // browser font metrics, so we just assert it's wider than
            // the default 96px.
            expect(after.A.width).toBeGreaterThan(before.A.width)
        }
    })

    test('formula function autocomplete: typing =LE shows LEFT/LEN, Tab inserts', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Open A1 and start typing a formula prefix. The dropdown is
        // derived from the live draft+cursor, so suggestions only render
        // once at least one letter has been typed after `=`.
        await page.getByLabel('Cell A1', { exact: true }).click()
        await formulaBar.focus()
        await formulaBar.fill('=LE')

        // Both LEFT and LEN match the LE prefix.
        await expect(page.getByText('LEFT', { exact: true })).toBeVisible()
        await expect(page.getByText('LEN', { exact: true })).toBeVisible()

        // Tab inserts the highlighted item plus an open paren.
        await formulaBar.press('Tab')
        await expect(formulaBar).toHaveValue('=LEFT(')

        // Cancel without committing — the goal of this test is the UI
        // flow, not a successful evaluation.
        await formulaBar.press('Escape')
        await formulaBar.press('Escape')
    })

    test('formula function autocomplete: ArrowDown moves highlight before Tab inserts', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        await page.getByLabel('Cell A1', { exact: true }).click()
        await formulaBar.focus()
        await formulaBar.fill('=LE')

        // First item is LEFT (alphabetical). ArrowDown moves to the
        // next match; Tab inserts whatever's highlighted.
        await expect(page.getByText('LEFT', { exact: true })).toBeVisible()
        await formulaBar.press('ArrowDown')
        await formulaBar.press('Tab')

        // Whatever the second entry is, the inserted text starts with
        // `=` and is followed by an open paren. Asserting on the open-
        // paren shape (rather than a specific function) keeps the test
        // resilient to HF function-pack changes.
        const value = await formulaBar.inputValue()
        expect(value).toMatch(/^=[A-Z]+\($/)
        expect(value).not.toBe('=LEFT(')

        await formulaBar.press('Escape')
        await formulaBar.press('Escape')
    })

    test('cell-ref insertion: clicking a cell mid-formula inserts its address', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Seed B5 so the inserted ref evaluates to a concrete number.
        await typeIntoCell(page, formulaBar, 'B5', '42')

        // Start a formula in A1, leave the cursor in a ref-acceptable
        // position (right after `=`), then click B5. The Grid intercepts
        // the cell tap (editSession active + ref-acceptable cursor) and
        // inserts B5 at the cursor instead of moving selection.
        await page.getByLabel('Cell A1', { exact: true }).click()
        await formulaBar.focus()
        await formulaBar.fill('=')

        await page.getByLabel('Cell B5', { exact: true }).click()
        await expect(formulaBar).toHaveValue('=B5')

        // Commit and verify the formula evaluates.
        await formulaBar.press('Enter')
        await page.getByLabel('Cell B1', { exact: true }).click()
        await page.getByLabel('Cell A1', { exact: true }).click()
        await expect(formulaBar).toHaveValue('=B5')
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('42')
    })

    test('cell-ref insertion: works inside an open function call', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Seed A2 and A3 so SUM has something to add.
        await typeIntoCell(page, formulaBar, 'A2', '10')
        await typeIntoCell(page, formulaBar, 'A3', '20')

        // Start =SUM( in A1, click A2 → "=SUM(A2", type a comma, click
        // A3 → "=SUM(A2,A3", close the paren and commit.
        await page.getByLabel('Cell A1', { exact: true }).click()
        await formulaBar.focus()
        await formulaBar.fill('=SUM(')

        await page.getByLabel('Cell A2', { exact: true }).click()
        await expect(formulaBar).toHaveValue('=SUM(A2')

        await formulaBar.focus()
        await formulaBar.press('End')
        await formulaBar.type(',')

        await page.getByLabel('Cell A3', { exact: true }).click()
        await expect(formulaBar).toHaveValue('=SUM(A2,A3')

        await formulaBar.focus()
        await formulaBar.press('End')
        await formulaBar.type(')')
        await formulaBar.press('Enter')

        await page.getByLabel('Cell B1', { exact: true }).click()
        await page.getByLabel('Cell A1', { exact: true }).click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('30')
    })

    test('undo/redo toolbar buttons revert and reapply edits', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        const undoBtn = page.getByRole('button', { name: 'Undo' })
        const redoBtn = page.getByRole('button', { name: 'Redo' })

        // Fresh sheet: nothing to undo yet. The buttons should be
        // disabled. RN-Web emits accessibilityState.disabled as
        // aria-disabled on the rendered DOM node.
        await expect(undoBtn).toHaveAttribute('aria-disabled', 'true')
        await expect(redoBtn).toHaveAttribute('aria-disabled', 'true')

        // Type something, then move selection away so re-clicking A1
        // selects (rather than re-edits) when we want to verify text.
        await typeIntoCell(page, formulaBar, 'A1', 'hello')
        await page.getByLabel('Cell B1', { exact: true }).click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('hello')

        // Undo is now available; click it and the cell empties.
        await expect(undoBtn).not.toHaveAttribute('aria-disabled', 'true')
        await undoBtn.click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('')

        // After the undo, redo should be available; click and the
        // value comes back.
        await expect(redoBtn).not.toHaveAttribute('aria-disabled', 'true')
        await redoBtn.click()
        await expect(page.getByLabel('Cell A1', { exact: true })).toHaveText('hello')
    })

    test('typing in a cell then clicking another commits the value instead of dropping it', async ({ page }) => {
        // Regression: clicking a different cell while editing used to
        // discard the in-flight draft. Web preventDefault on mousedown
        // (added so cell-ref insertion can fire mid-formula) suppresses
        // the input's onBlur, so the click-away has to perform the
        // commit explicitly.
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const a1 = page.getByLabel('Cell A1', { exact: true })
        const b2 = page.getByLabel('Cell B2', { exact: true })

        // Two clicks open the in-cell editor (first selects, second edits).
        // The cell editor TextInput has no accessibility label, so we
        // type via the focused element. autoFocus on mount means
        // keyboard input lands in the editor without an extra .focus().
        await a1.click()
        await a1.click()
        await page.keyboard.type('hello world')

        // Click away to a different cell — value must persist.
        await b2.click()
        await expect(a1).toHaveText('hello world')
    })

    test('Delete key on a focused cell clears its contents', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })
        const a1 = page.getByLabel('Cell A1', { exact: true })
        const a2 = page.getByLabel('Cell A2', { exact: true })

        // Seed two cells, then move selection back to the first one so
        // it's the focused (selected, not-editing) cell when we press
        // Delete. typeIntoCell ends with Enter, which leaves the cell
        // committed and selected — but we click B1 first to break the
        // "second click opens editor" gesture that a re-click on A1
        // would otherwise trigger.
        await typeIntoCell(page, formulaBar, 'A1', 'hello')
        await typeIntoCell(page, formulaBar, 'A2', 'world')
        await page.getByLabel('Cell B1', { exact: true }).click()
        await a1.click()
        await expect(a1).toHaveText('hello')

        await page.keyboard.press('Delete')
        await expect(a1).toHaveText('')

        // Backspace works the same way on the next cell.
        await a2.click()
        await expect(a2).toHaveText('world')
        await page.keyboard.press('Backspace')
        await expect(a2).toHaveText('')
    })

    test('=SUM() over a range displays the computed total', async ({ page }) => {
        await navigateToPackage(page, 'calc')
        await openNewSpreadsheet(page)

        const formulaBar = page.getByRole('textbox', { name: 'Formula bar' })

        // Cells fire onPress → first press selects, second press opens the
        // editor. The formula bar always edits the selected cell, so a
        // single click + typing into the formula bar is the simplest way
        // to drive cell input from a test.
        await typeIntoCell(page, formulaBar, 'A1', '2')
        await typeIntoCell(page, formulaBar, 'A2', '3')
        await typeIntoCell(page, formulaBar, 'A3', '=SUM(A1:A2)')

        // After the Enter commit, A3 stays selected. Move the selection
        // away by clicking B1 so a re-click on A3 lands as "select" (not
        // "select-then-edit"), and so the formula bar shows A3's formula
        // text rather than B1's empty draft.
        await page.getByLabel('Cell B1', { exact: true }).click()
        await page.getByLabel('Cell A3', { exact: true }).click()
        await expect(formulaBar).toHaveValue('=SUM(A1:A2)')
        await expect(page.getByLabel('Cell A3', { exact: true })).toHaveText('5')
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

// Click the "New spreadsheet" button on the calc index, wait for the
// detail URL, and wait for the Grid (column A header) to render. The
// detail screen flips through "Loading…" / "Opening…" placeholders
// before mounting the Grid; tests that read DOM geometry or click
// cells immediately after waitForURL race that mount.
async function openNewSpreadsheet(page: import('@playwright/test').Page): Promise<void> {
    // Wait for the calc index to fully render before clicking the create
    // button. handleNew inside CalcIndex throws "Organization context not
    // ready" if useOrgInfo / useCurrentUserOrg haven't resolved yet, and
    // when that happens the click silently does nothing — the page stays
    // on the index and the subsequent waitForURL hangs until the test
    // timeout.
    await expect(page.getByRole('heading', { level: 2, name: 'Calc' }).first()).toBeVisible({ timeout: 30_000 })
    const newBtn = page.getByRole('button', { name: 'New spreadsheet' })
    await newBtn.click()
    // The click triggers an async create + navigation. Under parallel-
    // worker contention either the create or the realtime open can take
    // longer than usual, so the URL/grid waits use a generous timeout.
    // 90s aligns with the file-level test timeout above.
    await page.waitForURL(/\/calc\/[^/]+$/, { timeout: 75_000 })
    await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 75_000 })
}

// Reads the on-screen left/width of column-header cells A and B.
// Header cells contain a single text node ("A" / "B") inside an
// absolute-positioned <View>; the rect of that parent is what
// callers compare across resize gestures.
async function readHeaderRects(
    page: import('@playwright/test').Page
): Promise<{ A: { left: number; width: number } | null; B: { left: number; width: number } | null }> {
    return page.evaluate(() => {
        const find = (text: string) => {
            for (const el of Array.from(document.querySelectorAll('div'))) {
                if (el.textContent === text && el.children.length === 0) {
                    const cell = el.parentElement
                    if (cell) {
                        const rect = cell.getBoundingClientRect()
                        return { left: rect.left, width: rect.width }
                    }
                }
            }
            return null
        }
        return { A: find('A'), B: find('B') }
    })
}
