import { test, expect } from '@playwright/test';

// Owner rule (PR-6 / RELY.1a): an outcome notice never takes page space or
// moves the page, and never covers the mini player's controls. Measured with
// ordinary input at phone, tablet and laptop sizes.
const SIZES = [
  ['phone', { width: 390, height: 844 }],
  ['tablet', { width: 820, height: 1180 }],
  ['laptop', { width: 1440, height: 900 }],
];

const box = async (locator) => {
  const b = await locator.boundingBox();
  expect(b, 'element must be laid out').toBeTruthy();
  return b;
};
const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const [size, viewport] of SIZES) {
  test.describe(size, () => {
    test.use({ viewport });
    test.setTimeout(120000);

    test(`[RELY.1a] ${size}: an outcome row overlays without moving the page or covering the mini player`, async ({ page }) => {
      await page.addInitScript(() => {
        if (!sessionStorage.getItem('cleared')) { localStorage.clear(); sessionStorage.setItem('cleared', '1'); }
      });
      await page.goto('/media');
      if (size === 'phone') {
        await expect(page.getByTestId('media-search-launcher')).toBeVisible({ timeout: 30000 });
        await page.getByTestId('media-search-launcher').click();
        await page.getByRole('searchbox', { name: 'Search media', exact: true }).fill('Arrival');
        await page.getByTestId('search-mode-results').getByText('Arrival', { exact: true }).first().click();
        await page.getByRole('button', { name: 'Close search' }).click();
      } else {
        const search = page.getByRole('textbox', { name: 'Search media…' });
        await expect(search).toBeVisible({ timeout: 30000 });
        await search.fill('Arrival');
        const option = page.getByRole('option').filter({ hasText: 'Arrival' }).filter({ hasText: 'Movie' });
        await expect(option).toHaveCount(1, { timeout: 15000 });
        await option.click();
        await page.keyboard.press('Escape');
      }
      await expect(page.getByTestId('mini-player-open-nowplaying')).toContainText('Arrival', { timeout: 30000 });
      // Let the first quiet confirmation (and its Undo window) pass.
      await expect(page.getByTestId('dispatch-tray')).toHaveCount(0, { timeout: 20000 });

      await page.getByTestId(size === 'phone' ? 'app-tab-home' : 'app-nav-home').click();
      const tile = page.getByTestId('recent-plex:55854');
      await expect(tile).toBeVisible({ timeout: 15000 });
      const mini = page.getByTestId('media-mini-player');
      const watched = {
        canvas: page.getByTestId('media-canvas'),
        mini,
        tile,
        toggle: page.getByTestId('mini-toggle'),
        stop: page.getByTestId('mini-stop'),
      };
      const before = {};
      for (const [name, locator] of Object.entries(watched)) before[name] = await box(locator);

      await tile.click();
      const row = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Playing Arrival here' });
      await expect(row).toBeVisible({ timeout: 10000 });
      const undo = row.getByTestId('item-action-undo');
      await expect(undo).toBeVisible();

      // Nothing on the page moved or resized when the notice appeared.
      for (const [name, locator] of Object.entries(watched)) {
        const after = await box(locator);
        for (const key of ['x', 'y', 'width', 'height']) {
          expect(Math.abs(after[key] - before[name][key]), `${name}.${key} moved`).toBeLessThan(0.5);
        }
      }
      // The notice sits above the handle and covers none of its hit targets.
      const rowBox = await box(row);
      const miniBox = await box(mini);
      expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(miniBox.y + 0.5);
      for (const control of await mini.locator('button').all()) {
        if (!(await control.isVisible())) continue;
        expect(intersects(rowBox, await box(control)), 'notice overlaps a mini-player control').toBe(false);
      }
      // The handle stays operable with the notice up, and Undo is ordinary-clickable.
      await expect(watched.toggle).toBeEnabled();
      await watched.toggle.click({ trial: true });
      await undo.click();
      await expect(row).toHaveCount(0);
      await expect(page.getByTestId('media-outcome-announcer')).toBeAttached();
    });
  });
}
