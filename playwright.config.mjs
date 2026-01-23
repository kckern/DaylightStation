import { defineConfig } from '@playwright/test';
import { getPorts } from './tests/lib/configHelper.mjs';

const ports = getPorts();

export default defineConfig({
  testDir: './tests/runtime',
  testMatch: '**/*.runtime.test.mjs',
  timeout: 90000,
  use: {
    baseURL: process.env.BASE_URL || `http://localhost:${ports.frontend}`,
    headless: true,
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${ports.frontend}`,  // Wait for Vite dev server
    reuseExistingServer: true,
    timeout: 120000,
  }
});
