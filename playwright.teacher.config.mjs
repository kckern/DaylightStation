import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:3113';

// Teacher visual-contract tests are intentionally frontend-only. Their API
// responses are intercepted in the test, so this must never boot the full
// household backend (which owns real device integrations).
export default defineConfig({
  testDir: './tests/live/flow/school',
  testMatch: 'teacher-workspace-contract.runtime.test.mjs',
  timeout: 30000,
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev --prefix frontend -- --host 127.0.0.1 --port 3113 --strictPort',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
