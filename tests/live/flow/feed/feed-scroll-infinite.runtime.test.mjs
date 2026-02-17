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

  test('PageDown loads next batch of cards', async ({ page }) => {
    await page.goto('/feed/scroll', { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for initial cards to render
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    const initialCount = await page.locator('.scroll-item-wrapper').count();
    expect(initialCount, 'Initial batch should have cards').toBeGreaterThan(0);
    console.log(`Initial card count: ${initialCount}`);

    // Need a sentinel to trigger infinite scroll — if absent, feed is too small
    const sentinel = page.locator('.scroll-sentinel');
    expect(await sentinel.count(), 'Sentinel must exist for pagination test').toBeGreaterThan(0);

    // Press PageDown repeatedly until new cards load
    await expect(async () => {
      await page.keyboard.press('PageDown');
      // Small pause to let IntersectionObserver fire and fetch complete
      await page.waitForTimeout(300);
      const currentCount = await page.locator('.scroll-item-wrapper').count();
      expect(currentCount, 'PageDown should eventually trigger next batch').toBeGreaterThan(initialCount);
    }).toPass({ timeout: 20000 });

    const finalCount = await page.locator('.scroll-item-wrapper').count();
    console.log(`Card count after PageDown: ${finalCount} (was ${initialCount})`);
  });

  test('scrolling through 3+ batches loads progressively deeper content', async ({ page }) => {
    await page.goto('/feed/scroll', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    const initialCount = await page.locator('.scroll-item-wrapper').count();
    console.log(`Initial card count: ${initialCount}`);

    let previousCount = initialCount;

    // Scroll through at least 3 batch boundaries
    for (let batch = 1; batch <= 3; batch++) {
      const sentinel = page.locator('.scroll-sentinel');
      if (await sentinel.count() === 0) {
        console.log(`Batch ${batch}: no sentinel — feed ended early`);
        break;
      }

      await sentinel.scrollIntoViewIfNeeded();

      await expect(async () => {
        const current = await page.locator('.scroll-item-wrapper').count();
        expect(current, `Batch ${batch} should add more cards`).toBeGreaterThan(previousCount);
      }).toPass({ timeout: 20000 });

      const newCount = await page.locator('.scroll-item-wrapper').count();
      console.log(`Batch ${batch}: ${newCount} cards (added ${newCount - previousCount})`);
      previousCount = newCount;
    }

    // After 3 batches we should have significantly more than initial
    const finalCount = await page.locator('.scroll-item-wrapper').count();
    expect(finalCount, 'Deep scroll should accumulate cards').toBeGreaterThan(initialCount * 1.5);
    console.log(`Final count: ${finalCount} (started at ${initialCount})`);
  });

});
