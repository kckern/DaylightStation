import { test, expect } from '@playwright/test';

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

async function chooseAcceptanceTarget(page, surface) {
  const destinationSurface = surface === 'phone'
    ? page.getByTestId('search-mode')
    : page.getByTestId('browse-dispatch-header');
  await destinationSurface.getByTestId('destination-line').click();
  await page.getByTestId('picker-device-acceptance-media').click();
  await page.getByTestId('picker-submit').click();
  await expect(destinationSurface.getByTestId('destination-line-name')).toContainText('Acceptance');
}

for (const [label, viewport, surface] of surfaces) {
  test(`[PLACE.2a/AC1-3] ${label}: aim changes, follows navigation/reload, then expires after two idle hours`, async ({ page }) => {
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
      const browseHeader = page.getByTestId('browse-dispatch-header');
      await expect(browseHeader).toBeVisible();
      await expect(browseHeader.getByTestId('destination-line-name')).toContainText('Acceptance');
      await page.getByTestId('browse-crumb-home').click();
    } else {
      // The dock chip is another live view of the same shared target state.
      await page.getByTestId('cast-target-chip').click();
      await expect(page.getByTestId('cast-target-checkbox-acceptance-media')).toBeChecked();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('cast-popover')).toBeHidden();
      await page.getByTestId('browse-crumb-home').click();
    }

    await page.reload();
    if (surface === 'phone') {
      await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
      await openDestinationSurface(page, surface);
    } else {
      await page.getByTestId('cast-target-chip').click();
      await expect(page.getByTestId('cast-target-checkbox-acceptance-media')).toBeChecked();
      await page.keyboard.press('Escape');
      await openDestinationSurface(page, surface);
    }
    const reopenedSurface = surface === 'phone'
      ? page.getByTestId('search-mode')
      : page.getByTestId('browse-dispatch-header');
    await expect(reopenedSurface.getByTestId('destination-line-name')).toContainText('Acceptance');

    await page.clock.fastForward(2 * 60 * 60 * 1000 + 1000);
    await expect(reopenedSurface.getByTestId('destination-line-name')).toHaveText(/This device/);
    await page.reload();
    if (surface === 'phone') {
      await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
      await openDestinationSurface(page, surface);
    } else {
      await page.getByTestId('cast-target-chip').click();
      await expect(page.getByTestId('cast-target-checkbox-acceptance-media')).not.toBeChecked();
      await page.keyboard.press('Escape');
      await openDestinationSurface(page, surface);
    }
    const expiredSurface = surface === 'phone'
      ? page.getByTestId('search-mode')
      : page.getByTestId('browse-dispatch-header');
    await expect(expiredSurface.getByTestId('destination-line-name')).toHaveText(/This device/);
    expect(deviceCommands, 'Changing, persisting, and expiring aim must not issue device commands').toEqual([]);
  });
}

test('[PLACE.2a/AC4] the two-hour clock stays suspended while matching sent playback is active', async ({ context, page: sender }) => {
  const receiver = await context.newPage();
  await sender.clock.install();
  await sender.goto('/media', { waitUntil: 'domcontentloaded' });
  await receiver.goto('/screen/living-room', { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => sender.evaluate(async () => {
    const response = await fetch('/api/v1/device/acceptance-media/receiver-ready');
    return response.ok && (await response.json()).ready;
  }), { timeout: 30000 }).toBe(true);

  await sender.getByTestId('cast-target-chip').click();
  await sender.getByTestId('cast-mode-fork').check();
  await sender.getByTestId('cast-target-checkbox-acceptance-media').check();
  await sender.getByTestId('cast-target-chip').click();

  const search = sender.getByRole('textbox', { name: 'Search media…' });
  await search.fill('arrival');
  await sender.getByTestId('combobox-option-plex:55854').click();
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
  await expect.poll(async () => Number.isFinite((await readAim()).aim?.exemptionStartedAt), {
    timeout: 30000,
  }).toBe(true);
  const before = await readAim();
  const receiverTime = await native.evaluate(element => element.currentTime);

  await sender.clock.setFixedTime(before.now + (2 * 60 * 60 * 1000) + 1000);
  await expect.poll(() => native.evaluate((element, start) => !element.paused
    && element.currentTime > start + 20, receiverTime), { timeout: 35000 }).toBe(true);

  const after = await readAim();
  expect(after.now - before.now).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000);
  expect(after.aim?.targetIds).toEqual(['acceptance-media']);
  expect(after.aim?.exemptionStartedAt).toEqual(expect.any(Number));
  await sender.getByTestId('cast-target-chip').click();
  await expect(sender.getByTestId('cast-target-checkbox-acceptance-media')).toBeChecked();
  await sender.getByTestId('cast-target-chip').click();
  await test.info().attach('active-aim-clock-evidence.json', {
    body: JSON.stringify({ before, after, receiverTime }),
    contentType: 'application/json',
  });
  await receiver.close();
});
