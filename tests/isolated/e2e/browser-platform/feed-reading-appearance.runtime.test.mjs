import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test('Feed Reading appearance owns Escape ahead of Scroll detail and closes on a mode change', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const article = { id: 'test:article', title: 'Appearance article', source: 'fixture', published: '2026-07-01T12:00:00Z' };
  const song = { id: 'plex:42', contentId: 'plex:42', title: 'Continuous audio', type: 'track', source: 'plex',
    image: '/icon-192.png', meta: { playable: true, duration: 30 } };
  const wave = silentWave(30);
  const writes = [];
  let heldExport;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/feed/workspace')) return route.fulfill({ json: { preferencesStored: true, preferences: { theme: 'dark' } } });
    if (path.endsWith('/feed/workspace/preferences') && request.method() === 'PATCH') {
      const preferences = request.postDataJSON();
      writes.push(preferences);
      return route.fulfill({ json: { preferences } });
    }
    if (path.endsWith('/scroll/sessions')) return route.fulfill({ json: { items: [song, article], sessionId: 'fixture', hasMore: false } });
    if (path.endsWith('/play/plex:42')) return route.fulfill({ json: {
      ...song, format: 'audio', mediaType: 'audio', duration: 30, mediaUrl: '/appearance-audio.wav',
    } });
    if (path.includes('/feed/detail/')) return route.fulfill({ json: { sections: [] } });
    if (path.endsWith('/feed/data/export')) { heldExport = route; return; }
    if (path.endsWith('/reader/feeds')) return route.fulfill({ json: [] });
    if (path.endsWith('/reader/stream')) return route.fulfill({ json: { items: [], exhausted: true } });
    return route.fulfill({ json: {} });
  });
  await page.route('**/appearance-audio.wav', route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
    if (!range) return route.fulfill({ contentType: 'audio/wav', body: wave });
    const first = Number(range[1]);
    const last = range[2] ? Math.min(Number(range[2]), wave.length - 1) : wave.length - 1;
    return route.fulfill({
      status: 206, contentType: 'audio/wav', body: wave.subarray(first, last + 1),
      headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${first}-${last}/${wave.length}` },
    });
  });

  await page.goto('/feed/scroll');
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  const decoder = await page.waitForFunction(() => [...document.querySelectorAll('audio,video')]
    .find(media => media.currentSrc.endsWith('/appearance-audio.wav') && !media.paused && media.currentTime > 0));
  const playbackTime = () => decoder.evaluate(media => media.isConnected && !media.paused ? media.currentTime : -1);

  const summary = page.getByLabel('Reading appearance', { exact: true });
  const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
  const openArticle = page.getByRole('button', { name: 'Open: ' + article.title, exact: true });
  const back = page.getByRole('button', { name: 'Back to feed', exact: true });
  await openArticle.click();
  await expect(back).toBeVisible();
  for (const key of ['Enter', 'Space']) {
    await summary.press(key);
    await page.keyboard.press('Escape');
    await expect(theme).toBeHidden();
    await expect(back).toBeVisible();
    await expect(summary).toBeFocused();
  }

  await summary.press('Enter');
  await theme.selectOption('sepia');
  await expect.poll(() => writes).toEqual([{ theme: 'sepia' }]);
  const beforeEscape = await playbackTime();
  await theme.press('Escape');
  await expect(theme).toBeHidden();
  await expect(back).toBeVisible();
  await expect(summary).toBeFocused();
  await expect.poll(playbackTime).toBeGreaterThan(beforeEscape);

  await page.keyboard.press('Escape');
  await expect(back).toBeHidden();
  await expect(openArticle).toBeFocused();

  await summary.press('Enter');
  await expect(theme).toHaveValue('sepia');
  await page.getByRole('button', { name: 'Export', exact: true }).press('Enter');
  await expect.poll(() => Boolean(heldExport)).toBe(true);
  const reader = page.getByRole('link', { name: 'Reader', exact: true });
  await reader.press('Enter');
  await expect(page).toHaveURL(/\/feed\/reader$/);
  await expect(theme).toBeHidden();
  await expect(reader).toBeFocused();

  const download = page.waitForEvent('download');
  await heldExport.fulfill({ json: { fixture: true } });
  expect((await download).suggestedFilename()).toMatch(/^daylight-feed-.*\.json$/);
  await summary.press('Enter');
  await expect(page.getByText('Export downloaded.')).toBeVisible();
  const afterMode = await playbackTime();
  expect(afterMode).toBeGreaterThan(0);
  await expect.poll(playbackTime).toBeGreaterThan(afterMode);
});
