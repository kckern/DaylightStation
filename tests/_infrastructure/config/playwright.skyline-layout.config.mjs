import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
export default defineConfig({
  testDir: '../../live/flow/fitness', testMatch: 'skyline-menu-layout.runtime.test.mjs',
  outputDir: `${repo}test-results/skyline-layout`, timeout: 30000, workers: 1,
  projects: [{ name: 'firefox', use: { browserName: 'firefox' } }, { name: 'chromium', use: { browserName: 'chromium' } }],
  use: { baseURL: 'http://127.0.0.1:3197', headless: true, screenshot: 'only-on-failure' },
  webServer: { cwd: repo, command: './frontend/node_modules/.bin/vite --config tests/_fixtures/fitness/skyline-layout/vite.config.mjs', url: 'http://127.0.0.1:3197', reuseExistingServer: false, timeout: 30000 },
});
