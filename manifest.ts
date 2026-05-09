const manifest = {
    name: 'Calc',
    slug: 'calc',
    version: '0.1.0',
    description: 'Spreadsheets for your organization',
    routes: { directory: 'screens' },
    nav: {
        label: 'Calc',
        icon: 'file-spreadsheet',
        order: 20,
        shortcut: 's',
    },
    sidebar: { component: 'sidebar' },
    provider: { component: 'provider' },
    migrations: { directory: 'pb-migrations' },
    collections: { register: 'collections', types: 'types' },
    seed: { script: 'seed' },
    server: { package: 'server', module: 'tinycld.org/packages/calc' },
    dependencies: ['drive'],
}

export default manifest
