import { test, expect } from '@playwright/test';
import { resetHouseholdAt } from './lib/household.mjs';
import { installFakeClock } from './lib/fakeClock.mjs';
import { scriptReceiver, SCRIPTED } from './lib/scriptedReceiver.mjs';
import {
  A, B, A_NAME, ITEM, VIEWPORTS, call, receiverState, openReceiver, startOn, stopReceiver, resetControls,
  newAppPage, gotoMedia, warmMedia, openHouse, openRemote,
} from './lib/receivers.mjs';
import { goArea, openSearch, resultRow, closeSearch } from './lib/search.mjs';

// STEER — the handle, the Remote (another screen's controls), the queue and
// shuffle/repeat. Real mounted receivers; scripted screens for states no page
// can show (no seek, live, photos, a screen that looks online but cannot be
// reached). Ordinary pointer input only.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block', actionTimeout: 30000 });
test.setTimeout(420000);

test.beforeAll(async ({ browser }) => { test.setTimeout(300000); await warmMedia(browser); });
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

const TRANSPORT_IDS = ['np-prev', 'np-rew', 'np-toggle', 'np-ffw', 'np-next', 'np-rate', 'np-volume', 'np-stop'];
const queueTitles = (scope) => scope.locator('[data-testid^="queue-item-"] .queue-item-title');
const queueIds = async (request, id = A) => (await receiverState(request, id))?.queue?.items?.map((i) => i.contentId) ?? [];

// ---------------------------------------------------------------------------
test('[STEER.7a/AC4] photos have a queue like video and audio; a live channel says it is live and has no position', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'playing', title: 'Photo 1', kind: 'photo', queue: [{ title: 'Photo 2', kind: 'photo' }, { title: 'Photo 3', kind: 'photo' }] });
  await openRemote(page, SCRIPTED.POWER, vp);
  const panel = page.getByTestId('peek-panel');
  await expect(panel.getByTestId('queue-panel')).toBeVisible({ timeout: 30000 });
  await expect(panel.locator('.queue-count')).toContainText('3 items');
  await expect(queueTitles(panel)).toHaveText([/Photo 1/, /Photo 2/, /Photo 3/]);
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'playing', title: 'News channel', kind: 'live' });
  await expect(panel.getByText('LIVE', { exact: false }).first()).toBeVisible({ timeout: 30000 });
  await expect(panel.getByTestId('np-seek')).toHaveCount(0);
  await context.close();
});

test('[STEER.7a/AC4] a live channel has no queue at all', async ({ browser, request }) => {
  // A live channel is a single thing: LIVE, no position, and no queue to shuffle, repeat or clear.
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'playing', title: 'News channel', kind: 'live' });
  await openRemote(page, SCRIPTED.POWER, vp);
  await expect(page.getByTestId('peek-panel').getByText('LIVE', { exact: false }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('peek-panel').getByTestId('queue-panel')).toHaveCount(0);
  await context.close();
});

for (const [label, vp] of Object.entries(VIEWPORTS)) {
  test(`[STEER.1b/AC1][STEER.1b/AC4] ${label}: another screen's Remote shows the same controls with that screen's name at the top, and leaving it never changes my aim`, async ({ browser, request }) => {
    const receiver = await openReceiver(browser, request, A);
    await resetControls(request, A);
    await startOn(request, A, ITEM.HOSPITAL, { queue: [ITEM.KEEPY] });
    const { context, page } = await newAppPage(browser, vp);
    await gotoMedia(page);
    const readAim = () => page.evaluate(() => {
      const raw = localStorage.getItem('media-app.cast-target');
      try { const { mode, targetIds } = JSON.parse(raw); return JSON.stringify({ mode, targetIds }); } catch { return String(raw); }
    });
    const aimBefore = await readAim();
    await openRemote(page, A, vp);
    const panel = page.getByTestId('peek-panel');
    // The screen's name is the title at the top of its controls.
    await expect(panel.getByRole('heading', { level: 1 })).toContainText(A_NAME);
    await expect(page.getByTestId('np-target-label')).toContainText(A_NAME);
    // The same controls as the local ones.
    for (const id of TRANSPORT_IDS) await expect(panel.getByTestId(id), `Remote has ${id}`).toBeVisible();
    // Title at the top is above the transport (layout order).
    const boxes = await Promise.all([panel.getByRole('heading', { level: 1 }), panel.getByTestId('np-toggle')].map((l) => l.boundingBox()));
    expect(boxes[0].y).toBeLessThan(boxes[1].y);
    // Leaving the controls does not change my aim.
    await panel.getByTestId('peek-back').click();
    await expect(page.getByTestId(`fleet-peek-${A}`)).toBeVisible({ timeout: 30000 });
    expect(await readAim()).toBe(aimBefore);
    await stopReceiver(request, A);
    await context.close();
    await receiver.context.close();
  });
}

