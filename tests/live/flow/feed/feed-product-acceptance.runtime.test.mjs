import { test, expect } from '@playwright/test';

const NOW = '2026-08-24T17:00:00.000Z';

function state(overrides = {}) {
  return { isRead: false, isSaved: false, isArchived: false, syncStatus: 'synced', ...overrides };
}

function scrollItem(index) {
  return {
    id: `scroll-${index}`,
    stateKey: `scroll-${index}`,
    title: `Discovery story ${index}`,
    summary: 'A representative summary used to verify bounded card rendering and readable formatting.',
    source: index % 2 ? 'headlines' : 'reddit',
    sourceInfo: { id: index % 2 ? 'headlines' : 'reddit', type: index % 2 ? 'headlines' : 'reddit', label: index % 2 ? 'Daily Wire' : 'Reddit' },
    tier: index % 4 === 0 ? 'library' : 'wire',
    contentType: 'article',
    publishedAt: NOW,
    link: `https://example.test/discovery-${index}`,
    state: state(),
  };
}

async function installFeedRoutes(page) {
  await page.route('**/api/v1/feed/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });

    if (path.endsWith('/workspace')) return json({
      preferencesStored: true,
      preferences: { theme: 'dark', density: 'comfortable', fontScale: 1, lineHeight: 1.65, measure: 72, sessionBudget: 0 },
      sourcePreferences: {},
      checkpoints: {},
    });
    if (path.endsWith('/items/state/summary')) return json({ unread: 12, readerUnread: 4, saved: 3, archived: 1, pendingSync: 0 });
    if (path.endsWith('/headlines/pages')) return json([{ id: 'mainstream', label: 'Daily' }, { id: 'technology', label: 'Technology' }]);
    if (path.endsWith('/reader/feeds')) return json([{ id: 'feed/1', title: 'World', category: 'News', unread: 4 }]);
    if (path.endsWith('/reader/stream')) return json({
      items: Array.from({ length: 75 }, (_, index) => ({
        id: `reader-${index}`,
        stateKey: `reader-${index}`,
        title: `Reader article ${index}`,
        preview: 'A concise preview that remains legible in the scanning row.',
        content: '<p>Readable article text with enough detail to exercise the expanded reading presentation.</p>',
        link: `https://example.test/reader-${index}`,
        feedTitle: 'World',
        published: NOW,
        publishedAt: NOW,
        state: state(),
      })),
      continuation: null,
      exhausted: true,
    });
    if (path.endsWith('/search')) return json({
      items: [{
        id: 'reader-saved-old', stateKey: 'reader-saved-old', title: 'Saved from last month', summary: 'A durable Reader history result.',
        url: 'https://example.test/saved-old', publishedAt: '2026-07-01T12:00:00.000Z', source: 'freshrss',
        sourceInfo: { id: 'feed/1', type: 'freshrss', label: 'World' }, origins: ['reader'], state: state({ isRead: true, isSaved: true }),
      }],
      total: 1,
      nextCursor: null,
      coverage: { retentionMonths: 12, status: 'complete' },
    });
    if (path.endsWith('/headlines')) {
      const coverage = [
        { id: 'headline-1', stateKey: 'headline-1', title: 'Coastal communities prepare for a major storm', url: 'https://one.test/storm', sourceId: 'one', sourceLabel: 'One News', publishedAt: '2026-08-24T15:00:00.000Z', source: 'headlines', state: state() },
        { id: 'headline-2', stateKey: 'headline-2', title: 'Update: coastal communities prepare for major storm', url: 'https://two.test/storm', sourceId: 'two', sourceLabel: 'Two News', publishedAt: '2026-08-24T16:00:00.000Z', source: 'headlines', state: state() },
      ];
      return json({
        grid: { rows: [0], cols: [0, 1] },
        col_colors: ['#234', '#432'],
        lastHarvest: NOW,
        configWarnings: [],
        sources: {
          one: { id: 'one', label: 'One News', row: 0, col: 0, url: 'https://one.test', items: [coverage[0]] },
          two: { id: 'two', label: 'Two News', row: 0, col: 1, url: 'https://two.test', items: [coverage[1]] },
        },
        briefing: [{ id: 'storm', title: coverage[1].title, excerpt: 'Two outlets are following the developing weather story.', publishedAt: coverage[1].publishedAt, leadSource: 'Two News', sourceCount: 2, coverage, timeline: [{ ...coverage[0], kind: 'report' }, { ...coverage[1], kind: 'update' }] }],
      });
    }
    if (path.endsWith('/scroll/sessions') && request.method() === 'POST') return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId: 'acceptance-session', items: Array.from({ length: 500 }, (_, index) => scrollItem(index)), hasMore: false, caughtUp: true, colors: {} }),
    });
    if (path.includes('/workspace/checkpoints/')) return json({ checkpoint: { itemId: null, scrollOffset: 0, visitedAt: NOW } });
    if (path.includes('/workspace/sources/')) return json({ sourcePreferences: { reddit: 'mute' } });
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: `Unhandled acceptance route: ${path}` }) });
  });
}

