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
      // The play's own quiet confirmation is up, with its Undo.
      const row = page.locator('[data-testid^="dispatch-row-"]').filter({ hasText: 'Playing Arrival here' });
      await expect(row).toBeVisible({ timeout: 10000 });
      const undo = row.getByTestId('item-action-undo');
      await expect(undo).toBeVisible();
      // Let the handle settle into its playing form (video dock) first, so only
      // the notice can differ between the two measurements.
      await expect(page.getByTestId('mini-player-video-dock')).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(1000);
      const mini = page.getByTestId('media-mini-player');
      const watched = {
        canvas: page.getByTestId('media-canvas'),
        anchor: page.getByTestId('media-outcome-anchor'),
        mini,
        miniTitle: page.getByTestId('mini-player-open-nowplaying'),
        toggle: page.getByTestId('mini-toggle'),
        stop: page.getByTestId('mini-stop'),
      };
      const withNotice = {};
      for (const [name, locator] of Object.entries(watched)) withNotice[name] = await box(locator);

      // The notice sits above the handle and covers none of its hit targets.
      const rowBox = await box(row);
      const miniBox = await box(mini);
      expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(miniBox.y + 0.5);
      for (const control of await mini.locator('button').all()) {
        if (!(await control.isVisible())) continue;
        expect(intersects(rowBox, await box(control)), 'notice overlaps a mini-player control').toBe(false);
      }
      // The handle and the notice's own Undo both take ordinary pointer input.
      await watched.toggle.click({ trial: true });
      await watched.stop.click({ trial: true });
      await undo.click({ trial: true });

      // When the notice goes away on its own, nothing on the page moves.
      await expect(row).toHaveCount(0, { timeout: 20000 });
      const moved = [];
      for (const [name, locator] of Object.entries(watched)) {
        const after = await box(locator);
        for (const key of ['x', 'y', 'width', 'height']) {
          if (Math.abs(after[key] - withNotice[name][key]) >= 0.5) moved.push(`${name}.${key} ${withNotice[name][key]} -> ${after[key]}`);
        }
      }
      expect(moved, 'page elements moved with the notice').toEqual([]);
      await expect(page.getByTestId('media-outcome-announcer')).toBeAttached();
    });
  });
}