test('[STEER.1b/AC1] the Remote lays its controls out like the local ones (same controls, same order)', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  await startOn(request, A, ITEM.HOSPITAL);
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  // Local: play Faith here and open Now Playing.
  const input = await openSearch(page, vp);
  await input.fill('Faith');
  await resultRow(page, vp, ITEM.FAITH).click();
  await page.getByTestId('mini-player-open-nowplaying').click();
  await expect(page.getByTestId('now-playing-view')).toBeVisible({ timeout: 30000 });
  const order = (scope) => scope.getByTestId('np-transport').locator('[data-testid^="np-"]').evaluateAll((els) => els.map((e) => e.dataset.testid).filter((t) => !['np-transport', 'np-target-label', 'np-command-feedback'].includes(t)));
  await expect(page.getByTestId('now-playing-view').getByTestId('np-rew')).toBeVisible({ timeout: 60000 });
  const local = await order(page.getByTestId('now-playing-view'));
  await openRemote(page, A, vp);
  await expect(page.getByTestId('peek-panel').getByTestId('np-rew')).toBeVisible({ timeout: 60000 });
  const remote = await order(page.getByTestId('peek-panel'));
  expect(remote).toEqual(local);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('[STEER.1b/AC2] controls a screen cannot support are shown as unavailable with a short reason, not missing: no seeking on a live channel, no speed on a screen that does not report it', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'playing', title: 'News channel', kind: 'live' });
  await openRemote(page, SCRIPTED.POWER, vp);
  const panel = page.getByTestId('peek-panel');
  await expect(panel.getByTestId('np-toggle')).toBeVisible({ timeout: 30000 });
  // Seeking: the live badge, and the reason in words.
  await expect(panel.getByText('LIVE', { exact: false }).first()).toBeVisible({ timeout: 30000 });
  await expect(panel.getByTestId('np-seek')).toHaveCount(0);
  await expect(panel.locator('.np-control-unavailable').filter({ hasText: /Live playback has no seekable position/ }).first()).toBeVisible();
  // Speed: present, disabled, and says why.
  await expect(panel.getByTestId('np-rate')).toBeDisabled();
  await expect(panel.locator('.np-control-unavailable').filter({ hasText: /speed is not supported/i }).first()).toBeVisible();
  await context.close();
});

test('(STEER.3a/AC4, no-replay half) a screen that looks online but does not answer: the press reads as unconfirmed and is never carried out later', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'playing', title: 'Arrival', duration: 7000, position: 100 });
  const sends = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/session\/transport$/.test(r.url())) sends.push(r.postData()); });
  await openRemote(page, SCRIPTED.POWER, vp);
  const panel = page.getByTestId('peek-panel');
  await expect(panel.getByTestId('np-toggle')).toBeEnabled({ timeout: 30000 });
  await panel.getByTestId('np-toggle').click();
  await expect(page.getByTestId('np-command-feedback')).toContainText(/not sent|could not confirm|didn.t respond|couldn.t reach/i, { timeout: 30000 });
  // Nothing is queued to happen later: the screen stays as it was, and no further press is sent on its own.
  const first = sends.length;
  await page.waitForTimeout(8000);
  expect(sends.length).toBe(first);
  expect((await receiverState(request, SCRIPTED.POWER))?.state).toBe('playing');
  await context.close();
});