test.describe('Feed product acceptance', () => {
  test('Reader remains usable and bounded at phone width', async ({ page }, testInfo) => {
    await installFeedRoutes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/feed/reader', { waitUntil: 'networkidle' });
    await page.screenshot({ path: testInfo.outputPath('reader-phone.png'), fullPage: true });

    await expect(page.locator('.reader-view')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open subscriptions' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'offline' })).toBeVisible();
    await expect(page.locator('.article-row').first()).toBeVisible();
    expect(await page.locator('.reader-virtual-row').count()).toBeLessThanOrEqual(60);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await page.locator('.reader-view-tabs').evaluate(element => getComputedStyle(element).overflowX)).toBe('auto');

    await page.locator('.article-row-header').first().click();
    const contrast = await page.locator('.article-content').first().evaluate(element => {
      const parse = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const luminance = rgb => {
        const channels = rgb.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const foreground = luminance(parse(getComputedStyle(element).color));
      const background = luminance(parse(getComputedStyle(element.closest('.article-expanded')).backgroundColor));
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await page.getByRole('button', { name: 'saved' }).click();
    await expect(page.getByText('Saved from last month', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Open subscriptions' }).click();
    await expect(page.locator('#reader-subscriptions')).toHaveAttribute('role', 'dialog');
    await page.keyboard.press('Escape');
    await expect(page.locator('#reader-subscriptions')).not.toHaveClass(/open/);
  });

  test('Headlines presents hierarchy, provenance, and timeline on desktop', async ({ page }, testInfo) => {
    await installFeedRoutes(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/feed/headlines/mainstream', { waitUntil: 'networkidle' });

    await expect(page.getByRole('heading', { name: 'Update: coastal communities prepare for major storm' })).toBeVisible();
    await expect(page.getByText('2 outlets', { exact: false })).toBeVisible();
    await page.getByText('Story timeline', { exact: true }).click();
    const timeline = page.locator('.briefing-story__timeline');
    await expect(timeline.getByRole('link', { name: 'One News: Coastal communities prepare for a major storm' })).toBeVisible();
    await expect(timeline.getByText('update', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('headlines-desktop.png'), fullPage: true });
  });

  test('Scroll mounts a bounded 500-item card window and reaches a healthy completion state', async ({ page }, testInfo) => {
    await installFeedRoutes(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/feed/scroll', { waitUntil: 'networkidle' });

    await expect(page.locator('.scroll-item-wrapper').first()).toBeVisible();
    expect(await page.locator('.scroll-item-wrapper').count()).toBeLessThanOrEqual(60);
    const firstCard = page.locator('.scroll-item-wrapper').first();
    await firstCard.getByRole('button', { name: 'Open: Discovery story 0' }).click();
    await expect(page.getByRole('link', { name: 'Open in browser' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to feed' }).first().click();
    await firstCard.getByText('Why shown', { exact: true }).click();
    await firstCard.getByRole('button', { name: 'Mute' }).click();
    await expect(page.getByRole('button', { name: 'Open: Discovery story 0' })).toHaveCount(0);
    await expect(page.getByText('You’re caught up', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('scroll-phone.png'), fullPage: false });
  });

  test('a cold Scroll detail link falls back to its user-scoped offline edition', async ({ page }) => {
    await installFeedRoutes(page);
    await page.goto('/feed/scroll', { waitUntil: 'networkidle' });
    const offlineItem = { ...scrollItem(900), id: 'offline-story', stateKey: 'offline-story', title: 'Downloaded storm analysis' };
    await page.evaluate(({ item }) => new Promise((resolve, reject) => {
      const request = indexedDB.open('daylight-feed-offline-v1', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('editions', { keyPath: 'key' });
        store.createIndex('user', 'user', { unique: false });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const transaction = request.result.transaction('editions', 'readwrite');
        transaction.objectStore('editions').put({
          key: `household:${item.id}`,
          user: 'household',
          item,
          detail: { sections: [{ type: 'article', data: { html: '<p>Downloaded body remains readable.</p>' } }] },
          savedAt: Date.now(),
        });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      };
    }), { item: offlineItem });

    const slug = Buffer.from(offlineItem.id).toString('base64url');
    await page.goto(`/feed/scroll/${slug}`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Downloaded storm analysis' })).toBeVisible();
    await expect(page.getByText('Downloaded body remains readable.', { exact: true })).toBeVisible();
  });
});
