// tests/live/flow/tv/tv-bare-list-resolution.runtime.test.mjs
// Runtime test: /tv?list=fhe resolves bare "fhe" to menu:fhe via Layer 4a/6 bareNameMap
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('TV bare list resolution', () => {
  test('/tv?list=fhe loads FHE menu items', async ({ page }) => {
    const apiErrors = [];
    page.on('response', res => {
      if (res.url().includes('/api/') && res.status() >= 400) {
        apiErrors.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto(`${FRONTEND_URL}/tv?list=fhe`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for menu items to appear (FHE submenu should render)
    await page.waitForSelector('.menu-item', { timeout: 15000 });

    const items = await page.locator('.menu-item').all();
    const labels = [];
    for (const item of items) {
      const h3 = item.locator('h3');
      if (await h3.count() > 0) {
        labels.push((await h3.textContent())?.trim());
      }
    }

    console.log(`FHE menu loaded: ${labels.length} items — ${labels.join(', ')}`);

    // FHE menu should have items
    expect(labels.length, 'FHE menu should have items').toBeGreaterThan(0);

    // Should contain known FHE items
    expect(labels).toContain('Opening Hymn');
    expect(labels).toContain('Closing Hymn');

    // No API errors (the key assertion — bare "fhe" must not 404)
    const infoErrors = apiErrors.filter(e => e.url.includes('/info/'));
    expect(infoErrors, `No /info/ API errors: ${JSON.stringify(infoErrors)}`).toHaveLength(0);
  });
});
