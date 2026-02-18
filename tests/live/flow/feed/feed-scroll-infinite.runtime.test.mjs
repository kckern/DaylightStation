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

  test('scrolling loads progressively deeper content until feed ends', async ({ page }) => {
    await page.goto('/feed/scroll', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    const initialCount = await page.locator('.scroll-item-wrapper').count();
    console.log(`Initial card count: ${initialCount}`);

    let previousCount = initialCount;
    let batchesLoaded = 0;

    // Scroll through batch boundaries until feed ends or 5 batches loaded
    for (let batch = 1; batch <= 5; batch++) {
      const sentinel = page.locator('.scroll-sentinel');
      if (await sentinel.count() === 0) {
        console.log(`Batch ${batch}: no sentinel — feed ended`);
        break;
      }

      await sentinel.scrollIntoViewIfNeeded();

      // Wait for either new cards to appear OR sentinel to disappear
      // (sentinel disappears when pool is exhausted and all items are dupes)
      await expect(async () => {
        const current = await page.locator('.scroll-item-wrapper').count();
        const sentinelGone = await sentinel.count() === 0;
        expect(
          current > previousCount || sentinelGone,
          `Batch ${batch}: expected more cards (${current}) or feed end`
        ).toBe(true);
      }).toPass({ timeout: 20000 });

      // Check if feed ended during this fetch
      if (await sentinel.count() === 0) {
        console.log(`Batch ${batch}: feed exhausted during fetch`);
        break;
      }

      const newCount = await page.locator('.scroll-item-wrapper').count();
      console.log(`Batch ${batch}: ${newCount} cards (added ${newCount - previousCount})`);
      previousCount = newCount;
      batchesLoaded++;
    }

    const finalCount = await page.locator('.scroll-item-wrapper').count();
    expect(batchesLoaded, 'At least one additional batch should load').toBeGreaterThanOrEqual(1);
    expect(finalCount, 'Deep scroll should accumulate cards').toBeGreaterThan(initialCount);
    console.log(`Final count: ${finalCount} (started at ${initialCount}, ${batchesLoaded} batches)`);
  });

  test('scroll stops cleanly when pool is exhausted (no infinite fetch loop)', async ({ page }) => {
    const fetchCount = { value: 0 };
    // Count how many scroll API calls are made
    page.on('request', req => {
      if (req.url().includes('/api/v1/feed/scroll') && !req.url().includes('/dismiss')) {
        fetchCount.value++;
      }
    });

    await page.goto('/feed/scroll', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    const initialFetches = fetchCount.value;
    console.log(`Initial fetches: ${initialFetches}`);

    // Scroll to bottom repeatedly until feed ends
    let scrollAttempts = 0;
    while (scrollAttempts < 20) {
      const sentinel = page.locator('.scroll-sentinel');
      if (await sentinel.count() === 0) break;

      await sentinel.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1500);
      scrollAttempts++;
    }

    const totalCards = await page.locator('.scroll-item-wrapper').count();
    const totalFetches = fetchCount.value;
    console.log(`After exhausting feed: ${totalCards} cards, ${totalFetches} fetches (${scrollAttempts} scroll attempts)`);

    // Wait a bit more and check no additional fetches fire (no infinite loop)
    await page.waitForTimeout(3000);
    const fetchesAfterWait = fetchCount.value;
    console.log(`Fetches after 3s idle: ${fetchesAfterWait}`);

    expect(
      fetchesAfterWait,
      'No additional API calls should fire after feed is exhausted'
    ).toBe(totalFetches);

    // Feed should end with either no sentinel or a "Load More" button
    const sentinel = page.locator('.scroll-sentinel');
    const loadMore = page.locator('.scroll-load-more');
    const endState = page.locator('.scroll-empty');
    const hasFinalState = (await sentinel.count() === 0) &&
      ((await loadMore.count() > 0) || (await endState.count() > 0) || totalCards > 0);
    expect(hasFinalState, 'Feed should reach a stable end state').toBe(true);
  });

});
