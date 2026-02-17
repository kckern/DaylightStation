// tests/live/flow/feed/feed-goodreads-detail.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Feed Scroll – Goodreads detail', () => {

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/feed/scroll`);
    expect(res.ok(), 'Feed scroll API should be healthy').toBe(true);
  });

  test('clicking a Goodreads card opens detail with review sections', async ({ page }) => {
    await page.goto('/feed/scroll', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    // Find a goodreads card by the GOODREADS source label
    const grCard = page.locator('.feed-card').filter({ hasText: /goodreads/i }).first();
    const grCount = await grCard.count();
    expect(grCount, 'At least one Goodreads card should be in the feed').toBeGreaterThan(0);

    await grCard.click();

    // Wait for detail view (mobile) or detail modal (desktop) to appear
    const detail = page.locator('.detail-view');
    await expect(detail).toBeVisible({ timeout: 10000 });

    // Detail should show sections (body sections from getDetail)
    const sections = detail.locator('.detail-section');
    await expect(sections.first()).toBeVisible({ timeout: 10000 });

    const sectionCount = await sections.count();
    expect(sectionCount, 'Goodreads detail should have at least 2 sections (metadata + review)').toBeGreaterThanOrEqual(2);

    console.log(`Goodreads detail rendered with ${sectionCount} sections`);
  });

  test('Goodreads hero image uses portrait aspect ratio', async ({ page }) => {
    await page.goto('/feed/scroll', { waitUntil: 'networkidle', timeout: 30000 });
    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible({ timeout: 15000 });

    const grCard = page.locator('.feed-card').filter({ hasText: /goodreads/i }).first();
    const grCount = await grCard.count();
    expect(grCount, 'At least one Goodreads card should be in the feed').toBeGreaterThan(0);

    await grCard.click();

    const detail = page.locator('.detail-view');
    await expect(detail).toBeVisible({ timeout: 10000 });

    // Hero should have portrait modifier class
    const hero = detail.locator('.detail-hero--portrait');
    await expect(hero).toBeVisible({ timeout: 5000 });

    // The image inside should use contain, not cover
    const img = hero.locator('img');
    const objectFit = await img.evaluate(el => getComputedStyle(el).objectFit);
    expect(objectFit, 'Portrait hero image should use object-fit: contain').toBe('contain');

    console.log('Portrait hero image rendered correctly');
  });

});
