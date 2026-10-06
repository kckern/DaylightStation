import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });
import fs from 'node:fs';
import path from 'node:path';

// Media redesign batch A — the start page and item surfaces over the
// household media memory (FIND.7a/9a/10a/11a/12a/12b/13a, PLAY.4a).
//
// Runs against `tests/_lib/media-redesign-server.mjs` (exact-SHA preview).
// That server blocks every household write and every unlisted upstream read,
// so this journey answers the household routes (tech doc §2.4–2.9) from an
// in-test household that applies the SAME rules the backend does — removed
// ids hidden from recent/carry on/suggestions, favourites first, Undo by
// DELETE — and records every request the page makes. Real household data is
// never written. Catalog, play and stream reads are the real ones, so a Play
// is real native playback of an authorized acceptance title.

test.use({ trace: 'retain-on-failure' });

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  laptop: { width: 1440, height: 900 },
};
const SHOTS = process.env.MEDIA_HOUSEHOLD_SHOTS
  || path.join(process.env.MEDIA_P0_EVIDENCE_DIR || '/tmp', 'media-household-shots');
const UPSTREAM = process.env.MEDIA_UPSTREAM || 'http://127.0.0.1:3111';

const ARRIVAL = 'plex:55854';
const DISCLOSURE = 'plex:697368';
const BLUEY = 'plex:59493';
const HOSPITAL = 'plex:266151';
const KEEPY = 'plex:266152';
const FAITH = 'plex:584614';
const thumb = id => `/api/v1/display/plex/${id.split(':')[1]}`;

function freshHousehold() {
  return {
    removed: new Map(),
    favourites: [{ id: BLUEY, kind: 'collection', title: 'Bluey', type: 'show', thumbnail: thumb(BLUEY), addedAt: '2026-10-01T00:00:00Z' }],
    watched: [],
    requests: [],
    playLogs: [],
    nowOn: [],
    entries: {
      [ARRIVAL]: { contentId: ARRIVAL, title: 'Arrival', type: 'movie', thumbnail: thumb(ARRIVAL), lastPlayed: '2026-10-02 21:00:00',
        playhead: 1800, duration: 6983, percent: 26, finished: false,
        playedOn: { deviceId: 'fleet:acceptance-media', kind: 'screen', screenId: 'acceptance-media' },
        spots: [{ deviceId: 'fleet:acceptance-media', kind: 'screen', screenId: 'acceptance-media', playhead: 1800, duration: 6983, percent: 26, lastPlayed: '2026-10-02 21:00:00', open: true }],
        plays: [{ deviceId: 'fleet:acceptance-media', startedAt: '2026-10-03T03:30:00.000Z', origin: null }] },
      [DISCLOSURE]: { contentId: DISCLOSURE, title: 'Disclosure Day', type: 'movie', thumbnail: thumb(DISCLOSURE), lastPlayed: '2026-10-02 08:00:00',
        playhead: 720, duration: 8833, percent: 8, finished: false,
        playedOn: { deviceId: 'browser:kidtablet', kind: 'browser', screenId: null },
        spots: [
          { deviceId: 'browser:kidtablet', kind: 'browser', screenId: null, playhead: 720, duration: 8833, percent: 8, lastPlayed: '2026-10-02 08:00:00', open: true },
          { deviceId: 'fleet:acceptance-media', kind: 'screen', screenId: 'acceptance-media', playhead: 4800, duration: 8833, percent: 54, lastPlayed: '2026-10-01 21:00:00', open: true },
        ],
        plays: [{ deviceId: 'browser:kidtablet', startedAt: '2026-10-02T15:00:00.000Z', origin: null }] },
      [FAITH]: { contentId: FAITH, title: 'Faith', type: 'track', thumbnail: thumb(FAITH), lastPlayed: '2026-10-02 07:10:00',
        playhead: 219, duration: 219, percent: 100, finished: true,
        playedOn: { deviceId: 'fleet:acceptance-media', kind: 'screen', screenId: 'acceptance-media' }, spots: [],
        plays: [{ deviceId: 'fleet:acceptance-media', startedAt: '2026-10-02T14:10:00.000Z', origin: null }] },
    },
  };
}

const SCREENS = {
  screens: [
    { id: 'fleet:acceptance-media', kind: 'screen', screenId: 'acceptance-media', name: 'Acceptance receiver', aliases: [] },
    { id: 'browser:kidtablet', kind: 'browser', screenId: null, name: "Kid's tablet", aliases: [] },
  ],
  notSeenLately: [], retired: [],
};

function visible(state, id) { return !state.removed.has(id); }

