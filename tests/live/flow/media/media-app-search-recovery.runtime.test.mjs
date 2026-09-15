import { test, expect } from '@playwright/test';

test.use({ trace: 'retain-on-failure', actionTimeout: 10000 });

// Withhold a real transport request; never fabricate successful search/media.
for (const [device, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
]) {
  test.describe(device, () => {
    test.use({ viewport });
    test.setTimeout(90000);

    test('[FIND.3a][FIND.4a] a silent search fails truthfully and Retry reaches real results', async ({ page }, testInfo) => {
      let releaseHeld;
      let intercepted = 0;
      const requests = [];
      const playbackRequests = [];
      page.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/v1/play/')) playbackRequests.push(true);
      });
      await page.route('**/api/v1/content/query/search/stream**', async route => {
        const url = new URL(route.request().url());
        requests.push({ text: url.searchParams.get('text'), mediaType: url.searchParams.get('mediaType'),
          capability: url.searchParams.get('capability'), type: url.searchParams.get('type'),
          form: url.searchParams.get('form'), source: url.searchParams.get('source'), take: url.searchParams.get('take') });
        if (intercepted++ > 0) return route.continue();
        await new Promise(resolve => { releaseHeld = resolve; });
        await route.abort('timedout').catch(() => {});
      });
      try {
        await page.goto('/media');
        if (device === 'phone') {
          await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
          await page.getByTestId('media-search-launcher').click();
        }
        const input = device === 'phone'
          ? page.getByRole('searchbox', { name: 'Search media', exact: true })
          : page.getByRole('textbox', { name: 'Search media…' });
        await expect(input).toBeVisible({ timeout: 30000 });
        const videoScope = page.getByRole('button', { name: 'Video', exact: true });
        await videoScope.click();
        await input.fill('Disclosure Day');
        await expect.poll(() => intercepted).toBe(1);
        const waitingAt = Date.now();
        await expect(page.getByText(/Search service did not complete in time/)).toBeVisible({ timeout: 35000 });
        expect(Date.now() - waitingAt).toBeLessThan(35000);
        await expect(page.getByText(/No results/)).not.toBeVisible();
        await expect(page.getByText(/didn't answer/)).not.toBeVisible();
        await expect(input).toHaveValue('Disclosure Day');
        await expect(videoScope).toHaveAttribute('aria-pressed', 'true');
        expect(intercepted, 'A failed request must not silently auto-retry').toBe(1);

        releaseHeld();
        await page.getByRole('button', { name: /^Retry(?: search)?$/ }).click();
        const result = device === 'phone'
          ? page.getByTestId('search-mode-results').getByText('Disclosure Day', { exact: true })
          : page.getByRole('option').filter({ hasText: 'Disclosure Day' }).filter({ hasText: 'Movie' });
        await expect(result).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(/Search service did not complete in time/)).not.toBeVisible();
        await expect(input).toHaveValue('Disclosure Day');
        await expect(videoScope).toHaveAttribute('aria-pressed', 'true');
        expect(requests.length).toBe(2);
        expect(requests[1]).toEqual(requests[0]);
        expect(playbackRequests).toEqual([]);
        await expect(page.locator('video')).toHaveCount(0);
      } finally {
        releaseHeld?.();
        await testInfo.attach('search-transport-recovery', {
          body: JSON.stringify({ requests, playbackRequestCount: playbackRequests.length }),
          contentType: 'application/json',
        });
      }
    });
  });
}
