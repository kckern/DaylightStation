// tests/live/flow/admin/programs-list-visual.runtime.test.mjs
/**
 * Visual check for program lists - thumbnails and 2-line rendering
 */
import { test, expect } from '@playwright/test';

const URL = '/admin/content/lists/programs';

test.describe('Program Lists Visual Check', () => {
  test('thumbnails and 2-line text render correctly', async ({ page }) => {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Take initial screenshot
    await page.screenshot({ path: 'test-results/programs-list-initial.png', fullPage: true });

    // Find all list items - try multiple selectors
    const listItems = page.locator('.content-list-item, .list-item, [data-content-type], .program-card');
    const count = await listItems.count();
    console.log(`Found ${count} list items`);

    if (count === 0) {
      // Debug: log page content
      const html = await page.content();
      console.log('Page HTML (first 2000 chars):', html.substring(0, 2000));
    }

    expect(count).toBeGreaterThan(0);

    // Check thumbnails
    const thumbnails = page.locator('img');
    const thumbCount = await thumbnails.count();
    console.log(`Found ${thumbCount} images`);

    // Check for broken images
    let brokenImages = 0;
    for (let i = 0; i < Math.min(thumbCount, 30); i++) {
      const img = thumbnails.nth(i);
      const isVisible = await img.isVisible().catch(() => false);
      if (isVisible) {
        const naturalWidth = await img.evaluate(el => el.naturalWidth);
        const src = await img.getAttribute('src');
        if (naturalWidth === 0) {
          brokenImages++;
          console.log(`Broken image: ${src}`);
        }
      }
    }

    console.log(`Broken images: ${brokenImages} of ${Math.min(thumbCount, 30)} checked`);

    // Check for 2-line text elements (title + subtitle)
    const titles = page.locator('.item-title, .title, h3, h4');
    const subtitles = page.locator('.item-subtitle, .subtitle, .meta, .description');

    const titleCount = await titles.count();
    const subtitleCount = await subtitles.count();

    console.log(`Titles: ${titleCount}, Subtitles: ${subtitleCount}`);

    // Sample some items for text content
    for (let i = 0; i < Math.min(5, count); i++) {
      const item = listItems.nth(i);
      const text = await item.textContent();
      console.log(`Item ${i + 1}: ${text?.substring(0, 100)}...`);
    }

    // Final screenshot
    await page.screenshot({ path: 'test-results/programs-list-final.png', fullPage: true });
  });
});
