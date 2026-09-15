import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, trace: 'retain-on-failure', actionTimeout: 10000 });

test('[PLACE.2b/AC1][PLACE.2b/AC2] phone switches office aim back to this device without sending playback', async ({ page }) => {
  const commands = [];
  page.on('request', request => {
    if (/\/device\/[^/]+\/(load|command|transport)/.test(request.url())) commands.push(request.url());
  });
  await page.goto('/media');
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
