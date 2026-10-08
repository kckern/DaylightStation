import { test, expect } from '@playwright/test';
import { resetHouseholdAt } from './lib/household.mjs';
import { A, A_NAME, ITEM, VIEWPORTS, newAppPage, gotoMedia, warmMedia, openReceiver, stopReceiver, receiverState } from './lib/receivers.mjs';
import {
  isPhone, goArea, openSearch, closeSearch, resultRows, resultRow, rowPicture, searchSurface, waitForSearchSettled, whereAmI,
} from './lib/search.mjs';
import { startSseServer, streamItem } from './lib/sseServer.mjs';

// FIND — search, results states, browse, details. Real catalog (the acceptance
// server's read-only Plex passthrough), real mounted receiver where a screen is
// involved, ordinary pointer/keyboard input at the three promised sizes.
// The "still arriving" sign needs a stream that can be held open, so those
// journeys redirect the app's own search request to a controllable stream.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block', actionTimeout: 30000 });
test.setTimeout(420000);

test.beforeAll(async ({ browser }) => { test.setTimeout(300000); await warmMedia(browser); });
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

const ARRIVAL = ITEM.ARRIVAL;
const ITEM_BLUEY = 'plex:59493';

async function typeSlowly(input, text) {
  await input.pressSequentially(text, { delay: 120 });
}

for (const [label, vp] of Object.entries(VIEWPORTS)) {
  test(`[FIND.1a/AC1][FIND.1a/AC2][FIND.1a/AC4] ${label}: search opens from every part of the app with the cursor ready, results arrive while typing with picture, title and kind, and closing returns to exactly where I was`, async ({ browser }) => {
    const { context, page } = await newAppPage(browser, vp);
    await gotoMedia(page);
    const places = [
      { area: 'home', ready: 'home-view' },
      { area: 'browse', ready: 'browse-view' },
      { area: 'fleet', ready: null },
    ];
    for (const place of places) {
      await goArea(page, vp, place.area);
      if (place.ready) await expect(page.getByTestId(place.ready)).toBeVisible({ timeout: 30000 });
      if (place.area === 'browse') {
        // Deeper than the root: into the first collection, so "exactly where I was" is not just a tab.
        const first = page.locator('[data-testid^="browse-open-"]').first();
        await expect(first).toBeVisible({ timeout: 30000 });
        await first.click();
        await expect(page.locator('.browse-crumb--current')).toBeVisible({ timeout: 30000 });
      }
      const before = await whereAmI(page);

      // AC1: one obvious action, and the cursor is ready.
      const input = await openSearch(page, vp);
      await expect(input).toBeFocused();

      // AC2: results begin appearing WHILE I type (before the word is finished), each with picture, title, kind.
      await input.fill('');
      await typeSlowly(input, 'Arr');
      const row = resultRow(page, vp, ARRIVAL);
      await expect(resultRows(page, vp).first()).toBeVisible({ timeout: 30000 });
      await typeSlowly(input, 'ival');
      await expect(input).toHaveValue('Arrival');
      await expect(row).toBeVisible({ timeout: 30000 });
      await expect(rowPicture(row).first()).toBeVisible();
      await expect(row).toContainText('Arrival');
      await expect(row).toContainText('Movie');

      // AC4: closing search returns me to exactly where I was.
      await closeSearch(page, vp);
      const after = await whereAmI(page);
      expect(after, `after closing search from ${place.area}`).toEqual(before);

      // "/" opens search again from anywhere, cursor ready (the keyboard path).
      await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
      await page.keyboard.press('/');
      if (isPhone(vp)) await expect(page.getByTestId('search-mode-input')).toBeFocused();
      else await expect(page.getByRole('textbox', { name: 'Search media…', exact: true })).toBeFocused();
      await closeSearch(page, vp);
      expect(await whereAmI(page)).toEqual(before);
    }
    await context.close();
  });
}

