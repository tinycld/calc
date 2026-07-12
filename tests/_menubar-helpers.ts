import { expect, type Page } from '@playwright/test'
import { ORG_SLUG, TEST_USER_EMAIL, TEST_USER_PASSWORD } from '../../tinycld/tests/e2e/helpers'

export const PB_URL = 'http://127.0.0.1:7200'

interface OrgContext {
    orgId: string
    userOrgId: string
    userId: string
}

let cachedAuthToken: string | null = null
let cachedOrgContext: OrgContext | null = null

async function authAsTestUser(): Promise<string> {
    if (cachedAuthToken) return cachedAuthToken
    const res = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: TEST_USER_EMAIL, password: TEST_USER_PASSWORD }),
    })
    if (!res.ok) {
        throw new Error(`PB auth failed: ${res.status} ${await res.text()}`)
    }
    const { token } = (await res.json()) as { token: string }
    cachedAuthToken = token
    return token
}

async function resolveOrgContext(token: string): Promise<OrgContext> {
    if (cachedOrgContext) return cachedOrgContext
    const me = await fetch(`${PB_URL}/api/collections/users/auth-refresh`, {
        method: 'POST',
        headers: { Authorization: token },
    })
    const meBody = (await me.json()) as { record?: { id: string } }
    const userId = meBody.record?.id
    if (!userId) throw new Error('auth-refresh returned no user record')

    const orgs = await fetch(
        `${PB_URL}/api/collections/orgs/records?filter=${encodeURIComponent(`slug='${ORG_SLUG}'`)}`,
        { headers: { Authorization: token } }
    )
    const orgItems = (await orgs.json()) as { items: { id: string }[] }
    if (!orgItems.items[0]) throw new Error(`Org ${ORG_SLUG} not found`)
    const orgId = orgItems.items[0].id

    const userOrgs = await fetch(
        `${PB_URL}/api/collections/user_org/records?filter=${encodeURIComponent(
            `org='${orgId}' && user='${userId}'`
        )}`,
        { headers: { Authorization: token } }
    )
    const userOrgItems = (await userOrgs.json()) as { items: { id: string }[] }
    if (!userOrgItems.items[0]) throw new Error(`user_org for ${ORG_SLUG} not found`)
    cachedOrgContext = { orgId, userOrgId: userOrgItems.items[0].id, userId }
    return cachedOrgContext
}

// Polls drive_items until a non-folder row with `name` exists in the test
// org. Read-only assertion (permitted — the template itself is created
// through the UI): the export's copy mutation resolves asynchronously after
// the ChooseFolderDialog closes, so a spec that immediately looks for the
// template in the UI can race the create. Awaiting server-visibility here
// removes that leg of the race deterministically. Uses the shared test-user
// token + resolved org context so it doesn't depend on any UI state.
export async function waitForTemplateItem(page: Page, name: string): Promise<void> {
    const token = await authAsTestUser()
    const ctx = await resolveOrgContext(token)
    const filter = encodeURIComponent(`org='${ctx.orgId}' && is_folder=false && name='${name}'`)
    await expect(async () => {
        const res = await page.request.get(
            `${PB_URL}/api/collections/drive_items/records?perPage=1&skipTotal=1&filter=${filter}`,
            { headers: { Authorization: token } }
        )
        expect(res.ok()).toBeTruthy()
        const body = (await res.json()) as { items: unknown[] }
        expect(body.items.length).toBeGreaterThan(0)
    }).toPass({ timeout: 15_000 })
}

// openNewSpreadsheet creates a fresh workbook and waits for the Grid
// to mount. The menubar specs each open their own workbook rather than
// sharing the seeded `Team Scorecard.xlsx` so a destructive test (e.g.
// Rename, Move to trash) can't poison sibling tests that run later in
// the same DB.
export async function openNewSpreadsheet(page: Page): Promise<void> {
    // Wait for the No-File panel's headline to render before clicking the
    // create button. handleCreateNew throws "Organization context not
    // ready" if useOrgInfo / useCurrentUserOrg haven't resolved yet; when
    // that happens the click silently does nothing.
    await expect(page.getByRole('heading', { level: 1, name: 'A fresh sheet.' })).toBeVisible()
    await page.getByRole('button', { name: 'New sheet' }).click()
    await expect(page.getByLabel('Cell A1', { exact: true })).toBeVisible({ timeout: 10_000 })
}
