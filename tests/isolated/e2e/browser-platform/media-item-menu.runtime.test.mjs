import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ viewport: { width: 1440, height: 850 }, serviceWorkers: 'block' });

async function installItemMenuFixtures(page, baseURL) {
  const origin = new URL(baseURL).origin;
  const audio = silentWave(30);
  const item = {
    contentId: 'plex:123', title: 'Item menu fixture film', type: 'movie',
    spots: [
      { playhead: 720, duration: 7200, deviceId: 'browser:tablet' },
      { playhead: 4800, duration: 7200, deviceId: 'fleet:lounge' },
    ],
  };
  const playRequests = [];
  const remoteCommands = [];
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', socket => socket.onMessage(raw => {
    const message = JSON.parse(raw);
    if (/^(device-control|client-control):/.test(message.topic || '')) remoteCommands.push(message);
  }));
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

  return { playRequests, remoteCommands };
}

test('Media Home item menu owns Escape before Back and returns focus from Quality', async ({ page, baseURL }) => {
  const { playRequests, remoteCommands } = await installItemMenuFixtures(page, baseURL);
  await page.goto('/media?play=plex%3A42');
  const original = await page.waitForFunction(() => [...document.querySelectorAll('audio,video')]
    .find(media => media.currentSrc.includes('fixture-audio.wav') && !media.paused && media.currentTime > 0));
  const playbackTime = () => original.evaluate(media => media.isConnected && !media.paused ? media.currentTime : -1);
  const primary = page.getByRole('navigation', { name: 'Primary' });
  await primary.getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(page).toHaveURL(/view=browse/);
  await primary.getByRole('button', { name: 'Home', exact: true }).click();

  const opener = page.getByRole('button', { name: 'More actions for Item menu fixture film' });
  const menu = page.getByRole('menu', { name: 'More actions for Item menu fixture film' });
  await opener.press('Enter');
  await expect(menu.locator(':focus')).toHaveCount(1);
  const beforeEscape = await playbackTime();

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page).not.toHaveURL(/view=browse/);
  await expect.poll(playbackTime).toBeGreaterThan(beforeEscape);

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/view=browse/);
  const afterBack = await playbackTime();
  expect(afterBack).toBeGreaterThan(0);
  await expect.poll(playbackTime).toBeGreaterThan(afterBack);
  await primary.getByRole('button', { name: 'Home', exact: true }).click();

  await opener.click();
  await expect(page).not.toHaveURL(/view=detail/);
  await menu.getByRole('menuitem', { name: 'Quality…', exact: true }).click();
  const quality = page.getByRole('dialog', { name: 'Playback quality' });
  await expect(menu).toBeHidden();
  await expect(quality).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(quality).toBeHidden();
  await expect(opener).toBeFocused();

  await opener.press('Enter');
  await menu.getByRole('menuitem', { name: 'Details', exact: true }).click();
  await expect(page).toHaveURL(/view=detail/);
  await expect(page.getByRole('heading', { name: 'Item menu fixture film' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('home-view')).toBeVisible();

  expect(playRequests).toEqual(['/api/v1/play/plex:42']);
  expect(remoteCommands).toEqual([]);
});

test('Media Home Play next shares native short presses and an exclusive long press', async ({ page, baseURL }) => {
  const { playRequests, remoteCommands } = await installItemMenuFixtures(page, baseURL);
  await page.goto('/media?play=plex%3A42');
  await expect(page.getByTestId('mini-state')).toHaveText('Playing on this device');
  await page.clock.install();

  const name = 'More actions for Item menu fixture film';
  const opener = page.getByRole('button', { name });
  const menu = page.getByRole('menu', { name });
  const next = menu.getByRole('menuitem', { name: 'Play next', exact: true });
  const front = menu.getByRole('menuitem', { name: 'At the very front', exact: true });
  const count = page.getByTestId('mini-queue-count');
  const openNext = async () => {
    await opener.press('Enter');
    await expect(menu.locator(':focus')).toHaveCount(1);
    await next.focus();
    await expect(next).toBeFocused();
  };

  await openNext();
  await next.press('Space');
  await expect(menu).toBeHidden();
  await expect(count).toHaveText('1/2');

  await openNext();
  await next.press('Enter');
  await expect(menu).toBeHidden();
  await expect(count).toHaveText('1/3');

  await openNext();
  await page.keyboard.down('Space');
  await page.keyboard.down('Shift');
  await page.keyboard.up('Shift');
  await page.clock.runFor(510);
  await expect(front).toBeVisible();
  await page.keyboard.up('Space');
  await expect(front).toBeVisible();
  await expect(next).toBeFocused();
  await expect(count).toHaveText('1/3');
  await next.press('ArrowDown');
  await expect(front).toBeFocused();
  await front.press('Enter');
  await expect(menu).toBeHidden();
  await expect(count).toHaveText('1/4');

  await openNext();
  await next.hover();
  await page.mouse.down();
  await page.clock.runFor(510);
  await expect(front).toBeVisible();
  await page.mouse.up();
  await expect(front).toBeVisible();
  await expect(count).toHaveText('1/4');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(opener).toBeFocused();

  await openNext();
  await next.hover();
  await page.mouse.down({ button: 'right' });
  await page.clock.runFor(510);
  await expect(front).toBeHidden();
  await page.mouse.up({ button: 'right' });
  await expect(count).toHaveText('1/4');
  expect(playRequests).toEqual(['/api/v1/play/plex:42']);
  expect(remoteCommands).toEqual([]);
});