// FIND.1a/AC3 — the same search whichever size, and while steering another screen.
test('[FIND.1a/AC3] search looks and behaves the same at every size, and while aimed at (and looking at the controls of) another screen', async ({ browser, request }) => {
  const receiver = await openReceiver(browser, request, A);
  const signature = async (page, vp) => {
    const input = await openSearch(page, vp);
    await input.fill('');
    await input.fill('Arrival');
    await expect(resultRow(page, vp, ARRIVAL)).toBeVisible({ timeout: 30000 });
    await waitForSearchSettled(page);
    const surface = searchSurface(page, vp);
    const chips = await surface.locator('[data-testid^="scope-chip-"]').evaluateAll((els) => els.map((e) => e.textContent.trim()));
    const first = resultRows(page, vp).first();
    const shape = {
      chips,
      firstTitle: (await first.locator('.media-result-title, p').first().innerText()).trim(),
      hasPicture: (await rowPicture(first).count()) > 0,
      hasKind: /Movie|Show|Episode|Album|Track|Song|Playlist|Collection|Artist|Book|Photo|Clip|Video/.test(await first.innerText()),
    };
    return shape;
  };
  const shapes = {};
  for (const [label, vp] of Object.entries(VIEWPORTS)) {
    const { context, page } = await newAppPage(browser, vp);
    await gotoMedia(page);
    const local = await signature(page, vp);
    await closeSearch(page, vp);
    // Aim at the other screen (the destination control), then search again: same search.
    if (isPhone(vp)) {
      await (await openSearch(page, vp), page.getByTestId('search-mode').getByTestId('destination-line')).click();
      await expect(page.getByTestId('destination-sheet')).toBeVisible();
      await page.getByTestId(`picker-device-${A}`).click();
      await page.getByTestId('picker-submit').click();
      await closeSearch(page, vp).catch(() => {});
    } else {
      await page.getByTestId('cast-target-chip').click();
      await page.getByTestId(`cast-target-checkbox-${A}`).check();
      await page.getByTestId('cast-target-chip').click();
      await expect(page.getByTestId('cast-popover')).toBeHidden();
    }
    const aimed = await signature(page, vp);
    expect(aimed, `${label}: search while aimed at ${A_NAME}`).toEqual(local);
    await expect(isPhone(vp) ? page.getByTestId('search-mode').getByTestId('destination-line-name') : page.getByTestId('destination-control-name')).toContainText(A_NAME);
    await closeSearch(page, vp);
    // Steering: open that screen's controls (its Remote), search from there: still the same search.
    await goArea(page, vp, 'fleet');
    await page.getByTestId(`fleet-peek-${A}`).click();
    await expect(page.getByTestId('peek-panel')).toBeVisible({ timeout: 30000 });
    const steering = await signature(page, vp);
    expect(steering, `${label}: search while steering ${A_NAME}`).toEqual(local);
    shapes[label] = local;
    await context.close();
  }
  // Across sizes: the same choices and the same kind of row.
  expect(shapes.tablet.chips).toEqual(shapes.laptop.chips);
  expect(shapes.phone.chips).toEqual(shapes.laptop.chips);
  expect(new Set(Object.values(shapes).map((s) => s.firstTitle)).size).toBe(1);
  await receiver.context.close();
});

// FIND.1a/AC5 — Add, Play on… and Play keep the words and the narrowing.
async function retentionSetup(browser, request, vp) {
  const receiver = await openReceiver(browser, request, A);
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  const input = await openSearch(page, vp);
  const surface = searchSurface(page, vp);
  await surface.getByTestId('scope-chip-video').click();
  await input.fill('Arrival');
  const row = resultRow(page, vp, ARRIVAL);
  await expect(row).toBeVisible({ timeout: 30000 });
  const retained = async (step) => {
    await expect(surface, `${step}: search stays open`).toBeVisible();
    await expect(input, `${step}: my words stay`).toHaveValue('Arrival');
    await expect(surface.getByTestId('scope-chip-video'), `${step}: my narrowing stays`).toHaveAttribute('aria-pressed', 'true');
    await expect(row, `${step}: my results stay`).toBeVisible();
  };
  const verb = async (name) => {
    await page.getByTestId(`result-more-${ARRIVAL}`).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  };
  return { receiver, context, page, row, retained, verb };
}

