import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createHomeAssistantCaller } from '../../../_lib/media-ha-caller.mjs';
import { resetHouseholdAt } from './lib/household.mjs';
import {
  A, B, A_NAME, B_NAME, ITEM, VIEWPORTS, call, receiverState, openReceiver, startOn, stopReceiver, resetControls,
  newAppPage, gotoMedia, warmMedia,
} from './lib/receivers.mjs';
import { goArea, openSearch, resultRow } from './lib/search.mjs';

// The play and line-up verbs, at the aim, on every surface. Aim = a real
// mounted receiver (acceptance-media), read back through its own published
// state; the browser under test plays nothing itself. Collection = the album
// "Baby Joy Joy" (six tracks, natural order Track 1..6).
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block', actionTimeout: 30000 });
test.setTimeout(420000);

const ALBUM = 'plex:592904';
const ALBUM_TRACKS = ['plex:592905', 'plex:592906', 'plex:592907', 'plex:592908', 'plex:592909', 'plex:592910'];
const vp = VIEWPORTS.laptop;

test.beforeAll(async ({ browser }) => { test.setTimeout(300000); await warmMedia(browser); });
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

const queueIds = async (request, id = A) => (await receiverState(request, id))?.queue?.items?.map((item) => item.contentId) ?? [];
const currentId = async (request, id = A) => (await receiverState(request, id))?.currentItem?.contentId ?? null;

async function aimAt(page, deviceId) {
  await page.getByTestId('cast-target-chip').click();
  await page.getByTestId(`cast-target-checkbox-${deviceId}`).check();
  await page.getByTestId('cast-target-chip').click();
  await expect(page.getByTestId('cast-popover')).toBeHidden();
}

async function setup(browser, request) {
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await aimAt(page, A);
  const done = async () => { await stopReceiver(request, A); await context.close(); await receiver.context.close(); };
  return { receiver, context, page, done };
}

async function searchFor(page, text, id) {
  const input = await openSearch(page, vp);
  await input.fill('');
  await input.fill(text);
  await expect(resultRow(page, vp, id)).toBeVisible({ timeout: 40000 });
  return input;
}

const trayRow = (page, text) => page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: text });

