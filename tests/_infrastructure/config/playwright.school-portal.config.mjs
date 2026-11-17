import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
export default defineConfig({
  testDir: '../../isolated/e2e/school', testMatch: 'portal-design-system.spec.mjs',
  outputDir: process.env.SCHOOL_PORTAL_TEST_OUTPUT || `${repo}test-results/school-portal`, workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:43177', headless: true },
  webServer: { cwd: repo, command: './node_modules/.bin/vite --config tests/_fixtures/school/portal-design-system/vite.config.mjs --host 127.0.0.1 --port 43177 --strictPort', url: 'http://127.0.0.1:43177/tests/_fixtures/school/portal-design-system/', reuseExistingServer: false, timeout: 30000 },
});
