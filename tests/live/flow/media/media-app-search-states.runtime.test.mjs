import { test, expect } from '@playwright/test';

test.describe('MediaApp — search states', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  });

  test('idle prompt appears on focus', async ({ page }) => {
    await page.goto('/media');
    await page.getByRole('textbox', { name: 'Search media…' }).focus();
    await expect(page.getByRole('listbox').getByText('Type to search...', { exact: true })).toBeVisible();
  });

  test('empty state for a no-match query', async ({ page }) => {
    // Stub the SSE endpoint to return an instant empty complete event.
    let requests = 0;
    await page.route('**/api/v1/content/query/search/stream**', async (route) => {
      requests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"event":"complete","query":"zzzqqq-nonsense-1234"}\n\n',
      });
    });
    await page.goto('/media');
    await page.getByRole('textbox', { name: 'Search media…' }).fill('zzzqqq-nonsense-1234');
    await expect.poll(() => requests).toBe(1);
    await expect(page.getByRole('listbox').getByText('No results', { exact: true })).toBeVisible();
  });

  test('error state when the search endpoint fails', async ({ page }) => {
    await page.route('**/api/v1/content/query/search/stream**', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"event":"error","message":"Search fixture failure"}\n\n',
      });
    });
    await page.goto('/media');
    await page.getByRole('textbox', { name: 'Search media…' }).fill('hello');
    const error = page.getByTestId('stream-global-error');
    await expect(error).toContainText('Search fixture failure');
    await expect(error.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  });

  test('[FIND.3a/AC3][FIND.4a/AC2] a failed source is named before a truthful widened result', async ({ page }) => {
    let requestCount = 0;
    await page.route('**/api/v1/content/query/search/stream**', async route => {
      requestCount += 1;
      const frames = requestCount < 3
        ? [
            'data: {"event":"source_error","source":"plex","error":"offline","pending":[]}',
            'data: {"event":"complete"}',
          ]
        : ['data: {"event":"complete"}'];
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `${frames.join('\n\n')}\n\n`,
      });
    });

    await page.goto('/media');
    await page.getByRole('button', { name: 'Video', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search media…' }).fill('not-in-video');
    await expect.poll(() => requestCount).toBe(3);

    const status = page.getByTestId('stream-status-line');
    await expect(status.getByText('Plex did not answer')).toBeVisible();
    await expect(status.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(status.getByText(/From everything:/)).toBeVisible();
    await expect(status).toContainText('results may be incomplete');
    await expect(status.getByText(/Still searching/)).toHaveCount(0);
    const failurePrecedesWidening = await status.evaluate(node => {
      const failure = [...node.querySelectorAll('*')].find(el => el.textContent === 'Plex did not answer');
      const widening = node.querySelector('[data-testid="combobox-fallback-notice"]');
      return Boolean(failure && widening && (failure.compareDocumentPosition(widening) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    expect(failurePrecedesWidening).toBe(true);
  });
});
