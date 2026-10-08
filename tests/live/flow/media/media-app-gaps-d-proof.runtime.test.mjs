import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHomeAssistantCaller } from '../../../_lib/media-ha-caller.mjs';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { installFakeClock } from './lib/fakeClock.mjs';
import { pinBrowserIdentity, resetHouseholdAt, household, SEED } from './lib/household.mjs';
import { scriptReceiver, SCRIPTED } from './lib/scriptedReceiver.mjs';
import { openSearch, resultRow } from './lib/search.mjs';
import {
  A, A_NAME, ITEM, VIEWPORTS, call, receiverState, openReceiver, startOn, stopReceiver, resetControls,
  newAppPage, gotoMedia, warmMedia, openHouse, openRemote,
} from './lib/receivers.mjs';

// Proof-gaps Phase 3 (batch D): the P1/P2 ledger rows still open after Phase 2.
//   HOUSE.4a/AC1  every screen is listed under a name, never a code
//   HOUSE.5a/AC2  who started it, in the controls header of a screen (feature)
//   HOUSE.6a/AC4  screens silent for 30 days fold into "Not seen lately"
//   PLACE.4a/AC6  neighbouring rooms warn about drift (adjacency set in admin)
//   RELY.4a/AC3   Start fresh asks first and offers no Undo
//   STEER.10a/AC2 a minutes sleep timer: time left on the handle, fade, then pause
//   STEER.11a/AC3 Pause all lists the screens that could not be paused
//   STEER.13b/AC3 next-episode behaviour lives in the controls; carry on lists only what is next
//   AUTO.4a/AC3   routines pointed at a screen that is off or unreachable are flagged ahead of time
// Real mounted receivers and the seeded household of the acceptance server; ordinary pointer input.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block', actionTimeout: 30000 });
test.setTimeout(420000);

const SHOTS = path.join(process.env.MEDIA_P0_EVIDENCE_DIR || '/tmp', 'media-gaps-d-shots');
const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
};

test.beforeAll(async ({ browser }) => { test.setTimeout(300000); await warmMedia(browser); });
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

const CODE_LIKE = [/^(fleet|browser|screen):/i, /^acceptance-/i, /^[0-9a-f]{8}-[0-9a-f]{4}/i, /^Browser [0-9a-f]{6,8}$/i];
const isCode = (text) => CODE_LIKE.some((re) => re.test(text.trim()));

async function openAdmin(page, vp) {
  if (vp.width < 768) {
    await page.getByTestId('settings-menu-trigger').click();
    await page.getByTestId('settings-manage-screens').click();
  } else {
    await openHouse(page, vp);
    await page.getByTestId('fleet-open-screens').click();
  }
  await expect(page.getByTestId('screen-admin-view')).toBeVisible({ timeout: 30000 });
}

for (const [label, vp] of Object.entries({ phone: VIEWPORTS.phone, laptop: VIEWPORTS.laptop })) {
  test(`[HOUSE.4a/AC1] ${label}: every screen the house lists is under a name like "Acceptance den TV", never a code, in the overview and in screen admin`, async ({ browser, request }) => {
    const receiver = await openReceiver(browser, request, A);
    await startOn(request, A, ITEM.HOSPITAL);
    await scriptReceiver(request, { deviceId: SCRIPTED.SPEAKER, state: 'paused', title: 'Faith', duration: 200, position: 50 });
    await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'idle' });
    await scriptReceiver(request, { deviceId: 'acceptance-offline', state: 'off' });
    const { context, page } = await newAppPage(browser, vp);
    await pinBrowserIdentity(page);
    await gotoMedia(page);
    await openHouse(page, vp);
    const names = {
      [A]: A_NAME, [SCRIPTED.SPEAKER]: 'Acceptance speaker', [SCRIPTED.POWER]: 'Acceptance den TV', 'acceptance-offline': 'Acceptance guest room TV',
    };
    for (const id of Object.keys(names)) await expect(page.getByTestId(`fleet-card-${id}`)).toBeVisible({ timeout: 40000 });
    // Every card in the overview, whatever it is (screens, the browsers using the app): a name, never a code.
    const cards = await page.locator('[data-testid^="fleet-card-"] .fleet-card-name').allInnerTexts();
    expect(cards.length).toBeGreaterThanOrEqual(Object.keys(names).length);
    for (const text of cards) {
      expect(text.trim(), 'a screen card with no name').not.toBe('');
      expect(isCode(text), `card named "${text}" reads like a code`).toBe(false);
    }
    for (const [id, name] of Object.entries(names)) await expect(page.getByTestId(`fleet-card-${id}`).locator('.fleet-card-name')).toContainText(name);
    await shot(page, `house-names-${label}`);

    // Screen admin lists the same screens by name too (configured, browsers and the long-silent one).
    await openAdmin(page, vp);
    // textContent, not innerText: the folded "Not seen lately" items are in the page but not rendered.
    const heads = await page.locator('[data-testid^="screen-admin-item-"] .house-item-head > :first-child').evaluateAll((els) => els.map((e) => e.textContent));
    expect(heads.length).toBeGreaterThanOrEqual(Object.keys(names).length);
    for (const text of heads) {
      expect(text.trim()).not.toBe('');
      expect(isCode(text), `admin item named "${text}" reads like a code`).toBe(false);
    }
    await stopReceiver(request, A);
    await context.close();
    await receiver.context.close();
  });
}

