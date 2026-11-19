import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test('Feed inline playback holds its progress display while the same decoder keeps playing', async ({ page }) => {
  const item = {
    id: 'youtube:fixture', title: 'Inline playback fixture', source: 'youtube',
    contentType: 'youtube', meta: { videoId: 'fixture' },
  };
  const clip = silentWave(16);
  await page.addInitScript(() => {
    window.fixtureVisibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { get: () => window.fixtureVisibility });
  });
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/scroll/sessions')) return route.fulfill({ json: { items: [item], sessionId: 'fixture', hasMore: false } });
    if (path.includes('/feed/detail/')) return route.fulfill({ json: {
      sections: [{ type: 'player', data: { provider: 'youtube', url: '/fixture-inline.wav', embedFallback: '/fixture-fallback' } }],
    } });
    return route.fulfill({ json: {} });
  });
  await page.route('**/fixture-inline.wav', route => {
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
