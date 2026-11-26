import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';
import { aimAt, aimLabel, stepChip } from './lib/aim.mjs';
import { playResult } from './lib/search.mjs';

test.beforeEach(async ({ context }) => { await markFirstUseDone(context); });

test.use({ trace: 'retain-on-failure' });
test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

const surfaces = [
  ['phone SearchMode', { width: 390, height: 844 }, 'phone'],
  ['tablet Browse header and dock', { width: 768, height: 1024 }, 'browse'],
  ['laptop Browse header and dock', { width: 1440, height: 900 }, 'browse'],
];

async function openDestinationSurface(page, surface) {
  if (surface === 'phone') {
    await page.getByTestId('media-search-launcher').click();
    await expect(page.getByTestId('search-mode')).toBeVisible();
    return;
  }

  const search = page.getByRole('textbox', { name: 'Search media…' });
  await search.fill('tuttle twins');
  const collection = page.getByTestId('combobox-option-plex:663508');
  await expect(collection).toBeVisible({ timeout: 30000 });
  await collection.click();
  await expect(page.getByTestId('browse-dispatch-header')).toBeVisible();
}

// Where ▶ plays is named where you type: the phone search sheet's chip, or
// (tablet, laptop) the dock search box chip / header control (aim.mjs).
const sheetChip = (page) => page.getByTestId('search-mode').getByTestId('search-destination-chip');

async function chooseAcceptanceTarget(page, surface) {
  if (surface === 'phone') await stepChip(sheetChip(page), '▶ Acceptance receiver');
  else await aimAt(page, 'acceptance-media');
  await expectAimed(page, surface);
}

async function expectAimed(page, surface) {
  if (surface === 'phone') await expect(sheetChip(page)).toContainText('Acceptance');
  else await expect.poll(() => aimLabel(page)).toBe('Acceptance receiver');
}

for (const [label, viewport, surface] of surfaces) {
  test(`[PLACE.2a/AC1-3] ${label}: aim changes, follows navigation/reload, then stays sticky after two idle hours`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.clock.install();
    const deviceCommands = [];
    await page.route('**/api/v1/device/**', async route => {
      const request = route.request();
      if (request.method() !== 'GET' || /\/load(?:\?|$)/.test(request.url())) {
        deviceCommands.push({ method: request.method(), url: request.url() });
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    await page.goto('/media');
    if (surface === 'browse') await openDestinationSurface(page, surface);
    else {
      await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
      await openDestinationSurface(page, surface);
    }
    await chooseAcceptanceTarget(page, surface);

    if (surface === 'phone') {
      // A real container selection leaves SearchMode and opens BrowseView.
      await page.getByTestId('search-mode-input').fill('tuttle twins');
      const collection = page.getByTestId('search-mode-results').getByTestId('search-mode-result-plex:663508');
      await expect(collection).toBeVisible({ timeout: 30000 });
      await collection.click();
      await expect(page.getByTestId('browse-dispatch-header')).toBeVisible();
      // The phone header's "Playing on" names the same aim.
      await expect.poll(() => aimLabel(page)).toContain('Acceptance');
      await page.getByTestId('browse-crumb-home').click();
    } else {
      // The search box chip is another live view of the same shared target state.
      await expect.poll(() => aimLabel(page)).toBe('Acceptance receiver');
      await page.getByTestId('browse-crumb-home').click();
    }

    await page.reload();
    if (surface === 'phone') {
      await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
      await openDestinationSurface(page, surface);
    } else {
      await expect.poll(() => aimLabel(page)).toBe('Acceptance receiver');
      await openDestinationSurface(page, surface);
    }
    await expectAimed(page, surface);

    await page.clock.fastForward(2 * 60 * 60 * 1000 + 1000);
    // Sticky: nothing expires the aim, two hours later it is still the screen.
    await expectAimed(page, surface);
    await page.reload();
    if (surface === 'phone') {
      await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
      await openDestinationSurface(page, surface);
    } else {
      await expect.poll(() => aimLabel(page)).toBe('Acceptance receiver');
      await openDestinationSurface(page, surface);
    }
    await expectAimed(page, surface);
    expect(deviceCommands, 'Changing, persisting, and a long idle must not issue device commands').toEqual([]);
  });
}

test('[PLACE.2a/AC4] the aim is sticky after two hours, with sent playback active or not', async ({ context, page: sender }) => {
  const receiver = await context.newPage();
  await sender.clock.install();
  await sender.goto('/media', { waitUntil: 'domcontentloaded' });
  await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => sender.evaluate(async () => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-ready');
    return response.ok && (await response.json()).ready;
  }), { timeout: 30000 }).toBe(true);

  await aimAt(sender, 'acceptance-media', { fork: true });

  const search = sender.getByRole('textbox', { name: 'Search media…' });
  await search.fill('arrival');
  // A row opens the info view; only PLAY plays.
  await playResult(sender, sender.getByTestId('combobox-option-plex:55854'));
  const native = receiver.locator('.video-player video');
  await expect(native).toBeVisible({ timeout: 60000 });
  await expect.poll(() => native.evaluate(element => element.readyState >= 2
    && !element.paused && element.currentTime > 0), { timeout: 30000 }).toBe(true);
  await expect(sender.getByTestId('dispatch-tray')).toContainText(
    'Playing on Acceptance receiver', { timeout: 60000 },
  );

  const readAim = () => sender.evaluate(() => ({
    now: Date.now(),
    aim: JSON.parse(localStorage.getItem('media-app.cast-target')),
  }));
  const before = await readAim();
  const receiverTime = await native.evaluate(element => element.currentTime);

  await sender.clock.setFixedTime(before.now + (2 * 60 * 60 * 1000) + 1000);
  await expect.poll(() => native.evaluate((element, start) => !element.paused
    && element.currentTime > start + 20, receiverTime), { timeout: 35000 }).toBe(true);

  const after = await readAim();
  expect(after.now - before.now).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
  expect(after.aim?.targetIds).toEqual(['acceptance-media']);
  await expect.poll(() => aimLabel(sender), { timeout: 30000 }).toBe('Acceptance receiver');
  await test.info().attach('active-aim-clock-evidence.json', {
    body: JSON.stringify({ before, after, receiverTime }),
    contentType: 'application/json',
  });
  await receiver.close();
});