function carryOn(state) {
  const items = [ARRIVAL, DISCLOSURE].filter(id => visible(state, id) && !state.nowOn.some(n => n.contentId === id))
    .map(id => ({ ...state.entries[id], reason: 'unfinished', spots: state.entries[id].spots.filter(s => s.open) }));
  if (visible(state, KEEPY)) {
    items.push({ contentId: KEEPY, title: 'Keepy Uppy', type: 'episode', thumbnail: thumb(KEEPY), reason: 'next-episode',
      grandparentTitle: 'Bluey (2018)', grandparentId: BLUEY, after: HOSPITAL, spots: [], playhead: 0, duration: 437, percent: 0, finished: false });
  }
  return { items, nowOn: state.nowOn, nowPlayingKnown: true };
}

function suggestions(state, deviceId) {
  const favourites = state.favourites.filter(f => visible(state, f.id)).map(f => ({
    id: f.id, kind: f.kind, type: f.type, title: f.title, thumbnail: f.thumbnail,
    ...(f.id === BLUEY ? { continue: { contentId: KEEPY, title: 'Keepy Uppy' } } : {}),
  }));
  const favIds = new Set(favourites.map(f => f.id));
  const carry = carryOn(state).items.filter(e => !favIds.has(e.contentId) && !(e.grandparentId && favIds.has(e.grandparentId)))
    .map(e => ({ id: e.contentId, kind: 'item', type: e.type, title: e.title, thumbnail: e.thumbnail, reason: e.reason,
      percent: e.percent, playhead: e.playhead, duration: e.duration, playedOn: e.playedOn?.deviceId ?? null, grandparentTitle: e.grandparentTitle ?? null }));
  const timeOfDay = visible(state, FAITH) && !favIds.has(FAITH)
    ? [{ id: FAITH, kind: 'item', type: 'track', title: 'Faith', thumbnail: thumb(FAITH), days: 4, lastPlayedAt: '2026-10-02 07:10:00' }] : [];
  const fresh = visible(state, 'plex:675677') && !favIds.has('plex:675677')
    ? [{ id: 'plex:675677', kind: 'item', type: 'episode', title: 'Mario Kart Arcade GP', thumbnail: thumb('plex:675677'), addedAt: '2026-10-01T00:00:00Z', latest: null }] : [];
  const rows = [
    { id: 'favourites', title: 'Favourites', items: favourites },
    { id: 'carry-on', title: 'Carry on', items: carry },
    { id: 'time-of-day', title: 'Usually here at this time', items: timeOfDay },
    { id: 'new', title: 'New', items: fresh },
  ].filter(r => r.items.length);
  return { deviceId, generatedAt: new Date().toISOString(), empty: rows.length === 0, rows };
}

function recent(state) {
  return { items: [ARRIVAL, DISCLOSURE, FAITH].filter(id => visible(state, id)).map(id => state.entries[id]) };
}

function playedEarlier(state, screenId) {
  return { deviceId: screenId, items: [
    { contentId: FAITH, startedAt: new Date(Date.now() - 5 * 60_000).toISOString(), title: 'Faith', thumbnail: thumb(FAITH), type: 'track', grandparentTitle: 'Calvin Harris', playedOn: screenId, origin: null },
    { contentId: HOSPITAL, startedAt: new Date(Date.now() - 65 * 60_000).toISOString(), title: 'Hospital', thumbnail: thumb(HOSPITAL), type: 'episode', grandparentTitle: 'Bluey (2018)', playedOn: screenId, origin: null },
  ] };
}

