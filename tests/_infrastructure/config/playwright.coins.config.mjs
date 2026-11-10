import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// A spare port. Never the household app or the dev backends (3111/3112/3113).
const baseURL = 'http://127.0.0.1:3199';

// The board's coin cells, bank screen and coin ceremony, frontend only: every
// API response is intercepted by the test, so no backend boots and no ledger
// is touched.
export default defineConfig({
  outputDir: `${repoRoot}test-results`,
  testDir: '../../live/flow/school',
  testMatch: 'coin-window-ceremony.runtime.test.mjs',
  timeout: 60_000,
  use: { baseURL, headless: true, screenshot: 'only-on-failure' },
  webServer: {
    cwd: repoRoot,
    command: 'npm run dev --prefix frontend -- --host 127.0.0.1 --port 3199 --strictPort',
    url: baseURL,
    // Always this worktree's Vite, never a stray server on the port.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
