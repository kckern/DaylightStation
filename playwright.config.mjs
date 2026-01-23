import { defineConfig } from '@playwright/test';
import { getAppPort } from './tests/lib/configHelper.mjs';

const appPort = getAppPort();

export default defineConfig({
  testDir: './tests/runtime',
  testMatch: '**/*.runtime.test.mjs',
  timeout: 90000,
  use: {
    baseURL: process.env.BASE_URL || `http://localhost:${appPort}`,
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${appPort}`,
    reuseExistingServer: true,
    timeout: 120000,
  }
});
