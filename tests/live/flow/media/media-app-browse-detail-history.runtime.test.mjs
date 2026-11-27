import { test, expect } from '@playwright/test';
import { openRowMenuAll } from './lib/search.mjs';

test.use({ viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure', actionTimeout: 10000 });
test.setTimeout(60000);

for (const entrypoint of ['Details', 'More → Open detail']) {
  test(`Browse ${entrypoint} preserves exact path, scroll, and triggering leaf on browser Back`, async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
    const items = Array.from({ length: 24 }, (_, index) => ({
      id: `demo:e${index + 1}`, title: `Episode ${index + 1}`,
      itemType: 'item', type: 'episode', index: index + 1,
    }));
    await page.route('**/api/v1/list/**', route => {
      const pathname = new URL(route.request().url()).pathname.replace(/\/expand$/, '');
      const rows = pathname === '/api/v1/list/'
        ? [{ id: 'demo:season-2', title: 'Season 2', itemType: 'container', type: 'season' }]
        : items;
      return route.fulfill({ json: { items: rows, total: rows.length } });
    });
    await page.route('**/api/v1/info/**', route => route.fulfill({ json: items[19] }));

    await page.goto('/media');
    await page.getByTestId('app-nav-browse').click();
    await page.getByTestId('browse-open-demo:season-2').click();
    await expect(page.locator('.browse-crumb--current')).toHaveText('Season 2');
    // A leaf row's tap opens its info view; its ⋯ menu keeps Open detail
    // behind More (four verbs lead).
    const action = page.getByTestId(entrypoint === 'Details' ? 'browse-open-demo:e20' : 'result-more-demo:e20');
    await action.scrollIntoViewIfNeeded();
    const canvas = page.getByTestId('media-canvas');
    const before = await canvas.evaluate(node => node.scrollTop);
    expect(before).toBeGreaterThan(0);
    if (entrypoint === 'Details') await action.click();
    else {
      await openRowMenuAll(page, 'demo:e20');
      await page.getByRole('menuitem', { name: 'Open detail' }).click();
    }
    await expect(page.getByTestId('detail-view').getByRole('heading')).toHaveText('Episode 20');
    await expect(page).toHaveURL(/view=detail/);

    await page.goBack();

    await expect(page).toHaveURL(/path=demo%2Fseason-2/);
    await expect(page.locator('.browse-crumb--current')).toHaveText('Season 2');
    await expect(page.getByTestId('browse-open-demo:e20')).toBeFocused();
    await expect.poll(() => canvas.evaluate(node => node.scrollTop)).toBe(before);
  });
}
