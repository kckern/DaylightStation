import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test('Admin Playback Hub preserves the newer snapshot and recovers on the next complete broadcast', async ({ page }) => {
  const held = Promise.withResolvers();
  const sockets = [];
  let statusReads = 0;
  const slot = status => ({ color: 'red', bt_connected: true, paused: false, status, volume: 45 });
  const older = '2026-11-19T15:55:00.000Z';
  await page.routeWebSocket('**/ws', socket => sockets.push(socket));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const { pathname } = url;
    if (pathname.endsWith('/playback-hub/config')) {
      return route.fulfill({ json: { ok: true, config: {
        devices: [{ color: 'red', class: 'private', name: 'Fixture red', volume: { default: 40, min: 0, max: 100 } }],
        scheduled: [],
      } } });
    }
    if (pathname.endsWith('/playback-hub/status')) {
      statusReads++;
      await held.promise;
      return route.fulfill({ json: { ok: true, slots: [slot('Earlier HTTP')], fetchedAt: older } });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });
  const publish = (socket, status, fetchedAt) => socket.send(JSON.stringify({
    topic: 'playback-hub:status',
    type: 'playback-hub.status.snapshot',
    data: { devices: [slot(status)], fetchedAt },
  }));
  await page.goto('/admin/playback-hub');
  await expect(page.getByText('Fixture red', { exact: true })).toBeVisible();
  await expect.poll(() => statusReads).toBe(1);
  await expect.poll(() => sockets.length).toBe(1);
  const badge = page.getByTestId('hub-slot-status');
  publish(sockets[0], 'First socket', '2026-11-19T15:55:05.000Z');
  await expect(badge).toHaveText('First socket');
  const http = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/playback-hub/status'));
  held.resolve();
  await (await http).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(badge).toHaveText('First socket');

  sockets[0].close({ code: 1001, reason: 'fixture relocation' });
  await expect.poll(() => sockets.length, { timeout: 18000 }).toBe(2);
  publish(sockets[1], 'Recovered socket', '2026-11-19T15:55:10.000Z');
  await expect(badge).toHaveText('Recovered socket');
  expect(statusReads).toBe(1);
});
