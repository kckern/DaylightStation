import { defineConfig } from '@playwright/test';
// Static built frontend only. Never boots the household backend.
export default defineConfig({
  testDir: './tests/live/flow/health',
  testMatch: 'health-review.runtime.test.mjs',
  timeout: 45000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4179', headless: true, screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run preview --prefix frontend -- --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179', reuseExistingServer: false,
  },
});