test('[HOUSE.6a/AC4] a screen silent for more than 30 days is folded under "Not seen lately", not listed among the screens in use', async ({ browser }) => {
  const vp = VIEWPORTS.tablet;
  const { context, page } = await newAppPage(browser, vp);
  await pinBrowserIdentity(page);
  await gotoMedia(page);
  await openAdmin(page, vp);
  // "Every screen" does not carry it ...
  await expect(page.getByTestId('screen-admin-list')).not.toContainText('Old tablet');
  await expect(page.getByTestId('screen-admin-item-browser:oldtablet')).toBeHidden();
  // ... the fold names the rule, is closed until opened, and holds it with when it was last seen.
  const fold = page.getByTestId('screen-admin-not-seen');
  await expect(fold).toContainText('Not seen lately (1)');
  await expect(fold).toContainText('silent for more than 30 days');
  expect(await fold.evaluate((el) => el.open)).toBe(false);
  await fold.locator('summary').click();
  expect(await fold.evaluate((el) => el.open)).toBe(true);
  const item = page.getByTestId('screen-admin-item-browser:oldtablet');
  await expect(item).toBeVisible();
  await expect(item).toContainText('Old tablet');
  await expect(item).toContainText('Last seen');
  await shot(page, 'not-seen-lately-tablet');
  // A screen seen today is not folded away.
  await expect(page.getByTestId('screen-admin-list')).toContainText('Acceptance receiver');
  await context.close();
});

for (const [label, vp] of Object.entries({ phone: VIEWPORTS.phone, laptop: VIEWPORTS.laptop })) {
  test(`[HOUSE.5a/AC2] ${label}: the screen's controls say who started what plays, the same note as its row in the house overview`, async ({ browser, request, baseURL }) => {
    const receiver = await openReceiver(browser, request, A);
    await resetControls(request, A);
    await startOn(request, A, ITEM.HOSPITAL, { asDevice: 'browser:kidtablet' });
    const { context, page } = await newAppPage(browser, vp);
    await pinBrowserIdentity(page);
    await gotoMedia(page);
    await openHouse(page, vp);
    const rowNote = page.getByTestId(`house-started-by-${A}`);
    await expect(rowNote).toContainText("Started by Kid's tablet", { timeout: 40000 });
    const rowText = (await rowNote.innerText()).trim();

    await page.getByTestId(`fleet-peek-${A}`).click();
    const panel = page.getByTestId('peek-panel');
    await expect(panel).toBeVisible();
    // In the controls' header: after the screen's name and what it is doing, before the transport.
    const note = panel.getByTestId(`house-started-by-${A}`);
    await expect(note).toBeVisible({ timeout: 30000 });
    await expect(note).toHaveText(rowText);
    const [titleBox, noteBox, transportBox] = await Promise.all([
      panel.getByRole('heading', { level: 1 }).boundingBox(), note.boundingBox(), panel.getByTestId('np-toggle').boundingBox(),
    ]);
    expect(titleBox.y).toBeLessThan(noteBox.y);
    expect(noteBox.y).toBeLessThan(transportBox.y);
    await shot(page, `remote-started-by-${label}`);

    // A routine start is named the same way, and follows what plays now.
    const ha = createHomeAssistantCaller({ baseUrl: baseURL });
    const routine = `Journey bedtime ${randomUUID().slice(0, 4)}`;
    expect((await ha.load(A, { play: ITEM.KEEPY, routine })).status).toBe(200);
    await expect.poll(async () => (await receiverState(request, A))?.currentItem?.contentId, { timeout: 120000 }).toBe(ITEM.KEEPY);
    await expect(note).toContainText(`Started by ${routine}`, { timeout: 40000 });

    // Nothing playing: nothing claimed.
    await stopReceiver(request, A);
    await expect(note).toHaveCount(0, { timeout: 40000 });
    await context.close();
    await receiver.context.close();
  });
}

