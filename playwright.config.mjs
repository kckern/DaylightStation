import { defineConfig } from '@playwright/test';
import { getAppPort } from './tests/_lib/configHelper.mjs';

const appPort = getAppPort();

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.runtime.test.mjs',
  timeout: 90000,
  use: {
    baseURL: process.env.BASE_URL || `http://localhost:${appPort}`,
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        '--autoplay-policy=no-user-gesture-required',
        // The two flags below are required for headless Chromium to serve audio to
        // WeeklyReview's AudioBridge WebSocket stub. They auto-approve all media
        // permission requests — tests that want to verify real permission-denial
        // behavior (e.g., "preflight failure when mic is unavailable") will not
        // observe denials under this config.
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${appPort}`,
    reuseExistingServer: true,
    timeout: 120000,
  }
});
