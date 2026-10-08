import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resetHouseholdAt } from './lib/household.mjs';
import { scriptReceiver, SCRIPTED } from './lib/scriptedReceiver.mjs';
import {
  A, A_NAME, ITEM, VIEWPORTS, call, receiverState, openReceiver, startOn, stopReceiver, resetControls,
  newAppPage, gotoMedia, warmMedia, openRemote,
} from './lib/receivers.mjs';
import { openSearch, resultRow, closeSearch } from './lib/search.mjs';

// PLACE 6/7/8 — moving playback between this device and a screen, and the
// aim label that says what the next tap will do. Real mounted receiver; a
// scripted screen that cannot be reached for the failed move.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block', actionTimeout: 30000 });
test.setTimeout(420000);

test.beforeAll(async ({ browser }) => { test.setTimeout(300000); await warmMedia(browser); });
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

const vp = VIEWPORTS.laptop;
const rowWith = (page, text) => page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: text });

async function playHere(page, id, text) {
  const input = await openSearch(page, vp);
  await input.fill('');
  await input.fill(text);
  await expect(resultRow(page, vp, id)).toBeVisible({ timeout: 40000 });
  await resultRow(page, vp, id).click();
  await closeSearch(page, vp);
  await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText(text, { timeout: 40000 });
}

async function addHere(page, id, text) {
  const input = await openSearch(page, vp);
  await input.fill('');
  await input.fill(text);
  await expect(resultRow(page, vp, id)).toBeVisible({ timeout: 40000 });
  await page.getByTestId(`result-more-${id}`).click();
  await page.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
  await closeSearch(page, vp);
}

async function aimAt(page, deviceId) {
  await page.getByTestId('cast-target-chip').click();
  await page.getByTestId(`cast-target-checkbox-${deviceId}`).check();
  await page.getByTestId('cast-target-chip').click();
  await expect(page.getByTestId('cast-popover')).toBeHidden();
}

test('[PLACE.7a/AC2] Move to this device from another screen\'s controls: this device starts the same item at the same moment with the same queue, the other screen stops, and a confirmation says it moved', async ({ browser, request }) => {
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  await startOn(request, A, ITEM.HOSPITAL, { queue: [ITEM.KEEPY] });
  await expect.poll(async () => (await receiverState(request, A))?.position, { timeout: 60000 }).toBeGreaterThan(4);
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await openRemote(page, A, vp);
  const atMove = (await receiverState(request, A)).position;
  await page.getByTestId('peek-move-to').click();
  await page.getByTestId('move-to-local').click();
  // Same item, same moment, same queue here.
  await expect(page.getByTestId('now-playing-view')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('now-playing-title')).toHaveAttribute('data-content-id', ITEM.HOSPITAL);
  const local = page.getByTestId('now-playing-host').locator('video');
  await expect.poll(() => local.evaluate((node) => (node.readyState >= 1 ? node.currentTime : -1)), { timeout: 120000 })
    .toBeGreaterThanOrEqual(Math.max(0, atMove - 3));
  const queue = page.getByTestId('queue-panel');
  await expect(queue.locator('[data-testid^="queue-item-"] .queue-item-title')).toHaveText([/Hospital/, /Keepy Uppy/], { timeout: 30000 });
  // The other screen stopped.
  await expect.poll(async () => (await receiverState(request, A))?.currentItem?.contentId ?? null, { timeout: 60000 }).toBeNull();
  // A confirmation: it moved, and from where.
  const moved = rowWith(page, 'Moved Hospital here');
  await expect(moved).toBeVisible({ timeout: 30000 });
  // PLACE.7a/AC3 "and from where": it names the screen it came from.
  await expect(moved).toContainText(`from ${A_NAME}`);
  await page.getByTestId('np-stop').click();
  await context.close();
  await receiver.context.close();
});

test('[PLACE.7a/AC4] if a move cannot happen I am told why and the other screen keeps playing', async ({ browser, request }) => {
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'playing', title: 'Arrival', duration: 7000, position: 100 });
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await openRemote(page, SCRIPTED.POWER, vp);
  await page.getByTestId('peek-move-to').click();
  await page.getByTestId('move-to-local').click();
  const failed = rowWith(page, /Couldn.t move Arrival here/);
  await expect(failed).toBeVisible({ timeout: 90000 });
  await expect(failed).toContainText(/can.t hand over|respond|reach|asleep|closed|offline|didn.t/i);
  // The other screen kept playing; nothing started here.
  expect((await receiverState(request, SCRIPTED.POWER)).state).toBe('playing');
  expect(await page.locator('video').count()).toBe(0);
  await context.close();
});

test('[PLACE.7a/AC5] a photo slideshow moves with its place; a screen playing it is left stopped', async ({ browser, request }) => {
  const receiver = await openReceiver(browser, request, A);
  const loaded = await call(request, 'GET', `/api/v1/device/${A}/load?queue=fixture:slideshow&dispatchId=${randomUUID()}`);
  expect(loaded.status).toBe(200);
  await expect.poll(async () => (await receiverState(request, A))?.currentItem?.contentId, { timeout: 90000 }).toMatch(/^fixture:/);
  const before = await receiverState(request, A);
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await openRemote(page, A, vp);
  await page.getByTestId('peek-move-to').click();
  await page.getByTestId('move-to-local').click();
  await expect(page.getByTestId('now-playing-view')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('now-playing-title')).toHaveAttribute('data-content-id', before.currentItem.contentId, { timeout: 60000 });
  await expect.poll(async () => (await receiverState(request, A))?.currentItem?.contentId ?? null, { timeout: 60000 }).toBeNull();
  await context.close();
  await receiver.context.close();
});

