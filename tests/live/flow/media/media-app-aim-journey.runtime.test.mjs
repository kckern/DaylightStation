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
