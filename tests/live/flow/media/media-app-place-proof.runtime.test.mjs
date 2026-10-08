import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createHomeAssistantCaller } from '../../../_lib/media-ha-caller.mjs';
import { resetHouseholdAt, pinBrowserIdentity } from './lib/household.mjs';
import { installFakeClock } from './lib/fakeClock.mjs';
import { scriptReceiver, SCRIPTED } from './lib/scriptedReceiver.mjs';
import {
  A, B, A_NAME, B_NAME, ITEM, VIEWPORTS, receiverState, openReceiver, startOn, stopReceiver, pauseReceiver, resetControls,
  newAppPage, gotoMedia, warmMedia, openHouse,
} from './lib/receivers.mjs';
import { isPhone, goArea, openSearch, closeSearch, resultRow, searchSurface } from './lib/search.mjs';

// PLACE — where things go: the aim, Play on…, the receiver picker states, and
// the stale-screen rule. Receivers are real mounted screen pages; the screens
// no page is mounted for (den TV, speaker) are put into states with the
// scripted-receiver fixture (they publish exactly what a screen would).
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block', actionTimeout: 30000 });
test.setTimeout(420000);

test.beforeAll(async ({ browser }) => { test.setTimeout(300000); await warmMedia(browser); });
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

const AIM = 'dispatch-aim'; // marker only; the aim is read from whichever aim label the surface has
const aimNodes = (page) => page.locator('[data-testid="destination-control-name"], [data-testid="destination-line-name"], [data-testid="aim-label"]');

async function setAim(page, vp, deviceIds) {
  if (isPhone(vp)) {
    await openSearch(page, vp);
    await page.getByTestId('search-mode').getByTestId('destination-line').click();
    await expect(page.getByTestId('destination-sheet')).toBeVisible();
    const toggle = page.getByTestId('picker-multi-toggle');
    if (deviceIds.length > 1 && await toggle.isVisible().catch(() => false)) await toggle.click();
    for (const id of deviceIds) await page.getByTestId(`picker-device-${id}`).click();
    await page.getByTestId('picker-submit').click();
    await closeSearch(page, vp);
    return;
  }
  await page.getByTestId('cast-target-chip').click();
  for (const id of deviceIds) await page.getByTestId(`cast-target-checkbox-${id}`).check();
  await page.getByTestId('cast-target-chip').click();
  await expect(page.getByTestId('cast-popover')).toBeHidden();
}

for (const [label, vp] of Object.entries(VIEWPORTS)) {
  test(`[PLACE.1a/AC1] ${label}: the aim is visible on every surface that has a play or line-up action`, async ({ browser }) => {
    const { context, page } = await newAppPage(browser, vp);
    await gotoMedia(page);
    await setAim(page, vp, [A]);
    const expectAim = async (surface) => {
      await expect(aimNodes(page).filter({ hasText: A_NAME }).first(), `the aim (${A_NAME}) is on screen at ${surface}`).toBeVisible({ timeout: 30000 });
    };
    await expectAim('home');
    await goArea(page, vp, 'browse');
    await expectAim('browse');
    await page.getByTestId('browse-open-plex:').click();
    await page.locator('[data-testid^="browse-open-plex:library/sections/6/"]').first().click();
    await expect(page.locator('[data-testid^="result-play-now-"]').first()).toBeVisible({ timeout: 40000 });
    await expectAim('a browsed list');
    await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ITEM.ARRIVAL)}`);
    await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
    await expectAim('details');
    const input = await openSearch(page, vp);
    await input.fill('Arrival');
    await expectAim('search');
    await context.close();
  });
}

test('[PLACE.1a/AC2] the aim reads as the screen\'s name and room, "This device (name)", or a list or count of screens', async ({ browser }) => {
  const vp = VIEWPORTS.laptop;
  // This device, named: the browser knows its own name.
  const named = await browser.newContext({ viewport: vp, serviceWorkers: 'block' });
  await pinBrowserIdentity(named, { clientId: 'dad-phone', name: "Dad's phone" });
  const namedPage = await named.newPage();
  await namedPage.addInitScript(() => { try { localStorage.setItem('media-app.first-use-done', 'journey'); } catch { /* ignore */ } });
  await gotoMedia(namedPage, `/media?view=detail&contentId=${encodeURIComponent(ITEM.ARRIVAL)}`);
  await expect(namedPage.getByTestId('aim-label')).toContainText('This device');
  await expect(namedPage.getByTestId('aim-label')).toContainText("Dad's phone");
  await named.close();

  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ITEM.ARRIVAL)}`);
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
  // One screen: its name and its room.
  await setAim(page, vp, [A]);
  await expect(page.getByTestId('aim-label').first()).toContainText(`${A_NAME} · `);
  // (the room is the screen's configured location: "Virtual browser" for the fixture screens)
  await expect(page.getByTestId('aim-label').first()).toContainText('Virtual browser');
  // Two screens: both names. Four: a count.
  await setAim(page, vp, [B]);
  await expect(page.getByTestId('aim-label').first()).toContainText(`${A_NAME} + ${B_NAME}`);
  await setAim(page, vp, [SCRIPTED.POWER, SCRIPTED.SPEAKER]);
  await expect(page.getByTestId('aim-label').first()).toContainText('4 screens');
  await context.close();
});