for (const [label, vp] of Object.entries(VIEWPORTS)) {
  test(`[FIND.1a/AC5] ${label}: after Add and after Play, search stays open with my words and narrowing`, async ({ browser, request }) => {
    const { receiver, context, row, retained, verb, page } = await retentionSetup(browser, request, vp);
    await verb('Add to Queue');
    await retained('Add');
    // Play here (tap the result).
    await row.click();
    await retained('Play');
    await expect(page.locator('video').first()).toBeAttached({ timeout: 60000 });
    await context.close();
    await receiver.context.close();
  });

  test(`[FIND.1a/AC5] ${label}: after Play on… to another screen, search stays open with my words and narrowing`, async ({ browser, request }) => {
    const { receiver, context, retained, verb, page } = await retentionSetup(browser, request, vp);
    await verb('Play on…');
    await expect(page.getByTestId('dispatch-target-picker')).toBeVisible();
    // One tap on the screen sends just this item there (a one-shot pick needs no second confirm).
    await page.getByTestId(`picker-device-${A}`).click();
    await expect(page.getByTestId('dispatch-target-picker')).toBeHidden({ timeout: 15000 });
    await retained('Play on…');
    await expect.poll(async () => (await receiverState(request, A))?.currentItem?.contentId, { timeout: 120000 }).toBe(ARRIVAL);
    await stopReceiver(request, A);
    await context.close();
    await receiver.context.close();
  });
}

// FIND.3a — the "still arriving" sign: visible while sources answer, gone when all are in, same wording everywhere.
test('[FIND.3a/AC1][FIND.3a/AC2][FIND.3a/AC4] the "still searching" sign shows while sources are pending, disappears once all have answered, and reads identically at every size', async ({ browser }) => {
  const sse = await startSseServer();
  const signs = {};
  try {
    for (const [label, vp] of Object.entries(VIEWPORTS)) {
      sse.reset();
      sse.script(async (s) => {
        s.send({ event: 'pending', sources: ['plex', 'immich'] });
        s.send({ event: 'results', source: 'plex', items: [streamItem({ id: ARRIVAL, title: 'Arrival' })], pending: ['immich'] });
        await s.gate('all-in');
        s.send({ event: 'results', source: 'immich', items: [], pending: [] });
        s.send({ event: 'complete' });
        s.end();
      });
      const { context, page } = await newAppPage(browser, vp);
      await sse.install(page);
      await gotoMedia(page);
      const input = await openSearch(page, vp);
      await input.fill('Arrival');
      const sign = page.getByTestId('stream-status-line');
      // AC1: results are arriving and the sign says more are still on their way.
      await expect(resultRow(page, vp, ARRIVAL)).toBeVisible({ timeout: 30000 });
      await expect(sign).toContainText('Still searching', { timeout: 15000 });
      signs[label] = (await sign.innerText()).trim();
      // AC2: when all are in, the sign disappears.
      sse.release('all-in');
      await expect(sign).toHaveCount(0, { timeout: 15000 });
      await expect(resultRow(page, vp, ARRIVAL)).toBeVisible();
      await context.close();
    }
  } finally { await sse.close(); }
  // AC4: the same words wherever search appears.
  expect(signs.phone).toBe(signs.laptop);
  expect(signs.tablet).toBe(signs.laptop);
  expect(signs.laptop).toMatch(/^Still searching — 1 source still answering$/);
});

// FIND.4a — empty results, widened results, and never confusing empty with loading.
for (const [label, vp] of Object.entries(VIEWPORTS)) {
  test(`[FIND.4a/AC1][FIND.4a/AC3][FIND.4a/AC4] ${label}: a narrowed search with nothing widens to every kind (kind in words on every row); nothing anywhere says so plainly with spelling and browse offers; empty never looks like loading`, async ({ browser }) => {
    const sse = await startSseServer();
    try {
      const { context, page } = await newAppPage(browser, vp);
      await sse.install(page);
      await gotoMedia(page);
      const input = await openSearch(page, vp);
      const surface = searchSurface(page, vp);
      sse.script(async (s) => {
        const narrowed = Boolean(s.params.source || s.params.mediaType);
        const everything = (s.params.text ?? '').includes('widen');
        s.send({ event: 'pending', sources: ['plex'] });
        if (!narrowed && everything) {
          s.send({ event: 'results', source: 'plex', items: [
            streamItem({ id: 'plex:1', title: 'Widen Movie', type: 'movie' }),
            streamItem({ id: 'plex:2', title: 'Widen Album', type: 'album' }),
            streamItem({ id: 'plex:3', title: 'Widen Show', type: 'show' }),
          ], pending: [] });
        } else if (s.params.text === 'holdme') {
          await s.gate('never-this-test');
        } else {
          s.send({ event: 'results', source: 'plex', items: [], pending: [] });
        }
        s.send({ event: 'complete' });
        s.end();
      });
      await surface.getByTestId('scope-chip-video').click();

      // AC1: nothing in Video → matches from every kind appear under the divider, kind in words on every row.
      await input.fill('widen');
      const status = page.getByTestId('stream-status-line');
      await expect(status).toContainText('Not in Video', { timeout: 20000 });
      await expect(status).toContainText('From everything:');
      const rows = resultRows(page, vp);
      await expect(rows).toHaveCount(3, { timeout: 20000 });
      const kinds = [['Widen Movie', 'Movie'], ['Widen Album', 'Album'], ['Widen Show', 'Show']];
      for (const [title, kind] of kinds) {
        const r = rows.filter({ hasText: title });
        await expect(r).toHaveCount(1);
        await expect(r).toContainText(kind);
      }

      // AC3: nothing anywhere → told plainly, offered spelling and the nearest kind.
      await input.fill('');
      await input.fill('zzzqqq-nothing');
      await expect(status).toContainText('no matches', { timeout: 20000 });
      await expect(status).toContainText('Check the spelling or browse Video');
      await expect(rows).toHaveCount(0);

      // AC4: an empty answer is not a loading state: no "Still searching"/"Searching" sign, and the state is settled.
      await expect(status).not.toContainText(/Still searching|Searching/);
      await expect(page.getByTestId('search-mode-loading')).toHaveCount(0);
      await context.close();
    } finally { await sse.close(); }
  });
}

