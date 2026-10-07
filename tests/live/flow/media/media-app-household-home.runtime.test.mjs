import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { SEED, resetHouseholdAt, recordHouseholdRequests, captureProgressLogs, pinBrowserIdentity, household } from './lib/household.mjs';

import fs from 'node:fs';
import path from 'node:path';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });

// Media redesign batch A — the start page and item surfaces over the
// household media memory (FIND.7a/9a/10a/11a/12a/12b/13a, PLAY.4a).
//
// Runs against `tests/_lib/media-redesign-server.mjs` (exact-SHA preview).
// That server mounts the REAL household services (memory, suggestions, play
// ledger, favourites/removed lists, mark-watched, per-screen spots) over a
// throwaway data dir seeded from `tests/_fixtures/media-household-seed/`, so
// nothing about the household rules is faked in this file: removed ids hidden,
// favourites first, Undo, spots, next episodes and time-of-day history are the
// backend's own answers to the seed. Each test starts from the seed again, and
// the journeys read the seed's ids from `lib/household.mjs`. Catalog, play and
// stream reads are the real ones, so a Play is real native playback of an
// authorized acceptance title. Real household data is never written.

test.use({ trace: 'retain-on-failure' });
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  laptop: { width: 1440, height: 900 },
};
const SHOTS = process.env.MEDIA_HOUSEHOLD_SHOTS
  || path.join(process.env.MEDIA_P0_EVIDENCE_DIR || '/tmp', 'media-household-shots');

const ARRIVAL = SEED.ARRIVAL;
const DISCLOSURE = SEED.DISCLOSURE;
const BLUEY = SEED.BLUEY;
const HOSPITAL = SEED.HOSPITAL;
const FAITH = SEED.FAITH;
const COUNTDOWN = SEED.COUNTDOWN;
const RED_COAST = SEED.RED_COAST;
const ANATOMY = SEED.ANATOMY;

