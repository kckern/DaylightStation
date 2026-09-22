import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(90000);

const json = (route, items, total = items.length) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ items, total }),
});

async function openBrowse(page) {
  await page.goto('/media');
  await page.getByTestId('app-nav-browse').click();
  await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 15000 });
}

test.describe('MediaApp — browse lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  });

  test('[FIND.5a/AC2][FIND.6a] browse shows pictures, natural order, every parent, and collection actions', async ({ page }) => {
    await page.route('**/api/v1/list/**', async route => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/api/v1/list/') {
        return json(route, [
          { id: 'demo:show', title: 'Example Show', itemType: 'container', type: 'show', thumbnail: '/art/example.jpg' },
          { id: 'demo:other', title: 'Other Show', itemType: 'container', type: 'show' },
        ]);
      }
      if (pathname === '/api/v1/list/demo/show') {
        return json(route, [
          { id: 'demo:season-2', title: 'Season 2', itemType: 'container', type: 'season', seasonNumber: 2 },
          { id: 'demo:season-1', title: 'Season 1', itemType: 'container', type: 'season', seasonNumber: 1 },
        ]);
      }
      if (pathname === '/api/v1/list/demo/season-2') {
        return json(route, [
          { id: 'demo:e10', title: 'Episode 10', itemType: 'item', type: 'episode', parentIndex: 2, index: 10 },
          { id: 'demo:e2', title: 'Episode 2', itemType: 'item', type: 'episode', parentIndex: 2, index: 2, thumbnail: '/art/e2.jpg' },
          { id: 'demo:e1', title: 'Episode 1', itemType: 'item', type: 'episode', parentIndex: 2, index: 1 },
        ]);
      }
      return json(route, []);
    });

    await openBrowse(page);
    await expect(page.getByRole('img', { name: 'Example Show artwork' })).toBeVisible();
    await expect(page.getByLabel('Other Show artwork unavailable')).toBeVisible();
    await expect(page.getByTestId('browse-row-demo:show')).toContainText('Show');

    await page.getByTestId('browse-open-demo:show').click();
    await expect(page.getByTestId('browse-dispatch-header')).toContainText('This device');
    await expect(page.getByTestId('browse-dispatch-play')).toBeVisible();
    await expect(page.getByTestId('browse-dispatch-shuffle')).toBeVisible();
    await expect(page.getByTestId('browse-dispatch-queue')).toBeVisible();

    const seasons = page.locator('.browse-list .media-result-title');
    await expect(seasons).toHaveText(['Season 1', 'Season 2']);
    await page.getByTestId('browse-open-demo:season-2').click();

    await expect(page.getByTestId('browse-crumb-parent-0')).toHaveText('All');
    await expect(page.getByTestId('browse-crumb-parent-1')).toHaveText('Example Show');
    await expect(page.locator('.browse-crumb--current')).toHaveText('Season 2');
    await expect(page.locator('.browse-list .media-result-title')).toHaveText([
      'Episode 1', 'Episode 2', 'Episode 10',
    ]);
    await expect(page.getByRole('img', { name: 'Episode 2 artwork' })).toBeVisible();
    await expect(page.getByLabel('Episode 1 artwork unavailable')).toBeVisible();
    await expect(page.getByTestId('browse-row-demo:e1')).toContainText('Episode');

    await page.getByTestId('browse-crumb-parent-1').click();
    await expect(page.locator('.browse-crumb--current')).toHaveText('Example Show');
    await expect(page.getByTestId('browse-open-demo:season-1')).toBeVisible();
  });

  test('[FIND.5a/AC4] browser Back restores the exact browse scroll and focused collection', async ({ page }) => {
    const rootItems = Array.from({ length: 24 }, (_, index) => ({
      id: `demo:c${index + 1}`,
      title: `Collection ${String(index + 1).padStart(2, '0')}`,
      itemType: 'container',
      type: 'collection',
    }));
    await page.route('**/api/v1/list/**', async route => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/api/v1/list/') return json(route, rootItems);
      return json(route, [{ id: 'demo:leaf', title: 'Leaf', itemType: 'item', type: 'movie' }]);
    });

    await openBrowse(page);
    const target = page.getByTestId('browse-open-demo:c20');
    await target.scrollIntoViewIfNeeded();
    const before = await page.getByTestId('media-canvas').evaluate(node => node.scrollTop);
    expect(before).toBeGreaterThan(0);
    await target.click();
    await expect(page.locator('.browse-crumb--current')).toHaveText('Collection 20');

    await page.goBack();
    await expect(page.getByTestId('browse-open-demo:c20')).toBeFocused();
    await expect.poll(() => page.getByTestId('media-canvas').evaluate(node => node.scrollTop)).toBe(before);
  });

  test('[FIND.5a/AC3] scrolling to the end loads the next page without a button hunt', async ({ page }) => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      id: `demo:p${index + 1}`,
      title: `Title ${index + 1}`,
      itemType: 'item',
      type: 'movie',
    }));
    await page.route('**/api/v1/list/**', async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('skip') === '50') {
        return json(route, [{ id: 'demo:p51', title: 'Title 51', itemType: 'item', type: 'movie' }], 51);
      }
      return json(route, firstPage, 51);
    });

    await openBrowse(page);
    await expect(page.getByTestId('browse-page-sentinel')).toBeVisible();
    await expect(page.getByRole('button', { name: /load more/i })).toHaveCount(0);
    await page.getByTestId('browse-page-sentinel').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('browse-row-demo:p51')).toBeVisible({ timeout: 10000 });
  });

  test('clicking Home crumb returns to the home view', async ({ page }) => {
    await page.route('**/api/v1/list/**', route => json(route, []));
    await openBrowse(page);
    await page.getByTestId('browse-crumb-home').click();
    await expect(page.getByTestId('home-view')).toBeVisible();
  });
});
