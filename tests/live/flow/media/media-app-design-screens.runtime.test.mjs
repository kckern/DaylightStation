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
    await page.addInitScript(() => { try { localStorage.clear(); } catch {} });
  });

  test('canonical states', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    // 01 home idle — fresh load, home view
    await page.goto('/media');
    await page.waitForSelector('[data-testid="home-view"]');
    await snap(page, '01-home-idle');

    // 02 search results — click input to focus (keeps overlay open), then fill
    await page.getByTestId('media-search-input').click();
    await page.getByTestId('media-search-input').fill('lonesome');
    await page.waitForSelector('[data-testid^="result-row-"]', { timeout: 15000 });
    await page.waitForTimeout(400);
    await snap(page, '02-search-results');

    // 03 result peek — JS click on the title button of the first result to open peek.
    // (.evaluate bypasses overlay pointer-event interception without dispatching pointerdown,
    //  so the search bar's useDismissable does not close the overlay.)
    const firstOpen = page.locator('[data-testid^="result-open-"]').first();
    await firstOpen.evaluate((el) => el.click());
    await page.waitForSelector('[data-testid^="result-peek-"]');
    await page.waitForTimeout(200);
    await snap(page, '03-result-peek');

    // 04 cast picker open — JS click on the cast <button> (not the root <span>).
    // 'button[data-testid^="cast-button-"]' skips cast-button-root-* spans.
    const firstCast = page.locator('button[data-testid^="cast-button-"]').first();
    await firstCast.evaluate((el) => el.click());
    await page.waitForSelector('[data-testid="dispatch-target-picker"]');
    await page.waitForTimeout(200);
    await snap(page, '04-cast-picker-open');

    // 05 search empty state — stub SSE to return instant empty complete so Immich
    // results don't prevent the empty state from appearing.
    await page.route('**/api/v1/content/query/search/stream**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'data: {"event":"complete","query":"zzzqqq-nonsense-1234"}\n\n',
      });
    });
    await page.getByTestId('media-search-input').click();
    await page.getByTestId('media-search-input').fill('zzzqqq-nonsense-1234');
    await page.waitForSelector('[data-testid="search-empty"]', { timeout: 10000 });
    await page.waitForTimeout(200);
    await snap(page, '05-search-empty');
    await page.unroute('**/api/v1/content/query/search/stream**');

    // 06 search error state — stub SSE to abort, click input to refocus, then fill
    await page.route('**/api/v1/content/query/search/stream**', (route) => route.abort('failed'));
    await page.getByTestId('media-search-input').click();
    await page.getByTestId('media-search-input').fill('hello');
    await page.waitForSelector('[data-testid="search-error"]', { timeout: 10000 });
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