/** Record what the page asks of the household routes (the server answers for real). */
async function installHousehold(page) {
  const state = { requests: recordHouseholdRequests(page), playLogs: await captureProgressLogs(page) };
  return state;
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

async function openHome(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/media', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('home-view'), `page errors: ${errors.join(' | ')}`).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('home-row-favourites')).toBeVisible({ timeout: 30000 });
}

async function openTileMenu(page, testId) {
  const tile = page.getByTestId(testId);
  await tile.scrollIntoViewIfNeeded();
  await tile.getByRole('button', { name: /More actions for/ }).click();
  return page.getByTestId(`${testId}-menu`);
}

async function stopLocal(page) {
  if (page.isClosed()) return;
  const expandedStop = page.getByTestId('np-stop');
  const stop = await expandedStop.isVisible().catch(() => false) ? expandedStop : page.getByTestId('mini-stop');
  if (await stop.isVisible().catch(() => false)) await stop.click();
}

for (const [size, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(`household start page — ${size}`, () => {
    test.use({ viewport, actionTimeout: 15000 });
    test.afterEach(async ({ page }) => stopLocal(page));

    test(`[FIND.7a/AC1][FIND.7a/AC3][FIND.12a/AC2][FIND.12b/AC1][FIND.9a/AC1][FIND.10a/AC1][FIND.10a/AC2][FIND.10a/AC4] ${size}: suggestions for this screen in order, favourites first as large pictures, carry on with where each screen stopped, recent from every screen`, async ({ page }) => {
      test.setTimeout(120000);
      const state = await installHousehold(page);
      await openHome(page);
      // This screen's own id asks for its suggestions.
      const ask = state.requests.find(r => r.path.endsWith('/suggestions'));
      expect(ask.query.deviceId).toMatch(/^(browser|fleet):/);
      expect(ask.query.deviceId).toBe(ask.device);
      const order = await page.locator('[data-testid^="home-row-"]').evaluateAll(nodes => nodes.map(n => n.dataset.testid));
      expect(order).toEqual(['home-row-favourites', 'home-row-carry-on', 'home-row-time-of-day', 'home-row-new', 'home-row-recent']);
      const fav = page.getByTestId(`home-tile-favourites-${BLUEY}`);
      await expect(fav).toHaveClass(/home-tile--large/);
      const favBox = await fav.getByTestId(`home-tile-favourites-${BLUEY}-picture`).boundingBox();
      const otherBox = await page.getByTestId(`home-tile-carry-on-${ARRIVAL}-picture`).boundingBox();
      expect(favBox.width).toBeGreaterThan(otherBox.width);
      expect(favBox.height).toBeGreaterThan(otherBox.height);
      await expect(fav).toContainText('Bluey');
      // The next part lives in the tile's ⋯ menu (no per-tile action bar).
      await fav.getByTestId(`home-tile-favourites-${BLUEY}-more`).click();
      await expect(page.getByTestId(`home-tile-favourites-${BLUEY}-verb-continue`)).toContainText(/Continue Keepy Uppy/);
      await page.keyboard.press('Escape');
      // A fresh browser has no time-of-day history of its own, so the household's is offered, labelled as such.
      await expect(page.getByTestId('home-row-time-of-day')).toContainText('Usually at this time');
      await expect(page.getByTestId(`home-tile-time-of-day-${FAITH}`)).toBeVisible();
      // Unfinished means 5 minutes or 5 %: Countdown (200 s, 6 %) is carry on, Red Coast (170 s, 4 %) is not,
      // and Anatomy of a Fall (310 s but on the removed list) is nowhere.
      await expect(page.getByTestId(`home-tile-carry-on-${COUNTDOWN}`)).toBeVisible();
      await expect(page.getByTestId(`home-tile-carry-on-${RED_COAST}`)).toHaveCount(0);
      // Finished (credits: 90 %) drops off on its own: Hospital (91 %) and Faith (100 %) are not carry on.
      await expect(page.getByTestId(`home-tile-carry-on-${HOSPITAL}`)).toHaveCount(0);
      await expect(page.getByTestId(`home-tile-carry-on-${FAITH}`)).toHaveCount(0);
      await expect(page.locator(`[data-testid$="-${ANATOMY}"]`)).toHaveCount(0);
      // A favourite item and a favourite collection, both in the favourites row.
      await expect(page.getByTestId(`home-tile-favourites-${RED_COAST}`)).toBeVisible();
      // Carry on: where it stopped, the next episode, and both spots when screens differ.
      const arrival = page.getByTestId(`home-tile-carry-on-${ARRIVAL}`);
      await expect(arrival).toContainText('1 h 26 min left');
      await expect(arrival).toContainText('Acceptance receiver');
      const disclosure = page.getByTestId(`home-tile-carry-on-${DISCLOSURE}`);
      await expect(disclosure).toContainText("12 m on Kid's tablet");
      await expect(disclosure).toContainText('1 h 20 m on Acceptance receiver');
      // Both spots are fully visible, never cut off by the tile width.
      for (const line of await disclosure.locator('.home-tile-line').all()) {
        expect(await line.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      await expect(fav).toContainText('Next: Keepy Uppy');
      // The next episode of a favourite show is that favourite's Continue.
      await expect(page.getByTestId('home-row-carry-on')).not.toContainText('Keepy Uppy');
      // Recent: everything from every screen, each marked with where it played.
      await expect(page.getByTestId(`home-tile-recent-${FAITH}`)).toContainText('Acceptance receiver');
      await expect(page.getByTestId(`home-tile-recent-${DISCLOSURE}`)).toContainText("Kid's tablet");
      // No function hidden by width: the page never scrolls sideways.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await expect.poll(() => page.locator(`[data-testid="home-tile-favourites-${BLUEY}-picture"] img`).evaluate(img => img.naturalWidth), { timeout: 30000 }).toBeGreaterThan(0);
      await shot(page, `home-${size}`);
    });

    test(`[FIND.13a/AC1][FIND.13a/AC2][FIND.13a/AC3] ${size}: remove from the household list in one step, gone from every list, Undo brings it back`, async ({ page, browser }) => {
      test.setTimeout(120000);
      const state = await installHousehold(page);
      await openHome(page);
      const menu = await openTileMenu(page, `home-tile-recent-${DISCLOSURE}`);
      await menu.getByTestId(`home-tile-recent-${DISCLOSURE}-verb-hide`).click();
      const row = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Removed Disclosure Day from the household list' });
      await expect(row).toBeVisible();
      expect(state.requests.filter(r => r.method === 'POST' && r.path.endsWith('/household/removed')).map(r => r.body)).toEqual([{ id: DISCLOSURE }]);
      // The household really holds it now (the real removed list, in the temp data dir).
      expect((await household(page, '/household/removed')).items.map(i => i.id)).toContain(DISCLOSURE);
      // Disappears from recent, carry on and suggestions on refetch.
      await expect(page.getByTestId(`home-tile-recent-${DISCLOSURE}`)).toHaveCount(0);
      await expect(page.getByTestId(`home-tile-carry-on-${DISCLOSURE}`)).toHaveCount(0);
      await shot(page, `home-removed-${size}`);
      // On every screen: another browser (another screen) no longer sees it in any row either.
      const otherContext = await browser.newContext({ viewport });
      await markFirstUseDone(otherContext);
      const other = await otherContext.newPage();
      await openHome(other);
      await expect(other.locator(`[data-testid*="${DISCLOSURE}"]`)).toHaveCount(0);
      await expect(other.getByTestId(`home-tile-carry-on-${ARRIVAL}`)).toBeVisible();
      await otherContext.close();
      await row.getByTestId('item-action-undo').click();
      await expect(page.getByTestId(`home-tile-recent-${DISCLOSURE}`)).toBeVisible();
      await expect(page.getByTestId(`home-tile-carry-on-${DISCLOSURE}`)).toBeVisible();
      expect(state.requests.filter(r => r.method === 'DELETE' && r.path.endsWith('/household/removed')).map(r => r.query.id)).toEqual([DISCLOSURE]);
      expect((await household(page, '/household/removed')).items.map(i => i.id)).not.toContain(DISCLOSURE);
    });

    test(`[FIND.12a/AC1][FIND.12a/AC2][FIND.12a/AC3][FIND.10a/AC6] ${size}: favourite in one step from a tile and from details, first on the start page; mark watched`, async ({ page, browser }) => {
      test.setTimeout(120000);
      const state = await installHousehold(page);
      await openHome(page);
      let menu = await openTileMenu(page, `home-tile-recent-${FAITH}`);
      await menu.getByTestId(`home-tile-recent-${FAITH}-verb-favourite`).click();
      await expect(page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Added Faith to favourites' })).toBeVisible();
      const favRow = page.getByTestId('home-row-favourites');
      await expect(favRow.getByTestId(`home-tile-favourites-${FAITH}`)).toBeVisible();
      await expect(favRow.locator('.home-tile').first()).toHaveAttribute('data-testid', `home-tile-favourites-${FAITH}`);
      // Watched / unwatched on any playable item.
      menu = await openTileMenu(page, `home-tile-carry-on-${ARRIVAL}`);
      await menu.getByTestId(`home-tile-carry-on-${ARRIVAL}-verb-watched`).click();
      await expect(page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Marked Arrival watched' })).toBeVisible();
      expect(state.requests.filter(r => r.method === 'POST' && r.path.endsWith('/household/watched')).map(r => r.body)).toEqual([{ contentId: ARRIVAL, watched: true }]);
      // Marked for real: the watched item leaves carry on in the household's own list.
      expect((await household(page, '/household/carry-on')).items.map(i => i.contentId)).not.toContain(ARRIVAL);
      // Favourites are the household's: another browser sees it too, and anyone can remove it — here, from its details.
      const otherContext = await browser.newContext({ viewport });
      await markFirstUseDone(otherContext);
      const other = await otherContext.newPage();
      await openHome(other);
      await expect(other.getByTestId(`home-tile-favourites-${FAITH}`)).toBeVisible();
      const otherState = recordHouseholdRequests(other);
      menu = await openTileMenu(other, `home-tile-favourites-${FAITH}`);
      await menu.getByTestId(`home-tile-favourites-${FAITH}-verb-details`).click();
      await expect(other.getByTestId('detail-view')).toBeVisible({ timeout: 30000 });
      await expect(other.getByTestId('detail-favourite')).toHaveText('Remove from favourites');
      await other.getByTestId('detail-favourite').click();
      await expect(other.getByTestId('detail-favourite')).toHaveText('Add to favourites');
      expect(otherState.filter(r => r.method === 'DELETE' && r.path.endsWith('/household/favourites')).map(r => r.query.id)).toEqual([FAITH]);
      await otherContext.close();
      // The first browser, which added it, sees it gone after a refetch.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('home-row-favourites')).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId(`home-tile-favourites-${FAITH}`)).toHaveCount(0);
      // And Remove from details also works from the browser that added it.
      menu = await openTileMenu(page, `home-tile-recent-${FAITH}`);
      await menu.getByTestId(`home-tile-recent-${FAITH}-verb-favourite`).click();
      await expect(page.getByTestId(`home-tile-favourites-${FAITH}`)).toBeVisible();
      menu = await openTileMenu(page, `home-tile-favourites-${FAITH}`);
      await menu.getByTestId(`home-tile-favourites-${FAITH}-verb-details`).click();
      await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 30000 });
      const toggle = page.getByTestId('detail-favourite');
      await expect(toggle).toHaveText('Remove from favourites');
      await toggle.click();
      await expect(toggle).toHaveText('Add to favourites');
      expect(state.requests.filter(r => r.method === 'DELETE' && r.path.endsWith('/household/favourites')).map(r => r.query.id)).toEqual([FAITH]);
      expect((await household(page, '/household/favourites')).items.map(i => i.id)).not.toContain(FAITH);
      await shot(page, `detail-favourite-${size}`);
    });

    test(`[FIND.7a/AC2][FIND.9a/AC2][FIND.9a/AC3][FIND.12b/AC2] ${size}: the tap rule on suggestions and recent; full verb set`, async ({ page }) => {
      test.setTimeout(120000);
      await installHousehold(page);
      await openHome(page);
      // A collection's picture opens it.
      await page.getByTestId(`home-tile-favourites-${BLUEY}-picture`).click();
      await expect(page.getByTestId('browse-view')).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('browse-dispatch-header')).toBeVisible();
      await page.getByTestId('browse-crumb-home').click();
      await expect(page.getByTestId('home-row-recent')).toBeVisible();
      // Every item has the same verbs as anywhere else.
      const menu = await openTileMenu(page, `home-tile-recent-${ARRIVAL}`);
      for (const verb of ['playNow', 'playNext', 'playFirst', 'add', 'playOn', 'addOn', 'details', 'favourite', 'hide']) {
        await expect(menu.getByTestId(`home-tile-recent-${ARRIVAL}-verb-${verb}`)).toBeVisible();
      }
      await page.waitForTimeout(400); // let the menu finish fading in before the picture
      await shot(page, `home-menu-${size}`);
      await page.keyboard.press('Escape');
      // A playable recent item plays at the aim with the same confirmation and Undo.
      await page.getByTestId(`home-tile-recent-${FAITH}-picture`).click();
      const row = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Playing Faith here' });
      await expect(row).toBeVisible({ timeout: 15000 });
      await expect(row.getByTestId('item-action-undo')).toBeVisible();
      // Playing here: the handle names it and offers Pause once native playback runs.
      await expect(page.getByTestId('media-mini-player')).toContainText('Faith', { timeout: 30000 });
      await expect(page.getByTestId('mini-toggle')).toHaveAttribute('aria-label', 'Pause', { timeout: 45000 });
    });
  });
}

test.describe('Unfinished by seconds (FIND.10a/AC5)', () => {
  test.use({ viewport: VIEWPORTS.laptop, actionTimeout: 15000 });

  test('[FIND.10a/AC5] 5 minutes counts as unfinished even when it is under 5 %: a 310 s legacy spot on a 2 h 25 min film is carry on once it is on the household list again', async ({ page }) => {
    test.setTimeout(120000);
    // Anatomy of a Fall is seeded as removed (hidden everywhere). Put it back through the real route: this is setup, the assertions are what Home shows.
    await page.goto('/media', { waitUntil: 'domcontentloaded' });
    await household(page, `/household/removed?id=${encodeURIComponent(ANATOMY)}`, { method: 'DELETE' });
    await openHome(page);
    const tile = page.getByTestId(`home-tile-carry-on-${ANATOMY}`);
    await expect(tile).toBeVisible();
    await expect(tile).toContainText('Anatomy of a Fall');
    // 310 s of 8709 s is 4 %: only the 5-minute rule keeps it, and its single (legacy) spot is the one it continues from.
    await expect(tile).toContainText('2 h 20 min left');
  });
});

test.describe('saved spots and Start over (PLAY.4a)', () => {
  test.use({ viewport: VIEWPORTS.laptop, actionTimeout: 15000 });
  test.afterEach(async ({ page }) => stopLocal(page));

  test('[PLAY.4a/AC1][PLAY.4a/AC2][PLAY.4a/AC3] continue from the saved spot with Start over; choose between screens; progress reported with this device', async ({ page }) => {
    test.setTimeout(240000);
    const state = await installHousehold(page);
    const plays = [];
    page.on('request', request => { if (/\/api\/v1\/play\/plex/.test(request.url())) plays.push(request.url()); });
    await openHome(page);
    // Screens hold different spots: the person chooses.
    await page.getByTestId(`home-tile-carry-on-${DISCLOSURE}-picture`).click();
    const chooser = page.getByRole('dialog');
    await expect(chooser).toContainText('12 m on Kid\'s tablet');
    await expect(chooser).toContainText('1 h 20 m on Acceptance receiver');
    await expect(chooser).toContainText('From the beginning');
    for (const choice of await chooser.getByRole('button', { name: /on |beginning/ }).all()) {
      expect((await choice.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    await shot(page, 'spot-chooser-laptop');
    await chooser.getByRole('button', { name: /1 h 20 m on Acceptance receiver/ }).click();
    // The confirmation says where it continues and offers Start over.
    const row = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Playing Disclosure Day here' }).first();
    await expect(row).toContainText('Continuing from 1 h 20 m', { timeout: 15000 });
    const video = page.locator('video').first();
    await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2).catch(() => false), { timeout: 60000 }).toBe(true);
    // The chosen spot is asked for explicitly: no server resume.
    expect(plays.some(url => url.includes('/play/plex') && url.includes('697368') && url.includes('resume=false')), plays.join('\n')).toBe(true);
    await expect.poll(() => video.evaluate(el => el.currentTime), { timeout: 30000 }).toBeGreaterThan(4790);
    await shot(page, 'start-over-offer-laptop');
    // Start over on that confirmation plays it here from the beginning.
    await expect(row.getByRole('button', { name: 'Start over' })).toBeVisible();
    await row.getByRole('button', { name: 'Start over' }).click();
    await expect(page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Started Disclosure Day over' })).toBeVisible({ timeout: 15000 });
    await expect.poll(() => video.evaluate(el => !el.paused && el.currentTime < 60).catch(() => false), { timeout: 60000 }).toBe(true);
    // Local playback reports its progress as this device.
    await expect.poll(() => state.playLogs.length, { timeout: 60000 }).toBeGreaterThan(0);
    const self = state.requests.find(r => r.path.endsWith('/suggestions')).query.deviceId;
    expect(state.playLogs.every(log => log.device === self)).toBe(true);
    expect(state.playLogs.some(log => String(log.body.assetId).includes('697368'))).toBe(true);
    expect(state.playLogs.every(log => !('origin' in log.body))).toBe(true);
  });

  test('[PLAY.4a/AC1] one saved spot: Continue starts from exactly that screen\'s spot, not the server\'s last playhead', async ({ page }) => {
    test.setTimeout(180000);
    await installHousehold(page);
    const plays = [];
    page.on('request', request => { if (/\/api\/v1\/play\/plex/.test(request.url())) plays.push(request.url()); });
    await openHome(page);
    await page.getByTestId(`home-tile-carry-on-${ARRIVAL}-picture`).click();
    const row = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Playing Arrival here' }).first();
    await expect(row).toContainText('Continuing from 30 m', { timeout: 15000 });
    await expect(row.getByRole('button', { name: 'Start over' })).toBeVisible();
    const video = page.locator('video').first();
    await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2).catch(() => false), { timeout: 60000 }).toBe(true);
    expect(plays.some(url => url.includes('55854') && url.includes('resume=false')), plays.join('\n')).toBe(true);
    await expect.poll(() => video.evaluate(el => el.currentTime), { timeout: 30000 }).toBeGreaterThan(1790);
  });

  test('[PLAY.4a/AC3] no saved spot: it simply starts, with no Start over', async ({ page }) => {
    test.setTimeout(180000);
    await installHousehold(page);
    await openHome(page);
    await page.getByTestId('home-tile-new-plex:675677-picture').click();
    const row = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Mario Kart Arcade GP' }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.getByRole('button', { name: 'Start over' })).toHaveCount(0);
  });
});

test.describe('Played earlier (FIND.11a)', () => {
  for (const [size, viewport] of Object.entries(VIEWPORTS)) {
    test.describe(size, () => {
      test.use({ viewport, actionTimeout: 15000 });
      test.afterEach(async ({ page }) => stopLocal(page));

      test(`[FIND.11a/AC1][FIND.11a/AC2][FIND.11a/AC3] ${size}: this screen's queue lists what played earlier, newest first, with picture, title and time, and every verb`, async ({ page }) => {
        test.setTimeout(180000);
        // This browser is the seeded "Acceptance browser", whose own ledger holds Faith (minutes ago) and Hospital (an hour ago).
        await pinBrowserIdentity(page);
        const state = await installHousehold(page);
        await openHome(page);
        await page.getByTestId(`home-tile-recent-${FAITH}-picture`).click();
        await expect(page.getByTestId('media-mini-player')).toContainText('Faith', { timeout: 30000 });
        await page.getByTestId('mini-player-open-nowplaying').click();
        const earlier = page.getByTestId('played-earlier');
        await earlier.scrollIntoViewIfNeeded();
        await expect(earlier).toBeVisible({ timeout: 30000 });
        const self = state.requests.find(r => r.path.endsWith('/suggestions')).query.deviceId;
        expect(state.requests.some(r => r.path === `/api/v1/media/screens/${encodeURIComponent(self)}/played-earlier`
          || r.path === `/api/v1/media/screens/${self}/played-earlier`)).toBe(true);
        await expect(earlier.getByTestId('played-earlier-0')).toContainText('Faith');
        await expect(earlier.getByTestId('played-earlier-0-when')).toContainText(/Calvin Harris · Today/);
        await expect(earlier.getByTestId('played-earlier-1')).toContainText('Hospital');
        await expect.poll(() => earlier.locator('[data-testid="played-earlier-0"] img').evaluate(img => img.naturalWidth), { timeout: 30000 }).toBeGreaterThan(0);
        await earlier.getByTestId('played-earlier-1-more').click();
        await page.getByTestId('played-earlier-1-verb-favourite').click();
        await expect(page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Added Hospital to favourites' })).toBeVisible();
        expect(state.requests.some(r => r.method === 'POST' && r.path.endsWith('/household/favourites') && r.body.id === HOSPITAL)).toBe(true);
        await earlier.scrollIntoViewIfNeeded();
        await shot(page, `played-earlier-${size}`);
      });
    });
  }
});

test.describe('Now on another screen (FIND.10a/AC3)', () => {
  test.use({ viewport: VIEWPORTS.laptop, actionTimeout: 15000 });

  test('[FIND.10a/AC3] an item playing on a screen shows as "Now on <screen>" with Remote and Move here, never as carry on; Move here brings it here and stops that screen', async ({ context, page: sender }) => {
    test.setTimeout(300000);
    await installHousehold(sender);
    const receiver = await context.newPage();
    await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => receiver.evaluate(async () => {
      const r = await fetch('/api/v1/device/acceptance-media/receiver-ready');
      return r.ok && (await r.json()).ready;
    }).catch(() => false), { timeout: 60000 }).toBe(true);
    await openHome(sender);
    // Send Arrival to the receiver through the ordinary Play on… verb.
    const menu = await openTileMenu(sender, `home-tile-recent-${ARRIVAL}`);
    await menu.getByTestId(`home-tile-recent-${ARRIVAL}-verb-playOn`).click();
    await sender.getByTestId('picker-device-acceptance-media').click();
    await expect.poll(async () => (await sender.evaluate(async () => {
      const r = await fetch('/api/v1/device/acceptance-media/receiver-state');
      return r.ok ? r.json() : null;
    }))?.snapshot?.state ?? null, { timeout: 90000 }).toBe('playing');
    // The household now reports it playing there (the real now-playing reader sees the receiver's published state).
    await openHome(sender);
    const card = sender.getByTestId(`home-tile-now-on-acceptance-media-${ARRIVAL}`);
    await expect(card).toContainText('Now on Acceptance receiver');
    await expect(card.getByRole('button', { name: /More actions for Arrival/ })).toBeVisible();
    await expect(sender.getByTestId(`home-tile-carry-on-${ARRIVAL}`)).toHaveCount(0);
    // The server's own suggestions leave out anything playing on any screen (FIND.7a/AC3).
    const self = await sender.evaluate(() => (window.localStorage.getItem('media-app.client-id')));
    const suggested = await household(sender, `/suggestions?deviceId=${encodeURIComponent(`browser:${self}`)}`);
    expect(JSON.stringify(suggested.rows.flatMap(r => r.items.map(i => i.id)))).not.toContain(ARRIVAL);
    await shot(sender, 'now-on-laptop');
    await card.getByRole('button', { name: 'Remote' }).click();
    await expect(sender.getByTestId('peek-panel')).toBeVisible({ timeout: 30000 });
    await sender.goBack();
    await expect(card).toBeVisible({ timeout: 30000 });
    await card.getByRole('button', { name: 'Move here' }).click();
    // The move reports itself until it is done, then confirms.
    await expect(sender.locator('[data-testid^="dispatch-row-"]').filter({ hasText: /Moving Arrival here|Moved Arrival here/ })).toBeVisible({ timeout: 10000 });
    await expect(sender.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Moved Arrival here' })).toBeVisible({ timeout: 60000 });
    const video = sender.locator('video').first();
    await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2).catch(() => false), { timeout: 60000 }).toBe(true);
    await expect.poll(async () => (await sender.evaluate(async () => {
      const r = await fetch('/api/v1/device/acceptance-media/receiver-state');
      return r.ok ? r.json() : null;
    }))?.snapshot?.state ?? null, { timeout: 30000 }).not.toBe('playing');
    await stopLocal(sender);
  });
});
