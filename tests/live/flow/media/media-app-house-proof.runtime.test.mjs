import { test, expect } from '@playwright/test';
import { resetHouseholdAt } from './lib/household.mjs';
import { installNetworkControl } from './lib/networkLoss.mjs';
import { scriptReceiver, SCRIPTED } from './lib/scriptedReceiver.mjs';
import {
  A, A_NAME, ITEM, VIEWPORTS, receiverState, openReceiver, startOn, stopReceiver, newAppPage, gotoMedia, warmMedia, openHouse,
} from './lib/receivers.mjs';

// HOUSE — the overview of every screen, and what it says when this device
// loses touch with the house. Real mounted receiver + scripted screens.
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block', actionTimeout: 30000 });
test.setTimeout(300000);

test.beforeAll(async ({ browser }) => { test.setTimeout(300000); await warmMedia(browser); });
test.beforeEach(async ({ request, baseURL }) => { await resetHouseholdAt(request, baseURL); });

for (const [label, vp] of Object.entries({ phone: VIEWPORTS.phone, laptop: VIEWPORTS.laptop })) {
  test(`[HOUSE.2a/AC1] ${label}: each screen shows its name, room and whether it is playing, paused, idle or off, and when playing its picture, title and progress`, async ({ browser, request }) => {
    const receiver = await openReceiver(browser, request, A);
    await startOn(request, A, ITEM.HOSPITAL);
    const { context, page } = await newAppPage(browser, vp);
    await gotoMedia(page);
    await openHouse(page, vp);
    // Screens that report as they change (scripted once this device is watching, so each arrives live).
    await scriptReceiver(request, { deviceId: SCRIPTED.SPEAKER, state: 'paused', title: 'Faith', duration: 200, position: 50 });
    await scriptReceiver(request, { deviceId: SCRIPTED.POWER, state: 'idle' });
    await scriptReceiver(request, { deviceId: 'acceptance-offline', state: 'off' });
    const card = (id) => page.getByTestId(`fleet-card-${id}`);
    await expect(card(A)).toBeVisible({ timeout: 30000 });

    // Playing: name, room, state, picture, title, progress.
    await expect(card(A)).toContainText(A_NAME);
    await expect(card(A).locator('.fleet-card-location')).toHaveText(/\S/);
    await expect(page.getByTestId(`fleet-state-${A}`)).toHaveText('Playing');
    await expect(card(A).locator('img.fleet-card-thumb')).toBeVisible();
    await expect(card(A)).toContainText('Hospital');
    await expect(card(A).locator('[role="progressbar"], .mantine-Progress-root').first()).toBeVisible();
    // Paused (speaker, with its room), idle (den TV), off (guest room TV: heard once, never again).
    await expect(card(SCRIPTED.SPEAKER)).toContainText('Acceptance speaker');
    await expect(card(SCRIPTED.SPEAKER).locator('.fleet-card-location')).toHaveText(/\S/);
    await expect(page.getByTestId(`fleet-state-${SCRIPTED.SPEAKER}`)).toHaveText('Paused', { timeout: 40000 });
    await expect(card(SCRIPTED.SPEAKER)).toContainText('Faith', { timeout: 40000 });
    await expect(card(SCRIPTED.POWER)).toContainText('Acceptance den TV');
    await expect(card(SCRIPTED.POWER).locator('.fleet-card-location')).toHaveText(/\S/);
    await expect(page.getByTestId(`fleet-state-${SCRIPTED.POWER}`)).toHaveText('Idle', { timeout: 40000 });
    await expect(card('acceptance-offline')).toContainText('Acceptance guest room TV');
    await expect(page.getByTestId('fleet-state-acceptance-offline')).toHaveText(/^Off/, { timeout: 30000 });
    await stopReceiver(request, A);
    await context.close();
    await receiver.context.close();
  });
}

test('[HOUSE.3a/AC2] when this device loses touch with the house the whole overview says so, and it recovers on its own', async ({ browser, request }) => {
  const vp = VIEWPORTS.phone;
  const receiver = await openReceiver(browser, request, A);
  await startOn(request, A, ITEM.HOSPITAL);
  await scriptReceiver(request, { deviceId: SCRIPTED.SPEAKER, state: 'paused', title: 'Faith', duration: 200, position: 50 });
  const { context, page } = await newAppPage(browser, vp);
  const net = await installNetworkControl(page);
  await gotoMedia(page);
  await openHouse(page, vp);
  await expect(page.getByTestId(`fleet-card-${A}`)).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId(`fleet-uncertain-${A}`)).toHaveCount(0);
  const accepted = net.accepted;

  await net.lose();
  // The whole overview says so, in words, above every row.
  const warning = page.getByTestId('fleet-connection-warning');
  await expect(warning).toBeVisible({ timeout: 60000 });
  await expect(warning).toContainText('This device has lost touch with the house');
  await expect(warning).toContainText('reconnect automatically');
  await expect(page.getByTestId('media-reconnecting')).toBeVisible({ timeout: 30000 });

  // And it recovers on its own, with no one touching anything.
  await net.restore();
  await net.waitForSocket({ after: accepted, timeout: 90000 });
  await expect(warning).toHaveCount(0, { timeout: 90000 });
  await expect(page.getByTestId('media-reconnecting')).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByTestId(`fleet-card-${A}`)).toBeVisible();
  await stopReceiver(request, A);
  await context.close();
  await receiver.context.close();
});

test('[RELY.7a/AC4] a brief network hiccup does not reload the app or interrupt me; a longer one shows a quiet "reconnecting" note', async ({ browser, request }) => {
  const vp = VIEWPORTS.laptop;
  const { context, page } = await newAppPage(browser, vp);
  const net = await installNetworkControl(page);
  await gotoMedia(page);
  await page.evaluate(() => { window.__notReloaded = 'yes'; });
  const accepted = net.accepted;

  // A brief hiccup (under the grace): nothing reloads, no note.
  await net.lose();
  await page.waitForTimeout(1200);
  await net.restore();
  await net.waitForSocket({ after: accepted, timeout: 60000 });
  expect(await page.evaluate(() => window.__notReloaded)).toBe('yes');
  await expect(page.getByTestId('media-reconnecting')).toHaveCount(0);

  // A longer one: a quiet note; still no reload; gone when it is back.
  const accepted2 = net.accepted;
  await net.lose();
  await expect(page.getByTestId('media-reconnecting')).toBeVisible({ timeout: 30000 });
  expect(await page.evaluate(() => window.__notReloaded)).toBe('yes');
  await net.restore();
  await net.waitForSocket({ after: accepted2, timeout: 90000 });
  await expect(page.getByTestId('media-reconnecting')).toHaveCount(0, { timeout: 60000 });
  expect(await page.evaluate(() => window.__notReloaded)).toBe('yes');
  await context.close();
});
