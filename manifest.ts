const manifest = {
    name: 'Calc',
    slug: 'calc',
    version: '0.2.0',
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
    seed: { script: 'seed' },
    server: { package: 'server', module: 'tinycld.org/packages/calc' },
    repository: { url: 'https://github.com/tinycld/calc' },
    dependencies: ['drive'],
    peerVersions: { '@tinycld/core': '>=0.4.0 <0.5.0' },
}

export default manifest