// FIND.5a/AC1 — every kind of content is reachable by tapping alone.
test('[FIND.5a/AC1] every kind of content (video, music, hymns, books, photos, YouTube) opens from Browse without typing', async ({ browser }) => {
  const vp = VIEWPORTS.phone;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  const typed = [];
  page.on('keydown', () => typed.push(1));
  await goArea(page, vp, 'browse');
  await expect(page.getByTestId('browse-view')).toBeVisible();
  // The kinds the household's own config says it has (the search choices) each have a way in from the root.
  const config = await (await page.request.get('/api/v1/media/config')).json();
  const kinds = config.searchScopes.filter((scope) => scope.key !== 'all').map((scope) => scope.label);
  expect(kinds).toEqual(expect.arrayContaining(['Video', 'Music', 'Books']));
  const roots = { video: ['plex:'], music: ['plex:'], hymns: ['singalong:'], books: ['abs:', 'readalong:'], photos: ['immich:'], youtube: ['youtube:'] };
  for (const [kind, ids] of Object.entries(roots)) {
    for (const id of ids) {
      await goArea(page, vp, 'browse');
      const entry = page.getByTestId(`browse-open-${id}`);
      await expect(entry, `${kind}: a way in (${id}) from the Browse root`).toBeVisible({ timeout: 30000 });
      await entry.click();
      // It opens: a listing (or an honest "nothing here"), never an error.
      await expect(page.locator('.browse-crumb--current')).toBeVisible({ timeout: 30000 });
      await expect(page.getByTestId('browse-view-loading')).toHaveCount(0, { timeout: 30000 });
      await expect(page.getByTestId('load-error')).toHaveCount(0);
      const rows = await page.locator('[data-testid^="browse-row-"]').count();
      const empty = await page.getByTestId('browse-empty').count();
      expect(rows + empty, `${kind}: ${id} opened to something`).toBeGreaterThan(0);
    }
  }
  // Music and video are separate libraries under the one Plex source.
  await goArea(page, vp, 'browse');
  await page.getByTestId('browse-open-plex:').click();
  // Read the list only once it has loaded: the click returns before the listing arrives.
  await expect(page.getByTestId('browse-view-loading')).toHaveCount(0, { timeout: 30000 });
  await expect(page.locator('.browse-list .media-result-title').first()).toBeVisible({ timeout: 30000 });
  await expect.poll(async () => page.locator('.browse-list .media-result-title').allTextContents(), { timeout: 30000 })
    .toEqual(expect.arrayContaining(['Movies', 'TV Shows', 'Music']));
  expect(typed.length, 'nothing was typed to get there').toBe(0);
  await context.close();
});

// FIND.8a — details.
async function openTileMenuIn(page, testId) {
  const tile = page.getByTestId(testId);
  await tile.scrollIntoViewIfNeeded();
  await tile.getByRole('button', { name: /More actions for/ }).click();
  return page.getByTestId(`${testId}-menu`);
}