test('[STEER.3a/AC4] a screen that looks online but cannot be reached: the press reads "Not sent — device is offline" and is never carried out later', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  // It keeps reporting as playing (so this device sees it online), but the server's own liveness refuses a send.
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'playing', title: 'Arrival', duration: 7000, position: 100, serverOffline: true });
  const sends = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/session\/transport$/.test(r.url())) sends.push(r.postData()); });
  await openRemote(page, SCRIPTED.POWER, vp);
  const panel = page.getByTestId('peek-panel');
  await expect(panel.getByTestId('np-toggle')).toBeEnabled({ timeout: 30000 });
  await panel.getByTestId('np-toggle').click();
  await expect(page.getByTestId('np-command-feedback')).toContainText(/not sent/i, { timeout: 30000 });
  const first = sends.length;
  expect(first).toBeGreaterThan(0);
  await page.waitForTimeout(8000);
  expect(sends.length, 'nothing is queued to happen later').toBe(first);
  expect((await receiverState(request, SCRIPTED.POWER))?.state).toBe('playing');
  await context.close();
});

test('[STEER.1b/AC3] I can switch to another screen\'s controls in one step; my aim and the first screen are left as they were', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  await startOn(request, A, ITEM.HOSPITAL);
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'playing', title: 'Arrival', duration: 7000, position: 100 });
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  const readAim = () => page.evaluate(() => {
    const raw = localStorage.getItem('media-app.cast-target');
    try { const { mode, targetIds } = JSON.parse(raw); return JSON.stringify({ mode, targetIds }); } catch { return String(raw); }
  });
  const aimBefore = await readAim();
  await openRemote(page, A, vp);
  const panel = page.getByTestId('peek-panel');
  await expect(panel.getByRole('heading', { level: 1 })).toContainText(A_NAME);
  await panel.getByTestId('peek-switch').click();
  await expect(page.getByTestId(`peek-switch-${A}`), 'the screen being steered is not offered').toHaveCount(0);
  await page.getByTestId(`peek-switch-${SCRIPTED.POWER}`).click();
  await expect(panel.getByRole('heading', { level: 1 })).not.toContainText(A_NAME, { timeout: 15000 });
  await expect(page.getByTestId('np-target-label')).not.toContainText(A_NAME);
  await expect(panel.getByTestId('np-toggle')).toBeVisible();
  expect(await readAim(), 'switching never changes my aim').toBe(aimBefore);
  expect((await receiverState(request, A)).state, 'the first screen kept playing').toBe('playing');
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('[STEER.7a/AC3][STEER.7a/AC5] another screen\'s queue shows what is playing, what is next (in order, including items placed next) and a count; what played earlier is listed', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  await startOn(request, A, ITEM.DISCLOSURE, { queue: [ITEM.HOSPITAL, ITEM.FAITH] });
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await openRemote(page, A, vp);
  const panel = page.getByTestId('peek-panel');
  const titles = () => queueTitles(panel).allInnerTexts().then((ts) => ts.map((t) => t.replace(/^\d+\./, '').trim()));
  await expect(panel.locator('.queue-count')).toContainText('3 items', { timeout: 30000 });
  await expect.poll(titles).toEqual(expect.arrayContaining(['Disclosure Day', 'Hospital', 'Faith']));
  // What is playing now is marked, and what is next follows in order.
  await expect(panel.locator('.queue-item--current, [aria-current="true"]').first()).toContainText('Disclosure Day');
  const initial = await titles();
  expect(initial.indexOf('Hospital')).toBeLessThan(initial.indexOf('Faith'));
  // What played earlier on this screen (the seeded ledger) closes the queue.
  const earlier = panel.getByTestId('played-earlier');
  await earlier.scrollIntoViewIfNeeded();
  await expect(earlier).toBeVisible();
  await expect(earlier.locator('.played-earlier-row').first()).toBeVisible({ timeout: 30000 });
  await expect(earlier).toContainText('Hospital');
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('[STEER.8a/AC1] I can move an item up or down on another screen and the new order shows immediately', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  await startOn(request, A, ITEM.DISCLOSURE, { queue: [ITEM.HOSPITAL, ITEM.FAITH] });
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await openRemote(page, A, vp);
  const panel = page.getByTestId('peek-panel');
  const titles = () => queueTitles(panel).allInnerTexts().then((ts) => ts.map((t) => t.replace(/^\d+\./, '').trim()));
  await expect(panel.locator('.queue-count')).toContainText('3 items', { timeout: 30000 });
  const faithRow = panel.locator('[data-testid^="queue-item-"]').filter({ hasText: 'Faith' });
  const faithId = (await faithRow.getAttribute('data-testid')).replace('queue-item-', '');
  await panel.getByTestId(`queue-moveup-${faithId}`).click();
  await expect.poll(titles, { timeout: 15000 }).toEqual(['Disclosure Day', 'Faith', 'Hospital']);
  await expect.poll(async () => (await receiverState(request, A)).queue.items.map((i) => i.contentId), { timeout: 30000 }).toEqual([ITEM.DISCLOSURE, ITEM.FAITH, ITEM.HOSPITAL]);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

async function remoteQueueSetup(browser, request, withClock = true) {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  await startOn(request, A, ITEM.DISCLOSURE, { queue: [ITEM.HOSPITAL, ITEM.FAITH] });
  const { context, page } = await newAppPage(browser, vp);
  const clock = withClock ? await installFakeClock(page) : null;
  await gotoMedia(page);
  await openRemote(page, A, vp);
  const panel = page.getByTestId('peek-panel');
  await expect(panel.locator('.queue-count')).toContainText('3 items', { timeout: 30000 });
  return { receiver, context, page, clock, panel, done: async () => { await stopReceiver(request, A); await context.close(); await receiver.context.close(); } };
}

test('(STEER.8a/AC3, remote) removing an item or clearing the queue on another screen offers Undo, and Undo puts it back', async ({ browser, request }) => {
  const { page, panel, done } = await remoteQueueSetup(browser, request, false);
  const faithRow = panel.locator('[data-testid^="queue-item-"]').filter({ hasText: 'Faith' });
  const faithId = (await faithRow.getAttribute('data-testid')).replace('queue-item-', '');
  await panel.getByTestId(`queue-remove-${faithId}`).click();
  await expect.poll(() => queueIds(request), { timeout: 30000 }).toEqual([ITEM.DISCLOSURE, ITEM.HOSPITAL]);
  await expect(page.getByTestId('item-action-undo').last()).toBeVisible({ timeout: 30000 });
  await page.getByTestId('item-action-undo').last().click();
  await expect.poll(() => queueIds(request), { timeout: 30000 }).toEqual([ITEM.DISCLOSURE, ITEM.HOSPITAL, ITEM.FAITH]);
  await panel.getByTestId('queue-clear').click();
  await expect.poll(() => queueIds(request).then((ids) => ids.length), { timeout: 30000 }).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('item-action-undo').last()).toBeVisible({ timeout: 30000 });
  await done();
});

for (const edit of ['clear', 'remove']) {
  test(`[STEER.8a/AC3] the Undo offered after ${edit === 'clear' ? 'clearing' : 'removing an item from'} another screen's queue lasts 10 seconds`, async ({ browser, request }) => {
    const { page, clock, panel, done } = await remoteQueueSetup(browser, request, true);
    // The page's clock keeps flowing between jumps, so measure from the tap itself rather than assuming how much of the
    // window the network round trip used: still there at 9 s after the tap, gone just after 10 s.
    const tapped = await clock.now();
    if (edit === 'clear') await panel.getByTestId('queue-clear').click();
    else {
      const faithRow = panel.locator('[data-testid^="queue-item-"]').filter({ hasText: 'Faith' });
      const faithId = (await faithRow.getAttribute('data-testid')).replace('queue-item-', '');
      await panel.getByTestId(`queue-remove-${faithId}`).click();
    }
    const undo = page.getByTestId('item-action-undo');
    await expect(undo.last()).toBeVisible({ timeout: 30000 });
    const elapsed = (await clock.now()) - tapped;
    expect(elapsed, 'the Undo appeared well inside its window').toBeLessThan(8_000);
    await clock.advance(tapped + 9_000 - (await clock.now()));
    await expect(undo.last()).toBeVisible();
    await clock.advance(tapped + 10_500 - (await clock.now()));
    await expect(undo).toHaveCount(0);
    await done();
  });
}

async function localQueue(page, vp, titles) {
  // Play the first title here, then line up the rest the ordinary way (search -> More -> Add to Queue).
  for (const [index, [id, text]] of titles.entries()) {
    const input = await openSearch(page, vp);
    await input.fill('');
    await input.fill(text);
    await expect(resultRow(page, vp, id)).toBeVisible({ timeout: 40000 });
    if (index === 0) await resultRow(page, vp, id).click();
    else {
      await page.getByTestId(`result-more-${id}`).click();
      await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
    }
    await closeSearch(page, vp);
  }
}

test('[STEER.9a/AC1][STEER.9a/AC2][STEER.9a/AC4] on this device repeat and shuffle appear once beside the queue and show whether they are on; they never interrupt what is playing; shuffle leaves the current and "next" items alone and turning it off restores the original order', async ({ browser }) => {
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await localQueue(page, vp, [[ITEM.HOSPITAL, 'Hospital'], [ITEM.KEEPY, 'Keepy Uppy'], [ITEM.FAITH, 'Faith'], ['plex:665638', 'Countdown'], ['plex:665639', 'Red Coast'], ['plex:703558', 'Anatomy of a Fall']]);
  // One placed "next" (Play Next on Arrival): right behind what is playing.
  const input = await openSearch(page, vp);
  await input.fill('Arrival');
  await expect(resultRow(page, vp, ITEM.ARRIVAL)).toBeVisible({ timeout: 40000 });
  await page.getByTestId(`result-more-${ITEM.ARRIVAL}`).click();
  await page.getByRole('menuitem', { name: 'Play Next', exact: true }).click();
  await closeSearch(page, vp);
  await page.getByTestId('mini-player-open-nowplaying').click();
  const view = page.getByTestId('now-playing-view');
  const queue = view.getByTestId('queue-panel');
  await expect(queue.locator('.queue-count')).toContainText('7 items', { timeout: 30000 });
  const video = view.getByTestId('now-playing-host').locator('video');
  await expect.poll(() => video.evaluate((v) => !v.paused && v.readyState >= 2 && v.currentTime > 2), { timeout: 120000 }).toBe(true);
  const node = await video.elementHandle();
  const order = () => queue.locator('[data-testid^="queue-item-"] .queue-item-title').allInnerTexts().then((ts) => ts.map((t) => t.replace(/^\d+\./, '').trim()));
  await expect(queue.getByTestId('queue-shuffle')).toHaveCount(1);
  await expect(queue.getByTestId('queue-repeat')).toHaveCount(1);
  await expect(queue.getByTestId('queue-shuffle')).toHaveAttribute('aria-pressed', 'false');
  await expect(queue.getByTestId('queue-repeat')).toContainText('Repeat off');
  const original = await order();
  expect(original.slice(0, 2)).toEqual(['Hospital', 'Arrival']);
  await queue.getByTestId('queue-shuffle').click();
  await expect(queue.getByTestId('queue-shuffle')).toHaveAttribute('aria-pressed', 'true');
  const shuffled = await order();
  expect(shuffled.slice(0, 2), 'the current item and the one placed next never move').toEqual(original.slice(0, 2));
  expect([...shuffled].sort()).toEqual([...original].sort());
  await queue.getByTestId('queue-shuffle').click();
  await expect(queue.getByTestId('queue-shuffle')).toHaveAttribute('aria-pressed', 'false');
  expect(await order()).toEqual(original);
  await queue.getByTestId('queue-repeat').click();
  await expect(queue.getByTestId('queue-repeat')).toContainText('Repeat all');
  await queue.getByTestId('queue-repeat').click();
  await expect(queue.getByTestId('queue-repeat')).toContainText(/one/i);
  await queue.getByTestId('queue-repeat').click();
  await expect(queue.getByTestId('queue-repeat')).toContainText('Repeat off');
  expect(await node.evaluate((v) => v.isConnected && !v.paused), 'none of it interrupted playback').toBe(true);
  await page.getByTestId('np-stop').click();
  await context.close();
});

test('[STEER.9a/AC3] shuffle and repeat behave the same for another screen: they take effect on that screen, show whether they are on, and never interrupt what is playing', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  await startOn(request, A, ITEM.DISCLOSURE, { queue: [ITEM.HOSPITAL, ITEM.KEEPY, ITEM.FAITH] });
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await openRemote(page, A, vp);
  const panel = page.getByTestId('peek-panel');
  await expect(panel.locator('.queue-count')).toContainText('4 items', { timeout: 30000 });
  const listed = await queueIds(request);
  const video = receiver.page.locator('video').first();
  const node = await video.elementHandle();
  await panel.getByTestId('queue-shuffle').click();
  await expect.poll(async () => (await receiverState(request, A)).config.shuffle, { timeout: 15000 }).toBe(true);
  await expect(panel.getByTestId('queue-shuffle')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
  expect(await queueIds(request), 'shuffle leaves the listed order and what is playing alone').toEqual(listed);
  await panel.getByTestId('queue-shuffle').click();
  await expect.poll(async () => (await receiverState(request, A)).config.shuffle, { timeout: 15000 }).toBe(false);
  await expect(panel.getByTestId('queue-shuffle')).toHaveAttribute('aria-pressed', 'false', { timeout: 15000 });
  expect(await queueIds(request), 'turning it off restores the original order').toEqual(listed);
  for (const [label, mode] of [['Repeat all', 'all'], ['one', 'one'], ['Repeat off', 'off']]) {
    await panel.getByTestId('queue-repeat').click();
    await expect.poll(async () => (await receiverState(request, A)).config.repeat, { timeout: 15000 }).toBe(mode);
    await expect(panel.getByTestId('queue-repeat')).toContainText(label === 'one' ? /one/i : label);
  }
  expect((await receiverState(request, A)).state, 'none of it interrupted the screen').toBe('playing');
  expect(await node.evaluate((v) => v.isConnected && !v.paused), 'the screen kept the same playing video').toBe(true);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

for (const [label, vp] of Object.entries(VIEWPORTS)) {
  test(`[STEER.5a/AC1] ${label}: volume changes in steps with big targets and shows its level`, async ({ browser }) => {
    const { context, page } = await newAppPage(browser, vp);
    await gotoMedia(page);
    const input = await openSearch(page, vp);
    await input.fill('Hospital');
    await resultRow(page, vp, ITEM.HOSPITAL).click();
    await closeSearch(page, vp);
    await page.getByTestId('mini-player-open-nowplaying').click();
    const view = page.getByTestId('now-playing-view');
    const video = view.getByTestId('now-playing-host').locator('video');
    await expect.poll(() => video.evaluate((v) => v.readyState >= 2), { timeout: 120000 }).toBe(true);
    const level = async () => Number((await view.getByTestId('np-volume-level').innerText()).replace('%', ''));
    const up = view.getByRole('button', { name: 'Increase volume' });
    const down = view.getByRole('button', { name: 'Decrease volume' });
    for (const b of [up, down]) {
      const box = await b.boundingBox();
      expect(Math.min(box.width, box.height), 'large tap target').toBeGreaterThanOrEqual(36);
    }
    const before = await level();
    await down.click();
    await expect.poll(level).toBeLessThan(before);
    const lowered = await level();
    await expect.poll(() => video.evaluate((v) => Math.round(v.volume * 100))).toBe(lowered);
    await up.click();
    await expect.poll(level).toBeGreaterThan(lowered);
    await view.getByTestId('np-stop').click();
    await context.close();
  });
}

test('[STEER.5a/AC3] volume on another screen changes that screen, not this device', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  await startOn(request, A, ITEM.HOSPITAL);
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await openRemote(page, A, vp);
  const before = (await receiverState(request, A)).config.volume;
  await page.getByTestId('peek-panel').getByRole('button', { name: 'Decrease volume' }).click();
  await expect.poll(async () => (await receiverState(request, A)).config.volume, { timeout: 15000 }).toBeLessThan(before);
  const after = (await receiverState(request, A)).config.volume;
  // It is the screen's own video that got quieter, and nothing played on this device.
  await expect.poll(() => receiver.page.locator('video').first().evaluate((v) => Math.round(v.volume * 100)), { timeout: 15000 }).toBe(after);
  await expect(page.getByTestId('media-mini-player').getByTestId('mini-toggle')).toHaveCount(0);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

// STEER.1a/AC1 — the handle, in every part of the app.
for (const [label, vp] of Object.entries(VIEWPORTS)) {
  test(`[STEER.1a/AC1] ${label}: while something plays here, a compact handle with title, picture, progress and play/pause is visible in every part of the app`, async ({ browser }) => {
    const { context, page } = await newAppPage(browser, vp);
    await gotoMedia(page);
    const input = await openSearch(page, vp);
    await input.fill('Hospital');
    await resultRow(page, vp, ITEM.HOSPITAL).click();
    await page.keyboard.press('Escape');
    if (vp.width < 600) { await page.getByTestId('search-mode-close').click().catch(() => {}); }
    const handle = page.getByTestId('media-mini-player');
    const expectHandle = async (where) => {
      await expect(handle, `handle at ${where}`).toBeVisible({ timeout: 40000 });
      await expect(handle, `handle title at ${where}`).toContainText('Hospital');
      // The picture is the item's poster (a background of the dock, or an img for artwork-only items).
      const pictures = await handle.locator('img:not([src^="data:"]), [style*="background-image"]').count();
      expect(pictures, `handle picture at ${where}`).toBeGreaterThan(0);
      await expect(handle.locator('.mini-player-progress'), `handle progress at ${where}`).toBeAttached();
      await expect(handle.getByTestId('mini-progress'), `handle progress fill at ${where}`).toBeAttached();
      await expect(handle.getByTestId('mini-toggle'), `handle play/pause at ${where}`).toBeVisible();
    };
    await expectHandle('home');
    await goArea(page, vp, 'browse');
    await expectHandle('browse');
    await goArea(page, vp, 'fleet');
    await expectHandle('devices');
    // The details step is a full page load, so the handle comes back from the
    // persisted session: wait until that record carries the item's duration.
    await expect.poll(() => page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('media-app.session'))?.snapshot?.currentItem?.duration ?? 0; } catch { return 0; }
    }), { timeout: 40000, message: 'persisted session carries the duration' }).toBeGreaterThan(0);
    await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ITEM.ARRIVAL)}`);
    await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
    await expectHandle('details');
    await openSearch(page, vp);
    await expect(page.getByTestId('mini-toggle').first()).toBeAttached();
    await context.close();
  });
}

// STEER.3a/AC3 — every press reflects within 2 seconds, or says it has not happened yet.
test('(STEER.3a/AC3, transport) after a press on another screen\'s transport controls, the control reflects the change within 2 seconds or says it is still pending', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  await startOn(request, A, ITEM.DISCLOSURE, { queue: [ITEM.HOSPITAL, ITEM.KEEPY] });
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await openRemote(page, A, vp);
  const panel = page.getByTestId('peek-panel');
  await expect(panel.locator('.queue-count')).toContainText('3 items', { timeout: 30000 });
  const signature = () => page.evaluate(() => {
    const q = (s) => document.querySelector(`[data-testid="peek-panel"] ${s}`);
    return JSON.stringify({
      toggle: q('[data-testid="np-toggle"]')?.getAttribute('aria-label') ?? q('[data-testid="np-toggle"]')?.textContent,
      status: q('.peek-status')?.textContent, pending: q('.peek-status')?.getAttribute('data-pending'),
      title: q('.peek-status')?.textContent,
      volume: q('[data-testid="np-volume-level"]')?.textContent,
      shuffle: q('[data-testid="queue-shuffle"]')?.getAttribute('aria-pressed'),
      repeat: q('[data-testid="queue-repeat"]')?.textContent,
      current: q('.queue-item--current, [aria-current="true"]')?.textContent,
      busy: [...document.querySelectorAll('[data-testid="peek-panel"] button[disabled]')].length,
      feedback: q('[data-testid="np-command-feedback"]')?.textContent,
      pos: q('[data-testid="np-seek"]')?.getAttribute('aria-valuenow'),
    });
  });
  const reflects = async (name, press) => {
    const before = await signature();
    const t0 = Date.now();
    await press();
    let changed = false;
    while (Date.now() - t0 < 2000) {
      if ((await signature()) !== before) { changed = true; break; }
      await page.waitForTimeout(100);
    }
    expect(changed, `${name}: nothing changed (and nothing said "pending") within 2 s`).toBe(true);
  };
  await reflects('Pause', () => panel.getByTestId('np-toggle').click());
  await reflects('Play', () => panel.getByTestId('np-toggle').click());
  await reflects('Forward 10 seconds', () => panel.getByTestId('np-ffw').click());
  await reflects('Next', () => panel.getByTestId('np-next').click());
  await reflects('Stop', () => panel.getByTestId('np-stop').click());
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

// STEER.5a/AC2 — speed.
test('[STEER.5a/AC2] speed can be changed for video and for audio on this device; another screen that cannot says so', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  const input = await openSearch(page, vp);
  for (const [id, text, kind] of [[ITEM.HOSPITAL, 'Hospital', 'video'], [ITEM.FAITH, 'Faith', 'audio']]) {
    await input.fill('');
    await input.fill(text);
    await expect(resultRow(page, vp, id)).toBeVisible({ timeout: 90000 });
    await resultRow(page, vp, id).click();
    await closeSearch(page, vp);
    await page.getByTestId('mini-player-open-nowplaying').click();
    // The host can render more than one media node of a kind (an audio node that is not the one playing); the rate must
    // change on the node that is actually playing, so find it rather than assuming it is the first.
    const nodes = page.getByTestId('now-playing-host').locator(kind);
    const playingIndex = () => nodes.evaluateAll((els) => els.findIndex((m) => !m.paused && m.readyState >= 2 && m.currentTime > 0));
    await expect.poll(playingIndex, { timeout: 180000, message: `one rendered ${kind} node must be actual local playback` }).toBeGreaterThanOrEqual(0);
    const media = nodes.nth(await playingIndex());
    const before = await media.evaluate((m) => m.playbackRate);
    await page.getByTestId('now-playing-view').getByTestId('np-rate').click();
    await expect.poll(() => media.evaluate((m) => m.playbackRate), { timeout: 10000 }).not.toBe(before);
    await page.getByTestId('np-stop').click();
    await gotoMedia(page);
    await openSearch(page, vp);
  }
  // Another screen: the control is there, unavailable, and says why.
  const receiver = await openReceiver(browser, request, A);
  await startOn(request, A, ITEM.HOSPITAL);
  await openRemote(page, A, vp);
  await expect(page.getByTestId('peek-panel').getByTestId('np-rate')).toBeDisabled();
  await expect(page.getByTestId('peek-panel').locator('.np-control-unavailable').filter({ hasText: /speed/i }).first()).toBeVisible();
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

// STEER.6a/AC4 — Stop and turn the screen off, only where the screen can.
test('[STEER.6a/AC4] Stop also offers "and turn the screen off" on a screen with device control (and records the power-off), never on one without', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  await startOn(request, A, ITEM.HOSPITAL);
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'playing', title: 'Arrival', duration: 7000, position: 100 });
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await openHouse(page, vp);
  await expect(page.getByTestId(`fleet-stop-${A}`)).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId(`fleet-stop-more-${A}`)).toHaveCount(0);
  // The scripted screen reports over the bus like any other; wait for its row to be playing before looking for its extras.
  await expect(page.getByTestId(`fleet-stop-${SCRIPTED.POWER}`)).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId(`fleet-stop-more-${SCRIPTED.POWER}`)).toBeVisible();
  await page.getByTestId(`fleet-stop-more-${SCRIPTED.POWER}`).click();
  await page.getByTestId(`fleet-stop-off-${SCRIPTED.POWER}`).click();
  await expect.poll(async () => (await call(request, 'GET', `/api/v1/device/${SCRIPTED.POWER}/device-control-calls`)).body.calls.map((c) => c.action), { timeout: 60000 }).toContain('off');
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});
