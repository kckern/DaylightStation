import { test, expect } from '@playwright/test';

test.describe('MediaApp — search states', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
    await page.goto('/media');
  });

  test('idle prompt appears on focus', async ({ page }) => {
    await page.getByTestId('media-search-input').focus();
    await expect(page.getByTestId('search-idle-prompt')).toBeVisible();
  });

  test('empty state for a no-match query', async ({ page }) => {
    // Stub the SSE endpoint to return an instant empty complete event.
    await page.route('**/api/v1/content/query/search/stream**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"event":"complete","query":"zzzqqq-nonsense-1234"}\n\n',
      });
    });
    await page.getByTestId('media-search-input').fill('zzzqqq-nonsense-1234');
    await expect(page.getByTestId('search-empty')).toBeVisible({ timeout: 8000 });
  });

  test('error state when the search endpoint fails', async ({ page }) => {
    await page.route('**/api/v1/content/query/search/stream**', (route) => route.abort('failed'));
    await page.getByTestId('media-search-input').fill('hello');
    await expect(page.getByTestId('search-error')).toBeVisible({ timeout: 8000 });
    // Retry button is present
    await expect(page.getByTestId('search-retry')).toBeVisible();
  });
});
