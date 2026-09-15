import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(90000);

test('[FIND.1a/AC5] phone Play keeps search words and narrowing while actual media starts', async ({ page }) => {
  const title = process.env.MEDIA_ACCEPTANCE_TITLE || 'Disclosure Day';
  await page.goto('/media');
  await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
  await page.getByTestId('media-search-launcher').click();
  const search = page.getByRole('dialog', { name: 'Search media', exact: true });
  const input = search.getByRole('searchbox', { name: 'Search media', exact: true });
  await input.fill(title);
  await search.getByRole('button', { name: 'Video', exact: true }).click();
  const result = search.getByTestId('search-mode-results').getByText(title, { exact: true });
  await expect(result).toHaveCount(1, { timeout: 15000 });
  await result.click();
  await expect(search, 'Play must leave search open so the next item can be chosen').toBeVisible();
  await expect(input).toHaveValue(title);
  await expect(search.getByRole('button', { name: 'Video', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const video = page.locator('video');
  await expect(video).toHaveCount(1, { timeout: 30000 });
  await expect.poll(() => video.evaluate(el => !el.paused && el.readyState >= 2 && el.currentTime > 0), {
    timeout: 30000, message: 'Keeping search open must not prevent actual playback',
  }).toBe(true);
});