test('[PLACE.3a/AC1][PLACE.3a/AC2][PLACE.3a/AC3] Play on… is offered on items everywhere, sends only that item to the chosen screen, names the item and the screen, and leaves the aim as it was', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, B);
  const { context, page } = await newAppPage(browser, vp);
  await gotoMedia(page);
  const aimBefore = (await page.getByTestId('destination-control-name').innerText()).trim();
  expect(aimBefore).toBe('This device');

  // Offered: search row, a browsed item, details, a home tile.
  const input = await openSearch(page, vp);
  await input.fill('Arrival');
  await expect(resultRow(page, vp, ITEM.ARRIVAL)).toBeVisible({ timeout: 40000 });
  await page.getByTestId(`result-more-${ITEM.ARRIVAL}`).click();
  await expect(page.getByRole('menuitem', { name: 'Play on…', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Add on…', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await closeSearch(page, vp);
  await goArea(page, vp, 'browse');
  await page.getByTestId('browse-open-plex:').click();
  await page.locator('[data-testid^="browse-open-plex:library/sections/6/"]').first().click();
  const leaf = page.locator('[data-testid^="result-more-"]').first();
  await expect(leaf).toBeVisible({ timeout: 40000 });
  await leaf.click();
  await expect(page.getByRole('menuitem', { name: 'Play on…', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  // Escape closes the menu and nothing else: the shell's deferred dismiss task (one macrotask after
  // the key) must find the menu's registered layer and not run Back. Flush that task, then prove the
  // browse page is still the page, before leaving it.
  await expect(page.getByRole('menuitem', { name: 'Play on…', exact: true })).toBeHidden();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))));
  await expect(leaf).toBeVisible();
  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ITEM.ARRIVAL)}`);
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId('detail-view').getByRole('button', { name: 'Add on…' })).toBeVisible();
  // (details name its "Play on…" the Cast button)
  await expect(page.getByTestId('detail-view').getByRole('button', { name: 'Cast', exact: true })).toBeVisible();
  await gotoMedia(page);
  await expect(page.getByTestId('home-row-recent')).toBeVisible({ timeout: 60000 });
  const tile = page.getByTestId(`home-tile-recent-${ITEM.ARRIVAL}`);
  await tile.getByRole('button', { name: /More actions for/ }).click();
  await expect(page.getByTestId(`home-tile-recent-${ITEM.ARRIVAL}-verb-playOn`)).toBeVisible();
  await expect(page.getByTestId(`home-tile-recent-${ITEM.ARRIVAL}-verb-addOn`)).toBeVisible();

  // Choose a screen: only that item goes there; the confirmation names item and screen; the aim does not change.
  await page.getByTestId(`home-tile-recent-${ITEM.ARRIVAL}-verb-playOn`).click();
  await page.getByTestId(`picker-device-${B}`).click();
  await expect.poll(async () => (await receiverState(request, B))?.currentItem?.contentId, { timeout: 120000 }).toBe(ITEM.ARRIVAL);
  const row = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Arrival' }).first();
  await expect(row).toBeVisible({ timeout: 20000 });
  await expect(row).toContainText(B_NAME);
  expect((await page.getByTestId('destination-control-name').innerText()).trim()).toBe(aimBefore);
  expect(await page.locator('video').count()).toBe(0);
  await stopReceiver(request, B);
  await context.close();
  await receiver.context.close();
});

test('[PLACE.5a/AC1][PLACE.5a/AC2] each screen choice shows name, room and whether it is playing (title, time left), paused, idle or off; a screen not heard from for two minutes is marked uncertain', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const idleReceiver = await openReceiver(browser, request, A);
  await stopReceiver(request, A);
  const { context, page } = await newAppPage(browser, vp);
  const clock = await installFakeClock(page);
  await gotoMedia(page);
  // Said once and then silent (the den TV stops reporting); the speaker keeps reporting. Scripted after the page is up,
  // so everything is observed inside the screen's liveness window.
  await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'playing', title: 'Arrival', duration: 7000, position: 1000, heartbeatMs: 0 });
  await scriptReceiver(request, { deviceId: SCRIPTED.SPEAKER, state: 'paused', title: 'Faith', duration: 200, position: 50 });
  // The picker used by Play on… carries the same status lines.
  await page.keyboard.press('Escape');
  await gotoMedia(page, `/media?view=detail&contentId=${encodeURIComponent(ITEM.HOSPITAL)}`);
  await expect(page.getByTestId('detail-view')).toBeVisible({ timeout: 60000 });
  await page.getByTestId('detail-view').getByRole('button', { name: 'Add on…' }).click();
  await expect(page.getByTestId('dispatch-target-picker')).toBeVisible();
  const line = (id) => page.getByTestId(`picker-device-status-${id}`);
  await expect(line(SCRIPTED.POWER)).toContainText('Playing: Arrival', { timeout: 30000 });
  await expect(line(SCRIPTED.POWER)).toContainText(/left/);
  await expect(line(SCRIPTED.SPEAKER)).toContainText('Paused: Faith');
  await expect(line(A)).toContainText('Idle');
  await expect(line('acceptance-offline')).toContainText('Off');
  // Name and room on each choice.
  await expect(page.getByTestId(`picker-device-${SCRIPTED.POWER}`)).toContainText('Acceptance den TV');
  await expect(page.getByTestId(`picker-device-${SCRIPTED.POWER}`)).toContainText('Acceptance den');
  await expect(page.getByTestId(`picker-device-${SCRIPTED.SPEAKER}`)).toContainText('Acceptance kitchen');
  await page.keyboard.press('Escape');

  // AC2: two minutes without hearing from a screen: it reads uncertain in the house overview.
  await goArea(page, vp, 'fleet');
  await expect(page.getByTestId(`fleet-state-${SCRIPTED.POWER}`)).not.toContainText(/uncertain/i);
  await clock.advance(121_000);
  await expect(page.getByTestId(`fleet-state-${SCRIPTED.POWER}`)).toContainText(/uncertain/i, { timeout: 15000 });
  await context.close();
  await idleReceiver.context.close();
});

test('[PLACE.2a/AC4] the aim\'s two-hour idle clock does not run while the aimed screen is playing something this device is steering', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const receiver = await openReceiver(browser, request, A);
  const { context, page } = await newAppPage(browser, vp);
  const clock = await installFakeClock(page);
  await gotoMedia(page);
  await setAim(page, vp, [A]);
  await startOn(request, A, ITEM.HOSPITAL);
  // Steering: this device opens the screen's controls and presses Pause then Play.
  await openHouse(page, vp);
  await page.getByTestId(`fleet-peek-${A}`).click();
  await expect(page.getByTestId('peek-panel')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('peek-panel').getByTestId('np-toggle').click();
  await expect.poll(async () => (await receiverState(request, A))?.state, { timeout: 60000 }).toBe('paused');
  await page.getByTestId('peek-panel').getByTestId('np-toggle').click();
  await expect.poll(async () => (await receiverState(request, A))?.state, { timeout: 60000 }).toBe('playing');
  // Three hours pass, steadily (the screen keeps playing and reporting).
  for (let i = 0; i < 6; i += 1) { await clock.advanceMinutes(30); await page.waitForTimeout(300); }
  await expect(page.getByTestId('destination-control-name')).toContainText(A_NAME);
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});
