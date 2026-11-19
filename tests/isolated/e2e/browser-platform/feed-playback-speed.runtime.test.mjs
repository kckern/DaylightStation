import { test, expect } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

test('Feed restores the saved speed on a lazy player and retains a speed change on the replacement track', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('feedPlayer:speed', '1.5'));
  await page.routeWebSocket('**/*', () => {});
  const items = ['41', '42'].map(id => ({
    id: 'plex:' + id, contentId: 'plex:' + id, source: 'plex', type: 'track',
    title: 'Track ' + id, image: '/icon-192.png', meta: { playable: true, duration: 30 },
  }));
  const audio = silentWave(30);
  await page.route('**/feed-speed-*.wav', route => route.fulfill({ contentType: 'audio/wav', body: audio }));
  await page.route('**/api/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const track = items.find(item => path.endsWith('/play/' + item.id));
    let json = {};
    if (path.endsWith('/supervision/bootstrap')) json = { enabled: false };
    else if (path.endsWith('/headlines/pages')) json = [];
    else if (path.includes('/scroll/sessions')) json = { items, sessionId: 'speed', hasMore: false };
    else if (track) json = {
      ...track, format: 'audio', mediaType: 'audio', duration: 30,
      mediaUrl: '/feed-speed-' + track.id.slice(5) + '.wav',
    };
    return route.fulfill({ json });
  });

  await page.goto('/feed/scroll');
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(play).toHaveCount(2);
  await play.first().click();
  const currentRate = id => page.evaluate(id => [...document.querySelectorAll('audio,video')]
    .find(el => el.currentSrc.includes('feed-speed-' + id + '.wav') && !el.paused && el.currentTime > 0)?.playbackRate, id);
  await expect.poll(() => currentRate('41')).toBe(1.5);
  await page.getByRole('button', { name: 'Playback speed 1.5x' }).click();
  await expect(page.getByRole('button', { name: 'Playback speed 1.75x' })).toBeVisible();
  await expect.poll(() => currentRate('41')).toBe(1.75);
  await page.getByRole('button', { name: 'Play', exact: true }).last().click();
  await expect.poll(() => currentRate('42')).toBe(1.75);
});
