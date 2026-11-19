import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ viewport: { width: 390, height: 850 }, serviceWorkers: 'block' });

test('Media Fleet Play picker owns Escape before Back while local audio persists', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const audio = silentWave(30);
  const playbackCommands = [];
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/ws', socket => {
    socket.onMessage(raw => {
      const message = JSON.parse(raw);
      if (/^(device-control|client-control):/.test(message.topic || '')) playbackCommands.push(message);
    });
  });
  await page.route('**/fixture-audio.wav', route => route.fulfill({ contentType: 'audio/wav', body: audio }));
  await page.route('**/api/**', route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path.endsWith('/device/config')) {
      return route.fulfill({ json: { devices: { fixture: { name: 'Fixture screen', fleet: true } } } });
    }
    if (path.endsWith('/play/plex:42')) return route.fulfill({ json: {
      id: 'plex:42', contentId: 'plex:42', title: 'Persistent local fixture',
      format: 'audio', mediaType: 'audio', mediaUrl: '/fixture-audio.wav', duration: 30,
    } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/media?play=plex%3A42');
  const localMedia = await page.waitForFunction(() => [...document.querySelectorAll('audio,video')]
    .find(media => media.currentSrc.includes('fixture-audio.wav') && !media.paused && media.currentTime > 0));
  const playbackTime = () => localMedia.evaluate(media => media.isConnected && !media.paused ? media.currentTime : -1);
  const beforeFleet = await playbackTime();
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Devices' }).click();
  await expect(page.getByTestId('fleet-peek-fixture')).toBeVisible();
  const opener = page.getByTestId('fleet-play-fixture');
  const input = page.getByTestId('fleet-play-input-fixture');
  await opener.press('Enter');
  await expect(input).toBeFocused();
  await input.fill('fixture');
  await page.keyboard.press('Escape');
  await expect(input).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page).toHaveURL(/view=fleet/);
  await expect.poll(playbackTime).toBeGreaterThan(beforeFleet);

  await opener.click();
  await expect(input).toBeFocused();
  await opener.click();
  await expect(input).toBeHidden();
  await opener.click();
  await expect(input).toBeFocused();
  const devicesHeading = page.getByRole('heading', { name: 'Devices', exact: true });
  await devicesHeading.click();
  await expect(input).toBeHidden();
  await expect(page).toHaveURL(/view=fleet/);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('home-view')).toBeVisible();
  const afterBack = await playbackTime();
  expect(afterBack).toBeGreaterThan(0);
  await expect.poll(playbackTime).toBeGreaterThan(afterBack);
  expect(playbackCommands).toEqual([]);
});
