import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 850 }, serviceWorkers: 'block' });

test('Media Home independently recovers delayed partial reads', async ({ page }) => {
  const suggestions = '/api/v1/media/suggestions';
  const recent = '/api/v1/media/household/recent';
  const carryOn = '/api/v1/media/household/carry-on';
  const reads = { [suggestions]: 0, [recent]: 0, [carryOn]: 0 };
  const releaseSuggestions = Promise.withResolvers();
  const item = (contentId, title) => ({ id: contentId, contentId, title, kind: 'item', type: 'movie' });

  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  await page.clock.install();
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path in reads) reads[path]++;
    if (path === suggestions) {
      const first = reads[path] === 1;
      if (first) await releaseSuggestions.promise;
      const movie = item('plex:100', first ? 'Partial suggestion' : 'Recovered suggestion');
      return route.fulfill({ json: { degraded: first, rows: [{ id: 'new', title: 'New', items: [movie] }] } });
    }
    if (path === recent) {
      const first = reads[path] === 1;
      return route.fulfill({ json: {
        degraded: true,
        items: [item('plex:200', first ? 'Partial recent result' : 'Updated recent result')],
      } });
    }
    if (path === carryOn) return route.fulfill({ json: { items: [], nowOn: [] } });
    return route.fulfill({ json: { enabled: false } });
  });

  try {
    await page.goto('/media');
    await expect(page.getByText('Partial recent result', { exact: true })).toBeVisible();
    await expect.poll(() => ({ ...reads })).toEqual({ [suggestions]: 1, [recent]: 1, [carryOn]: 1 });
    await page.clock.fastForward(10_500);
    await expect(page.getByText('Updated recent result', { exact: true })).toBeVisible();
    expect(reads).toEqual({ [suggestions]: 1, [recent]: 2, [carryOn]: 1 });

    releaseSuggestions.resolve();
    await expect(page.getByText('Partial suggestion', { exact: true })).toBeVisible();
    await page.clock.fastForward(10_500);
    await expect(page.getByText('Recovered suggestion', { exact: true })).toBeVisible();
    await page.clock.fastForward(20_000);
    expect(reads).toEqual({ [suggestions]: 2, [recent]: 2, [carryOn]: 1 });
  } finally {
    releaseSuggestions.resolve();
  }
});
