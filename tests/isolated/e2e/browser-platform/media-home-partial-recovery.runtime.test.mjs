import { expect, test } from '@playwright/test';

// Simulate a fine pointer with hover. Headless Firefox otherwise reports no pointer.
const firefoxDesktopPointer = 6;
test.use({
  viewport: { width: 1440, height: 850 },
  serviceWorkers: 'block',
  launchOptions: { firefoxUserPrefs: {
    'ui.primaryPointerCapabilities': firefoxDesktopPointer,
    'ui.allPointerCapabilities': firefoxDesktopPointer,
  } },
});

test('Media Home independently recovers delayed partial reads', async ({ page }) => {
  const suggestions = '/api/v1/media/suggestions';
  const recent = '/api/v1/media/household/recent';
  const carryOn = '/api/v1/media/household/carry-on';
  const reads = { [suggestions]: 0, [recent]: 0, [carryOn]: 0 };
  const releaseSuggestions = Promise.withResolvers();
  const releaseSuggestionRefresh = Promise.withResolvers();
  const item = (contentId, title) => ({ id: contentId, contentId, title, kind: 'item', type: 'movie' });

  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  await page.clock.install();
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path in reads) reads[path]++;
    if (path === suggestions) {
      const first = reads[path] === 1;
      await (first ? releaseSuggestions : releaseSuggestionRefresh).promise;
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
    await expect.poll(() => reads[suggestions]).toBe(2);
    const suggestionRegion = page.getByRole('region', { name: 'Suggestions', exact: true });
    await expect(suggestionRegion).toHaveAttribute('aria-busy', 'true');
    await expect(suggestionRegion.getByText('Partial suggestion', { exact: true })).toBeVisible();
    await expect(page.getByText('Updated recent result', { exact: true })).toBeVisible();
    releaseSuggestionRefresh.resolve();
    await expect(page.getByText('Recovered suggestion', { exact: true })).toBeVisible();
    await expect(suggestionRegion).not.toHaveAttribute('aria-busy', 'true');
    await page.clock.fastForward(20_000);
    expect(reads).toEqual({ [suggestions]: 2, [recent]: 2, [carryOn]: 1 });
  } finally {
    releaseSuggestions.resolve();
    releaseSuggestionRefresh.resolve();
  }
});

test('Media Home and Search use the same Continue episode after returning to Home', async ({ page }) => {
  const show = { id: 'plex:43', source: 'plex', title: 'Fixture series', itemType: 'container', metadata: { type: 'show' }, children: [], childCount: 1 };
  const episode = (itemIndex, title) => ({
    contentId: `plex:${430 + itemIndex}`, title, type: 'episode', grandparentId: 43,
    parentIndex: 1, itemIndex, duration: 240, playhead: 60,
  });
  let reads = 0;
  await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/v1/media/household/carry-on') {
      reads++;
      const active = reads === 1 ? episode(1, 'First episode') : episode(2, 'Second episode');
      return route.fulfill({ json: { items: [active], nowOn: [{ ...active, deviceId: 'family-screen' }] } });
    }
    if (pathname === '/api/v1/content/query/search/stream') {
      return route.fulfill({ contentType: 'text/event-stream', body: [
        { event: 'results', source: 'plex', items: [show], pending: [] }, { event: 'complete' },
      ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') });
    }
    return route.fulfill({ json: pathname.endsWith('/supervision/bootstrap') ? { enabled: false } : {} });
  });

  await page.goto('/media');
  const playing = page.getByTestId('home-row-now-on');
  await expect(playing).toContainText('First episode');
  const search = page.getByRole('textbox', { name: 'Search media…', exact: true });
  const play = page.getByTestId(`result-play-all-${show.id}`);
  await search.fill(show.title);
  await expect(play).toHaveText('Continue S1E1');
  expect(reads).toBe(1);

  await page.getByTestId('app-nav-browse').click();
  await expect(page).toHaveURL(/view=browse/);
  await page.getByTestId('app-nav-home').click();
  await expect(playing).toContainText('Second episode');
  await search.fill('');
  await search.fill(show.title);
  await expect(play).toHaveText('Continue S1E2');
  expect(reads).toBe(2);
});

