import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });
test.setTimeout(45000);

test('[STEER.1b/AC2] an offline retained session cannot seek or change its queue', async ({ page }) => {
  const deviceId = 'acceptance-offline-virtual';
  const sockets = [];
  const commands = [];
  // Isolated incoming fleet evidence only: no socket connects to a server and
  // no device mutation can leave the browser, including on a failing build.
  await page.routeWebSocket('**/*', socket => {
    sockets.push(socket);
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (/^(device-control|client-control):/.test(message.topic ?? '')) commands.push(message);
    });
  });
  await page.route('**/api/v1/device/**', async route => {
    const request = route.request();
    if (new URL(request.url()).pathname === '/api/v1/device/config') {
      await route.fulfill({ json: { devices: {
        [deviceId]: { name: 'Offline test screen', fleet: true },
      } } });
    } else if (request.method() !== 'GET' || /\/load(?:\?|$)/.test(request.url())) {
      commands.push({ method: request.method(), url: request.url() });
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  await page.goto('/media');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeVisible({ timeout: 30000 });
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  const items = ['one', 'two'].map(id => ({
    queueItemId: id, contentId: `fixture:${id}`, title: `Retained ${id}`,
    format: 'video', duration: 120, priority: 'queue',
  }));
  const snapshot = {
    sessionId: 'offline-session', state: 'paused', currentItem: items[0], position: 20,
    queue: { items, currentIndex: 0, upNextCount: 0, executionOrder: ['one', 'two'] },
    config: { shuffle: false, repeat: 'off', volume: 70, playbackRate: 1, shader: null },
    meta: { ownerId: deviceId, updatedAt: new Date().toISOString() },
  };
  const broadcast = payload => sockets.forEach(socket => socket.send(JSON.stringify({
    topic: `device-state:${deviceId}`, deviceId, ts: new Date().toISOString(), ...payload,
  })));
  broadcast({ snapshot, reason: 'change' });
  await nav.getByRole('button', { name: /^(?:\d+\s+)?Devices$/ }).click();
  await page.getByTestId(`fleet-peek-${deviceId}`).click();
  const panel = page.getByTestId('peek-panel');
  await expect(panel.getByRole('heading', { name: /Offline test screen/ })).toBeVisible();
  await expect(panel.getByTestId('queue-jump-two')).toBeEnabled();
  broadcast({ reason: 'offline' });
  await expect(panel.getByText('Offline', { exact: true })).toBeVisible();
  const seek = panel.getByTestId('np-seek');
  await seek.focus();
  await page.keyboard.press('ArrowRight');
  // The real RemoteSessionController is in use. A visual disabled label alone
  // cannot satisfy this test if keyboard input still submits a command.
  expect(commands, 'Offline keyboard seek must not dispatch').toEqual([]);
  await expect(seek).toHaveAttribute('aria-disabled', 'true');
  for (const id of ['np-stop', 'queue-jump-two', 'queue-remove-one', 'queue-clear', 'queue-shuffle', 'queue-repeat']) {
    await expect(panel.getByTestId(id)).toBeDisabled();
  }
  expect(commands).toEqual([]);
  await expect(page.locator('video, audio')).toHaveCount(0);
});