test('[FIND.8a/AC1] details open in one step from search, browsing, suggestions and recent', async ({ browser }) => {
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  const detailOpen = async (id) => {
    await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 30000 });
    expect(page.url()).toContain(`contentId=${encodeURIComponent(id)}`);
    await page.getByTestId('detail-back').click();
  };
  // Search.
  const input = await openSearch(page, vp);
  await input.fill('Arrival');
  await expect(resultRow(page, vp, ARRIVAL)).toBeVisible({ timeout: 30000 });
  await page.getByTestId(`result-more-${ARRIVAL}`).click();
  await page.getByTestId(`result-action-detail-${ARRIVAL}`).click();
  await detailOpen(ARRIVAL);
  // Recent (the seeded household's recents) and a suggestion ("Usually at this time").
  await goArea(page, vp, 'home');
  await expect(page.getByTestId('home-row-recent')).toBeVisible({ timeout: 30000 });
  const recent = await openTileMenuIn(page, `home-tile-recent-${ITEM.ARRIVAL}`);
  await recent.getByTestId(`home-tile-recent-${ITEM.ARRIVAL}-verb-details`).click();
  await detailOpen(ITEM.ARRIVAL);
  const suggestion = await openTileMenuIn(page, `home-tile-time-of-day-${ITEM.FAITH}`);
  await suggestion.getByTestId(`home-tile-time-of-day-${ITEM.FAITH}-verb-details`).click();
  await detailOpen(ITEM.FAITH);
  // Browsing: a leaf in a library has its own details action.
  await goArea(page, vp, 'browse');
  await page.getByTestId('browse-open-plex:').click();
  await page.locator('[data-testid^="browse-open-plex:library/sections/6/"]').first().click();
  const leaf = page.locator('[data-testid^="browse-detail-"]').first();
  await expect(leaf).toBeVisible({ timeout: 30000 });
  const leafId = (await leaf.getAttribute('data-testid')).replace('browse-detail-', '');
  await leaf.click();
  await detailOpen(leafId);
  await context.close();
});

test('[FIND.8a/AC3][FIND.8a/AC4] details offer the same play and line-up actions with the destination stated, and opening them never changes what is playing', async ({ browser, request }) => {
  const receiver = await openReceiver(browser, request, A);
  const { context, page } = await newAppPage(browser, VIEWPORTS.laptop);
  await gotoMedia(page);
  // Aim at the receiver and let it play something; details of another item must not disturb it.
  await page.getByTestId('cast-target-chip').click();
  await page.getByTestId(`cast-target-checkbox-${A}`).check();
  await page.getByTestId('cast-target-chip').click();
  await expect(page.getByTestId('cast-popover')).toBeHidden();
  const { startOn } = await import('./lib/receivers.mjs');
  await startOn(request, A, ITEM.HOSPITAL, { queue: [ITEM.KEEPY] });
  const before = await receiverState(request, A);
  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ARRIVAL)}`);
  const detail = page.getByTestId('detail-view');
  await expect(detail).toBeVisible({ timeout: 60000 });
  // AC3: the same verbs as everywhere else, and the destination is stated.
  for (const name of ['Play Now', 'Play Next', 'Play First', 'Add to Queue', 'Add on…']) {
    await expect(detail.getByRole('button', { name }), name).toBeVisible();
  }
  await expect(detail.getByRole('button', { name: /Cast|Play on/ })).toBeVisible();
  await expect(page.getByTestId('aim-label')).toContainText(A_NAME);
  // AC4: the receiver was neither started, stopped nor changed by looking.
  await page.waitForTimeout(4000);
  const after = await receiverState(request, A);
  expect(after.state).toBe('playing');
  expect(after.currentItem.contentId).toBe(before.currentItem.contentId);
  expect(after.queue.items.map((i) => i.contentId)).toEqual(before.queue.items.map((i) => i.contentId));
  expect(after.position).toBeGreaterThan(before.position);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('[FIND.8a/AC2] details show picture, title, description, length, kind and how far anyone has got', async ({ browser }) => {
  const { context, page } = await newAppPage(browser, VIEWPORTS.laptop);
  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ARRIVAL)}`);
  const detail = page.getByTestId('detail-view');
  await expect(detail).toBeVisible({ timeout: 60000 });
  await expect(detail.locator('img')).toBeVisible();
  await expect(detail.getByRole('heading', { name: 'Arrival' })).toBeVisible();
  await expect(detail.getByTestId('detail-progress')).toContainText(/left|min/);
  await expect(detail).toContainText('Movie');
  // Length and kind sit together on the facts line (not the progress line, which also says "min left").
  await expect(detail.getByTestId('detail-facts')).toHaveText(/^Movie · \d+ hr( \d+ min)?$/);
  expect((await detail.innerText()).length).toBeGreaterThan(200);
  await context.close();
});

