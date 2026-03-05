import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3111';

// Clear queue before each test for isolation
async function clearQueue(page) {
  await page.evaluate(async () => {
    await fetch('/api/v1/media/queue', { method: 'DELETE' }).catch(() => {});
  });
}

test.describe('MediaApp Three-Panel Layout', () => {

  test('three panels render on /media route', async ({ page }) => {
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.media-panels', { timeout: 10000 });
    await clearQueue(page);

    // All three panels should be in the DOM
    await expect(page.locator('.media-panel--search')).toBeAttached();
    await expect(page.locator('.media-panel--browser')).toBeAttached();
    await expect(page.locator('.media-panel--player')).toBeAttached();

    // Search panel should be active by default
    await expect(page.locator('.media-panels')).toHaveClass(/media-panels--active-search/);
  });

  test('search panel has input and scope dropdown', async ({ page }) => {
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.search-home-panel', { timeout: 10000 });
    await clearQueue(page);

    const input = page.locator('.search-home-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', 'Search media...');
    await expect(page.locator('.search-home-header')).toBeVisible();
  });

  test('search returns streaming results', async ({ page }) => {
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.search-home-input', { timeout: 10000 });
    await clearQueue(page);

    const input = page.locator('.search-home-input');
    await input.fill('mozart');

    const firstResult = page.locator('.search-result-item').first();
    await expect(firstResult).toBeVisible({ timeout: 15000 });

    await expect(firstResult.locator('.search-result-title')).toBeVisible();
    await expect(firstResult.locator('.search-result-actions button').first()).toBeVisible();
  });

  test('search result click navigates to detail view', async ({ page }) => {
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.search-home-input', { timeout: 10000 });
    await clearQueue(page);

    const input = page.locator('.search-home-input');
    await input.fill('mozart');

    const resultInfo = page.locator('.search-result-info').first();
    await expect(resultInfo).toBeVisible({ timeout: 15000 });
    await resultInfo.click();

    await page.waitForURL(/\/media\/view\//, { timeout: 5000 });
    await expect(page.locator('.media-panels')).toHaveClass(/media-panels--active-browser/);
    await expect(page.locator('.content-browser-panel')).toBeVisible();
  });

  test('detail view loads for specific content', async ({ page }) => {
    await page.goto(`${BASE}/media/view/plex:653701`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await clearQueue(page);

    const title = page.locator('.content-detail-title');
    await expect(title).toBeVisible({ timeout: 15000 });

    const titleText = await title.textContent();
    expect(titleText.length).toBeGreaterThan(0);

    const hero = page.locator('.content-detail-hero');
    await expect(hero).toBeVisible({ timeout: 10000 });

    const playBtn = page.locator('.action-btn--primary').first();
    await expect(playBtn).toBeVisible();
  });

  test('play button adds to queue and shows player', async ({ page }) => {
    await page.goto(`${BASE}/media/view/plex:653701`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await clearQueue(page);

    const playBtn = page.locator('.action-btn--primary').first();
    await expect(playBtn).toBeVisible({ timeout: 15000 });
    await playBtn.click();
    await page.waitForTimeout(2000);

    const queueRes = await page.evaluate(async () => {
      const res = await fetch('/api/v1/media/queue');
      return res.json();
    });

    expect(queueRes.items.length).toBeGreaterThan(0);
    expect(queueRes.items[queueRes.position]).toBeDefined();
    expect(queueRes.items[queueRes.position].contentId).toBe('plex:653701');

    const hasPlayer = await page.locator('.media-mini-player').isVisible().catch(() => false)
      || await page.locator('.player-panel').isVisible().catch(() => false);
    expect(hasPlayer).toBe(true);
  });

  test('browser panel shows empty state when no content selected', async ({ page }) => {
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.media-panels', { timeout: 10000 });
    await clearQueue(page);

    const emptyState = page.locator('.content-browser-panel-empty');
    await expect(emptyState).toBeAttached();
  });

  test('player panel renders with NowPlaying and queue', async ({ page }) => {
    await page.goto(`${BASE}/media/play`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.media-panels', { timeout: 10000 });

    await expect(page.locator('.media-panels')).toHaveClass(/media-panels--active-player/);
    await expect(page.locator('.player-panel')).toBeVisible();
    await expect(page.locator('.player-panel-queue')).toBeAttached();
    await expect(page.locator('.player-panel-collapse')).toBeAttached();
  });

  test('search clearing shows home sections', async ({ page }) => {
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.search-home-input', { timeout: 10000 });
    await clearQueue(page);

    const input = page.locator('.search-home-input');
    await input.fill('test');
    await page.waitForTimeout(500);
    await input.fill('');

    const body = page.locator('.search-home-body');
    await expect(body).toBeVisible();
    await expect(page.locator('.search-home-sections')).toBeVisible();
  });

  test('play now from search results navigates to player', async ({ page }) => {
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.search-home-input', { timeout: 10000 });
    await clearQueue(page);

    const input = page.locator('.search-home-input');
    await input.fill('mozart');

    const firstResult = page.locator('.search-result-item').first();
    await expect(firstResult).toBeVisible({ timeout: 15000 });

    const playBtn = firstResult.locator('.search-result-actions button').first();
    await playBtn.click();

    await page.waitForURL(/\/media\/play/, { timeout: 5000 });
    await expect(page.locator('.media-panels')).toHaveClass(/media-panels--active-player/);
  });

  test('route-based panel activation works correctly', async ({ page }) => {
    // Search (default)
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await clearQueue(page);
    await page.waitForSelector('.media-panels', { timeout: 10000 });
    await expect(page.locator('.media-panels')).toHaveClass(/media-panels--active-search/);

    // Browser
    await page.goto(`${BASE}/media/view/plex:653701`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.media-panels', { timeout: 10000 });
    await expect(page.locator('.media-panels')).toHaveClass(/media-panels--active-browser/);

    // Player
    await page.goto(`${BASE}/media/play`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.media-panels', { timeout: 10000 });
    await expect(page.locator('.media-panels')).toHaveClass(/media-panels--active-player/);
  });

  test('content browser shows breadcrumbs for navigation history', async ({ page }) => {
    await page.goto(`${BASE}/media/view/plex:653701`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await clearQueue(page);

    const title = page.locator('.content-detail-title');
    await expect(title).toBeVisible({ timeout: 15000 });

    const childLink = page.locator('.content-detail-view a[href*="/media/view/"]').first();
    const hasChildLinks = await childLink.isVisible().catch(() => false);

    if (hasChildLinks) {
      await childLink.click();
      await page.waitForTimeout(1000);
      const breadcrumbs = page.locator('.content-browser-breadcrumbs');
      await expect(breadcrumbs).toBeVisible({ timeout: 5000 });
    }
  });

  test('API: media config returns valid structure', async ({ page }) => {
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const config = await page.evaluate(async () => {
      const res = await fetch('/api/v1/media/config');
      return res.json();
    });

    expect(config).toBeDefined();
    expect(Array.isArray(config.browse)).toBe(true);
    expect(config.browse.length).toBeGreaterThan(0);

    const first = config.browse[0];
    expect(first.source).toBeDefined();
    expect(first.label).toBeDefined();
  });

  test('API: search stream returns results', async ({ page }) => {
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const results = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const items = [];
        const es = new EventSource('/api/v1/content/query/search/stream?text=mozart&take=3');
        es.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.event === 'results') items.push(...(data.items || []));
          if (data.event === 'complete') { es.close(); resolve(items); }
          if (data.event === 'error') { es.close(); resolve(items); }
        };
        es.onerror = () => { es.close(); resolve(items); };
        setTimeout(() => { es.close(); resolve(items); }, 10000);
      });
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toBeDefined();
  });

  test('API: queue operations work', async ({ page }) => {
    await page.goto(`${BASE}/media`, { waitUntil: 'domcontentloaded', timeout: 15000 });

    const queue = await page.evaluate(async () => {
      const res = await fetch('/api/v1/media/queue');
      return res.json();
    });

    expect(queue).toBeDefined();
    expect(Array.isArray(queue.items)).toBe(true);
    expect(typeof queue.position).toBe('number');
  });

});