// ---------------------------------------------------------------------------
test('[PLAY.1a/AC1][PLAY.1a/AC3][PLACE.1a/AC3] Play now plays at the aim from search, browsing, details, a suggestion and a recent item, and each confirmation names the item and the screen', async ({ browser, request }) => {
  const { page, done } = await setup(browser, request);
  const playedHere = async () => (await page.locator('video').count()) === 0;
  const expectPlayedAtAim = async (id, title) => {
    await expect.poll(() => currentId(request), { timeout: 120000, message: `${title} plays at the aim` }).toBe(id);
    const row = trayRow(page, title).first();
    await expect(row, `the confirmation names ${title}`).toBeVisible({ timeout: 20000 });
    await expect(row, 'and names the screen').toContainText(A_NAME);
    expect(await playedHere(), 'nothing played on this device').toBe(true);
  };

  // Search.
  await searchFor(page, 'Arrival', ITEM.ARRIVAL);
  await resultRow(page, vp, ITEM.ARRIVAL).click();
  await expectPlayedAtAim(ITEM.ARRIVAL, 'Arrival');
  await page.keyboard.press('Escape');

  // Details.
  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ITEM.HOSPITAL)}`);
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('detail-play-now').click();
  await expectPlayedAtAim(ITEM.HOSPITAL, 'Hospital');

  // Home: a recent item and a suggestion ("Usually at this time").
  await gotoMedia(page, '/media');
  await expect(page.getByTestId('home-row-recent')).toBeVisible({ timeout: 60000 });
  await page.getByTestId(`home-tile-recent-${ITEM.ARRIVAL}-picture`).click();
  await expectPlayedAtAim(ITEM.ARRIVAL, 'Arrival');
  await page.getByTestId(`home-tile-time-of-day-${ITEM.FAITH}-picture`).click();
  await expectPlayedAtAim(ITEM.FAITH, 'Faith');

  // Browsing: the first film in the Movies library.
  await goArea(page, vp, 'browse');
  await page.getByTestId('browse-open-plex:').click();
  await page.locator('[data-testid^="browse-open-plex:library/sections/6/"]').first().click();
  const leaf = page.locator('[data-testid^="result-play-now-"]').first();
  await expect(leaf).toBeVisible({ timeout: 40000 });
  const leafId = (await leaf.getAttribute('data-testid')).replace('result-play-now-', '');
  const leafTitle = (await page.getByTestId(`browse-row-${leafId}`).locator('.media-result-title').innerText()).trim();
  await leaf.click();
  await expectPlayedAtAim(leafId, leafTitle);
  await done();
});

test('[PLAY.5a/AC1][PLAY.5a/AC2][PLAY.6a/AC1][PLACE.1a/AC3] Play next puts items right after what is playing in the order added, Add goes to the end, from search, details, a tile and browsing — all at the aim', async ({ browser, request }) => {
  const { page, done } = await setup(browser, request);
  await startOn(request, A, ITEM.DISCLOSURE);
  const expectQueue = async (expected, step) => {
    await expect.poll(() => queueIds(request), { timeout: 60000, message: step }).toEqual(expected);
  };

  // Play next from search, then from details, then from a tile: each lands behind the previous one.
  await searchFor(page, 'Arrival', ITEM.ARRIVAL);
  await page.getByTestId(`result-more-${ITEM.ARRIVAL}`).click();
  await page.getByRole('menuitem', { name: 'Play Next', exact: true }).click();
  await expectQueue([ITEM.DISCLOSURE, ITEM.ARRIVAL], 'Play next from search');
  await page.keyboard.press('Escape');

  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ITEM.HOSPITAL)}`);
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('detail-play-next').click();
  await expectQueue([ITEM.DISCLOSURE, ITEM.ARRIVAL, ITEM.HOSPITAL], 'Play next from details');

  await gotoMedia(page, '/media');
  await expect(page.getByTestId('home-row-recent')).toBeVisible({ timeout: 60000 });
  const tile = page.getByTestId(`home-tile-time-of-day-${ITEM.FAITH}`);
  await tile.scrollIntoViewIfNeeded();
  await tile.getByRole('button', { name: /More actions for/ }).click();
  await page.getByTestId(`home-tile-time-of-day-${ITEM.FAITH}-verb-playNext`).click();
  await expectQueue([ITEM.DISCLOSURE, ITEM.ARRIVAL, ITEM.HOSPITAL, ITEM.FAITH], 'Play next from a tile');

  // Add (to the end): from details and from a browsed item.
  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ITEM.KEEPY)}`);
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('detail-add').click();
  await expectQueue([ITEM.DISCLOSURE, ITEM.ARRIVAL, ITEM.HOSPITAL, ITEM.FAITH, ITEM.KEEPY], 'Add from details');
  await goArea(page, vp, 'browse');
  await page.getByTestId('browse-open-plex:').click();
  await page.locator('[data-testid^="browse-open-plex:library/sections/6/"]').first().click();
  const leaf = page.locator('[data-testid^="result-play-now-"]').first();
  await expect(leaf).toBeVisible({ timeout: 40000 });
  const leafId = (await leaf.getAttribute('data-testid')).replace('result-play-now-', '');
  await page.getByTestId(`result-more-${leafId}`).click();
  await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
  await expectQueue([ITEM.DISCLOSURE, ITEM.ARRIVAL, ITEM.HOSPITAL, ITEM.FAITH, ITEM.KEEPY, leafId], 'Add from browsing');

  // The aim read the same afterwards, and the verbs never touched this device.
  await expect(page.getByTestId('destination-control-name')).toContainText(A_NAME);
  expect(await page.locator('video').count()).toBe(0);
  await done();
});

test('[PLAY.2a/AC1][PLAY.2a/AC2][PLAY.2a/AC3][PLAY.3a/AC1][PLAY.3a/AC2][PLAY.3a/AC3] a whole collection plays from its first part with the rest queued in order, replacing the queue with shuffle off; Shuffle turns shuffle on; Play turns it off; both offered on every surface', async ({ browser, request }) => {
  const { page, done } = await setup(browser, request);
  // Something else is playing with a queue behind it: a collection Play replaces it.
  await startOn(request, A, ITEM.DISCLOSURE, { queue: [ITEM.HOSPITAL] });

  // AC1: Play and Shuffle are offered on the collection wherever it appears (search row menu, browse header, details, home tile).
  await searchFor(page, 'Baby Joy Joy', ALBUM);
  await page.getByTestId(`result-more-${ALBUM}`).click();
  await expect(page.getByRole('menuitem', { name: 'Play Now', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Shuffle', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ALBUM)}`);
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('detail-play-now')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shuffle', exact: true })).toBeVisible();
  await gotoMedia(page, '/media');
  await expect(page.getByTestId('home-row-favourites')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('home-tile-favourites-plex:59493').getByRole('button', { name: /More actions for/ }).click();
  await expect(page.getByTestId('home-tile-favourites-plex:59493-verb-playNow')).toBeVisible();
  await expect(page.getByTestId('home-tile-favourites-plex:59493-verb-shuffle')).toBeVisible();
  await page.keyboard.press('Escape');

  // AC2/AC3: Play from the browse header: the first part, the rest in order, queue replaced, shuffle off, confirmation + Undo.
  await searchFor(page, 'Baby Joy Joy', ALBUM);
  await resultRow(page, vp, ALBUM).click();
  await expect(page.getByTestId('browse-dispatch-header')).toBeVisible({ timeout: 40000 });
  await expect(page.getByTestId('browse-dispatch-shuffle')).toBeVisible();
  await page.getByTestId('browse-dispatch-play').click();
  await expect.poll(() => queueIds(request), { timeout: 90000 }).toEqual(ALBUM_TRACKS);
  let snap = await receiverState(request, A);
  expect(snap.currentItem.contentId, 'starts at the first part').toBe(ALBUM_TRACKS[0]);
  expect(snap.queue.currentIndex).toBe(0);
  expect(snap.config.shuffle, 'Play leaves shuffle off').toBe(false);
  const row = trayRow(page, 'Baby Joy Joy').first();
  await expect(row).toContainText(A_NAME);
  await expect(row.getByTestId('item-action-undo')).toBeVisible();

  // PLAY.3a/AC2+AC3: Shuffle turns shuffle on, the queue holds the same parts, the screen reads shuffle as on.
  await page.getByTestId('browse-dispatch-shuffle').click();
  await expect.poll(async () => (await receiverState(request, A))?.config?.shuffle, { timeout: 90000 }).toBe(true);
  snap = await receiverState(request, A);
  expect([...snap.queue.items.map((i) => i.contentId)].sort()).toEqual([...ALBUM_TRACKS].sort());
  // Reading it from the screen's own Remote: shuffle shows as on.
  await goArea(page, vp, 'fleet');
  await page.getByTestId(`fleet-peek-${A}`).click();
  await expect(page.getByTestId('peek-panel')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('peek-panel').getByRole('button', { name: /shuffle/i }).first()).toHaveAttribute('aria-pressed', 'true');

  // And Play again turns it off.
  await searchFor(page, 'Baby Joy Joy', ALBUM);
  await resultRow(page, vp, ALBUM).click();
  await page.getByTestId('browse-dispatch-play').click();
  await expect.poll(async () => (await receiverState(request, A))?.config?.shuffle, { timeout: 90000 }).toBe(false);
  await expect.poll(() => queueIds(request), { timeout: 60000 }).toEqual(ALBUM_TRACKS);
  await done();
});

