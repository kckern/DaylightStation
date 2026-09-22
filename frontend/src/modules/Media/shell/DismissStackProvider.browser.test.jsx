// @vitest-environment node
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';

const frontendRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
let browser;
let server;
let vite;
let origin;

beforeAll(async () => {
  vite = await createViteServer({ root: frontendRoot, appType: 'custom', server: { middlewareMode: true } });
  server = http.createServer((request, response) => {
    if (request.url === '/dismiss-stack-browser-fixture.html') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html><div id="root"></div>
        <script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => type => type;
          window.__vite_plugin_react_preamble_installed__ = true;
        </script>
        <script type="module" src="/src/modules/Media/shell/DismissStackProvider.browser.fixture.jsx"></script>`);
      return;
    }
    vite.middlewares(request, response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
}, 120000);

afterAll(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
  await vite?.close();
});

describe('DismissStackProvider native Escape dispatch', () => {
  it('allows a trusted target handler to prevent default before considering dismissal', async () => {
    const page = await browser.newPage();
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    try {
      await page.goto(`${origin}/dismiss-stack-browser-fixture.html`, { waitUntil: 'commit', timeout: 10000 });
      try {
        await page.locator('#escape-target').waitFor({ timeout: 5000 });
      } catch (error) {
        throw new Error(`${error.message}\nBrowser errors: ${browserErrors.join(' | ')}`);
      }
      await page.locator('#escape-target').focus();
      await page.keyboard.press('Escape');
      await expect.poll(async () => page.locator('#target-handled').textContent(), { timeout: 5000 }).toBe('true');

      expect(await page.locator('#trusted-event').textContent()).toBe('true');
      expect(await page.locator('#dismissals').textContent()).toBe('0');
      expect(await page.locator('#event-order').textContent()).toBe('target');
    } finally {
      await page.close();
    }
  }, 15000);
});
