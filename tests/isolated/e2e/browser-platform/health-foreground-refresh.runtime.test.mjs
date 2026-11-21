import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const date = '2026-11-22';
const dayPath = '/api/v1/health/day';
const makeEntry = (id, name) => ({
  id, uuid: id, name, kind: 'item', date, mealTime: 'evening', calories: 100, grams: 100,
});
const initial = makeEntry('initial', 'Initial meal item');
const day = (item, revision = 0) => ({
  date, items: [item], revision, budget: { budget: 2000, food: 100, remaining: 1900 },
});


async function interceptHealth(page, readDay) {
  await page.clock.setFixedTime(new Date(date + 'T18:00:00Z'));
  await page.addInitScript(() => {
    window.fixtureVisible = true;
    Object.defineProperty(document, 'visibilityState', {
      get: () => window.fixtureVisible ? 'visible' : 'hidden',
    });
  });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname, searchParams } = new URL(route.request().url());
    if (!pathname.startsWith('/api/')) return route.fallback();
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname === '/api/v1/health/context') return route.fulfill({ json: { userId: 'alice' } });
    if (pathname === dayPath && searchParams.get('date') === date) return readDay(route);
    return route.fulfill({ json: {} });
  });
}

function setVisible(page, visible) {
  return page.evaluate(visible => {
    window.fixtureVisible = visible;
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
}

function focusWindow(page) {
  return page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
}

test('Health keeps the foreground day refresh when the window also receives focus', async ({ page }) => {
  let reads = 0;
  let armed = false;
  const release = Promise.withResolvers();
  await interceptHealth(page, async route => {
    if (!armed) return route.fulfill({ json: day(initial) });
    const read = ++reads;
    if (read === 1) await release.promise;
    const item = read === 1 ? makeEntry('foreground', 'Meal item from foreground')
      : makeEntry('duplicate', 'Meal item from duplicate refresh');
    return route.fulfill({ json: day(item, read) });
  });
  await page.goto('/health?date=' + date);
  await expect(page.getByText('Initial meal item', { exact: true })).toBeVisible();
  armed = true;

  try {
    await setVisible(page, false);
    await setVisible(page, true);
    await expect.poll(() => reads).toBe(1);
    await focusWindow(page);
  } finally {
    release.resolve();
  }
  await expect(page.getByText('Meal item from foreground', { exact: true })).toBeVisible();
  expect(reads).toBe(1);
});

test('Health refreshes on a visible window focus and leaves a hidden day idle', async ({ page }) => {
  let reads = 0;
  let armed = false;
  await interceptHealth(page, route => {
    if (!armed) return route.fulfill({ json: day(initial) });
    const read = ++reads;
    return route.fulfill({ json: day(makeEntry('read-' + read, 'Meal item from read ' + read), read) });
  });
  await page.goto('/health?date=' + date);
  await expect(page.getByText('Initial meal item', { exact: true })).toBeVisible();
  armed = true;

  await focusWindow(page);
  await expect(page.getByText('Meal item from read 1', { exact: true })).toBeVisible();

  await setVisible(page, false);
  const hiddenRead = page.waitForRequest(request => {
    const { pathname, searchParams } = new URL(request.url());
    return pathname === dayPath && searchParams.get('date') === date;
  }, { timeout: 250 });
  await focusWindow(page);
  await expect(hiddenRead).rejects.toThrow('Timeout');
  await setVisible(page, true);
  await expect(page.getByText('Meal item from read 2', { exact: true })).toBeVisible();
  expect(reads).toBe(2);
});