// FIND.8b — the tap rule, the mis-tap undo and the details action on every result.
test('[FIND.8b/AC1][FIND.8b/AC4] a tap plays a playable item at the aim (with Undo) and opens a collection, in search and in browse', async ({ browser, request }) => {
  const receiver = await openReceiver(browser, request, A);
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await page.getByTestId('cast-target-chip').click();
  await page.getByTestId(`cast-target-checkbox-${A}`).check();
  await page.getByTestId('cast-target-chip').click();
  await expect(page.getByTestId('cast-popover')).toBeHidden();

  // Search: a collection (a show) opens; nothing starts.
  const input = await openSearch(page, vp);
  await input.fill('Bluey');
  const show = resultRow(page, vp, ITEM_BLUEY);
  await expect(show).toBeVisible({ timeout: 30000 });
  await show.click();
  await expect(page.locator('.browse-crumb--current, [data-testid="detail-view"]').first()).toBeVisible({ timeout: 30000 });
  expect((await receiverState(request, A))?.state ?? 'none').not.toBe('playing');

  // Search: a playable item plays at the aim, with an Undo; the mis-tap costs nothing.
  await goArea(page, vp, 'home');
  const search = await openSearch(page, vp);
  await search.fill('Arrival');
  await resultRow(page, vp, ARRIVAL).click();
  const row = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: /Arrival/ });
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect.poll(async () => (await receiverState(request, A))?.currentItem?.contentId, { timeout: 120000 }).toBe(ARRIVAL);
  await row.getByTestId('item-action-undo').click();
  await expect.poll(async () => (await receiverState(request, A))?.state, { timeout: 60000 }).not.toBe('playing');

  // Browse: a leaf plays at the aim and offers Undo; a collection opens.
  await goArea(page, vp, 'browse');
  await page.getByTestId('browse-open-plex:').click();
  await page.locator('[data-testid^="browse-open-plex:library/sections/6/"]').first().click();
  const leaf = page.locator('[data-testid^="result-play-now-"]').first();
  await expect(leaf).toBeVisible({ timeout: 30000 });
  const leafId = (await leaf.getAttribute('data-testid')).replace('result-play-now-', '');
  await leaf.click();
  await expect.poll(async () => (await receiverState(request, A))?.currentItem?.contentId, { timeout: 120000 }).toBe(leafId);
  const browseRow = page.locator('[data-testid^="dispatch-row-"]');
  await expect(browseRow.first().getByTestId('item-action-undo')).toBeVisible({ timeout: 15000 });
  await browseRow.first().getByTestId('item-action-undo').click();
  await expect.poll(async () => (await receiverState(request, A))?.state, { timeout: 60000 }).not.toBe('playing');
  await page.getByTestId('browse-crumb-parent-1').click().catch(() => {});
  await page.locator('[data-testid^="browse-open-"]').first().click();
  await expect(page.locator('.browse-crumb--current')).toBeVisible();
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

for (const [label, vp] of Object.entries(VIEWPORTS)) {
  test(`[FIND.8b/AC5] ${label}: every result has a secondary action that opens its details`, async ({ browser }) => {
    const { context, page } = await newAppPage(browser, vp);
    await gotoMedia(page);
    const input = await openSearch(page, vp);
    await input.fill('Arrival');
    await waitForSearchSettled(page);
    const rows = resultRows(page, vp);
    await expect(rows.first()).toBeVisible({ timeout: 30000 });
    const ids = (await rows.evaluateAll((els) => els.map((e) => e.dataset.testid.replace(/^(search-mode-result|combobox-option)-/, '')))).slice(0, 8);
    expect(ids.length).toBeGreaterThan(2);
    for (const id of ids) {
      await page.getByTestId(`result-more-${id}`).scrollIntoViewIfNeeded();
      await page.getByTestId(`result-more-${id}`).click();
      await expect(page.getByTestId(`result-action-detail-${id}`), `result ${id} offers details`).toBeVisible();
      await page.keyboard.press('Escape');
    }
    // And it opens.
    await page.getByTestId(`result-more-${ids[0]}`).click();
    await page.getByTestId(`result-action-detail-${ids[0]}`).click();
    await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 30000 });
    await context.close();
  });
}
