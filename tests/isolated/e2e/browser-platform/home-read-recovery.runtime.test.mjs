import { expect, test } from '@playwright/test';

const entities = '/api/v1/home-dashboard/entities';
const timeline = '/api/v1/home-dashboard/timeline';
const cameras = '/api/v1/camera';
const room = { id: 'kitchen', name: 'Kitchen' };
const payloads = {
  [entities]: {
    entities: [{ id: 'light.kitchen', room, domain: 'light', type: 'light', name: 'Kitchen light', state: 'off', stateClass: 'off' }],
    rooms: [room], types: [],
  },
  [timeline]: { days: [], lanes: [] },
  [cameras]: { cameras: [] },
};

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
});

for (const [view, endpoint, label, resultText] of [
  ['rooms', entities, 'Home Assistant', 'Kitchen'],
  ['today', timeline, 'Timeline', 'No timeline lanes'],
  ['cameras', cameras, 'Cameras', 'No cameras configured'],
]) {
  for (const width of [390, 1440]) {
    test(`Home keeps ${label} Retry in its read region at ${width}px`, async ({ page }) => {
      const reads = [];
      let recovery;
      await page.setViewportSize({ width, height: 850 });
      await page.addInitScript(view => {
        localStorage.setItem('home.view', view);
        localStorage.setItem('home.today.range', 'week');
      }, view);
      await page.route('**/api/**', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/v1/home-dashboard/') || url.pathname === cameras) {
          reads.push({ path: url.pathname + url.search, method: request.method() });
        }
        if (url.pathname !== endpoint) return route.fulfill({ json: payloads[url.pathname] ?? { enabled: false } });
        if (reads.filter(read => read.path.startsWith(endpoint)).length === 1) {
          return route.fulfill({ status: 409, json: {} });
        }
        recovery = route;
      });

      await page.goto('/home');
      const retry = page.getByRole('alert').filter({ hasText: `${label} failed to load` }).getByRole('button', { name: 'Retry' });
      await retry.press('Enter');
      await expect.poll(() => Boolean(recovery)).toBe(true);
      const targetRead = { path: endpoint === timeline ? timeline + '?range=week' : endpoint, method: 'GET' };
      expect(reads).toEqual(endpoint === timeline ? [{ path: entities, method: 'GET' }, targetRead, targetRead] : [targetRead, targetRead]);
      const nav = page.getByRole('button', { name: 'Cameras', exact: true });
      await expect(nav).toBeVisible();
      await expect(nav).toBeEnabled();
      expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('BODY');

      const region = page.getByRole('region', { name: label, exact: true });
      await expect(region).toBeFocused();
      await expect(region).toHaveAttribute('aria-busy', 'true');
      if (endpoint === timeline) {
        const range = page.getByRole('radio', { name: 'Week', exact: true });
        await expect(range).toBeChecked();
        await expect(region.getByRole('radio')).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Home Assistant', exact: true })).not.toHaveAttribute('aria-busy', 'true');
      }

      const moveFocus = endpoint === cameras && width === 1440;
      if (moveFocus) await nav.focus();
      await recovery.fulfill({ json: payloads[endpoint] });
      await expect(region.getByText(resultText, { exact: true })).toBeVisible();
      await expect(region).not.toHaveAttribute('aria-busy', 'true');
      await expect(moveFocus ? nav : region).toBeFocused();
    });
  }
}

test('Home keeps the timeline available during independent foreground rereads', async ({ page }) => {
  const pending = new Map();
  const reads = { [entities]: 0, [timeline]: 0 };
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (!(pathname in reads)) return route.fulfill({ json: { enabled: false } });
    reads[pathname] += 1;
    if (reads[pathname] === 1) return route.fulfill({ json: payloads[pathname] });
    pending.set(pathname, route);
  });
  await page.goto('/home');
  const accepted = page.getByText('No timeline lanes', { exact: true });
  await expect(accepted).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => [...pending.keys()].sort()).toEqual([entities, timeline]);
  await expect(accepted).toBeVisible();
  const week = page.getByRole('radio', { name: 'Week', exact: true });
  await expect(week).toBeEnabled();
  const timelineRegion = page.getByRole('region', { name: 'Timeline', exact: true });
  await expect(timelineRegion).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('region', { name: 'Home Assistant', exact: true })).not.toHaveAttribute('aria-busy', 'true');
  await week.focus();
  await pending.get(entities).fulfill({ status: 409, json: {} });
  await pending.get(timeline).fulfill({ status: 409, json: {} });
  await expect(timelineRegion).not.toHaveAttribute('aria-busy', 'true');
  await expect(accepted).toBeVisible();
  await expect(week).toBeFocused();
  // d9ae9c212f and f816ff9c91 (after this spec was written) say so when a refresh fails
  // over retained data: each read names its failure and offers its own Retry, and the
  // accepted lanes and the focused control stay in place.
  await expect(page.getByText('Home Assistant could not refresh', { exact: true })).toBeVisible();
  await expect(timelineRegion.getByText('Timeline could not refresh', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(2);
});
