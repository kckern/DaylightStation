import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ viewport: { width: 1440, height: 850 }, serviceWorkers: 'block' });

const audio = silentWave(30);

test('Media Settings menu owns Escape before Browse Back while audio plays', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/ws', () => {});
  await page.route('**/fixture-audio.wav', route => route.fulfill({ contentType: 'audio/wav', body: audio }));
  await page.route('**/api/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/play/plex:42')) return route.fulfill({
      json: {
        id: 'plex:42', contentId: 'plex:42', title: 'Settings playback fixture',
        format: 'audio', mediaType: 'audio', mediaUrl: '/fixture-audio.wav', duration: 30,
      },
    });
    return route.fulfill({ json: {} });
  });

  await page.goto('/media?play=plex%3A42');
  const original = await page.waitForFunction(() => [...document.querySelectorAll('audio,video')]
    .find(media => media.currentSrc.includes('fixture-audio.wav') && !media.paused && media.currentTime > 0));
  const playbackTime = () => original.evaluate(media => media.isConnected && !media.paused ? media.currentTime : -1);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Browse' }).click();
  await expect(page).toHaveURL(/view=browse/);
  const browseUrl = page.url();
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  const menu = page.getByRole('menu', { name: 'Settings' });
  await settings.press('Enter');
  await expect(menu.locator(':focus')).toHaveCount(1);
  const beforeEscape = await playbackTime();

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(settings).toBeFocused();
  await expect(page).toHaveURL(browseUrl);
  await expect.poll(playbackTime).toBeGreaterThan(beforeEscape);

  await settings.press('Enter');
  await expect(menu.locator(':focus')).toHaveCount(1);
  // Exercise Escape from the trigger as well as from the portal.
  await page.getByTestId('settings-menu-trigger').focus();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(settings).toBeFocused();
  await expect(page).toHaveURL(browseUrl);

  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/view=browse/);
  const afterBack = await playbackTime();
  expect(afterBack).toBeGreaterThan(0);
  await expect.poll(playbackTime).toBeGreaterThan(afterBack);
});
