import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

async function reopenAfterEscape(page, chooser) {
  const commands = [];
  const audio = silentWave(30);
  let socket;
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/ws', connection => {
    socket = connection;
    connection.onMessage(raw => {
      const message = JSON.parse(raw);
      if (/^(device-control|client-control):/.test(message.topic || '')) commands.push(message.topic);
    });
  });
  await page.route('**/fixture-audio.wav', route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    if (!range) return route.fulfill({ contentType: 'audio/wav', body: audio });
    const first = Number(range[1]);
    const last = range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    return route.fulfill({
      status: 206,
      contentType: 'audio/wav',
      headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${first}-${last}/${audio.length}` },
      body: audio.subarray(first, last + 1),
    });
  });
  await page.route('**/api/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.endsWith('/device/config')) return route.fulfill({ json: { devices: {
      den: { name: 'Den TV', fleet: true }, kitchen: { name: 'Kitchen TV', fleet: true },
    } } });
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.includes('/device/') && route.request().method() === 'POST') {
      commands.push(path);
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith('/play/plex:42')) return route.fulfill({ json: {
      id: 'plex:42', contentId: 'plex:42', title: 'Den track', format: 'audio', mediaType: 'audio',
      mediaUrl: '/fixture-audio.wav', duration: 30,
    } });
    return route.fulfill({ json: {} });
  });

  const publish = (id, title, position) => {
    const item = { queueItemId: 'q1', contentId: 'plex:42', title, format: 'audio', duration: 30 };
    const ts = new Date().toISOString();
    socket.send(JSON.stringify({
      topic: `device-state:${id}`, deviceId: id, ts,
      snapshot: {
        sessionId: id, state: 'playing', position, currentItem: item,
        queue: { items: [item], currentIndex: 0, upNextCount: 0 },
        config: { shuffle: false, repeat: 'off', volume: 50, playbackRate: 1 },
        meta: { ownerId: id, updatedAt: ts, playbackOwner: {
          ownerInstanceId: id, playbackRevision: 1, queueRevision: 1, sessionId: id,
          contentId: item.contentId, queueItemId: item.queueItemId,
        } },
      },
    }));
  };

  await page.goto('/media');
  await page.getByTestId('app-tab-fleet').click();
  const den = page.getByTestId('fleet-peek-den');
  await expect(den).toBeVisible();
  await expect.poll(() => Boolean(socket)).toBe(true);
  publish('den', 'Den track', 3);
  await den.click();
  const panel = page.getByTestId('peek-panel');
  await expect(panel).toContainText('Den track');
  const denRoute = page.url();
  const trigger = panel.getByRole('button', { name: chooser, exact: true });
  await trigger.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(denRoute);
  await expect(trigger).toBeFocused();
  expect(commands).toEqual([]);

  await trigger.press('Enter');
  return { panel, menu, commands, denRoute, publish };
}

test('Media Peek dismisses Switch screen before Back and shows live playback on the selected screen', async ({ page }) => {
  const { panel, menu, commands, denRoute, publish } = await reopenAfterEscape(page, 'Switch screen');
  await menu.getByRole('menuitem', { name: 'Kitchen TV' }).click();
  await expect(panel.getByRole('heading', { name: 'Kitchen TV' })).toBeVisible();
  publish('kitchen', 'Kitchen track', 9);
  await expect(panel).toContainText('Kitchen track');
  await expect(panel.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuenow', '9');
  expect(commands).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(denRoute);
  await expect(panel).toContainText('Den track');
});

test('Media Peek dismisses Move to before Back and moves remote playback here on selection', async ({ page }) => {
  const { menu, commands } = await reopenAfterEscape(page, 'Move to…');
  await menu.getByRole('menuitem', { name: 'This device' }).click();
  await expect.poll(() => commands).toEqual(['/api/v1/device/den/session/claim']);
  await expect(page).toHaveURL(/view=nowPlaying/);
  const playing = await page.waitForFunction(() => [...document.querySelectorAll('audio,video')]
    .find(media => media.currentSrc.includes('fixture-audio.wav') && !media.paused && media.currentTime >= 3));
  const initial = await playing.evaluate(media => media.currentTime);
  await expect.poll(() => playing.evaluate(media => media.currentTime)).toBeGreaterThan(initial);
});
