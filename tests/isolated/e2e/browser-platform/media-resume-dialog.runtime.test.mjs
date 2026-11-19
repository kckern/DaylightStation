import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ viewport: { width: 390, height: 850 }, serviceWorkers: 'block' });

test('Media resume chooser owns Escape before Details Back while audio plays', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const audio = silentWave(30);
  const item = {
    contentId: 'plex:123', title: 'Resume fixture film', type: 'movie',
    spots: [
      { playhead: 720, duration: 7200, deviceId: 'browser:tablet' },
      { playhead: 4800, duration: 7200, deviceId: 'fleet:lounge' },
    ],
  };
  const playRequests = [];
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/fixture-audio.wav', route => route.fulfill({ contentType: 'audio/wav', body: audio }));
  await page.route('**/api/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path === '/api/v1/media/screens') return route.fulfill({ json: { screens: [
      { id: 'fleet:lounge', name: 'Lounge TV' }, { id: 'browser:tablet', name: 'Kitchen Tablet' },
    ] } });
    if (path === '/api/v1/media/suggestions') return route.fulfill({ json: { rows: [{ id: 'carry-on', title: 'Carry on', items: [item] }] } });
    if (path === '/api/v1/media/household/carry-on') return route.fulfill({ json: { items: [item] } });
    if (path === '/api/v1/info/plex/123') return route.fulfill({ json: item });
    if (path.includes('/play/')) playRequests.push(path);
    if (path.endsWith('/play/plex:42')) return route.fulfill({ json: {
      id: 'plex:42', contentId: 'plex:42', title: 'Current track fixture',
      format: 'audio', mediaType: 'audio', mediaUrl: '/fixture-audio.wav', duration: 30,
    } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/media?play=plex%3A42');
  const original = await page.waitForFunction(() => [...document.querySelectorAll('audio,video')]
    .find(media => media.currentSrc.includes('fixture-audio.wav') && !media.paused && media.currentTime > 0));
  const playbackTime = () => original.evaluate(media => media.isConnected && !media.paused ? media.currentTime : -1);
  await page.getByTestId('home-tile-carry-on-plex:123-more').click();
  await page.getByRole('menuitem', { name: 'Details', exact: true }).click();
  const playNow = page.getByRole('button', { name: 'Play Now', exact: true });
  await playNow.press('Enter');
  const chooser = page.getByRole('dialog', { name: 'Continue Resume fixture film from…' });
  await expect(chooser.getByRole('button', { name: '12 m on Kitchen Tablet' })).toBeVisible();
  await expect(chooser.getByRole('button', { name: '1 h 20 m on Lounge TV' })).toBeVisible();

  const beforeEscape = await playbackTime();
  await page.keyboard.press('Escape');
  await expect(chooser).toBeHidden();
  await expect(playNow).toBeFocused();
  await expect(page).toHaveURL(/view=detail/);
  await expect.poll(playbackTime).toBeGreaterThan(beforeEscape);
  expect(playRequests).toEqual(['/api/v1/play/plex:42']);

  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/view=detail/);
  const afterBack = await playbackTime();
  expect(afterBack).toBeGreaterThan(0);
  await expect.poll(playbackTime).toBeGreaterThan(afterBack);
});
