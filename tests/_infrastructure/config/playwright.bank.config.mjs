import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const baseURL = 'http://127.0.0.1:3115';

// The bank-strip contract (economy slice 1, C3) is frontend-only, like the
// reading shelf's: every API response is intercepted by the test, so this must
// never boot a copy of the household backend or touch a real ledger.
export default defineConfig({
  outputDir: `${repoRoot}test-results`,
  testDir: '../../live/flow/school',
  testMatch: 'bank-strip-contract.runtime.test.mjs',
  timeout: 45_000,
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    cwd: repoRoot,
    command: 'npm run dev --prefix frontend -- --host 127.0.0.1 --port 3115 --strictPort',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
