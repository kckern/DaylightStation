import { expect, test } from '@playwright/test';

const shellViewport = 'width=device-width, initial-scale=1.0';
const browserViewport = shellViewport + ', viewport-fit=cover';
const phone = { width: 390, height: 850 };
const insets = { top: 30, bottom: 24, left: 40, right: 40 };
const member = { username: 'fixture', displayName: 'Fixture' };

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (pathname.endsWith('/health/context')) return route.fulfill({ json: { userId: member.username } });
    if (pathname.endsWith('/life/user')) return route.fulfill({ json: member });
    if (pathname.endsWith('/life/users')) return route.fulfill({ json: { users: [member] } });
    if (pathname.endsWith('/automotive/vehicles')) return route.fulfill({ json: { vehicles: [{ id: 'fixture', label: 'Fixture car' }] } });
    if (pathname.endsWith('/automotive/vehicles/fixture')) {
      return route.fulfill({ json: { odometer: { km: 123 }, fuel: { needsMoreData: true, fillCount: 0 }, trip_count: 0 } });
    }
    if (pathname.endsWith('/feed/workspace')) return route.fulfill({ json: { preferencesStored: true } });
    if (pathname.endsWith('/reader/feeds')) return route.fulfill({ json: [{ id: 'fixture', title: 'Fixture Feed' }] });
    if (pathname.endsWith('/reader/stream')) return route.fulfill({ json: { items: [], continuation: null } });
    if (pathname.endsWith('/fitness')) return route.fulfill({ json: { fitness: { content: { nav_items: [] } } } });
    return route.fulfill({ json: {} });
  });
});

async function emulateInsets(page, size = phone, edges = insets) {
  await page.setViewportSize(size);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride', { insets: edges });
}

async function expectInsideInsets(controls, edges = insets) {
  await expect(controls.filter({ visible: true }).first()).toBeVisible();
  await expect.poll(() => controls.evaluateAll((elements, edges) => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || getComputedStyle(element).visibility === 'hidden') return [];
    if (box.left + 1 >= edges.left && box.top + 1 >= edges.top &&
        box.right - 1 <= innerWidth - edges.right && box.bottom - 1 <= innerHeight - edges.bottom) return [];
    return [{ control: element.getAttribute('aria-label') || element.textContent.trim(),
      bounds: [box.left, box.top, box.right, box.bottom].map(Math.round) }];
  }), edges)).toEqual([]);
}

const dashboard = '.ds-chrome__title, .ds-chrome__header button, .ds-chrome__tab';
const apps = [
  ['Admin', '/admin', '.admin-navigation-toggle', '.admin-navigation-toggle, .ds-chrome__header a'],
  ['Health', '/health', '.ds-chrome__tab', dashboard],
  ['Home', '/home', '.ds-chrome__tab', dashboard],
  ['Life', '/life', '.ds-chrome__tab', dashboard],
  ['Auto', '/auto', '.ds-chrome__tab', dashboard],
  ['Media', '/media', '[data-testid="app-tab-search"]', '.media-dock button, .media-tabbar button'],
  ['Feed', '/feed', '.feed-reading-settings summary', '.feed-tabs > a, .feed-tabs > button, .feed-reading-settings summary'],
];

