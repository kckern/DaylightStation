import { expect, test } from '@playwright/test';

const settings = '/api/v1/admin/notifications';
const ledger = settings + '/ledger';
const initial = {
  quiet_hours: { enabled: true, start: '21:00', end: '07:00' },
  cooldowns: { default: 30 },
};
const row = username => ({ events: [{ at: '2026-11-19T19:00:00Z', username, category: 'fixture' }] });
const data = { [settings]: initial, [ledger]: row('fixture-recipient') };
const read = path => ({ path: path === ledger ? ledger + '?limit=50' : path, method: 'GET' });

test.use({ serviceWorkers: 'block' });

for (const [scenario, endpoint, label] of [
  ['settings Retry', settings, 'Notification settings'],
  ['ledger Retry', ledger, 'Recent activity'],
  ['ledger Refresh', ledger, 'Recent activity'],
]) {
  for (const width of [390, 1440]) {
    test(`Admin Notifications keeps ${scenario} in its read region at ${width}px`, async ({ page }) => {
      const requests = [];
      const retries = [];
      const refresh = scenario === 'ledger Refresh';
      const selectedRead = read(endpoint);
      const siblingRead = read(endpoint === settings ? ledger : settings);
      await page.setViewportSize({ width, height: 850 });
      await page.routeWebSocket('**/*', () => {});
      await page.route('**/api/**', route => {
        const request = route.request();
        const { pathname, search } = new URL(request.url());
        if (!(pathname in data)) return route.fulfill({ json: { enabled: false } });
        requests.push({ path: pathname + search, method: request.method() });
        if (pathname !== endpoint) return route.fulfill({ json: data[pathname] });
        if (requests.filter(call => call.path === pathname + search).length === 1) {
          return refresh ? route.fulfill({ json: data[pathname] }) : route.fulfill({ status: 409, json: {} });
        }
        retries.push(route);
      });

      await page.goto('/admin/system/notifications');
      const start = page.getByRole('textbox', { name: 'Start', exact: true });
      const recipient = page.getByText('fixture-recipient', { exact: true });
      const sibling = endpoint === settings ? recipient : start;
      await expect(sibling).toBeVisible();
      if (endpoint === ledger) await start.fill('20:30');
      const retry = page.getByRole('alert').filter({ hasText: `${label} failed to load` }).getByRole('button', { name: 'Retry' });
      const refreshButton = page.getByRole('button', { name: 'Refresh', exact: true });
      if (refresh) await expect(recipient).toBeVisible();
      await (refresh ? refreshButton : retry).press('Enter');
      await expect.poll(() => retries.length).toBe(1);
      if (refresh) await expect(refreshButton).toBeDisabled();
      else await expect(retry).toHaveCount(0);
      expect(requests.filter(call => call.path === selectedRead.path)).toEqual([selectedRead, selectedRead]);
      expect(requests.filter(call => call.path !== selectedRead.path)).toEqual([siblingRead]);
      await expect(sibling).toBeVisible();
      expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('BODY');

      const region = page.getByRole('region', { name: label, exact: true });
      const siblingRegion = page.getByRole('region', {
        name: endpoint === settings ? 'Recent activity' : 'Notification settings', exact: true,
      });
      await expect(region).toBeFocused();
      await expect(region).toHaveAttribute('aria-busy', 'true');
      await expect(siblingRegion).not.toHaveAttribute('aria-busy', 'true');

      if (refresh) {
        await expect(recipient).toBeVisible();
        await start.focus();
        await retries[0].fulfill({ status: 409, json: {} });
        await expect(retry).toBeVisible();
        await expect(recipient).toBeVisible();
        await expect(start).toBeFocused();
        await expect(start).toHaveValue('20:30');
        await retry.press('Enter');
        await expect.poll(() => retries.length).toBe(2);
        await expect(region).toBeFocused();
        await expect(region).toHaveAttribute('aria-busy', 'true');
        await expect(recipient).toBeVisible();
        await retries[1].fulfill({ json: row('recovered-recipient') });
        await expect(region.getByText('recovered-recipient', { exact: true })).toBeVisible();
        await expect(recipient).toHaveCount(0);
      } else {
        await retries[0].fulfill({ json: data[endpoint] });
        await expect(endpoint === settings ? start : recipient).toBeVisible();
      }

      await expect(region).toBeFocused();
      await expect(region).not.toHaveAttribute('aria-busy', 'true');
      await expect(sibling).toBeVisible();
      if (endpoint === ledger) {
        await expect(start).toHaveValue('20:30');
        await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
      }
      expect(requests.filter(call => call.path === selectedRead.path)).toEqual(
        Array.from({ length: refresh ? 3 : 2 }, () => selectedRead),
      );
      expect(requests.filter(call => call.path !== selectedRead.path)).toEqual([siblingRead]);
    });
  }
}

for (const width of [390, 1440]) {
  test(`Admin Notifications keeps the SaveBar sticky while scrolling the ledger at ${width}px`, async ({ page }) => {
    const events = Array.from({ length: 40 }, (_, index) => ({
      ...data[ledger].events[0], username: `recipient-${index}`,
    }));
    await page.setViewportSize({ width, height: 850 });
    await page.routeWebSocket('**/*', () => {});
    await page.route('**/api/**', route => {
      const { pathname } = new URL(route.request().url());
      return route.fulfill({ json: pathname === ledger ? { events } : data[pathname] ?? { enabled: false } });
    });
    await page.goto('/admin/system/notifications');
    const main = page.getByRole('main');
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await page.getByRole('textbox', { name: 'Start', exact: true }).fill('20:30');
    await expect(save).toBeEnabled();
    const lastRow = page.getByRole('cell', { name: 'recipient-39', exact: true });
    await expect(lastRow).toBeVisible();
    await main.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect(lastRow).toBeInViewport();
    await expect(save).toBeInViewport();
  });
}
