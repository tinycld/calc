import path from 'node:path'
import { mergeConfig } from 'vitest/config'
import appConfig from '../tinycld/vitest.config'

export default mergeConfig(appConfig, {
    resolve: {
        alias: [{ find: /^~\/(.+)$/, replacement: path.resolve(import.meta.dirname, '$1') }],
    },
    test: {
        root: import.meta.dirname,
        include: ['tests/**/*.test.{ts,tsx}', 'tinycld/**/*.test.{ts,tsx}'],
    },
})
