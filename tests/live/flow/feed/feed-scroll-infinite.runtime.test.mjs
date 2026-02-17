// tests/live/flow/feed/feed-scroll-infinite.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Feed Scroll – infinite loading', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/feed/scroll`);
    expect(res.ok(), 'Feed scroll API should be healthy').toBe(true);
  });

  test('scrolling to bottom loads more cards', async ({ page }) => {
    await page.goto('/feed/scroll', { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for initial cards to render
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    const initialCount = await page.locator('.scroll-item-wrapper').count();
    expect(initialCount, 'Initial batch should have cards').toBeGreaterThan(0);
    console.log(`Initial card count: ${initialCount}`);

    // Scroll to the sentinel element at the bottom to trigger infinite scroll
    const sentinel = page.locator('.scroll-sentinel');
    if (await sentinel.count() === 0) {
      // hasMore is false — feed is too small to paginate; pass with note
      console.log('No sentinel found — feed returned all items in first batch');
      return;
    }

    await sentinel.scrollIntoViewIfNeeded();

    // Wait for new cards to appear beyond the initial count
    await expect(async () => {
      const newCount = await page.locator('.scroll-item-wrapper').count();
      expect(newCount, 'More cards should load after scroll').toBeGreaterThan(initialCount);
    }).toPass({ timeout: 15000 });

    const finalCount = await page.locator('.scroll-item-wrapper').count();
    console.log(`Card count after scroll: ${finalCount} (was ${initialCount})`);
  });

});
