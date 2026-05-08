const manifest = {
    name: 'Sheets',
    slug: 'sheets',
    version: '0.1.0',
    description: 'Sheets for your organization',
    routes: { directory: 'screens' },
    nav: {
        label: 'Sheets',
        icon: 'file-spreadsheet',
        order: 20,
        shortcut: 's',
    },
    sidebar: { component: 'sidebar' },
    provider: { component: 'provider' },
    migrations: { directory: 'pb-migrations' },
    collections: { register: 'collections', types: 'types' },
    seed: { script: 'seed' },
    server: { package: 'server', module: 'tinycld.org/packages/sheets' },
    dependencies: ['drive'],
}

export default manifest
