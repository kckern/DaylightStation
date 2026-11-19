import { test, expect } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const item = {
  id: 'plex:42', contentId: 'plex:42', source: 'plex', type: 'track',
  title: 'Playback fixture', image: '/icon-192.png', meta: { playable: true, duration: 30 },
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.route('**/fixture-audio.wav', route =>
    route.fulfill({ contentType: 'audio/wav', body: silentWave(30) }));
  await page.route('**/api/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    let json = {};
    if (path.endsWith('/supervision/bootstrap')) json = { enabled: false };
    else if (path.endsWith('/headlines/pages')) json = [];
    else if (path.includes('/scroll/sessions')) json = { items: [item], sessionId: 'fixture', hasMore: false };
    else if (path === '/api/v1/feed/detail/plex:42') json = { sections: [] };
    else if (path.endsWith('/play/plex:42')) json = {
      ...item, format: 'audio', mediaType: 'audio', mediaUrl: '/fixture-audio.wav', duration: 30,
    };
    return route.fulfill({ json });
  });
});

async function originalClock(page) {
  const node = await page.waitForFunction(() => [...document.querySelectorAll('audio,video')]
    .find(media => media.currentSrc.includes('fixture-audio.wav') && !media.paused && media.currentTime > 0));
  return () => node.evaluate(media => media.isConnected && !media.paused ? media.currentTime : -1);
}

for (const app of ['Media', 'Feed']) {
  test(app + ' keeps its local audio through a WebSocket disconnect and reconnect', async ({ page }) => {
    const sockets = [];
    const commands = [];
    await page.routeWebSocket('**/*', socket => {
      sockets.push(socket);
      socket.onMessage(raw => {
        const message = JSON.parse(raw);
        if (/^(device-control|client-control):/.test(message.topic || '')) commands.push(message);
      });
    });
    await page.goto(app === 'Media' ? '/media?play=plex:42' : '/feed/scroll');
    if (app === 'Feed') await page.getByRole('button', { name: 'Play', exact: true }).first().click();
    const clock = await originalClock(page);
    const initial = await clock();
    await expect.poll(() => sockets.length).toBe(1);
    sockets[0].close({ code: 1001, reason: 'fixture disconnect' });
    await expect.poll(() => sockets.length, { timeout: 20000 }).toBe(2);
    await expect.poll(clock).toBeGreaterThan(initial);
    const reconnected = await clock();
    await expect.poll(clock).toBeGreaterThan(reconnected);
    expect(commands).toEqual([]);
  });
}

test('Feed article playback survives its player sheet and Back restores the card focus', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const clock = await originalClock(page);
  const initial = await clock();
  const opener = page.getByRole('button', { name: /^Open:/ }).first();
  await opener.press('Enter');
  await expect(page).toHaveURL(/\/feed\/scroll\/[^/]+$/);
  await expect(page.getByRole('heading', { name: item.title, exact: true })).toBeVisible();
  await expect.poll(clock).toBeGreaterThan(initial);

  const mini = page.getByRole('button', { name: /Open player/ });
  await mini.click();
  const expanded = await clock();
  await expect.poll(clock).toBeGreaterThan(expanded);
  await page.getByRole('button', { name: 'Close player' }).click();
  await expect(mini).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/feed\/scroll$/);
  await expect(opener).toBeFocused();
  const returned = await clock();
  expect(returned).toBeGreaterThan(initial);
  await expect.poll(clock).toBeGreaterThan(returned);
});
