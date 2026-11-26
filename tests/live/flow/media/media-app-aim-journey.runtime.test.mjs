import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { aimAt, aimHere, aimLocator, stepChip } from './lib/aim.mjs';

// The phone's search sheet names where ▶ plays with the destination chip; a
// tap walks the cycle (usual screen, other screens, This device).
const chipIn = (scope) => scope.getByTestId('search-destination-chip');
const RECEIVER = '▶ Acceptance receiver';
const HERE = '▶ This device';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });

test.use({ viewport: { width: 390, height: 844 }, trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(90000);

test('[PLACE.2a/AC2][PLACE.2a/AC3][PLACE.2a/AC5] remembered aim is sticky: still there after two idle hours, including reload', async ({ page }) => {
  const commands = [];
  await page.route('**/api/v1/device/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET' || /\/load(?:\?|$)/.test(request.url())) {
      commands.push({ method: request.method(), url: request.url() });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await page.clock.install();
  await page.goto('/media');
  await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('media-search-launcher').click();
  const searchMode = page.getByTestId('search-mode');
  await stepChip(chipIn(searchMode), RECEIVER);
  await page.reload();
  await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('media-search-launcher').click();
  await expect(chipIn(searchMode)).toContainText('Acceptance receiver');
  await page.clock.fastForward(2 * 60 * 60 * 1000 + 1000);
  // Sticky: nothing expires the aim.
  await expect(chipIn(searchMode)).toContainText('Acceptance receiver');
  await page.reload();
  await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('media-search-launcher').click();
  await expect(chipIn(page.getByTestId('search-mode'))).toContainText('Acceptance receiver');
  expect(commands, 'A long-idle aim must not issue playback commands').toEqual([]);
});

test('[PLACE.2a/AC5] a closed app restores a remote aim, and still does after more than two idle hours (sticky)', async ({ context, page }) => {
  const startedAt = new Date('2026-09-19T12:00:00.000Z');
  const beforeExpiryAt = new Date(startedAt.getTime() + (2 * 60 * 60 * 1000) - 1);
  const receiverTargetId = 'acceptance-media';
  const commands = [];
  const readClockAndAim = browserPage => browserPage.evaluate(() => {
    const raw = localStorage.getItem('media-app.cast-target');
    return { now: Date.now(), aim: raw ? JSON.parse(raw) : null };
  });
  await context.route('**/api/v1/device/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET' || /\/load(?:\?|$)/.test(request.url())) {
      commands.push({ method: request.method(), url: request.url() });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await context.clock.install({ time: startedAt });
  await context.clock.setFixedTime(startedAt);
  await page.goto('/media');
  await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('media-search-launcher').click();
  const searchMode = page.getByTestId('search-mode');
  await stepChip(chipIn(searchMode), RECEIVER);
  await expect(chipIn(searchMode)).toContainText('Acceptance receiver');
  const beforeClose = await readClockAndAim(page);
  expect(beforeClose).toMatchObject({ now: startedAt.getTime(), aim: { targetIds: [receiverTargetId], activityAt: startedAt.getTime() } });
  await page.close();

  const beforeExpiry = await context.newPage();
  await context.clock.setFixedTime(beforeExpiryAt);
  await beforeExpiry.goto('/media');
  const beforeExpiryFirstLayout = await readClockAndAim(beforeExpiry);
  expect(beforeExpiryFirstLayout).toMatchObject({ now: beforeExpiryAt.getTime(), aim: { targetIds: [receiverTargetId], activityAt: startedAt.getTime() } });
  await expect(beforeExpiry.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await beforeExpiry.getByTestId('media-search-launcher').click();
  const beforeExpirySearch = beforeExpiry.getByTestId('search-mode');
  await expect(chipIn(beforeExpirySearch)).toContainText('Acceptance receiver');
  // Opening Search is user activity. Make the resulting lease explicit with
  // the chip (away and back) so the final closed interval has a known baseline.
  await stepChip(chipIn(beforeExpirySearch), HERE);
  await stepChip(chipIn(beforeExpirySearch), RECEIVER);
  await expect(chipIn(beforeExpirySearch)).toContainText('Acceptance receiver');
  const afterKnownRenewal = await readClockAndAim(beforeExpiry);
  expect(afterKnownRenewal).toMatchObject({ now: beforeExpiryAt.getTime(), aim: { targetIds: [receiverTargetId], activityAt: beforeExpiryAt.getTime() } });
  await beforeExpiry.close();

  const afterExpiry = await context.newPage();
  const afterExpiryAt = new Date(beforeExpiryAt.getTime() + (2 * 60 * 60 * 1000) + 1);
  await context.clock.setFixedTime(afterExpiryAt);
  await afterExpiry.goto('/media');
  await expect(afterExpiry.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await afterExpiry.getByTestId('media-search-launcher').click();
  await expect(chipIn(afterExpiry.getByTestId('search-mode'))).toContainText('Acceptance receiver');
  // Nothing expires a persisted aim. Read storage only as evidence after the
  // ordinary UI has established the user-visible contract: still the screen.
  const afterExpiryAfterOpen = await readClockAndAim(afterExpiry);
  expect(afterExpiryAfterOpen.aim?.targetIds).toEqual([receiverTargetId]);
  expect(commands, 'Aim persistence must not issue playback commands').toEqual([]);
  await test.info().attach('ac5-clock-evidence.json', {
    body: JSON.stringify({ beforeClose, beforeExpiryFirstLayout, afterKnownRenewal, afterExpiryAfterOpen }),
    contentType: 'application/json',
  });
});

test('[PLACE.2b/AC1][PLACE.2b/AC2] phone switches receiver aim back to this device without sending playback', async ({ page }) => {
  const commands = [];
  await page.route('**/api/v1/device/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET' || /\/load(?:\?|$)/.test(request.url())) {
      commands.push({ method: request.method(), url: request.url() });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await page.goto('/media');
  await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('media-search-launcher').click();
  const searchMode = page.getByTestId('search-mode');
  await stepChip(chipIn(searchMode), RECEIVER);
  await expect(chipIn(searchMode)).not.toContainText(/This browser|This device/);
  await stepChip(chipIn(searchMode), HERE);
  await expect(chipIn(searchMode)).toHaveAttribute('data-here', 'true');
  // The choice is sticky across closing and reopening the sheet.
  await page.getByRole('button', { name: 'Close search' }).click();
  await page.getByTestId('media-search-launcher').click();
  await expect(chipIn(page.getByTestId('search-mode'))).toHaveText(HERE);
  expect(commands, 'Changing aim must not send a playback command').toEqual([]);
});

for (const [device, viewport] of [
  ['tablet', { width: 768, height: 1024 }],
  ['laptop', { width: 1440, height: 900 }],
]) {
  test(`[PLACE.2b/AC1][PLACE.2b/AC2] ${device} offers This device and immediately restores the local aim`, async ({ page }) => {
    const commands = [];
    await page.setViewportSize(viewport);
    await page.route('**/api/v1/device/**', async route => {
      const request = route.request();
      if (request.method() !== 'GET' || /\/load(?:\?|$)/.test(request.url())) {
        commands.push({ method: request.method(), url: request.url() });
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    await page.goto('/media');
    const search = page.getByRole('textbox', { name: 'Search media…' });
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill('tuttle twins');
    const collection = page.getByTestId('combobox-option-plex:663508');
    await expect(collection).toBeVisible({ timeout: 15000 });
    await collection.click();
    await expect(page.getByTestId('browse-dispatch-header')).toBeVisible();
    // The destination is named where you type (the search chip, or the
    // header control where this viewport has one), not on the browse header.
    await aimAt(page, 'acceptance-media');
    await expect(await aimLocator(page)).toContainText('Acceptance receiver');
    await aimHere(page);
    await expect(await aimLocator(page)).toContainText(/This browser|This device/);
    expect(commands, 'Changing aim must not send a playback command').toEqual([]);
  });
}

test('[PLACE.2b/AC3] Start fresh defaults to returning the aim to This device without touching another screen', async ({ page }) => {
  const commands = [];
  await page.route('**/api/v1/device/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET' || /\/load(?:\?|$)/.test(request.url())) {
      commands.push({ method: request.method(), url: request.url() });
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await page.goto('/media');
  await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('media-search-launcher').click();
  const searchMode = page.getByTestId('search-mode');
  await stepChip(chipIn(searchMode), RECEIVER);
  await expect(chipIn(searchMode)).toContainText('Acceptance receiver');
  await page.getByRole('button', { name: 'Close search' }).click();
  await page.getByTestId('settings-menu-trigger').click();
  await page.getByRole('menuitem', { name: 'Start fresh' }).click();
  await expect(page.getByLabel('Return aim to this device')).toBeChecked();
  await expect(page.getByText('It does not stop anything playing on other screens.')).toBeVisible();
  await page.getByRole('dialog', { name: 'Start fresh on this device?' }).getByRole('button', { name: 'Start fresh', exact: true }).click();
  await page.getByTestId('media-search-launcher').click();
  await expect(chipIn(page.getByTestId('search-mode'))).toContainText(/This browser|This device/);
  expect(commands, 'Starting fresh must not issue a command to another screen').toEqual([]);
});