test('[PLAY.7a/AC1][PLAY.7a/AC3] a whole collection can be played next or added from search, details and a tile, keeping its natural order', async ({ browser, request }) => {
  const { page, done } = await setup(browser, request);
  await startOn(request, A, ITEM.DISCLOSURE);
  // Play next: the whole album lands right behind what is playing, in order.
  await searchFor(page, 'Baby Joy Joy', ALBUM);
  await page.getByTestId(`result-more-${ALBUM}`).click();
  await page.getByRole('menuitem', { name: 'Play Next', exact: true }).click();
  await expect.poll(() => queueIds(request), { timeout: 90000 }).toEqual([ITEM.DISCLOSURE, ...ALBUM_TRACKS]);
  await page.keyboard.press('Escape');
  // Add: from details, to the end, in order (Hospital first so the tail is distinguishable).
  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ITEM.HOSPITAL)}`);
  await page.getByTestId('detail-add').click();
  await expect.poll(() => queueIds(request), { timeout: 60000 }).toEqual([ITEM.DISCLOSURE, ...ALBUM_TRACKS, ITEM.HOSPITAL]);
  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ALBUM)}`);
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('detail-add').click();
  await expect.poll(() => queueIds(request), { timeout: 90000 }).toEqual([ITEM.DISCLOSURE, ...ALBUM_TRACKS, ITEM.HOSPITAL, ...ALBUM_TRACKS]);
  await done();
});