async function handoffSetup(browser, request) {
  const receiver = await openReceiver(browser, request, A);
  await resetControls(request, A);
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await playHere(page, ITEM.HOSPITAL, 'Hospital');
  await addHere(page, ITEM.KEEPY, 'Keepy Uppy');
  await page.getByTestId('mini-player-open-nowplaying').click();
  const local = page.getByTestId('now-playing-host').locator('video');
  await expect.poll(() => local.evaluate((v) => !v.paused && v.readyState >= 2 && v.currentTime > 5), { timeout: 120000 }).toBe(true);
  const picker = page.getByTestId('handoff-section').getByTestId('dispatch-target-picker');
  await expect(picker).toBeVisible();
  await picker.getByTestId(`picker-device-${A}`).click();
  return { receiver, context, page, local, picker };
}

test('[PLACE.8a/AC4] hand-off from Now Playing with "Keep playing here too": the chosen screen starts the same item with the same queue, this device carries on, and the outcome is named', async ({ browser, request }) => {
  const { receiver, context, page, local, picker } = await handoffSetup(browser, request);
  const spot = await local.evaluate((v) => v.currentTime);
  await picker.getByTestId('picker-mode-fork').click();
  await picker.getByTestId('picker-submit').click();
  await expect.poll(async () => {
    const s = await receiverState(request, A);
    return s?.currentItem?.contentId === ITEM.HOSPITAL ? s.queue.items.map((i) => i.contentId).join(',') : null;
  }, { timeout: 120000 }).toBe([ITEM.HOSPITAL, ITEM.KEEPY].join(','));
  // "At the same moment" (PLACE.8a/AC2): the screen's copy is playing from the local spot from its FIRST playing
  // report, not from 0:00 (a copy that restarted would take `spot` seconds to get there).
  let firstPlaying = null;
  await expect.poll(async () => {
    const s = await receiverState(request, A);
    if (s?.state === 'playing' && s?.currentItem?.contentId === ITEM.HOSPITAL && Number.isFinite(s.position)) firstPlaying ??= s.position;
    return firstPlaying !== null;
  }, { timeout: 60000 }).toBe(true);
  const hereNow = await local.evaluate((v) => v.currentTime);
  expect(firstPlaying, `screen first played at ${Math.round(firstPlaying)} s; local spot was ${Math.round(spot)} s`).toBeGreaterThanOrEqual(spot - 3);
  expect(Math.abs(firstPlaying - hereNow), 'and is within seconds of where this device is now').toBeLessThanOrEqual(20);
  // The screen page's own video element agrees: it is playing from the spot, not from the start.
  const screenVideo = receiver.page.locator('video').first();
  await expect.poll(() => screenVideo.evaluate((v) => (v.readyState >= 2 && !v.paused ? v.currentTime : -1)), { timeout: 60000 }).toBeGreaterThanOrEqual(spot - 3);
  await expect(rowWith(page, A_NAME).first()).toBeVisible({ timeout: 20000 });
  await expect(rowWith(page, 'Hospital').first()).toBeVisible();
  // (keep) this device carries on, as chosen.
  await page.waitForTimeout(3000);
  expect(await local.evaluate((v) => !v.paused)).toBe(true);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('[PLACE.8a/AC3][PLACE.6a/AC4] hand-off from Now Playing with "Move playback" to an idle screen: the screen starts and this device stops', async ({ browser, request }) => {
  const { receiver, context, page, local, picker } = await handoffSetup(browser, request);
  await picker.getByTestId('picker-mode-transfer').click();
  await picker.getByTestId('picker-submit').click();
  await expect.poll(async () => (await receiverState(request, A))?.currentItem?.contentId, { timeout: 60000 }).toBe(ITEM.HOSPITAL);
  // This device stopped: its player is gone (or at least paused).
  await expect.poll(async () => (await local.count()) === 0 || await local.evaluate((v) => v.paused || v.ended), { timeout: 60000 }).toBe(true);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('[PLACE.6a/AC1][PLACE.6a/AC3] while this device plays and the aim is another screen, the aim label says what the next tap will do and I can change it there; my usual choice is remembered and shown before I confirm', async ({ browser, request }) => {
  const receiver = await openReceiver(browser, request, A);
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  await playHere(page, ITEM.FAITH, 'Faith');
  await aimAt(page, A);
  // Usual choice (move): said before any tap.
  const behavior = page.getByTestId('aim-behavior').first();
  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ITEM.ARRIVAL)}`);
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('aim-behavior').first()).toContainText('move playback', { timeout: 30000 });
  // Change it right there: the destination control carries the choice.
  await page.getByTestId('cast-target-chip').click();
  await expect(page.getByTestId('cast-mode-transfer')).toBeChecked();
  await page.getByTestId('cast-mode-fork').check();
  await page.getByTestId('cast-target-chip').click();
  await expect(page.getByTestId('aim-behavior').first()).toContainText('keep playing here too');
  // Remembered: still the choice after a reload, pre-selected and visible before confirming anything.
  await page.reload();
  await expect(page.getByTestId('media-shell')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('cast-target-chip').click();
  await expect(page.getByTestId('cast-mode-fork')).toBeChecked();
  await page.getByTestId('cast-target-chip').click();
  void behavior;
  await context.close();
  await receiver.context.close();
});
