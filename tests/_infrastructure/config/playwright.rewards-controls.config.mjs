import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../../', import.meta.url));
export default defineConfig({
  testDir: '../../live/flow/school', testMatch: 'rewards-controls.runtime.test.mjs',
  outputDir: `${repo}test-results/rewards-controls`, workers: 1,
  use: { baseURL: 'http://127.0.0.1:43176', headless: true },
  webServer: { cwd: repo, command: './node_modules/.bin/vite --config tests/_fixtures/school/rewards-controls/vite.config.mjs --host 127.0.0.1 --port 43176 --strictPort', url: 'http://127.0.0.1:43176/tests/_fixtures/school/rewards-controls/', reuseExistingServer: false, timeout: 30000 },
});
