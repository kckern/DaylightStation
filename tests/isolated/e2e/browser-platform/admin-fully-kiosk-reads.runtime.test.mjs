import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 1440, height: 850 } });

const routePath = '/admin/household/devices/fixture/fully-kiosk';
const api = `/api/v1${routePath}`;
const status = name => ({ device: { id: 'fixture', name }, summary: { screenOn: true } });

test('Admin kiosk keeps the latest status and cancels device reads when leaving', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const held = new Map();
  const canceled = [];
  const calls = [];
  let statusReads = 0;
  let settingsReads = 0;

  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  page.on('requestfailed', request => {
    for (const [label, route] of held) if (route.request() === request) canceled.push(label);
  });
  await page.route('**/api/**', route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (!pathname.startsWith(`${api}/`)) {
      return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
    }
    const endpoint = pathname.slice(api.length);
    calls.push(`${request.method()} ${endpoint}`);
    if (endpoint === '/status' && request.method() === 'GET') {
      const read = ++statusReads;
      if (read === 2 || read === 4) {
        held.set(read === 2 ? 'command status' : 'route status', route);
        return;
      }
      return route.fulfill({ json: status(read === 1 ? 'Initial fixture device' : 'Fresh fixture device') });
    }
    if (endpoint === '/settings' && request.method() === 'GET') {
      if (++settingsReads === 3) {
        held.set('route settings', route);
        return;
      }
      return route.fulfill({ json: { settings: [] } });
    }
    if (endpoint === '/actions/screen-on' && request.method() === 'POST') return route.fulfill({ json: { ok: true } });
    if (endpoint === '/screenshot' && request.method() === 'GET') return route.fulfill({ status: 404, json: {} });
    return route.fulfill({ status: 405 });
  });

  await page.goto(routePath);
  await expect(page.getByText('Initial fixture device', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Screen on', exact: true }).click();
  await expect.poll(() => held.has('command status')).toBe(true);
  const refresh = page.getByRole('button', { name: 'Refresh device' });
  await refresh.click();
  await expect(page.getByText('Fresh fixture device', { exact: true })).toBeVisible();
  await expect.poll(() => canceled).toContain('command status');
  await held.get('command status').fulfill({ json: status('Stale fixture device') }).catch(() => {});
  await expect(page.getByText('Stale fixture device', { exact: true })).toHaveCount(0);

  await refresh.click();
  await expect.poll(() => [...held.keys()].sort()).toEqual(['command status', 'route settings', 'route status']);
  await page.getByRole('banner').getByRole('link', { name: 'Devices', exact: true }).click();
  await expect(page).toHaveURL('/admin/household/devices');
  await expect.poll(() => [...canceled].sort()).toEqual(['command status', 'route settings', 'route status']);
  expect(calls.filter(call => call.startsWith('GET ')).sort()).toEqual([
    ...Array(4).fill('GET /status'), ...Array(3).fill('GET /settings'), 'GET /screenshot',
  ].sort());
  expect(calls.filter(call => !call.startsWith('GET '))).toEqual(['POST /actions/screen-on']);
});
