import { expect, test } from '@playwright/test';
import { silentWave } from '../../../_fixtures/media/silentWave.mjs';
import { emptyRegistry, roomAdjacencyView, setRoomNeighbours } from '../../../../__app_modules/media/media/server/domain/screenRegistry.mjs';

test.use({ viewport: { width: 390, height: 850 }, serviceWorkers: 'block' });

const screens = [
  { id: 'fleet:den', name: 'Den TV', room: 'Den', kind: 'screen' },
  { id: 'fleet:kitchen', name: 'Kitchen tablet', room: 'Kitchen', kind: 'screen' },
  { id: 'fleet:porch', name: 'Porch TV', room: 'Porch', kind: 'screen' },
];
const audio = silentWave(30);

async function installMedia(page, baseURL, save) {
  const origin = new URL(baseURL).origin;
  await page.context().route('**/*', route => (
    new URL(route.request().url()).origin === origin ? route.fallback() : route.abort()
  ));
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/fixture-audio.wav', route => route.fulfill({ contentType: 'audio/wav', body: audio }));
  let roomRegistry = emptyRegistry();
  await page.route('**/api/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
    if (path === '/api/v1/media/screens') return route.fulfill({ json: { screens, roomAdjacency: roomAdjacencyView(roomRegistry) } });
    if (path === '/api/v1/media/screens/rooms/adjacency' && route.request().method() === 'PUT') {
      const input = route.request().postDataJSON();
      if (await save(input) === false) {
        return route.fulfill({ status: 409, json: { error: 'Room settings changed' } });
      }
      const updated = setRoomNeighbours(roomRegistry, input.room, input.neighbours);
      roomRegistry = updated.state;
      return route.fulfill({ json: { roomAdjacency: updated.adjacency } });
    }
    if (path.endsWith('/play/plex:42')) return route.fulfill({ json: {
      id: 'plex:42', contentId: 'plex:42', title: 'Neighbour playback fixture',
      format: 'audio', mediaType: 'audio', mediaUrl: '/fixture-audio.wav', duration: 30,
    } });
    return route.fulfill({ json: {} });
  });
}

async function openScreens(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('settings-manage-screens').click();
}

test('Media Room Neighbours owns Escape before Screens Back while audio plays', async ({ page, baseURL }) => {
  const writes = [];
  await installMedia(page, baseURL, input => writes.push(input));
  await page.goto('/media?play=plex%3A42');
  const original = await page.waitForFunction(() => [...document.querySelectorAll('audio,video')]
    .find(media => media.currentSrc.includes('fixture-audio.wav') && !media.paused && media.currentTime > 0));
  const playbackTime = () => original.evaluate(media => media.isConnected && !media.paused ? media.currentTime : -1);
  await openScreens(page);
  const trigger = page.getByTestId('screen-admin-room-edit-den');
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Rooms next to Den' });
  await dialog.getByRole('checkbox', { name: 'Kitchen' }).check();

  const beforeEscape = await playbackTime();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/view=screens/);
  await expect(trigger).toBeFocused();
  await expect.poll(playbackTime).toBeGreaterThan(beforeEscape);
  expect(writes).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/view=screens/);
  const afterBack = await playbackTime();
  expect(afterBack).toBeGreaterThan(0);
  await expect.poll(playbackTime).toBeGreaterThan(afterBack);
});

test('Media Room Neighbours preserves a replacement editor when an earlier save completes', async ({ page, baseURL }) => {
  const release = Promise.withResolvers();
  const submissions = [];
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installMedia(page, baseURL, async input => {
    submissions.push(input);
    if (submissions.length === 1) await release.promise;
    if (submissions.length === 2) return false;
  });
  await page.goto('/media');
  await openScreens(page);
  await page.getByTestId('screen-admin-room-edit-den').click();
  const den = page.getByRole('dialog', { name: 'Rooms next to Den' });
  await den.getByRole('checkbox', { name: 'Kitchen' }).check();
  await den.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => submissions).toEqual([{ room: 'Den', neighbours: ['Kitchen'] }]);
  await den.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(den).toBeHidden();
  await page.goBack();
  await expect(page).not.toHaveURL(/view=screens/);
  await page.goForward();
  await expect(page).toHaveURL(/view=screens/);

  await page.getByTestId('screen-admin-room-edit-kitchen').click();
  const kitchen = page.getByRole('dialog', { name: 'Rooms next to Kitchen' });
  const denOption = kitchen.getByRole('checkbox', { name: 'Den' });
  await expect(denOption).not.toBeChecked();
  const porch = kitchen.getByRole('checkbox', { name: 'Porch' });
  await porch.check();
  const save = kitchen.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  release.resolve();
  await expect(page.getByTestId('screen-admin-room-near-den')).toHaveText('Next to Kitchen');
  await expect(kitchen).toBeVisible();
  await expect(porch).toBeChecked();
  await expect(denOption).toBeChecked();

  await expect(save).toBeEnabled();
  await save.click();
  await expect(kitchen.getByRole('alert')).toBeVisible();
  await expect(porch).toBeChecked();
  await save.click();
  await expect(kitchen).toBeHidden();
  await expect(page.getByTestId('screen-admin-room-near-den')).toHaveText('Next to Kitchen');
  await expect(page.getByTestId('screen-admin-room-near-kitchen')).toContainText('Porch');
  expect(submissions).toEqual([
    { room: 'Den', neighbours: ['Kitchen'] },
    { room: 'Kitchen', neighbours: ['Den', 'Porch'] },
    { room: 'Kitchen', neighbours: ['Den', 'Porch'] },
  ]);
  expect(pageErrors).toEqual([]);
});
