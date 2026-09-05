import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3114';

// The reading-shelf visual contract is intentionally frontend-only. Every API
// response is intercepted by the test, so this must never boot a second copy
// of the household backend or write to the real reading log.
export default defineConfig({
  testDir: './tests/live/flow/school',
  testMatch: 'reading-shelf-contract.runtime.test.mjs',
  timeout: 45_000,
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev --prefix frontend -- --host 127.0.0.1 --port 3114 --strictPort',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
