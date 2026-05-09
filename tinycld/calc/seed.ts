import ExcelJS from 'exceljs'
import type PocketBase from 'pocketbase'

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

interface SeedContext {
    user: { id: string; email: string; name: string }
    org: { id: string }
    userOrg: { id: string }
}

function log(...args: unknown[]) {
    process.stdout.write(`[seed:calc] ${args.join(' ')}\n`)
}

async function buildSampleWorkbook(): Promise<{ blob: Blob; size: number }> {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Sheet1')
    // A small known grid so e2e tests can assert specific cells render in
    // the right columns. Every value here is asserted in tests/calc.spec.ts.
    ws.addRow(['Name', 'Role', 'Score'])
    ws.addRow(['Alice', 'Engineer', 95])
    ws.addRow(['Bob', 'Designer', 88])
    ws.addRow(['Carol', 'Manager', 92])
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer
    return { blob: new Blob([buffer], { type: XLSX_MIME_TYPE }), size: buffer.byteLength }
}

export default async function seed(pb: PocketBase, ctx: SeedContext): Promise<void> {
    const { org, userOrg } = ctx
    // Disambiguate from the drive seed's own "Team Roster.xlsx" sample, which
    // is a financial-data fixture from the Drive package's `sample.xlsx`. Both
    // seeds run for every dev/test reset, and the existing-name check below
    // would otherwise skip seeding if drive already created a file by the same
    // name — leaving Calc tests pointed at the wrong workbook.
    const fileName = 'Team Scorecard.xlsx'

    const existing = await pb.collection('drive_items').getList(1, 1, {
        filter: pb.filter('org = {:org} && name = {:name}', { org: org.id, name: fileName }),
    })
    if (existing.items.length > 0) {
        log(`Skipping (already seeded): ${fileName}`)
        return
    }

    const { blob, size } = await buildSampleWorkbook()
    log(`Uploading sample sheet: ${fileName} (${size} bytes)`)

    const formData = new FormData()
    formData.append('org', org.id)
    formData.append('name', fileName)
    formData.append('is_folder', 'false')
    formData.append('mime_type', XLSX_MIME_TYPE)
    formData.append('parent', '')
    formData.append('created_by', userOrg.id)
    formData.append('size', String(size))
    formData.append('description', '')
    formData.append('file', blob, fileName)
    await pb.collection('drive_items').create(formData)
}