test('[PLAY.2a/AC3][PLAY.7a/AC2] the confirmation of a whole-collection start or add states how many items and where', async ({ browser, request }) => {
  const { page, done } = await setup(browser, request);
  await searchFor(page, 'Baby Joy Joy', ALBUM);
  await page.getByTestId(`result-more-${ALBUM}`).click();
  await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
  const row = trayRow(page, 'Baby Joy Joy').first();
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row).toContainText(/\b6 items\b/);
  await expect(row).toContainText(A_NAME);
  await done();
});

test('[PLAY.1a/AC4][PLACE.5a/AC3][PLACE.5a/AC4] when the aimed screen is busy with someone else\'s playback the aim says so before I tap; the tap itself never stops to ask; a routine\'s playback counts too, my own does not', async ({ browser, request, baseURL }) => {
  const { page, done } = await setup(browser, request);
  const aimBusy = page.getByTestId('aim-busy-origin');
  // Another device started it (header names the sender): busy, named.
  const other = await openReceiver(browser, request, B);
  await startOn(request, A, ITEM.DISCLOSURE, { asDevice: B });
  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ITEM.ARRIVAL)}`);
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('aim-label')).toContainText(A_NAME);
  await expect(aimBusy).toContainText(B_NAME, { timeout: 30000 });
  await expect(aimBusy).toContainText('Busy');
  // The tap never stops to ask: no confirmation dialog, it simply plays.
  await page.getByTestId('detail-play-now').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => currentId(request), { timeout: 120000 }).toBe(ITEM.ARRIVAL);

  // A routine started it: busy too, named by the routine.
  const ha = createHomeAssistantCaller({ baseUrl: baseURL });
  const routine = `Busy journey ${randomUUID().slice(0, 4)}`;
  await stopReceiver(request, A);
  expect((await ha.load(A, { play: ITEM.DISCLOSURE, routine })).status).toBe(200);
  await expect.poll(() => currentId(request), { timeout: 120000 }).toBe(ITEM.DISCLOSURE);
  await page.reload();
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('aim-busy-origin')).toContainText(routine, { timeout: 30000 });

  // Mine is not "someone else's": started from this very browser, the label does not say busy.
  await stopReceiver(request, A);
  await page.getByTestId('detail-play-now').click();
  await expect.poll(() => currentId(request), { timeout: 120000 }).toBe(ITEM.ARRIVAL);
  await expect(page.getByTestId('aim-busy-origin')).toHaveCount(0);
  await other.context.close();
  await done();
});
