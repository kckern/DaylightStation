// tests/live/flow/tv/tv-submenu-url.runtime.test.mjs
// Verify /screens/living-room/fhe loads directly into the FHE submenu
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Submenu URL Navigation', () => {
  test('loads FHE submenu directly via /screens/living-room/fhe', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    await page.goto(`${BACKEND_URL}/screens/living-room/fhe`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for menu items to appear
    await page.waitForSelector('.menu-item', { timeout: 15000 });
    // Give the 500ms autoplay delay + render time
    await page.waitForTimeout(2000);

    const labels = await page.locator('.menu-item h3').allTextContents();
    const trimmed = labels.map(l => l.trim());
    console.log('Menu items:', trimmed.join(', '));

    // Should show FHE items, not base TVApp items
    expect(trimmed, 'Should contain FHE items').toContain('Opening Hymn');
    expect(trimmed, 'Should contain FHE items').toContain('Closing Hymn');
    expect(trimmed, 'Should NOT contain base menu items').not.toContain('Cartoons');

    // URL should have been cleaned to /screens/living-room
    const cleanUrl = page.url();
    console.log('Cleaned URL:', cleanUrl);
    expect(cleanUrl).not.toContain('/fhe');

    await page.close();
    await context.close();
  });
});
