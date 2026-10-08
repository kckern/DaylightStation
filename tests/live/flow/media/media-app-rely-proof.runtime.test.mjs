import { test, expect } from '@playwright/test';
import { resetHouseholdAt } from './lib/household.mjs';
import { scriptReceiver, failWake, SCRIPTED } from './lib/scriptedReceiver.mjs';
import {
  A, A_NAME, ITEM, VIEWPORTS, call, receiverState, openReceiver, startOn, stopReceiver, newAppPage, gotoMedia, warmMedia,
} from './lib/receivers.mjs';
import { goArea, openSearch, resultRow, closeSearch } from './lib/search.mjs';

// RELY — confirmations (one outcome vocabulary on every size), retries on
// another screen, wake step wording by kind of screen, and a quiet failure of
// a screen that cannot be woken. Outcomes are read from the tray overlay the
// person sees; no notification is faked.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block', actionTimeout: 30000 });
test.setTimeout(420000);

test.beforeAll(async ({ browser }) => { test.setTimeout(300000); await warmMedia(browser); });
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

const rows = (page) => page.locator('[data-testid^="dispatch-row-"]');
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
    await page.getByTestId('detail-add').click();
    await expect(rowWith(page, 'Added Hospital here')).toBeVisible({ timeout: 15000 });
    await page.getByTestId('detail-play-next').click();
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
  await resultRow(page, vp, ITEM.FAITH).click();
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
  // Faith is genuinely playing here, so a one-off Play on… asks whether this device stops or keeps
  // playing (PLACE.6a/AC2) and is sent by its button, not by the tile tap. Keep it playing here.
  await page.getByTestId('picker-mode-fork').click();
  await page.getByTestId('picker-submit').click();
  const far = rowWith(page, A_NAME);
  await expect(far).toBeVisible({ timeout: 30000 });
  await expect(far).not.toHaveClass(/cast-tray-row--quiet/);
  await expect(far).toContainText('Arrival');
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
    await page.getByTestId(`picker-device-${deviceId}`).click();
  };
  await sendTo(ITEM.ARRIVAL, 'Arrival', SCRIPTED.POWER);
  const failedRow = (text) => rowWith(page, text).filter({ has: page.locator('[data-phase="failed"], [data-testid^="dispatch-retry-"]') });
  await expect(rowWith(page, 'Arrival').filter({ has: page.locator('[data-testid^="dispatch-retry-"]') })).toBeVisible({ timeout: 120000 });
  await sendTo(ITEM.HOSPITAL, 'Hospital', SCRIPTED.POWER);
  await expect(rowWith(page, 'Hospital').filter({ has: page.locator('[data-testid^="dispatch-retry-"]') })).toBeVisible({ timeout: 120000 });
  void failedRow;
  // AC3: both failures are on screen, each with its own Retry.
  await expect(page.locator('[data-testid^="dispatch-retry-"]')).toHaveCount(2);
  await expect(rows(page).filter({ has: page.locator('[data-testid^="dispatch-retry-"]') })).toHaveCount(2);

  // AC2: next to Retry, choose another screen for that attempt only.
  const arrivalRow = rowWith(page, 'Arrival').filter({ has: page.locator('[data-testid^="dispatch-elsewhere-"]') });
  await arrivalRow.locator('[data-testid^="dispatch-elsewhere-"]').first().click();
  await arrivalRow.locator('[data-testid^="dispatch-elsewhere-list-"]').getByRole('button', { name: new RegExp(A_NAME) }).click();
  await expect.poll(async () => (await receiverState(request, A))?.currentItem?.contentId, { timeout: 120000 }).toBe(ITEM.ARRIVAL);
  // The other failed attempt is untouched: still failed, still has its own Retry, and nothing else went to the screen chosen.
  await expect(rowWith(page, 'Hospital').locator('[data-testid^="dispatch-retry-"]')).toBeVisible();
  expect((await receiverState(request, A)).queue.items.map((i) => i.contentId)).toEqual([ITEM.ARRIVAL]);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('[RELY.2a/AC1][RELY.2a/AC3] a far screen that needs waking shows its steps in plain words, and wording fits the kind of screen (a speaker is never a TV)', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  const sendTo = async (deviceId) => {
    const input = await openSearch(page, vp);
    await input.fill('');
    await input.fill('Arrival');
    await expect(resultRow(page, vp, ITEM.ARRIVAL)).toBeVisible({ timeout: 40000 });
    await page.getByTestId(`result-more-${ITEM.ARRIVAL}`).click();
    await page.getByRole('menuitem', { name: 'Play on…', exact: true }).click();
    await page.getByTestId(`picker-device-${deviceId}`).click();
  };
  // The den TV has (virtual) device control: it is woken, and the person reads the steps.
  const seen = new Set();
  await page.exposeFunction('__noteTray', (text) => seen.add(text));
  await page.evaluate(() => {
    new MutationObserver(() => {
      for (const row of document.querySelectorAll('[data-testid^="dispatch-row-"]')) window.__noteTray(row.innerText.replace(/\s+/g, ' '));
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await sendTo(SCRIPTED.POWER);
  await expect.poll(() => [...seen].join(' | '), { timeout: 90000 }).toMatch(/Turning on TV/);
  await expect.poll(() => [...seen].join(' | '), { timeout: 90000 }).toMatch(/Starting playback|Getting ready|Loading/);
  const wake = await call(request, 'GET', `/api/v1/device/${SCRIPTED.POWER}/device-control-calls`);
  expect(wake.body.calls.some((c) => c.action === 'on')).toBe(true);
  // A speaker is never called a TV, in progress or in failure.
  seen.clear();
  await sendTo(SCRIPTED.SPEAKER);
  await expect.poll(() => [...seen].filter((t) => /speaker/i.test(t)).length, { timeout: 90000 }).toBeGreaterThan(0);
  expect([...seen].filter((t) => /speaker/i.test(t)).every((t) => !/\bTV\b/.test(t)), [...seen].join(' | ')).toBe(true);
  await context.close();
});
