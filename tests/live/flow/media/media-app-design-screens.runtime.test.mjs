import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'docs/_wip/audits/media-app-screens');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function snap(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: true });
}

test.describe('MediaApp — design screenshots', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('media-app.first-use-done', 'journey'); } catch {} });
  });

  test('canonical states', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 01 home idle — fresh load, home view
    await page.goto('/media');
    await page.waitForSelector('[data-testid="home-view"]');
    await snap(page, '01-home-idle');

    // 02 search results — the dock's "Search media…" textbox; results are combobox options.
    const searchBox = page.getByRole('textbox', { name: 'Search media…' });
    await searchBox.click();
    await searchBox.fill('Arrival');
    await page.waitForSelector('[data-testid^="combobox-option-"]', { timeout: 20000 });
    await page.waitForTimeout(400);
    await snap(page, '02-search-results');

    // 03 result actions — the first result's ⋯ menu (the inline peek was retired with the unified selector;
    // a result's verbs and Open detail live here now). Real pointer input: the menu keeps the combobox open.
    await page.locator('[data-testid^="combobox-option-"]').first().getByRole('button', { name: 'More actions' }).click();
    await page.waitForSelector('[data-testid^="result-more-menu-"]');
    await page.waitForTimeout(200);
    await snap(page, '03-result-actions');
    await page.keyboard.press('Escape');

    // 04 destination picker open — the header "Playing on" control.
    await page.keyboard.press('Escape');
    await page.getByTestId('cast-target-chip').click();
    await page.waitForSelector('[data-testid="cast-popover"]');
    await page.waitForTimeout(200);
    await snap(page, '04-cast-picker-open');
    await page.keyboard.press('Escape');

    // 05 search empty state — stub SSE to return instant empty complete so Immich
    // results don't prevent the empty state from appearing.
    await page.route('**/api/v1/content/query/search/stream**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"event":"complete","query":"zzzqqq-nonsense-1234"}\n\n',
      });
    });
    await searchBox.click();
    await searchBox.fill('zzzqqq-nonsense-1234');
    await page.getByRole('listbox').getByText('No results').waitFor({ timeout: 10000 });
    await page.waitForTimeout(200);
    await snap(page, '05-search-empty');
    await page.unroute('**/api/v1/content/query/search/stream**');

    // 06 search error state — stub SSE to abort, click input to refocus, then fill
    await page.route('**/api/v1/content/query/search/stream**', (route) => route.abort('failed'));
    await searchBox.click();
    await searchBox.fill('hello');
    await page.waitForSelector('[data-testid="stream-global-error"]', { timeout: 10000 });
    await page.waitForTimeout(200);
    await snap(page, '06-search-error');
    await page.unroute('**/api/v1/content/query/search/stream**');

    // 07 mobile (narrow viewport), fresh home view
    await page.setViewportSize({ width: 420, height: 800 });
    await page.goto('/media');
    await page.waitForSelector('[data-testid="home-view"]');
    await page.waitForTimeout(200);
    await snap(page, '07-home-mobile');
  });
});
