import { test, expect } from '@playwright/test';
import { resetHouseholdAt } from './lib/household.mjs';
import { scriptReceiver, failWake, SCRIPTED } from './lib/scriptedReceiver.mjs';
import {
  A, A_NAME, ITEM, VIEWPORTS, call, receiverState, openReceiver, startOn, stopReceiver, newAppPage, gotoMedia, warmMedia, startOutcome,
} from './lib/receivers.mjs';
import { goArea, openSearch, resultRow, closeSearch, detailVerb, playResult, showAllRows } from './lib/search.mjs';

// RELY — confirmations (one outcome vocabulary on every size), retries on
// another screen, wake step wording by kind of screen, and a quiet failure of
// a screen that cannot be woken. Outcomes are read from the tray overlay the
// person sees; no notification is faked.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block', actionTimeout: 30000 });
test.setTimeout(420000);

test.beforeAll(async ({ browser }) => { test.setTimeout(300000); await warmMedia(browser); });
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

const rows = (page) => page.locator('[data-testid^="dispatch-row-"]');
// The newest start on a screen reads on the screen handle (Starting, Playing,
// Retry); the tray keeps the older ones. Either carries that start's Retry.
const RETRY = '[data-testid^="dispatch-retry-"], [data-testid="screen-handle-retry"]';
const rowWith = (page, text) => rows(page).filter({ hasText: text });
const OFFLINE = 'acceptance-offline';