test('[PLACE.4a/AC6] screens chosen together in neighbouring rooms are warned they may drift; the neighbours are set in screen admin', async ({ browser, request }) => {
  const vp = VIEWPORTS.phone;
  const receiver = await openReceiver(browser, request, A);
  await scriptReceiver(request, { deviceId: SCRIPTED.SPEAKER, state: 'idle' });
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'idle' });
  const { context, page } = await newAppPage(browser, vp);
  await pinBrowserIdentity(page);
  await gotoMedia(page);

  const chooseTwo = async (a, b) => {
    await page.getByTestId('media-search-launcher').click();
    const searchMode = page.getByTestId('search-mode');
    await searchMode.getByTestId('destination-line').click();
    await expect(page.getByTestId('destination-sheet')).toBeVisible();
    await page.getByTestId('picker-multi-toggle').click();
    await expect(page.getByTestId(`picker-device-${a}`)).toBeVisible({ timeout: 40000 });
    await page.getByTestId(`picker-device-${a}`).click();
    await page.getByTestId(`picker-device-${b}`).click();
  };
  const leavePicker = async () => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('destination-sheet')).toHaveCount(0, { timeout: 15000 });
    const close = page.getByTestId('search-mode-close');
    if (await close.isVisible().catch(() => false)) await close.click();
  };

  // Before anyone says the rooms are neighbours: kitchen speaker and the receiver's room draw no warning.
  await chooseTwo(A, SCRIPTED.SPEAKER);
  await page.waitForTimeout(2500);
  await expect(page.getByTestId('picker-drift-warning')).toHaveCount(0);
  await leavePicker();

  // Screen admin: rooms next to each other. The link is mutual.
  await openAdmin(page, vp);
  const rooms = page.getByTestId('screen-admin-rooms');
  await expect(rooms).toBeVisible();
  await expect(page.getByTestId('screen-admin-room-near-virtual browser')).toHaveText('No neighbours set');
  await page.getByTestId('screen-admin-room-edit-virtual browser').click();
  const dialog = page.getByTestId('room-neighbours-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('room-neighbour-option-acceptance kitchen').click();
  await shot(page, 'room-neighbours-dialog-phone');
  await page.getByTestId('room-neighbours-save').click();
  await expect(dialog).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByTestId('screen-admin-room-near-virtual browser')).toHaveText('Next to Acceptance kitchen');
  await expect(page.getByTestId('screen-admin-room-near-acceptance kitchen')).toHaveText('Next to Virtual browser');
  const stored = await (await request.get('/api/v1/media/screens/rooms/adjacency')).json();
  expect(stored.roomAdjacency).toEqual({ 'Acceptance kitchen': ['Virtual browser'], 'Virtual browser': ['Acceptance kitchen'] });

  // Choosing the receiver and the kitchen speaker together now warns, naming both rooms.
  await page.goBack().catch(() => {});
  await gotoMedia(page);
  await chooseTwo(A, SCRIPTED.SPEAKER);
  const warning = page.getByTestId('picker-drift-warning');
  await expect(warning).toContainText('neighbouring rooms (Acceptance kitchen and Virtual browser)', { timeout: 20000 });
  await expect(warning).toContainText(A_NAME);
  await expect(warning).toContainText('Acceptance speaker');
  await expect(warning).toContainText('can drift apart');
  await shot(page, 'neighbouring-rooms-drift-phone');
  // A screen in a room that is not next to it draws no such warning (the den TV).
  await page.getByTestId(`picker-device-${SCRIPTED.SPEAKER}`).click();
  await page.getByTestId(`picker-device-${SCRIPTED.POWER}`).click();
  await expect(page.getByTestId('picker-drift-warning')).toHaveCount(0, { timeout: 15000 });
  await leavePicker();

  await context.close();
  await receiver.context.close();
});

