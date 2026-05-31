import path from 'node:path'
import { defineConfig } from '@playwright/test'
import appConfig from '../app/playwright.config'

const WS_ROOT = path.resolve(import.meta.dirname, '..')
const TEST_DIR = path.join(WS_ROOT, 'node_modules', '@tinycld', 'calc', 'tests')

export default defineConfig({
    ...appConfig,
    testDir: TEST_DIR,
    // Per-test timeout. Default is 30s; calc tests routinely open xlsx
    // files (the seeded Team Scorecard, blank workbooks) where the
    // grid hydration + xlsx parse pipeline runs end-to-end inside the
    // test body. On CI under parallel load that pipeline can take
    // 30-60s for the first navigation per worker. 60s gives the spec
    // body room after the navigation overhead.
    timeout: 60_000,
})
