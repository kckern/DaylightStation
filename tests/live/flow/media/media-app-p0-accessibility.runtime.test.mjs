import { test, expect } from '@playwright/test';
import { SIZES, smallTargets, offscreenControls, noHorizontalScroll } from './lib/a11yProbe.mjs';
import { freshPage, isPhone, playArrivalHere, searchFor, skipFirstUse } from './lib/mediaDriver.mjs';

// Task 8 — accessibility and size parity (RELY.11a, RELY.12a, RELY.13a, NF-A11Y,
// NF-DEV). Everything is measured from the live page with ordinary pointer and
// keyboard input at phone, tablet and laptop sizes (and the 360 px floor).
test.use({ trace: 'retain-on-failure', serviceWorkers: 'block' });
test.setTimeout(180000);

const fmt = (list) => list.map((x) => `${x.id ?? x.name} ${x.w}x${x.h}`).join('; ');

for (const [size, viewport] of SIZES) {
  test.describe(size, () => {
    test.use({ viewport });

    test(`[RELY.11a][NF-DEV-02] ${size}: every main action is in the viewport and a 44px target, in every state`, async ({ page }) => {
      await freshPage(page);
      await expect(page.getByTestId('first-use-card')).toBeVisible({ timeout: 30000 });
      // Home, first use, with the aim explained.
      expect(await smallTargets(page), 'home: ').toEqual([]);
      const phone = isPhone(page);
      expect(await offscreenControls(page, [
        phone ? '[data-testid="media-search-launcher"]' : '[data-testid="media-search-bar"] input, input[placeholder="Search media…"]',
        '[data-testid="house-indicator"]', '[data-testid="settings-menu-trigger"]',
        phone ? '[data-testid="app-tab-home"]' : '[data-testid="app-nav-home"]',
        phone ? '[data-testid="app-tab-fleet"]' : '[data-testid="app-nav-fleet"]',
      ])).toEqual([]);
      expect(await noHorizontalScroll(page)).toBe(true);
      await skipFirstUse(page);

      // Search open, with results (incl. the row action icons and the aim line).
      await searchFor(page, 'Arrival');
      const searching = await smallTargets(page);
      expect(searching, `search: ${fmt(searching)}`).toEqual([]);
      if (phone) await page.getByRole('button', { name: 'Close search' }).click(); else await page.keyboard.press('Escape');

      // Playing: handle, outcome row (Undo), controls.
      await playArrivalHere(page);
      await expect(page.getByTestId('mini-toggle')).toBeVisible();
      const playing = await smallTargets(page);
      expect(playing, `playing: ${fmt(playing)}`).toEqual([]);
      expect(await offscreenControls(page, ['[data-testid="mini-toggle"]', '[data-testid="mini-next"]', '[data-testid="mini-stop"]', '[data-testid="mini-player-open-nowplaying"]'])).toEqual([]);

      // Now Playing: transport, queue editing, the several-screens picker.
      await page.getByTestId('mini-player-open-nowplaying').click();
      await expect(page.getByTestId('queue-panel')).toBeVisible({ timeout: 15000 });
      const np = await smallTargets(page);
      expect(np, `now playing: ${fmt(np)}`).toEqual([]);
      expect(await noHorizontalScroll(page)).toBe(true);

      // A portalled menu (Settings) and a dialog (Start fresh) hold the same floor.
      await page.getByTestId('settings-menu-trigger').click();
      await expect(page.getByTestId('settings-menu-panel')).toBeVisible();
      const menu = await smallTargets(page, { scope: '[data-testid="settings-menu-panel"]' });
      expect(menu, `settings menu: ${fmt(menu)}`).toEqual([]);
      await page.getByTestId('settings-reset-session').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const dlg = await smallTargets(page, { scope: '[role="dialog"]' });
      expect(dlg, `dialog: ${fmt(dlg)}`).toEqual([]);
      // Esc dismisses the dialog; the person is back where they were.
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });
  });
}
