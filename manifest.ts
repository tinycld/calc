const manifest = {
    name: 'Calc',
    slug: 'calc',
    version: '0.2.2',
    description: 'Spreadsheets for your organization',
    routes: { directory: 'screens' },
    nav: {
        label: 'Calc',
        icon: 'table',
        order: 20,
        shortcut: 's',
    },
    provider: { component: 'provider' },
    help: { directory: 'help' },
    migrations: { directory: 'pb-migrations' },
    collections: { register: 'collections', types: 'types' },
    // Trigger catalog for workflow rules. The Go side
    // (server/automation.go) resolves owners through the workbook's
    // participants rather than the comment's author.
    automation: { definitions: 'automation' },
    seed: { script: 'seed' },
    server: { package: 'server', module: 'tinycld.org/packages/calc' },
    // Contributes the `tinycld calc` command group — comments only. The
    // documents themselves are drive_items, which `tinycld drive` already owns.
    cli: {
        package: 'cli',
        module: 'tinycld.org/packages/calc/cli',
        scopes: ['calc:read', 'calc:write'],
    },
    repository: { url: 'https://github.com/tinycld/calc' },
    dependencies: ['drive'],
    peerVersions: { '@tinycld/core': '>=0.0.4 <0.1.0' },
}

export default manifest