async function moreMenu(page, vp, id, name) {
  await page.getByTestId(`result-more-${id}`).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

for (const [label, vp] of Object.entries(VIEWPORTS)) {
  test(`[RELY.1a/AC2][RELY.1a/AC3][RELY.1a/AC4] ${label}: every change to what is lined up confirms by naming the item (and where), the same way whichever control did it; local confirmations are quiet, brief, and a newer one replaces an older one of the same kind`, async ({ browser }) => {
    const { context, page } = await newAppPage(browser, vp);
    await gotoMedia(page);
    const input = await openSearch(page, vp);

    // Add (held queue, nothing plays): "Added <item> here", quiet.
    await input.fill('Arrival');
    await expect(resultRow(page, vp, ITEM.ARRIVAL)).toBeVisible({ timeout: 40000 });
    await moreMenu(page, vp, ITEM.ARRIVAL, 'Add to Queue');
    const first = rowWith(page, 'Added Arrival here');
    await expect(first).toBeVisible({ timeout: 15000 });
    await expect(first).toHaveClass(/cast-tray-row--quiet/);
    // AC4: a newer confirmation of the same kind replaces the older one; they do not pile up.
    await input.fill('');
    await input.fill('Disclosure Day');
    await expect(resultRow(page, vp, ITEM.DISCLOSURE)).toBeVisible({ timeout: 40000 });
    await moreMenu(page, vp, ITEM.DISCLOSURE, 'Add to Queue');
    await expect(rowWith(page, 'Added Disclosure Day here')).toBeVisible({ timeout: 15000 });
    await expect(rowWith(page, 'Added Arrival here')).toHaveCount(0);
    await expect(rows(page).filter({ hasText: /^.*Added /i })).toHaveCount(1);

    // AC2: the same outcome reads the same from another control (details) at this size.
    await closeSearch(page, vp);
    await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ITEM.HOSPITAL)}`);
    await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
    await detailVerb(page, 'detail-add');
    await expect(rowWith(page, 'Added Hospital here')).toBeVisible({ timeout: 15000 });
    await detailVerb(page, 'detail-play-next');
    await expect(rowWith(page, 'Hospital plays next here')).toBeVisible({ timeout: 15000 });

    // Queue edits confirm too: remove, undo (put back), clear.
    if (vp.width < 600) await page.getByTestId('media-mini-player').getByTestId('mini-player-open-nowplaying').click();
    else await page.getByTestId('mini-player-open-nowplaying').click();
    const queue = page.getByTestId('queue-panel');
    await expect(queue).toBeVisible({ timeout: 30000 });
    const removeButtons = queue.locator('[data-testid^="queue-remove-"]');
    const countBefore = await removeButtons.count();
    expect(countBefore).toBeGreaterThanOrEqual(3);
    await removeButtons.last().click();
    await expect(rowWith(page, /Removed .* from the queue here/)).toBeVisible({ timeout: 15000 });
    await page.getByTestId('item-action-undo').last().click();
    await expect(removeButtons).toHaveCount(countBefore, { timeout: 15000 });
    // RELY.1a/AC1: the Undo is itself an action on the queue and confirms on its own.
    await expect(rowWith(page, /Put back .* here/)).toBeVisible({ timeout: 15000 });
    await page.getByTestId('queue-clear').click();
    await expect(rowWith(page, 'Cleared the queue here')).toBeVisible({ timeout: 15000 });
    // Undo of a Clear confirms in its own words, and the queue is back.
    await page.getByTestId('item-action-undo').last().click();
    await expect(rowWith(page, 'Put the queue back here')).toBeVisible({ timeout: 15000 });
    await expect(removeButtons).toHaveCount(countBefore, { timeout: 15000 });
    await page.getByTestId('queue-clear').click();
    await expect(rowWith(page, 'Cleared the queue here')).toBeVisible({ timeout: 15000 });
    // AC3: quiet and brief: it leaves on its own.
    await expect(rowWith(page, 'Cleared the queue here')).toHaveCount(0, { timeout: 20000 });
    await context.close();
  });
}

test('[RELY.1a/AC5][PLAY.1a/AC3] playing here confirms quietly; playing on another screen confirms with that screen\'s name and its progress steps', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  const input = await openSearch(page, vp);
  // Here.
  await input.fill('Faith');
  // Selecting the row opens its info view; PLAY plays it (music, nothing aimed: here).
  await playResult(page, resultRow(page, vp, ITEM.FAITH));
  const here = rowWith(page, 'Playing Faith here');
  await expect(here).toBeVisible({ timeout: 30000 });
  await expect(here).toHaveClass(/cast-tray-row--quiet/);
  // Another screen: its name, and the steps it goes through. Wait until Faith really plays here first.
  await expect(page.getByTestId('mini-toggle')).toHaveAttribute('aria-label', 'Pause', { timeout: 60000 });
  await input.fill('');
  await input.fill('Arrival');
  await expect(resultRow(page, vp, ITEM.ARRIVAL)).toBeVisible({ timeout: 40000 });
  await page.getByTestId(`result-more-${ITEM.ARRIVAL}`).click();
  await page.getByRole('menuitem', { name: 'Play on…', exact: true }).click();
  await page.getByTestId(`picker-device-${A}`).click();
  // The calm picker sends on the tap (1d3e9e087d) and keeps this device playing.
  const far = startOutcome(page, { screen: A_NAME, title: 'Arrival' });
  await expect(far).toBeVisible({ timeout: 30000 });
  await expect(far).not.toHaveClass(/cast-tray-row--quiet/);
  await expect(page.getByTestId('media-mini-player')).toContainText('Faith');
  await expect(far).toContainText(/Sending|Sent to|Starting playback|Playing on/);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('[RELY.6a/AC2][RELY.6a/AC3] a failed send offers Retry and "Another screen…" for that attempt only; several failures are each shown separately with their own retry', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  // The den TV does not come on: a send to it fails outright (a failed attempt, not a "may not have started").
  await failWake(request, SCRIPTED.POWER, true);
  const sendTo = async (id, text, deviceId) => {
    const input = await openSearch(page, vp);
    await input.fill('');
    await input.fill(text);
    await expect(resultRow(page, vp, id)).toBeVisible({ timeout: 40000 });
    await page.getByTestId(`result-more-${id}`).click();
    await page.getByRole('menuitem', { name: 'Play on…', exact: true }).click();
    // The picker leads with three screens; the rest sit behind its More (k).
    await expect(page.locator('[data-testid^="picker-device-"]').first()).toBeVisible({ timeout: 15000 });
    await showAllRows(page, 'picker');
    await page.getByTestId(`picker-device-${deviceId}`).click();
  };
  const DEN = 'Acceptance den TV';
  const failed = (title) => startOutcome(page, { screen: DEN, title }).filter({ has: page.locator(RETRY) });
  await sendTo(ITEM.ARRIVAL, 'Arrival', SCRIPTED.POWER);
  await expect(failed('Arrival')).toBeVisible({ timeout: 120000 });
  await sendTo(ITEM.HOSPITAL, 'Hospital', SCRIPTED.POWER);
  await expect(failed('Hospital')).toBeVisible({ timeout: 120000 });
  // AC3: both failures are on screen, each with its own Retry (the newer on the
  // screen handle, the older in the tray).
  await expect(page.locator(RETRY)).toHaveCount(2);
  await expect(failed('Arrival')).toHaveCount(1);

  // AC2: next to Retry, choose another screen for that attempt only.
  const arrivalRow = rowWith(page, 'Arrival').filter({ has: page.locator('[data-testid^="dispatch-elsewhere-"]') });
  await arrivalRow.locator('[data-testid^="dispatch-elsewhere-"]').first().click();
  await arrivalRow.locator('[data-testid^="dispatch-elsewhere-list-"]').getByRole('button', { name: new RegExp(A_NAME) }).click();
  await expect.poll(async () => (await receiverState(request, A))?.currentItem?.contentId, { timeout: 120000 }).toBe(ITEM.ARRIVAL);
  // The other failed attempt is untouched: still failed, still has its own Retry, and nothing else went to the screen chosen.
  await expect(failed('Hospital').locator(RETRY)).toBeVisible();
  expect((await receiverState(request, A)).queue.items.map((i) => i.contentId)).toEqual([ITEM.ARRIVAL]);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('[RELY.2a/AC1][RELY.2a/AC3] a far screen that needs waking shows its steps in plain words, and wording fits the kind of screen (a speaker is never a TV)', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  // A speaker plays sound only (it is never offered a film): it gets Faith.
  const sendTo = async (deviceId, [id, text] = [ITEM.ARRIVAL, 'Arrival']) => {
    const input = await openSearch(page, vp);
    await input.fill('');
    await input.fill(text);
    await expect(resultRow(page, vp, id)).toBeVisible({ timeout: 40000 });
    await page.getByTestId(`result-more-${id}`).click();
    await page.getByRole('menuitem', { name: 'Play on…', exact: true }).click();
    // The picker leads with three screens; the rest sit behind its More (k).
    await expect(page.locator('[data-testid^="picker-device-"]').first()).toBeVisible({ timeout: 15000 });
    await showAllRows(page, 'picker');
    await page.getByTestId(`picker-device-${deviceId}`).click();
  };
  // The den TV has (virtual) device control: it is woken, and the person reads the steps.
  const seen = new Set();
  await page.exposeFunction('__noteTray', (text) => seen.add(text));
  await page.evaluate(() => {
    new MutationObserver(() => {
      // The tray's rows and the screen handle, which carries the newest start's steps.
      for (const row of document.querySelectorAll('[data-testid^="dispatch-row-"], [data-testid="screen-handle"]')) window.__noteTray(row.innerText.replace(/\s+/g, ' '));
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await sendTo(SCRIPTED.POWER);
  await expect.poll(() => [...seen].join(' | '), { timeout: 90000 }).toMatch(/Turning on TV/);
  await expect.poll(() => [...seen].join(' | '), { timeout: 90000 }).toMatch(/Starting playback|Getting ready|Loading/);
  const wake = await call(request, 'GET', `/api/v1/device/${SCRIPTED.POWER}/device-control-calls`);
  expect(wake.body.calls.some((c) => c.action === 'on')).toBe(true);
  // A speaker is never called a TV, in progress or in failure.
  seen.clear();
  await sendTo(SCRIPTED.SPEAKER, [ITEM.FAITH, 'Faith']);
  await expect.poll(() => [...seen].filter((t) => /speaker/i.test(t)).length, { timeout: 90000 }).toBeGreaterThan(0);
  expect([...seen].filter((t) => /speaker/i.test(t)).every((t) => !/\bTV\b/.test(t)), [...seen].join(' | ')).toBe(true);
  await context.close();
});
