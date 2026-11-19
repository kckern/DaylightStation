import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test('a remote screen supplies its own clock and recovers a missed start outcome on reconnect', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  let socket;
  let connections = 0;
  let reads = 0;
  const commands = [];
  await page.routeWebSocket('**/*', connection => {
    socket = connection;
    connections++;
    connection.onMessage(raw => {
      const envelope = JSON.parse(raw);
      if (/^(device-control|client-control):/.test(envelope.topic || '')) commands.push(envelope);
    });
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/device/config')) {
      return route.fulfill({ json: { devices: { fixture: { name: 'Fixture screen', fleet: true } } } });
    }
    if (path.endsWith('/device/fixture/start-status')) {
      reads++;
      const status = connections > 1 ? { phase: 'failed', updatedAt: new Date().toISOString() } : null;
      return route.fulfill({ json: { ok: true, status } });
    }
    return route.fulfill({ json: {} });
  });

  const item = { id: 'plex:42', contentId: 'plex:42', title: 'Remote track', duration: 60 };
  function sendPosition(position) {
    socket.send(JSON.stringify({ topic: 'device-state:fixture', deviceId: 'fixture', ts: new Date().toISOString(),
      snapshot: { state: 'playing', currentItem: item, position, duration: 60, queue: { items: [item] } } }));
  }

  await page.goto('/media');
  await page.getByTestId('app-tab-fleet').click();
  const target = page.getByTestId('fleet-peek-fixture');
  await expect(target).toBeVisible();
  await expect.poll(() => reads).toBe(1);
  socket.close({ code: 1001, reason: 'fixture restart' });
  await expect.poll(() => connections, { timeout: 20000 }).toBe(2);
  await expect(page.getByTestId('house-start-status-fixture')).toHaveAttribute('data-tone', 'failed');
  expect(reads).toBe(2);
  sendPosition(12);
  await target.click();
  const panel = page.getByTestId('peek-panel');
  await expect(panel).toContainText('Remote track');
  const seek = panel.getByRole('slider', { name: 'Seek' });
  await expect(seek).toHaveAttribute('aria-valuenow', '12');
  sendPosition(24);
  await expect(seek).toHaveAttribute('aria-valuenow', '24');
  await expect(page.locator('audio[src],video[src]')).toHaveCount(0);
  expect(commands).toEqual([]);
});
