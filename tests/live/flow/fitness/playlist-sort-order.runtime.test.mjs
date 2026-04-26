// tests/live/flow/fitness/playlist-sort-order.runtime.test.mjs
/**
 * End-to-end verification that the Warmups playlist renders with rated items
 * (userRating > 0) ahead of unrated ones. Regression target: `filteredItems`
 * in FitnessShow used to re-sort every list by `itemIndex` ascending, which
 * steamrolled the backend+frontend rating sort for grab-bag playlists.
 *
 * Strategy:
 *   1. Hit the API to discover which items are rated vs unrated.
 *   2. Navigate through the fitness UI by clicking the Short nav tab, then
 *      the Warmups playlist tile.
 *   3. Extract rendered titles from the DOM and verify rated titles all
 *      appear before any unrated title.
 *
 * The route-based deep link (/fitness/show/:id) wouldn't trigger a full
 * playlist render in tests, so we navigate via UI clicks.
 */

import { test, expect } from '@playwright/test';

const PLAYLIST_ID = '674570'; // "Warmups"

test.describe('Playlist sort order — UI render respects backend sort', () => {
  test('warmups playlist renders rated items before unrated ones', async ({ page }) => {
    // Grab rating data from the API (post-backend-sort)
    const apiResponse = await page.request.get(`/api/v1/fitness/show/${PLAYLIST_ID}/playable`);
    expect(apiResponse.ok()).toBeTruthy();
    const api = await apiResponse.json();
    expect(api.info?.type).toBe('playlist');

    const isRated = (it) => {
      const n = Number(it.userRating);
      return Number.isFinite(n) && n > 0;
    };
    const ratedTitles = api.items.filter(isRated).map((it) => it.title);
    const unratedTitles = api.items.filter((it) => !isRated(it)).map((it) => it.title);
    expect(ratedTitles.length).toBeGreaterThan(0);
    expect(unratedTitles.length).toBeGreaterThan(0);

    // Navigate via the UI: open fitness app, click Short nav, click Warmups tile
    await page.goto('/fitness');
    await page.waitForSelector('.fitness-app-container', { timeout: 15000 });

    // Click the "Short" category button in the top nav
    const shortNav = page.locator('button:has-text("Short")').first();
    await shortNav.click();

    // Wait for the Short menu grid to render
    await page.waitForTimeout(1500);

    // Tiles in the Short menu are <img> elements with alt text
    const warmupsTile = page.getByRole('img', { name: 'Warmups' }).first();
    await warmupsTile.waitFor({ state: 'visible', timeout: 15000 });
    await warmupsTile.click();

    // Wait for the playlist view to render with episode titles
    const firstRatedTitle = ratedTitles[0];
    await page.waitForFunction(
      (needle) => document.body.innerText.includes(needle),
      firstRatedTitle,
      { timeout: 30000 }
    );

    // Extract DOM-rendered order
    const renderedOrder = await page.evaluate((titles) => {
      const text = document.body.innerText;
      return titles
        .map((t) => ({ title: t, pos: text.indexOf(t) }))
        .filter((x) => x.pos >= 0)
        .sort((a, b) => a.pos - b.pos)
        .map((x) => x.title);
    }, [...ratedTitles, ...unratedTitles]);

    expect(renderedOrder.length).toBeGreaterThan(2);

    // Assertion: every rated title appears before any unrated title.
    const ratedSet = new Set(ratedTitles);
    const firstUnratedIdx = renderedOrder.findIndex((t) => !ratedSet.has(t));
    if (firstUnratedIdx === -1) return; // nothing to compare

    const lastRatedIdx = renderedOrder.reduce(
      (last, t, i) => (ratedSet.has(t) ? i : last),
      -1
    );
    expect(lastRatedIdx).toBeLessThan(firstUnratedIdx);
  });
});
