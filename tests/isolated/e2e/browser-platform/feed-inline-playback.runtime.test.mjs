import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const item = {
  id: 'youtube:fixture', title: 'Inline playback fixture', source: 'youtube',
  contentType: 'youtube', meta: { videoId: 'fixture' }, published: '2026-07-01T12:00:00Z',
};
const song = {
  id: 'plex:42', contentId: 'plex:42', title: 'Persistent audio fixture', type: 'track',
  source: 'plex', image: '/icon-192.png', meta: { playable: true, duration: 16 },
};

async function installPlaybackFixture(page, items = [item]) {
  const clip = silentWave(16);
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/scroll/sessions')) return route.fulfill({ json: { items, sessionId: 'fixture', hasMore: false } });
    if (path.endsWith('/reader/feeds')) return route.fulfill({ json: [] });
    if (path.endsWith('/reader/stream')) return route.fulfill({ json: { items: [item], exhausted: true } });
    if (decodeURIComponent(path).endsWith('/play/plex:42')) return route.fulfill({ json: {
      ...song, format: 'audio', mediaType: 'audio', duration: 16, mediaUrl: '/fixture-persistent.wav',
    } });
    if (path.includes('/feed/detail/')) return route.fulfill({ json: {
      sections: [{ type: 'player', data: { provider: 'youtube', url: '/fixture-inline.wav', embedFallback: '/fixture-fallback' } }],
    } });
    return route.fulfill({ json: {} });
  });
  await page.route(/\/fixture-(inline|persistent)\.wav$/, route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    if (!range) return route.fulfill({ contentType: 'audio/wav', body: clip });
    const first = Number(range[1]);
    const last = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
    return route.fulfill({
      status: 206,
      contentType: 'audio/wav',
      headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${first}-${last}/${clip.length}` },
      body: clip.subarray(first, last + 1),
    });
  });

}

test('Feed inline playback holds its progress display while the same decoder keeps playing', async ({ page }) => {
  await page.addInitScript(() => {
    window.fixtureVisibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { get: () => window.fixtureVisibility });
  });
  await installPlaybackFixture(page);
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: `Open: ${item.title}` }).click();
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  const player = page.locator('.feed-player');
  const decoder = await player.locator('video').elementHandle();
  const clock = () => decoder.evaluate(video => video.isConnected && !video.paused ? video.currentTime : -1);
  const progress = player.locator('.feed-player-controls > div:first-child > div:first-child > div');
  const width = () => progress.evaluate(bar => Number.parseFloat(bar.style.width));
  await expect.poll(clock).toBeGreaterThan(0.2);
  await expect.poll(width).toBeGreaterThan(0);

  const frozen = await progress.evaluate(bar => {
    window.fixtureVisibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    return Number.parseFloat(bar.style.width);
  });
  const hiddenStart = await clock();
  await expect.poll(clock).toBeGreaterThan(hiddenStart + 0.5);
  expect(await width()).toBe(frozen);

  await page.evaluate(() => {
    window.fixtureVisibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(width).toBeGreaterThan(frozen + 0.5);
  await expect.poll(clock).toBeGreaterThan(hiddenStart + 0.5);
});

async function startPersistentAudio(page) {
  await installPlaybackFixture(page, [song, item]);
  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: /^Play / }).first().click();
  return page.waitForFunction(() => [...document.querySelectorAll('audio,video')].find(media =>
    media.currentSrc.endsWith('/fixture-persistent.wav') && !media.paused && media.currentTime > 0));
}

test('Feed Scroll parks the original audio without controls when a different article plays inline', async ({ page }) => {
  const original = await startPersistentAudio(page);
  const mini = page.getByRole('button', { name: /Open player/ });
  await expect(mini).toBeVisible();
  await page.getByRole('button', { name: `Open: ${item.title}` }).click();
  await page.getByRole('button', { name: 'Play video', exact: true }).click();
  const inline = page.locator('.feed-player video');
  await expect.poll(() => inline.evaluate(video => video.currentTime)).toBeGreaterThan(0.2);

  await expect.poll(() => original.evaluate(audio => audio.isConnected)).toBe(false);
  await expect(mini).toHaveCount(0);
  await expect(inline).toBeVisible();
});

test('Feed Reader preempts persistent audio without publishing controls for its inline decoder', async ({ page }) => {
  const token = 'header.' + Buffer.from(JSON.stringify({ sub: 'reader-fixture' })).toString('base64url') + '.signature';
  await page.addInitScript(value => localStorage.setItem('ds_token', value), token);
  const original = await startPersistentAudio(page);
  const mini = page.getByRole('button', { name: /Open player/ });
  await expect(mini).toBeVisible();
  const readerRequest = page.waitForRequest(request =>
    new URL(request.url()).pathname.endsWith('/reader/stream') && request.headers().authorization === `Bearer ${token}`);
  await page.getByRole('link', { name: 'Reader', exact: true }).click();
  await readerRequest;
  const row = page.getByRole('button', { name: new RegExp(item.title) });
  await row.click();
  const inline = page.locator('.feed-player video');
  await expect.poll(() => inline.evaluate(video => video.currentTime)).toBeGreaterThan(0.2);
  await expect.poll(() => original.evaluate(audio => audio.isConnected)).toBe(false);
  await expect(mini).toHaveCount(0);

  await row.click();
  await expect(inline).toHaveCount(0);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(mini).toHaveCount(0);
});
