import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 850 }, serviceWorkers: 'block' });

test('Media favourites revalidate once with Home and desktop search mounted', async ({ page }) => {
  const item = { contentId: 'plex:123', title: 'Fixture Film', type: 'movie' };
  const reads = [];
  const writes = [];
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname === '/api/v1/media/household/recent') return route.fulfill({ json: { items: [item] } });
    if (pathname === '/api/v1/media/household/favourites') {
      if (request.method() === 'GET') {
        reads.push(route);
        if (reads.length > 2) return route.fulfill({ json: { items: [{ id: item.contentId }] } });
        return;
      }
      writes.push({ method: request.method(), body: request.postDataJSON() });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto('/media');
  await expect(page.getByRole('textbox', { name: 'Search media…' })).toBeVisible();
  await expect.poll(() => reads.length).toBe(1);
  const tileId = 'home-tile-recent-plex:123';
  const openMenu = () => page.getByTestId(`${tileId}-more`).click();
  await openMenu();
  await page.getByRole('menuitem', { name: 'Add to favourites' }).click();
  await expect.poll(() => reads.length).toBeGreaterThanOrEqual(2);
  expect(writes).toEqual([{ method: 'POST', body: { id: item.contentId, kind: 'item', title: item.title, type: item.type } }]);

  await reads[0].fulfill({ json: { items: [] } });
  await reads[1].fulfill({ json: { items: [{ id: item.contentId }] } });
  await openMenu();
  await expect(page.getByRole('menuitem', { name: 'Remove from favourites' })).toBeVisible();
  expect(reads).toHaveLength(2);
});