for (const [kind, regionName, siblingTitle] of [
  ['suggestions', 'Suggestions', 'Recent fixture'],
  ['recent', 'Recent activity', 'Suggested fixture'],
]) {
  for (const width of [390, 1440]) {
    test(`Media Home keeps ${kind} Retry local at ${width}px`, async ({ page }) => {
      const suggestions = '/api/v1/media/suggestions';
      const recent = '/api/v1/media/household/recent';
      const carryOn = '/api/v1/media/household/carry-on';
      const failedPath = kind === 'suggestions' ? suggestions : recent;
      const reads = { [suggestions]: [], [recent]: [], [carryOn]: [] };
      const payloads = {
        [suggestions]: { rows: [{ id: 'new', title: 'New', items: [{ contentId: 'plex:100', title: 'Suggested fixture', type: 'movie' }] }] },
        [recent]: { items: [{ contentId: 'plex:200', title: 'Recent fixture', type: 'movie' }] },
        [carryOn]: { items: [], nowOn: [] },
      };
      const empty = kind === 'recent' && width === 390;
      let recovery;
      await page.setViewportSize({ width, height: 850 });
      await page.addInitScript(() => localStorage.setItem('media-app.first-use-done', 'done'));
      await page.routeWebSocket('**/*', () => {});
      await page.route('**/api/**', route => {
        const request = route.request();
        const { pathname } = new URL(request.url());
        if (!(pathname in reads)) return route.fulfill({ json: { enabled: false } });
        reads[pathname].push({ url: request.url(), method: request.method() });
        if (pathname !== failedPath) return route.fulfill({ json: payloads[pathname] });
        if (reads[failedPath].length === 1) return route.fulfill({ status: 409, json: {} });
        recovery = route;
      });

      await page.goto('/media');
      const other = page.getByText(siblingTitle, { exact: true });
      await expect(other).toBeVisible();
      const retry = page.getByTestId(`home-${kind}-error`).getByRole('button', { name: 'Try again' });
      await retry.press('Enter');
      await expect.poll(() => recovery).toBeTruthy();
      expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('BODY');
      const region = page.getByRole('region', { name: regionName, exact: true });
      await expect(region).toBeVisible();
      await expect(region).toBeFocused();
      await expect(region).toHaveAttribute('aria-busy', 'true');
      await expect(other).toBeVisible();
      const sibling = page.getByRole('region', {
        name: kind === 'suggestions' ? 'Recent activity' : 'Suggestions', exact: true,
      });
      await expect(sibling).not.toHaveAttribute('aria-busy', 'true');
      expect(reads[failedPath]).toEqual([reads[failedPath][0], reads[failedPath][0]]);
      expect(reads[failedPath][0].method).toBe('GET');
      expect(reads[kind === 'suggestions' ? recent : suggestions]).toHaveLength(1);
      expect(reads[carryOn]).toHaveLength(1);

      const leavesRegion = kind === 'recent' && width === 1440;
      const browse = page.getByRole('button', { name: 'Browse everything' });
      if (leavesRegion) {
        await page.keyboard.press('Tab');
        await expect(browse).toBeFocused();
      }
      await recovery.fulfill({ json: empty ? { items: [] } : payloads[failedPath] });
      const result = empty ? region.getByTestId('home-recents-empty')
        : region.getByText(kind === 'suggestions' ? 'Suggested fixture' : 'Recent fixture', { exact: true });
      await expect(result).toBeVisible();
      await expect(region).not.toHaveAttribute('aria-busy', 'true');
      await expect(leavesRegion ? browse : region).toBeFocused();
      await expect(other).toBeVisible();
    });
  }
}

test('Media Home Recent steps follow the current browser motion preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('media-app.first-use-done', 'done');
    window.recentRailSteps = [];
    const scrollBy = Element.prototype.scrollBy;
    Element.prototype.scrollBy = function (...args) {
      if (this.closest('[data-testid="home-row-recent"]') && this.matches('.home-row-scroll')) {
        window.recentRailSteps.push(args[0]);
      }
      return scrollBy.apply(this, args);
    };
  });
  await page.routeWebSocket('**/*', () => {});
  await page.route('**/api/**', route => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/v1/media/suggestions') return route.fulfill({ json: { rows: [] } });
    if (pathname === '/api/v1/media/household/carry-on') return route.fulfill({ json: { items: [], nowOn: [] } });
    if (pathname === '/api/v1/media/household/recent') {
      const items = Array.from({ length: 24 }, (_, index) => ({
        contentId: `plex:${500 + index}`, title: `Recent film ${index + 1}`, type: 'movie', kind: 'item',
      }));
      return route.fulfill({ json: { items } });
    }
    return route.fulfill({ json: { enabled: false } });
  });

  await page.goto('/media');
  const rail = page.getByTestId('home-row-recent').locator('.home-row-scroll');
  const forward = page.getByRole('button', { name: 'Scroll Recent forward', exact: true });
  const back = page.getByRole('button', { name: 'Scroll Recent back', exact: true });
  const steps = () => page.evaluate(() => window.recentRailSteps);
  const scrollLeft = () => rail.evaluate(element => element.scrollLeft);
  const stepSize = await rail.evaluate(element => Math.max(120, element.clientWidth * 0.85));

  await expect(forward).toBeEnabled();
  await forward.press('Enter');
  await expect.poll(steps).toEqual([{ left: stepSize, behavior: 'instant' }]);
  await expect.poll(scrollLeft).toBeGreaterThan(0);
  await expect(back).toBeEnabled();

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await back.press('Enter');
  expect(await steps()).toEqual([{ left: stepSize, behavior: 'instant' }, { left: -stepSize, behavior: 'smooth' }]);
  await expect.poll(scrollLeft).toBe(0);
  await expect(back).toBeDisabled();
});
