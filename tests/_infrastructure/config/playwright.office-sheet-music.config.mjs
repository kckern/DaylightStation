import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// The office piano screen with Sheet Music, driven by simulated MIDI only.
// Backend-free: the spec answers /api/v1 itself (tests/_fixtures/piano/office-sheet-music/routes.mjs).
//   npx playwright test --config tests/_infrastructure/config/playwright.office-sheet-music.config.mjs
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const port = Number(process.env.OFFICE_SHEET_MUSIC_PORT || 3196);
export default defineConfig({
  testDir: '../../live/flow/piano', testMatch: 'office-sheet-music.runtime.test.mjs',
  outputDir: `${repo}test-results/office-sheet-music`, timeout: 90000, workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, viewport: { width: 1280, height: 720 }, screenshot: 'only-on-failure' },
  webServer: {
    cwd: repo,
    command: './frontend/node_modules/.bin/vite --config tests/_fixtures/piano/office-sheet-music/vite.config.mjs',
    url: `http://127.0.0.1:${port}`, reuseExistingServer: true, timeout: 60000,
  },
});
