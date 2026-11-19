import { test, expect } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 850 } });

const tracks = ['41', '42'].map(id => ({
  id: 'plex:' + id, contentId: 'plex:' + id, source: 'plex', type: 'track',
  title: 'Track ' + id, image: '/icon-192.png', meta: { playable: true, duration: 30 },
}));

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  const audio = silentWave(30);
  await page.route('**/feed-speed-*.wav', route => route.fulfill({ contentType: 'audio/wav', body: audio }));
  await page.route('**/api/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const track = tracks.find(item => path.endsWith('/play/' + item.id));
    let json = {};
    if (path.endsWith('/supervision/bootstrap')) json = { enabled: false };
    else if (path.endsWith('/headlines/pages')) json = [];
    else if (path.includes('/scroll/sessions')) json = { items: tracks, sessionId: 'speed', hasMore: false };
    else if (track) json = {
      ...track, format: 'audio', mediaType: 'audio', duration: 30,
      mediaUrl: '/feed-speed-' + track.id.slice(5) + '.wav',
    };
    return route.fulfill({ json });
  });
});

function playTrack(page, id) {
  return page.locator(`[data-feed-item-id="plex:${id}"]`).getByRole('button', { name: 'Play', exact: true }).click();
}

function playingSettings(page, id) {
  return page.evaluate(id => {
    const audio = [...document.querySelectorAll('audio,video')]
      .find(media => media.currentSrc.includes('feed-speed-' + id + '.wav') && !media.paused && media.currentTime > 0);
    return audio ? { speed: audio.playbackRate, volume: audio.volume } : null;
  }, id);
}

test('Feed restores the saved speed and volume and retains a speed change on the replacement track', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('feedPlayer:speed', '1.5');
    localStorage.setItem('feedPlayer:volume', '0.65');
  });
  await page.goto('/feed/scroll');
  await playTrack(page, '41');
  await expect.poll(() => playingSettings(page, '41')).toEqual({ speed: 1.5, volume: 0.65 });
  await page.getByRole('button', { name: 'Playback speed 1.5x' }).click();
  await expect(page.getByRole('button', { name: 'Playback speed 1.75x' })).toBeVisible();
  await expect.poll(() => playingSettings(page, '41')).toEqual({ speed: 1.75, volume: 0.65 });
  await playTrack(page, '42');
  await expect.poll(() => playingSettings(page, '42')).toEqual({ speed: 1.75, volume: 0.65 });

  const original = await page.locator('audio[src$="feed-speed-42.wav"]').elementHandle();
  await page.setViewportSize({ width: 1440, height: 850 });
  await page.getByRole('button', { name: 'Open player: Track 42', exact: true }).press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Track 42', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect.poll(() => original.evaluate(audio => audio.isConnected && audio.volume)).toBe(0);
  await dialog.getByRole('button', { name: 'Unmute', exact: true }).click();
  await expect.poll(() => original.evaluate(audio => audio.isConnected && audio.volume)).toBe(0.65);
});

test('Feed uses playable defaults for malformed speed and out-of-range volume', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('feedPlayer:speed', '1.5junk');
    localStorage.setItem('feedPlayer:volume', '1.7');
  });
  await page.goto('/feed/scroll');
  await playTrack(page, '41');
  await expect(page.getByRole('button', { name: 'Playback speed 1x' })).toBeVisible();
  await expect.poll(() => playingSettings(page, '41')).toEqual({ speed: 1, volume: 1 });
});
