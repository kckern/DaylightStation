import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';

test.use({ viewport: { width: 390, height: 850 }, serviceWorkers: 'block' });

async function openMedia(page, baseURL, { firstUse = false } = {}) {
  const origin = new URL(baseURL).origin;
  const audio = silentWave(30);
  const playbackCommands = [];
  let connection;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  if (!firstUse) await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/ws', socket => {
    connection = socket;
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
      return route.fulfill({ json: { devices: { fixture: { name: 'Fixture screen', fleet: true, device_control: { driver: 'fixture' } } } } });
    }
    if (path.endsWith('/device/fixture/off')) playbackCommands.push(path);
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
  await expect.poll(() => Boolean(connection)).toBe(true);
  return { playbackTime, playbackCommands, connection };
}

const openers = [
  { menu: 'Whole house', opener: 'mini-house-menu', item: 'Pause all', area: 'Browse', view: 'browse' },
  { menu: 'screen stop options', opener: 'fleet-stop-more-fixture', item: 'Stop and turn the screen off', area: 'Devices', view: 'fleet' },
];

for (const fixture of openers) {
  test(`Media ${fixture.menu} menu owns Escape before Back without dispatching`, async ({ page, baseURL }) => {
    const { playbackTime, playbackCommands, connection } = await openMedia(page, baseURL);
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: fixture.area, exact: true }).click();
    const view = new RegExp(`view=${fixture.view}`);
    await expect(page).toHaveURL(view);
    if (fixture.view === 'fleet') {
      await expect(page.getByTestId('fleet-peek-fixture')).toBeVisible();
      connection.send(JSON.stringify({
        topic: 'device-state:fixture', deviceId: 'fixture', ts: new Date().toISOString(),
        snapshot: { state: 'playing', currentItem: { contentId: 'plex:123', title: 'Remote fixture', duration: 120 } },
      }));
    }

    const opener = page.getByTestId(fixture.opener);
    await opener.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: fixture.item, exact: true })).toBeEnabled();
    await expect.poll(() => menu.evaluate(node => node.contains(document.activeElement))).toBe(true);
    const beforeEscape = await playbackTime();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page).toHaveURL(view);
    await expect.poll(playbackTime).toBeGreaterThan(beforeEscape);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('home-view')).toBeVisible();
    const afterBack = await playbackTime();
    expect(afterBack).toBeGreaterThan(0);
    await expect.poll(playbackTime).toBeGreaterThan(afterBack);
    expect(playbackCommands).toEqual([]);
  });
}

test('Media dismisses first-use and cast settings before Browse Back', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 850 });
  const { playbackTime, playbackCommands } = await openMedia(page, baseURL, { firstUse: true });
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(page).toHaveURL(/view=browse/);
  const firstUse = page.getByRole('dialog', { name: 'What should we call this device?' });
  await firstUse.getByRole('textbox', { name: 'Name for this device' }).focus();
  const beforeEscape = await playbackTime();
  await page.keyboard.press('Escape');
  await expect(firstUse).toBeHidden();
  await expect(page).toHaveURL(/view=browse/);

  const cast = page.getByRole('button', { name: /Change where things play/ });
  await cast.press('Enter');
  const preferences = page.getByTestId('cast-popover');
  await preferences.getByRole('radio', { name: 'Keep playing here too' }).focus();
  await page.keyboard.press('Escape');
  await expect(preferences).toBeHidden();
  await expect(cast).toBeFocused();
  await expect(page).toHaveURL(/view=browse/);

  // Pointer dismissal should keep the focus chosen by the new click.
  await cast.click();
  await expect(preferences).toBeVisible();
  const search = page.getByRole('textbox', { name: 'Search media…', exact: true });
  await search.click();
  await expect(preferences).toBeHidden();
  await expect(search).toBeFocused();
  await cast.press('Escape');
  await expect(page.getByTestId('home-view')).toBeVisible();
  await expect.poll(playbackTime).toBeGreaterThan(beforeEscape);
  expect(playbackCommands).toEqual([]);
});

test('Media Play on a screen returns focus before Browse Back without sending a command', async ({ page, baseURL }) => {
  const { playbackTime, playbackCommands } = await openMedia(page, baseURL);
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Browse', exact: true }).click();
  await expect(page).toHaveURL(/view=browse/);
  const opener = page.getByRole('button', { name: 'Play on a screen', exact: true });
  await opener.press('Enter');
  const panel = page.getByTestId('fling-panel');
  await panel.getByRole('button', { name: 'Fixture screen' }).focus();
  const beforeEscape = await playbackTime();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page).toHaveURL(/view=browse/);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('home-view')).toBeVisible();
  await expect.poll(playbackTime).toBeGreaterThan(beforeEscape);
  expect(playbackCommands).toEqual([]);
});