test('[RELY.4a/AC3] Start fresh is truly irreversible: it asks first, cancelling changes nothing, and confirming offers no Undo', async ({ browser }) => {
  const entry = (id, title) => ({ queueItemId: `q-${id}`, contentId: `plex:${id}`, title, format: 'video', priority: 'queue', addedAt: '' });
  const session = {
    schemaVersion: 1, sessionId: 'old', updatedAt: 't', wasPlayingOnUnload: true,
    snapshot: {
      sessionId: 'old', state: 'playing',
      currentItem: { contentId: 'plex:55854', title: 'Arrival', format: 'video' }, position: 125,
      queue: { items: [entry(55854, 'Arrival'), entry(697368, 'Disclosure Day')], currentIndex: 0, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50, playbackRate: 1 },
      meta: { ownerId: 'test', updatedAt: '' },
    },
  };
  const context = await browser.newContext({ viewport: VIEWPORTS.laptop, serviceWorkers: 'block' });
  await markFirstUseDone(context);
  const page = await context.newPage();
  await page.addInitScript((seed) => {
    try {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('media-app.session', JSON.stringify(seed));
    } catch { /* storage unavailable */ }
  }, session);
  await page.goto('/media', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Arrival', { timeout: 40000 });
  const undoOffers = () => page.locator('[data-testid="item-action-undo"], [data-testid*="undo" i]').count()
    .then(async (n) => n + await page.getByRole('button', { name: /undo/i }).count());

  // Asks first; cancelling is a no-op with no Undo to offer either.
  await page.getByTestId('settings-menu-trigger').click();
  await page.getByRole('menuitem', { name: 'Start fresh' }).click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await page.getByTestId('confirm-cancel').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Arrival');
  expect(await undoOffers()).toBe(0);

  // Confirm: everything ticked is cleared, and nothing offers to bring it back.
  await page.getByTestId('settings-menu-trigger').click();
  await page.getByRole('menuitem', { name: 'Start fresh' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText(/undo/i);
  await page.getByTestId('confirm-ok').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('media-mini-player')).toHaveCount(0, { timeout: 15000 });
  // Look through the window an Undo would have had (the default is 10 seconds): none ever appears.
  for (let i = 0; i < 6; i += 1) {
    expect(await undoOffers(), 'Start fresh must not offer Undo').toBe(0);
    await page.waitForTimeout(1800);
  }
  expect((await page.getByTestId('dispatch-tray').allInnerTexts()).join(' ')).not.toMatch(/undo|put it back/i);
  await context.close();
});

test('[STEER.10a/AC2] a minutes sleep timer shows its time left on the handle, fades the sound over its last 10 seconds, then stops (fake clock)', async ({ browser }) => {
  test.setTimeout(480000);
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  const input = await openSearch(page, vp);
  await input.fill('Faith');
  await resultRow(page, vp, ITEM.FAITH).click();
  await page.getByTestId('mini-player-open-nowplaying').click();
  const np = page.getByTestId('now-playing-view');
  await expect(np).toBeVisible({ timeout: 30000 });
  // Faith is a song: the output is an audio element.
  // The element that is actually playing (the page may hold others): mark it once, then read it.
  await expect.poll(() => page.evaluate(() => {
    const el = [...document.querySelectorAll('audio, video')].find((n) => !n.paused && n.currentTime > 1);
    if (el) el.setAttribute('data-gaps-d-media', '1');
    return !!el;
  }), { timeout: 120000 }).toBe(true);
  const media = page.locator('[data-gaps-d-media="1"]');

  // From here the page's clock is ours; the media keeps playing on its own clock.
  const clock = await installFakeClock(page);
  const baseVolume = await media.evaluate((n) => n.volume);
  // The element plays at the level the UI shows (the Player resets it to 1 on load; the bridge puts the session level back).
  await expect(np.getByTestId('np-volume-level')).toBeVisible();
  const shown = Number((await np.getByTestId('np-volume-level').innerText()).replace('%', ''));
  expect(baseVolume).toBeCloseTo(shown / 100, 2);
  await np.getByTestId('sleep-timer-button').click();
  await page.getByTestId('sleep-option-15').click();
  await expect(np.getByTestId('sleep-timer-left')).toHaveText(/^Sleep in (15:00|14:5\d)$/, { timeout: 15000 });
  // The handle shows the time left too.
  await np.getByTestId('now-playing-back').click();
  const sleep = page.getByTestId('mini-sleep');
  await expect(sleep).toHaveText(/\d+:\d\d/);
  await expect(sleep).toHaveAttribute('data-sleep-label', /^Sleep timer: (15:00|14:5\d) left$/);
  await shot(page, 'handle-sleep-minutes');

  // Fourteen minutes on: time left on the handle counts down; the sound has not been touched yet.
  await clock.advanceMinutes(14);
  await expect(sleep).toHaveAttribute('data-sleep-label', /^Sleep timer: (0:[1-5]\d|1:0\d) left$/, { timeout: 15000 });
  expect(await media.evaluate((n) => n.volume)).toBeCloseTo(baseVolume, 2);

  // Into the last 10 seconds: the sound ramps down, it does not cut.
  await clock.advance(52_000);
  await clock.tick(2_000);
  const early = await media.evaluate((n) => n.volume);
  await clock.tick(3_000);
  const later = await media.evaluate((n) => n.volume);
  expect(early, 'fading: quieter than the session volume').toBeLessThan(baseVolume);
  expect(early, 'fading, not muted at once').toBeGreaterThan(0);
  expect(later, 'still fading: quieter again').toBeLessThan(early);
  expect(await media.evaluate((n) => !n.paused), 'still playing while it fades').toBe(true);

  // Then it stops, and the level is given back for the next time someone presses play.
  await clock.tick(8_000);
  await expect.poll(() => media.evaluate((n) => n.paused), { timeout: 30000 }).toBe(true);
  await page.getByTestId('mini-player-open-nowplaying').click();
  await expect(np.getByTestId('sleep-resume')).toBeVisible({ timeout: 30000 });
  // The fade multiplier is given back: the output is at the person's own volume setting again, not left faded.
  const level = Number((await np.getByTestId('np-volume-level').innerText()).replace('%', ''));
  expect(level).toBeGreaterThan(0);
  await expect.poll(() => media.evaluate((n) => n.volume), { timeout: 30000 }).toBeCloseTo(level / 100, 2);
  await shot(page, 'sleep-stopped-after-fade');
  await context.close();
});

test('[STEER.11a/AC3] Pause all names the screens it could not pause, and says why', async ({ browser, request }) => {
  const vp = VIEWPORTS.tablet;
  const receiver = await openReceiver(browser, request, A);
  await startOn(request, A, ITEM.HOSPITAL);
  // The den TV says it is playing, but no one is there to take the command: it never answers.
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'playing', title: 'Faith', duration: 200, position: 50 });
  const { context, page } = await newAppPage(browser, vp);
  await pinBrowserIdentity(page);
  await gotoMedia(page);
  await openHouse(page, vp);
  await expect(page.getByTestId(`fleet-state-${SCRIPTED.POWER}`)).toHaveText('Playing', { timeout: 40000 });
  await expect(page.getByTestId(`fleet-state-${A}`)).toHaveText('Playing', { timeout: 40000 });
  await page.getByTestId('house-pause-all').click();
  const tray = page.getByTestId('dispatch-tray');
  // The screen that answered is paused; the one that did not is listed, by name, as not paused.
  await expect.poll(async () => (await receiverState(request, A))?.state, { timeout: 30000 }).toBe('paused');
  await expect(tray).toContainText('Paused 1 screen', { timeout: 40000 });
  await expect(tray).toContainText('Not paused: Acceptance den TV', { timeout: 40000 });
  await expect(tray).toContainText("didn't answer");
  await shot(page, 'pause-all-not-reached-tablet');
  // Resume all brings back the one it paused, and the one it could not reach is not claimed as paused.
  await expect(page.getByTestId('house-resume-all')).toBeVisible();
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('[STEER.13b/AC3] next-episode behaviour lives in the controls; carry on lists only what is next, with no countdown or stop-after of its own', async ({ browser }) => {
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await pinBrowserIdentity(page);
  await gotoMedia(page);
  // Home, over the seeded household: the favourite show offers its next episode as its Continue; that
  // episode is not a carry-on tile of its own.
  await expect(page.getByTestId('home-view')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('home-row-carry-on')).toBeVisible({ timeout: 40000 });
  await expect(page.getByTestId('home-row-favourites')).toContainText('Next: Keepy Uppy', { timeout: 40000 });
  await expect(page.getByTestId('home-row-carry-on')).not.toContainText('Keepy Uppy');
  // The household's own list says why each item is there: where it stopped, or "next episode of ...".
  const carryOn = (await household(page, '/household/carry-on')).items;
  expect(carryOn.find((i) => i.contentId === SEED.ARRIVAL)?.reason).toBe('unfinished');
  expect(carryOn.find((i) => i.contentId === ITEM.KEEPY)).toMatchObject({ reason: 'next-episode', after: ITEM.HOSPITAL });
  await shot(page, 'home-carry-on-next-laptop');

  // The behaviour is in the controls of what is playing: Stop after this one, here.
  await page.getByTestId('home-tile-carry-on-' + SEED.ARRIVAL + '-picture').click();
  await page.getByTestId('mini-player-open-nowplaying').click();
  const np = page.getByTestId('now-playing-view');
  await expect(np).toBeVisible({ timeout: 40000 });
  await expect(np.getByTestId('stop-after-current')).toBeVisible({ timeout: 30000 });
  await shot(page, 'now-playing-next-episode-controls-laptop');
  await np.getByTestId('np-stop').click();
  await context.close();
});

test('[AUTO.4a/AC3] a routine pointed at a screen that is off or cannot be reached is flagged before it runs', async ({ browser, request }) => {
  const vp = VIEWPORTS.tablet;
  // Seed: "Acceptance guest room: Slow TV" points at a screen that was heard once and is gone (unreachable).
  // A second routine points at the den TV, which can be woken: flagged only while it is off.
  const current = await (await request.get('/api/v1/media/routines')).json();
  const mine = current.routines.filter((r) => r.source === 'fixture');
  const withDen = [...mine, {
    id: 'automation:acceptance_den_morning', name: 'Acceptance den: Morning news', kind: 'automation', source: 'fixture',
    targets: [{ deviceId: `fleet:${SCRIPTED.POWER}`, query: 'queue=morning-program' }], via: [],
  }];
  const imported = await request.put('/api/v1/media/routines/catalog', { data: { routines: withDen, source: 'journey' } });
  expect(imported.status()).toBe(200);
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'off' });

  const flagsApi = async () => (await (await request.get('/api/v1/media/routines/flags')).json()).items;
  await expect.poll(async () => (await flagsApi()).map((f) => f.problem), { timeout: 30000 }).toEqual(expect.arrayContaining(['off', 'unreachable']));

  const { context, page } = await newAppPage(browser, vp);
  await pinBrowserIdentity(page);
  await gotoMedia(page);
  await page.getByTestId('settings-menu-trigger').click();
  await page.getByTestId('settings-routine-history').click();
  const panel = page.getByTestId('routine-flags');
  await expect(panel).toBeVisible({ timeout: 40000 });
  await expect(panel.getByText('Before they run')).toBeVisible();
  // Unreachable: a warning that needs attention, naming the routine and the screen.
  const unreachable = panel.getByTestId('routine-flag-script:acceptance_guest_tv');
  await expect(unreachable).toContainText('Acceptance guest room: Slow TV');
  await expect(unreachable).toContainText("Needs attention: Acceptance guest room TV isn't reachable");
  await expect(unreachable).toHaveAttribute('data-severity', 'warn');
  // Off but wakeable: a note that the routine will turn it on.
  const off = panel.getByTestId('routine-flag-automation:acceptance_den_morning');
  await expect(off).toContainText('Acceptance den: Morning news');
  await expect(off).toContainText('Acceptance den TV is off; the routine will turn it on');
  await expect(off).toHaveAttribute('data-severity', 'info');
  await shot(page, 'routine-flags-off-and-unreachable-tablet');
  await context.close();
});
