import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const localServer = 'http://127.0.0.1:4180';
const baseURL = process.env.BASE_URL || localServer;
const target = new URL(baseURL);

if (!['http:', 'https:'].includes(target.protocol)
  || !['127.0.0.1', '[::1]', 'localhost'].includes(target.hostname)) {
  throw new Error('Browser-platform BASE_URL must be an HTTP(S) loopback URL');
}

export default defineConfig({
  testDir: '../../isolated/e2e/browser-platform',
  testMatch: '**/*.runtime.test.mjs',
  outputDir: `${repoRoot}test-results/browser-platform`,
  timeout: 35_000,
  workers: 1,
  projects: ['chromium', 'firefox', 'webkit'].map(browserName => ({
    name: browserName,
    use: { browserName },
  })),
  use: {
    baseURL,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.BASE_URL ? undefined : {
    cwd: repoRoot,
    command: `node tests/_infrastructure/harnesses/browser-platform-server.mjs ${target.port}`,
    url: localServer,
    reuseExistingServer: false,
  },
});
