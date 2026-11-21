import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const items = Array.from({ length: 110 }, (_, i) => ({
  id: 'fixture:' + i, title: 'Fixture article ' + i, source: 'fixture', type: 'article', isRead: true,
}));

async function fixture(page) {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/reader/feeds') || pathname.endsWith('/headlines/pages')) return route.fulfill({ json: [] });
    if (pathname.includes('/scroll/sessions')) {
      await ready;
      return route.fulfill({ json: { items, sessionId: 'fixture', hasMore: false } });
    }
    if (pathname.startsWith('/api/v1/feed/items/') && !pathname.includes('/state/')) {
      return route.fulfill({ json: { item: items[42], sections: [] } });
    }
    return route.fulfill({ json: {} });
  });
  return release;
}

for (const width of [390, 1440]) {
  test('scroll and keyboard focus return to the originating Feed card at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    const release = await fixture(page);
    await page.goto('/feed/scroll', { waitUntil: 'domcontentloaded' });
    const main = page.getByRole('main');
    await expect(main).toHaveCount(1);
    // A second host with the historical class must never own this route's scroll.
    await main.evaluate(el => {
      const decoy = document.createElement('div');
      decoy.className = 'feed-content';
      el.before(decoy);
      decoy.style.display = 'none';
    });
    release();
    const cards = main.locator('[data-feed-item-id]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeLessThan(items.length);
    await expect.poll(() => main.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThan(2000);
    await main.evaluate(el => { el.scrollTop = 1900; });
    await expect.poll(() => main.evaluate(el => el.scrollTop)).toBeGreaterThan(100);
    const visibleCardId = () => main.evaluate(el => {
      const main = el.getBoundingClientRect();
      return [...el.querySelectorAll('[data-feed-item-id]')].find(node => {
        const rect = node.getBoundingClientRect();
        return rect.top >= main.top && rect.top < main.bottom;
      })?.dataset.feedItemId;
    });
    await expect.poll(visibleCardId).toBeTruthy();
    const visible = await visibleCardId();
    const opener = main.locator('[data-feed-item-id="' + visible + '"]').getByRole('button', { name: /^Open:/ });
    await opener.focus();
    const initial = await main.evaluate(el => el.scrollTop);
    await opener.press('Enter');
    await expect(page).toHaveURL(/\/feed\/scroll\/[^/]+$/);
    await expect(main).toHaveCount(1);
    if (width > 390) await expect(main.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/feed\/scroll$/);
    await expect(opener).toBeFocused();
    await expect.poll(() => main.evaluate(el => el.scrollTop)).toBeCloseTo(initial, -1);
    await opener.press('Enter');
    await expect(page).toHaveURL(/\/feed\/scroll\/[^/]+$/);
    await page.goBack();
    await expect(opener).toBeFocused();
    await page.getByRole('link', { name: 'Search feed history' }).click();
    await page.getByRole('link', { name: 'Scroll', exact: true }).click();
    await expect(opener).toBeAttached();
    await expect.poll(() => main.evaluate(el => el.scrollTop)).toBeCloseTo(initial, -1);
  });
}

test('direct article entry returns focus to the Feed main landmark', async ({ page }) => {
  const release = await fixture(page);
  release();
  const slug = Buffer.from(items[42].id).toString('base64url');
  await page.goto('/feed/scroll/' + slug);
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to feed' }).first().click();
  await expect(page).toHaveURL(/\/feed\/scroll$/);
  await expect(page.getByRole('main')).toBeFocused();
});


test('Reader, Headlines and Search each render inside the Feed main landmark', async ({ page }) => {
  const release = await fixture(page);
  release();
  for (const [route, role, name] of [
    ['reader', 'group', 'Article state'],
    ['headlines/mainstream', 'button', 'Refresh all'],
    ['search', 'heading', 'Search your feed'],
  ]) {
    await page.goto('/feed/' + route);
    const main = page.getByRole('main');
    await expect(main.getByRole(role, { name, exact: true })).toBeVisible();
    await expect(main).toHaveCount(1);
  }
});

for (const failure of ['blocked read', 'expired session and quota']) {
  test('Scroll loads and paginates in memory with ' + failure, async ({ page }) => {
    const release = await fixture(page);
    release();
    const requests = [];
    await page.addInitScript(mode => {
      const key = 'feed:scroll:session:all:all';
      if (mode !== 'blocked read') sessionStorage.setItem(key, 'expired');
      for (const method of ['getItem', 'setItem', 'removeItem']) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (name, ...args) {
          if (this === sessionStorage && name === key && (mode === 'blocked read' || method !== 'getItem')) {
            throw new DOMException('Unavailable', 'QuotaExceededError');
          }
          return original.call(this, name, ...args);
        };
      }
    }, failure);
    await page.route('**/api/v1/feed/scroll/sessions**', route => {
      const path = new URL(route.request().url()).pathname;
      requests.push([route.request().method(), path]);
      if (path.endsWith('/expired')) return route.fulfill({ status: 404, json: {} });
      const first = route.request().method() === 'POST';
      return route.fulfill({ json: { items: [items[first ? 0 : 1]], sessionId: 'in-memory', hasMore: first } });
    });
    await page.goto('/feed/scroll');
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: 'Open: Fixture article 0' })).toBeVisible();
    await main.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(main.getByRole('button', { name: 'Open: Fixture article 1' })).toBeVisible();
    expect(requests.filter(([method]) => method === 'POST')).toHaveLength(1);
    expect(requests).toContainEqual(['GET', '/api/v1/feed/scroll/sessions/in-memory']);
    if (failure !== 'blocked read') expect(requests).toContainEqual(['GET', '/api/v1/feed/scroll/sessions/expired']);
  });
}