for (const [app, url, ready, selector] of apps) {
  test(`${app} keeps compact header and navigation controls in the device safe area`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CSS environment override uses Chromium DevTools');
    await emulateInsets(page);
    await page.goto(url);
    await expect(page.locator(ready).first()).toBeVisible();
    await expectInsideInsets(page.locator(selector));
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', browserViewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });
}

test('Admin contains compact navigation and a portaled form at 320px', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CSS environment override uses Chromium DevTools');
  const edges = { ...insets, right: 27 };
  await emulateInsets(page, { width: 320, height: 850 }, edges);
  await page.goto('/admin/household/devices');
  const toggle = page.getByRole('button', { name: 'Toggle admin navigation' });
  await toggle.press('Enter');
  await expectInsideInsets(page.getByRole('navigation', { name: 'Primary', exact: true }), edges);
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await page.getByRole('button', { name: 'Add Device', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Device' });
  await expectInsideInsets(dialog, edges);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('Feed landscape appearance keeps its data controls reachable inside the safe area', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CSS environment override uses Chromium DevTools');
  const landscape = { top: 12, bottom: 16, left: 48, right: 38 };
  await emulateInsets(page, { width: 740, height: 360 }, landscape);
  await page.goto('/feed/search');
  await page.getByLabel('Reading appearance').click();
  await expectInsideInsets(page.locator('.feed-reading-settings__panel'), landscape);
  const importButton = page.getByRole('button', { name: 'Import', exact: true });
  await importButton.scrollIntoViewIfNeeded();
  await expectInsideInsets(importButton, landscape);
  await importButton.click({ trial: true });
});

test('Feed Reader keeps the compact subscriptions drawer inside the safe area', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CSS environment override uses Chromium DevTools');
  await emulateInsets(page);
  await page.goto('/feed/reader');
  const opener = page.getByRole('button', { name: 'Open subscriptions' });
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'Subscriptions' });
  await expectInsideInsets(drawer);
  await expectInsideInsets(drawer.getByRole('button', { name: 'Close subscriptions' }));
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
});

test('Media phone search and the shared Auto fuel sheet fit the viewport edges independently', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CSS environment override uses Chromium DevTools');
  await emulateInsets(page);
  await page.goto('/media');
  await page.getByRole('button', { name: /Playing on .*Change where things play/ }).click();
  await expectInsideInsets(page.getByRole('dialog'));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('app-tab-search').click();
  const search = page.getByRole('dialog', { name: 'Search media' });
  await expectInsideInsets(search.getByRole('button', { name: 'Close search' }));
  await expectInsideInsets(search.getByRole('searchbox', { name: 'Search media' }));

  await page.goto('/auto');
  await page.getByRole('button', { name: 'Fuel', exact: true }).click();
  await page.getByRole('button', { name: 'Log a fill-up' }).click();
  const fuel = page.getByRole('dialog');
  const save = fuel.getByRole('button', { name: 'Save', exact: true });
  await save.scrollIntoViewIfNeeded();
  await expectInsideInsets(save);
  await expectInsideInsets(fuel.getByRole('button', { name: 'Close', exact: true }));
});

test('Browser viewport policy follows same-document navigation and restores the original shell meta', async ({ page }) => {
  await page.goto('/feed/search');
  const viewport = page.locator('meta[name="viewport"]');
  await expect(viewport).toHaveAttribute('content', browserViewport);
  await viewport.evaluate(meta => { meta.dataset.viewportFixture = 'original'; });

  const navigate = async (path, content) => {
    await page.evaluate(path => {
      const state = { idx: (history.state?.idx ?? 0) + 1, key: path, usr: null };
      history.pushState(state, '', path);
      dispatchEvent(new PopStateEvent('popstate', { state }));
    }, path);
    await expect(page).toHaveURL(new RegExp(path + '$'));
    await expect(viewport).toHaveCount(1);
    await expect(viewport).toHaveAttribute('data-viewport-fixture', 'original');
    await expect(viewport).toHaveAttribute('content', content);
    const html = page.locator('html');
    if (content === browserViewport) await expect(html).toHaveAttribute('data-browser-app-viewport', '');
    else await expect(html).not.toHaveAttribute('data-browser-app-viewport');
  };
  await navigate('/call', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  await navigate('/media', browserViewport);
  await navigate('/fitness', shellViewport);
  await navigate('/home', browserViewport);
  await navigate('/media/channels/fixture', shellViewport);
  await page.goBack();
  await expect(page).toHaveURL(/\/home$/);
  await expect(viewport).toHaveAttribute('content', browserViewport);
  await navigate('/school/teacher', shellViewport);
});

test('Screen routes start with the shared document default viewport', async ({ page }) => {
  await page.goto('/screen/fixture', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', shellViewport);
  await expect(page.locator('html')).not.toHaveAttribute('data-browser-app-viewport');
});