async function installHousehold(page, state = freshHousehold()) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(/\/api\/v1\/display\/plex\/\d+$/, async route => {
    // Pictures are the real catalog's, read from the household server.
    const url = new URL(route.request().url());
    const response = await page.request.get(`${UPSTREAM}${url.pathname}`).catch(() => null);
    if (!response?.ok()) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ response });
  });
  await page.route('**/api/v1/play/log', async route => {
    const request = route.request();
    state.playLogs.push({ body: request.postDataJSON(), device: request.headers()['x-daylight-device'] ?? null });
    return json(route, { ok: true });
  });
  await page.route(/\/api\/v1\/media\/(household|suggestions|screens)/, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = method === 'GET' ? null : (request.postDataJSON() ?? {});
    state.requests.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, device: request.headers()['x-daylight-device'] ?? null });
    const p = url.pathname.replace('/api/v1/media', '');
    if (p === '/suggestions') return json(route, suggestions(state, url.searchParams.get('deviceId')));
    if (p === '/household/carry-on') return json(route, carryOn(state));
    if (p === '/household/recent') return json(route, recent(state));
    if (p === '/household/favourites') {
      if (method === 'POST') {
        state.favourites = [{ ...body, addedAt: new Date().toISOString() }, ...state.favourites.filter(f => f.id !== body.id)];
        return json(route, { item: state.favourites[0], items: state.favourites });
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id');
        const before = state.favourites.length;
        state.favourites = state.favourites.filter(f => f.id !== id);
        return json(route, { removed: before !== state.favourites.length, items: state.favourites });
      }
      return json(route, { items: state.favourites });
    }
    if (p === '/household/removed') {
      if (method === 'POST') { state.removed.set(body.id, new Date().toISOString()); return json(route, { id: body.id, removedAt: state.removed.get(body.id) }); }
      if (method === 'DELETE') { const id = url.searchParams.get('id'); return json(route, { id, restored: state.removed.delete(id) }); }
      return json(route, { items: [...state.removed].map(([id, removedAt]) => ({ id, removedAt })) });
    }
    if (p === '/household/watched' && method === 'POST') {
      state.watched.push(body);
      return json(route, { contentId: body.contentId, watched: body.watched, namespaces: ['plex/test'] });
    }
    if (p === '/screens') return json(route, SCREENS);
    const earlier = /^\/screens\/([^/]+)\/played-earlier$/.exec(p);
    if (earlier) return json(route, playedEarlier(state, decodeURIComponent(earlier[1])));
    return json(route, { error: 'not in household fixture' }, 404);
  });
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
      await expect(page.getByTestId('home-row-time-of-day')).toContainText('Usually here at this time');
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

    test(`[FIND.13a/AC1][FIND.13a/AC2][FIND.13a/AC3] ${size}: remove from the household list in one step, gone from every list, Undo brings it back`, async ({ page }) => {
      test.setTimeout(120000);
      const state = await installHousehold(page);
      await openHome(page);
      const menu = await openTileMenu(page, `home-tile-recent-${DISCLOSURE}`);
      await menu.getByTestId(`home-tile-recent-${DISCLOSURE}-verb-hide`).click();
      const row = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Removed Disclosure Day from the household list' });
      await expect(row).toBeVisible();
      expect(state.requests.filter(r => r.method === 'POST' && r.path.endsWith('/household/removed')).map(r => r.body)).toEqual([{ id: DISCLOSURE }]);
      // Disappears from recent, carry on and suggestions on refetch.
      await expect(page.getByTestId(`home-tile-recent-${DISCLOSURE}`)).toHaveCount(0);
      await expect(page.getByTestId(`home-tile-carry-on-${DISCLOSURE}`)).toHaveCount(0);
      await shot(page, `home-removed-${size}`);
      await row.getByTestId('item-action-undo').click();
      await expect(page.getByTestId(`home-tile-recent-${DISCLOSURE}`)).toBeVisible();
      await expect(page.getByTestId(`home-tile-carry-on-${DISCLOSURE}`)).toBeVisible();
      expect(state.requests.filter(r => r.method === 'DELETE' && r.path.endsWith('/household/removed')).map(r => r.query.id)).toEqual([DISCLOSURE]);
    });

    test(`[FIND.12a/AC1][FIND.12a/AC2][FIND.12a/AC3][FIND.10a/AC6] ${size}: favourite in one step from a tile and from details, first on the start page; mark watched`, async ({ page }) => {
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
      expect(state.watched).toEqual([{ contentId: ARRIVAL, watched: true }]);
      // Anyone can remove a favourite — here from its details.
      menu = await openTileMenu(page, `home-tile-favourites-${FAITH}`);
      await menu.getByTestId(`home-tile-favourites-${FAITH}-verb-details`).click();
      await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 30000 });
      const toggle = page.getByTestId('detail-favourite');
      await expect(toggle).toHaveText('Remove from favourites');
      await toggle.click();
      await expect(toggle).toHaveText('Add to favourites');
      expect(state.requests.filter(r => r.method === 'DELETE' && r.path.endsWith('/household/favourites')).map(r => r.query.id)).toEqual([FAITH]);
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
    const state = await installHousehold(sender);
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
    // The household now reports it playing there.
    state.nowOn = [{ ...state.entries[ARRIVAL], deviceId: 'fleet:acceptance-media', screenId: 'acceptance-media', state: 'playing', position: null }];
    await openHome(sender);
    const card = sender.getByTestId(`home-tile-now-on-acceptance-media-${ARRIVAL}`);
    await expect(card).toContainText('Now on Acceptance receiver');
    await expect(card.getByRole('button', { name: /More actions for Arrival/ })).toBeVisible();
    await expect(sender.getByTestId(`home-tile-carry-on-${ARRIVAL}`)).toHaveCount(0);
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
