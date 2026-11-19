import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ serviceWorkers: 'block' });

const audio = silentWave(30);

for (const width of [390, 1440]) {
  test(`Media rename owns Escape before Browse Back while audio plays at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
    await page.routeWebSocket('**/ws', () => {});
    await page.route('**/fixture-audio.wav', route => route.fulfill({ contentType: 'audio/wav', body: audio }));
    await page.route('**/api/**', route => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
      if (path.endsWith('/play/plex:42')) return route.fulfill({
        json: {
          id: 'plex:42', contentId: 'plex:42', title: 'Rename playback fixture',
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
    await settings.click();
    await page.getByTestId('settings-rename-device').click();
    const dialog = page.getByRole('dialog', { name: 'Rename this device' });
    const name = dialog.getByRole('textbox', { name: 'Device name' });
    await expect(name).toBeFocused();
    await name.fill('Unsaved fixture name');

    const beforeEscape = await playbackTime();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(browseUrl);
    await expect(settings).toBeFocused();
    await expect.poll(playbackTime).toBeGreaterThan(beforeEscape);

    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/view=browse/);
    const afterBack = await playbackTime();
    expect(afterBack).toBeGreaterThan(0);
    await expect.poll(playbackTime).toBeGreaterThan(afterBack);
  });
}
