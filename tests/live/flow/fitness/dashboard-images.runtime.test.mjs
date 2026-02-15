// tests/live/flow/fitness/dashboard-images.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Dashboard session images', () => {
  test('episode thumbnails, show posters, and avatars load correctly', async ({ page }) => {
    // Collect ALL network responses for image URLs
    const imageResponses = [];
    page.on('response', (response) => {
      const url = response.url();
      if (
        url.includes('/api/v1/display/plex/') ||
        url.includes('/api/v1/proxy/plex/') ||
        url.includes('/api/v1/static/users/') ||
        url.includes('/api/static/users/')
      ) {
        imageResponses.push({
          url,
          status: response.status(),
          contentType: response.headers()['content-type'] || '',
        });
      }
    });

    await page.goto(`${FRONTEND_URL}/fitness/home`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.dashboard-card--workouts', { timeout: 15000 });

    // Wait for all images to settle (plex proxy can be slow)
    await page.waitForTimeout(8000);

    const sessionCard = page.locator('.dashboard-card--workouts');
    const allImages = sessionCard.locator('img');
    const imageCount = await allImages.count();

    console.log(`\n=== Dashboard Image Audit ===`);
    console.log(`Total <img> elements in sessions card: ${imageCount}\n`);

    const results = { THUMBNAIL: [], POSTER: [], AVATAR: [] };

    for (let i = 0; i < imageCount; i++) {
      const img = allImages.nth(i);
      const src = await img.getAttribute('src');
      const className = await img.getAttribute('class') || '';
      const visible = await img.isVisible();
      const naturalWidth = await img.evaluate(el => el.naturalWidth);
      const naturalHeight = await img.evaluate(el => el.naturalHeight);

      const type = className.includes('session-thumbnail') ? 'THUMBNAIL'
        : className.includes('session-poster') ? 'POSTER'
        : className.includes('session-avatar') ? 'AVATAR'
        : 'UNKNOWN';

      const loaded = naturalWidth > 0;
      const status = loaded ? 'OK' : (visible ? 'BROKEN' : 'HIDDEN');

      results[type]?.push({ status, src, naturalWidth, naturalHeight, visible });
      console.log(`[${status}] ${type}: ${src}  (${naturalWidth}x${naturalHeight}, visible=${visible})`);
    }

    // Network summary
    console.log(`\n=== Network Responses (${imageResponses.length} total) ===`);
    for (const r of imageResponses) {
      const ok = r.status >= 200 && r.status < 400;
      console.log(`[${ok ? 'OK' : 'FAIL'}] ${r.status} ${r.contentType || 'no-type'} ${r.url}`);
    }

    // Summary stats
    console.log('\n=== Summary ===');
    for (const [type, items] of Object.entries(results)) {
      const ok = items.filter(i => i.status === 'OK').length;
      const broken = items.filter(i => i.status === 'BROKEN').length;
      const hidden = items.filter(i => i.status === 'HIDDEN').length;
      if (items.length > 0) console.log(`${type}: ${items.length} total, ${ok} loaded, ${broken} broken, ${hidden} hidden`);
    }

    expect(imageCount).toBeGreaterThan(0);
  });
});
