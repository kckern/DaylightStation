import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(90000);

test('[PLACE.2a/AC2][PLACE.2a/AC3][PLACE.2a/AC5] remembered aim expires after two idle hours, including reload', async ({ page }) => {
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
  await page.getByTestId('destination-line').click();
  await page.getByRole('button', { name: /^Office Screen Office/ }).click();
  await page.getByTestId('picker-submit').click();
  await page.reload();
  await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('media-search-launcher').click();
  await expect(page.getByTestId('destination-line-name')).toContainText('Office');
  await page.clock.fastForward(2 * 60 * 60 * 1000 + 1000);
  await expect(page.getByTestId('destination-line-name')).toHaveText(/This device/);
  await page.reload();
  await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('media-search-launcher').click();
  await expect(page.getByTestId('destination-line-name')).toHaveText(/This device/);
  expect(commands, 'Aim expiry must not issue playback commands').toEqual([]);
});

test('[PLACE.2a/AC5] a closed app restores a remote aim before two idle hours and starts locally after two', async ({ context, page }) => {
  const startedAt = new Date('2026-09-19T12:00:00.000Z');
  const beforeExpiryAt = new Date(startedAt.getTime() + (2 * 60 * 60 * 1000) - 1);
  const officeTargetId = 'office-tv';
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
  await page.getByTestId('destination-line').click();
  await page.getByRole('button', { name: /^Office Screen Office/ }).click();
  await page.getByTestId('picker-submit').click();
  await expect(page.getByTestId('destination-line-name')).toContainText('Office');
  const beforeClose = await readClockAndAim(page);
  expect(beforeClose).toMatchObject({ now: startedAt.getTime(), aim: { targetIds: [officeTargetId], activityAt: startedAt.getTime() } });
  await page.close();

  const beforeExpiry = await context.newPage();
  await context.clock.setFixedTime(beforeExpiryAt);
  await beforeExpiry.goto('/media');
  const beforeExpiryFirstLayout = await readClockAndAim(beforeExpiry);
  expect(beforeExpiryFirstLayout).toMatchObject({ now: beforeExpiryAt.getTime(), aim: { targetIds: [officeTargetId], activityAt: startedAt.getTime() } });
  await expect(beforeExpiry.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await beforeExpiry.getByTestId('media-search-launcher').click();
  await expect(beforeExpiry.getByTestId('destination-line-name')).toContainText('Office');
  // Opening Search is user activity. Make the resulting lease explicit with
  // the ordinary picker so the final closed interval has a known baseline.
  await beforeExpiry.getByTestId('destination-line').click();
  await beforeExpiry.getByRole('button', { name: 'This device', exact: true }).click();
  await beforeExpiry.getByTestId('destination-line').click();
  await beforeExpiry.getByRole('button', { name: /^Office Screen Office/ }).click();
  await beforeExpiry.getByTestId('picker-submit').click();
  await expect(beforeExpiry.getByTestId('destination-line-name')).toContainText('Office');
  const afterKnownRenewal = await readClockAndAim(beforeExpiry);
  expect(afterKnownRenewal).toMatchObject({ now: beforeExpiryAt.getTime(), aim: { targetIds: [officeTargetId], activityAt: beforeExpiryAt.getTime() } });
  await beforeExpiry.close();

  const afterExpiry = await context.newPage();
  const afterExpiryAt = new Date(beforeExpiryAt.getTime() + (2 * 60 * 60 * 1000) + 1);
  await context.clock.setFixedTime(afterExpiryAt);
  await afterExpiry.goto('/media');
  await expect(afterExpiry.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await afterExpiry.getByTestId('media-search-launcher').click();
  await expect(afterExpiry.getByTestId('destination-line-name')).toHaveText(/This device/);
  // The provider expires persisted aims during initialization, while its
  // effect writes the cleared state after mount. Read storage only as evidence
  // after the ordinary UI has established the user-visible contract.
  const afterExpiryAfterOpen = await readClockAndAim(afterExpiry);
  expect(commands, 'Aim persistence must not issue playback commands').toEqual([]);
  await test.info().attach('ac5-clock-evidence.json', {
    body: JSON.stringify({ beforeClose, beforeExpiryFirstLayout, afterKnownRenewal, afterExpiryAfterOpen }),
    contentType: 'application/json',
  });
});

test('[PLACE.2b/AC1][PLACE.2b/AC2] phone switches office aim back to this device without sending playback', async ({ page }) => {
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
  await page.getByTestId('destination-line').click();
  const office = page.getByRole('button', { name: /^Office Screen Office/ });
  await expect(office).toBeVisible();
  await office.click();
  await page.getByTestId('picker-submit').click();
  await expect(page.getByTestId('destination-line-name')).not.toHaveText(/This browser|This device/);
  await page.getByTestId('destination-line').click();
  await page.getByRole('button', { name: 'This device', exact: true }).click();
  await expect(page.getByTestId('destination-sheet')).not.toBeVisible();
  await expect(page.getByTestId('destination-line-name')).toHaveText(/This browser|This device/);
  await page.getByTestId('destination-line').click();
  await expect(page.getByTestId('picker-this-device')).toHaveAttribute('aria-pressed', 'true');
  await expect(office).toHaveAttribute('aria-pressed', 'false');
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
    await page.getByTestId('destination-line').click();
    await page.getByRole('button', { name: /^Office Screen Office/ }).click();
    await page.getByTestId('picker-submit').click();
    await expect(page.getByTestId('destination-line-name')).toContainText('Office');
    await page.getByTestId('destination-line').click();
    await page.getByRole('button', { name: 'This device', exact: true }).click();
    await expect(page.getByTestId('destination-line-name')).toHaveText(/This browser|This device/);
    await page.getByTestId('destination-line').click();
    await expect(page.getByTestId('picker-this-device')).toHaveAttribute('aria-pressed', 'true');
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
  await page.getByTestId('destination-line').click();
  await page.getByRole('button', { name: /^Office Screen Office/ }).click();
  await page.getByTestId('picker-submit').click();
  await expect(page.getByTestId('destination-line-name')).toContainText('Office');
  await page.getByRole('button', { name: 'Close search' }).click();
  await page.getByTestId('settings-menu-trigger').click();
  await page.getByRole('menuitem', { name: 'Start fresh' }).click();
  await expect(page.getByLabel('Return aim to this device')).toBeChecked();
  await expect(page.getByText('It does not stop anything playing on other screens.')).toBeVisible();
  await page.getByTestId('confirm-ok').click();
  await page.getByTestId('media-search-launcher').click();
  await expect(page.getByTestId('destination-line-name')).toHaveText(/This browser|This device/);
  expect(commands, 'Starting fresh must not issue a command to another screen').toEqual([]);
});
