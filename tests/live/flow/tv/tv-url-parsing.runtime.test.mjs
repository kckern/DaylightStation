import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:3111';

test.describe('TV URL Parsing', () => {
  test('play=plex:ID parses compound ID correctly', async ({ page }) => {
    // Capture API requests BEFORE navigating
    const apiRequests = [];
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.includes('/api/v1/')) {
        apiRequests.push(url);
      }
      route.continue();
    });

    await page.goto(`${BASE_URL}/tv?play=plex:380663`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for video to start loading
    await page.waitForTimeout(3000);

    console.log('API Requests:', apiRequests);

    // Should call /api/v1/item/plex/380663 or /content/plex/info/380663
    // NOT /media/plex:380663 (which would mean the compound ID wasn't parsed)
    const correctApiCall = apiRequests.some(url =>
      url.includes('/plex/380663') && !url.includes('plex:')
    );
    const incorrectApiCall = apiRequests.some(url => url.includes('/media/plex:'));

    expect(correctApiCall).toBe(true);
    expect(incorrectApiCall).toBe(false);

    console.log('✓ Compound ID parsed correctly - called /plex/380663');
  });

  test('play=12345 (digits only) defaults to plex source', async ({ page }) => {
    const apiRequests = [];
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.includes('/api/v1/')) {
        apiRequests.push(url);
      }
      route.continue();
    });

    await page.goto(`${BASE_URL}/tv?play=380663`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(3000);

    console.log('API Requests:', apiRequests);

    const correctApiCall = apiRequests.some(url =>
      url.includes('/plex/380663') && !url.includes('plex:')
    );
    expect(correctApiCall).toBe(true);

    console.log('✓ Digits-only ID correctly defaulted to plex source');
  });

  test('list=plex:ID parses compound ID for menu browsing', async ({ page }) => {
    const apiRequests = [];
    page.on('request', req => {
      if (req.url().includes('/api/v1/item/')) {
        apiRequests.push(req.url());
      }
    });

    await page.goto(`${BASE_URL}/tv?list=plex:380469`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    await page.waitForTimeout(2000);

    console.log('API Requests:', apiRequests);

    const correctApiCall = apiRequests.some(url => url.includes('/item/plex/380469'));
    expect(correctApiCall).toBe(true);

    console.log('✓ List compound ID parsed correctly');
  });
});
