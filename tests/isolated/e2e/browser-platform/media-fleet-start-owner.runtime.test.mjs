import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ viewport: { width: 390, height: 850 }, serviceWorkers: 'block' });

test('Media Fleet retires start-status reads on reconnect and Back while local audio persists', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const audio = silentWave(30);
  const sockets = [];
  const reads = [];
  const aborted = [];
  const playbackCommands = [];
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/ws', socket => {
    sockets.push(socket);
    socket.onMessage(raw => {
      const message = JSON.parse(raw);
      if (/^(device-control|client-control):/.test(message.topic || '')) playbackCommands.push(message);
    });
  });
  await page.route('**/fixture-audio.wav', route => route.fulfill({ contentType: 'audio/wav', body: audio }));
  page.on('requestfailed', request => aborted.push(request));
  await page.route('**/api/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/device/config')) {
      return route.fulfill({ json: { devices: { fixture: { name: 'Fixture screen', fleet: true } } } });
    }
    if (path.endsWith('/device/fixture/start-status')) {
      reads.push(route);
      return;
    }
    if (path.endsWith('/play/plex:42')) return route.fulfill({ json: {
      id: 'plex:42', contentId: 'plex:42', title: 'Persistent local fixture',
      format: 'audio', mediaType: 'audio', mediaUrl: '/fixture-audio.wav', duration: 30,
    } });
    return route.fulfill({ json: {} });
  });

  const reconnect = async count => {
    sockets[count - 2].close({ code: 1001, reason: 'fixture reconnect' });
    await expect.poll(() => sockets.length, { timeout: 20_000 }).toBe(count);
    await expect.poll(() => reads.length).toBe(count);
  };
  await page.goto('/media?play=plex%3A42');
  const localMedia = await page.waitForFunction(() => [...document.querySelectorAll('audio,video')]
    .find(media => media.currentSrc.includes('fixture-audio.wav') && !media.paused && media.currentTime > 0));
  const playbackTime = () => localMedia.evaluate(media => media.isConnected && !media.paused ? media.currentTime : -1);
  const beforeFleet = await playbackTime();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Devices' }).click();
  await expect(page.getByTestId('fleet-peek-fixture')).toBeVisible();
  await expect.poll(() => sockets.length).toBe(1);
  await expect.poll(() => reads.length).toBe(1);

  await reconnect(2);
  await expect.configure({ soft: true }).poll(() => aborted, { timeout: 2_000 }).toContain(reads[0].request());
  const status = page.getByTestId('house-start-status-fixture');
  sockets[1].send(JSON.stringify({
    topic: 'device-start:fixture', deviceId: 'fixture', phase: 'failed', updatedAt: '2026-11-19T12:01:00.000Z',
  }));
  await expect(status).toHaveAttribute('data-tone', 'failed');
  const reply = page.waitForResponse(response => response.request() === reads[1].request());
  await reads[1].fulfill({ json: { status: { phase: 'starting', updatedAt: '2026-11-19T12:00:00.000Z' } } });
  await (await reply).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(status).toHaveAttribute('data-tone', 'failed');

  await reconnect(3);
  await page.goBack();
  await expect(page.getByTestId('home-view')).toBeVisible();
  await expect.poll(() => aborted, { timeout: 2_000 }).toContain(reads[2].request());
  await expect.poll(playbackTime).toBeGreaterThan(beforeFleet);
  expect(playbackCommands).toEqual([]);
});
