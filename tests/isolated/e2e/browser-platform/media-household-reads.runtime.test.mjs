import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 850 }, serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
});

test('Media favourites revalidate once with Home and desktop search mounted', async ({ page }) => {
  const item = { contentId: 'plex:123', title: 'Fixture Film', type: 'movie' };
  const reads = [];
  const writes = [];
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

test('Media detail waits for the authoritative resume spots and closes their chooser on item navigation', async ({ page }) => {
  const first = { contentId: 'plex:123', title: 'First Fixture Film', type: 'movie' };
  const next = { contentId: 'plex:456', title: 'Next Fixture Film', type: 'movie' };
  const detailUrl = contentId => `/media?view=detail&contentId=${encodeURIComponent(contentId)}`;
  const carryOnPath = '/api/v1/media/household/carry-on?limit=12';
  const recentPath = '/api/v1/media/household/recent?limit=24';
  const reads = new Map();

  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    const path = pathname + search;
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname === '/api/v1/info/plex/123') return route.fulfill({ json: first });
    if (pathname === '/api/v1/info/plex/456') return route.fulfill({ json: next });
    if (pathname === '/api/v1/media/screens') {
      return route.fulfill({ json: { screens: [
        { id: 'fleet:lounge', name: 'Lounge TV' },
        { id: 'browser:tablet', name: 'Kitchen Tablet' },
      ] } });
    }
    if (request.method() === 'GET' && (path === carryOnPath || path === recentPath)) {
      reads.set(path, route);
      return;
    }
    return route.fulfill({ json: {} });
  });

  await page.goto(detailUrl(first.contentId));
  await expect(page.getByRole('heading', { name: first.title })).toBeVisible();
  await expect.poll(() => reads.size).toBe(2);

  const playNow = page.getByRole('button', { name: 'Play Now', exact: true });
  const recent = reads.get(recentPath);
  const recentResponse = page.waitForResponse(response => response.request() === recent.request());
  await recent.fulfill({ json: { items: [{ contentId: first.contentId, playhead: 120, duration: 7200 }] } });
  await (await recentResponse).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect.soft(playNow, 'Play Now waits while carry-on can still supersede recent').toBeDisabled();

  await reads.get(carryOnPath).fulfill({ json: { items: [{
    contentId: first.contentId,
    spots: [
      { playhead: 720, duration: 7200, deviceId: 'browser:tablet' },
      { playhead: 4800, duration: 7200, deviceId: 'fleet:lounge' },
    ],
  }] } });
  await expect(playNow).toBeEnabled();
  await playNow.click();
  const chooser = page.getByRole('dialog', { name: 'Continue First Fixture Film from…' });
  await expect(chooser.getByRole('button', { name: '12 m on Kitchen Tablet' })).toBeVisible();
  await expect(chooser.getByRole('button', { name: '1 h 20 m on Lounge TV' })).toBeVisible();

  await page.evaluate(url => {
    history.pushState(null, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  }, detailUrl(next.contentId));
  // Wait for the next detail to render even if the stale modal still hides it from the accessibility tree.
  await expect(page.getByRole('heading', { name: next.title, includeHidden: true })).toBeVisible();
  await expect(chooser).toBeHidden();
});
