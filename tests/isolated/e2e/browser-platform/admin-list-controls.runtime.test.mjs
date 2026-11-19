import { expect, test } from '@playwright/test';

const index = '/admin/content/lists/menus';
const folder = index + '/family-picks';

for (const { width, hasTouch } of [{ width: 390, hasTouch: true }, { width: 1440, hasTouch: false }]) {
  test.describe(`Admin list controls at ${width}px`, () => {
    test.use({ hasTouch, serviceWorkers: 'block', viewport: { width, height: 850 } });

    test.beforeEach(async ({ page }) => {
      await page.routeWebSocket('**/*', () => {});
      await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (!path.startsWith('/api/')) return route.fallback();
        if (path.endsWith('/supervision/bootstrap')) return route.fulfill({ json: { enabled: false } });
        if (path === '/api/v1' + index) {
          return route.fulfill({ json: { lists: [{ name: 'family-picks', active: true }] } });
        }
        if (path === '/api/v1' + folder) {
          return route.fulfill({ json: {
            name: 'family-picks',
            sections: [{ title: 'Tonight', items: [{ uid: 'tonight-item', label: 'Show to watch', action: 'Play', input: 'plex:123' }] }],
          } });
        }
        return route.fulfill({ json: {} });
      });

      await page.goto(index);
      await page.getByRole('link', { name: /Family Picks/ }).click();
      await expect(page).toHaveURL(new RegExp(folder + '$'));
    });

    test('keeps the first arrow selection and tabs out in the trigger order', async ({ page }) => {
      const main = page.getByRole('main');
      const trigger = main.getByRole('button', { name: 'List actions', exact: true });
      const menu = page.getByRole('menu', { name: 'List actions', exact: true });
      const firstAction = menu.getByRole('menuitem', { name: 'Menu Settings', exact: true });
      const deleteAction = menu.getByRole('menuitem', { name: 'Delete Menu', exact: true });
      const collapse = main.getByRole('button', { name: 'Collapse Tonight', exact: true });
      const search = main.getByPlaceholder('Search items...');
      await trigger.focus();

      const start = new Date('2026-01-01T00:00:00Z');
      await page.clock.install({ time: start });
      await page.clock.pauseAt(new Date(start.getTime() + 1000));
      await page.keyboard.press('Enter');
      await menu.waitFor({ state: 'attached' });
      expect.soft(await firstAction.evaluate(item => document.activeElement === item)).toBe(true);
      await page.keyboard.press('ArrowDown');
      await page.clock.runFor(160);
      await expect(deleteAction).toBeFocused();

      await page.keyboard.press('Tab');
      await expect(menu).toBeHidden();
      await expect(collapse).toBeFocused();

      await trigger.press('Space');
      await expect(firstAction).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(menu).toBeHidden();
      await expect(search).toBeFocused();
    });

    test('names and operates the list and section controls', async ({ page }) => {
      const main = page.getByRole('main');
      const back = main.getByRole('button', { name: 'Back', exact: true });
      const listActions = main.getByRole('button', { name: 'List actions', exact: true });
      const collapse = main.getByRole('button', { name: 'Collapse Tonight', exact: true });
      const expand = main.getByRole('button', { name: 'Expand Tonight', exact: true });
      const sectionActions = main.getByRole('button', { name: 'Section actions for Tonight', exact: true });
      for (const control of [back, listActions, collapse, sectionActions]) {
        await expect(control).toBeVisible();
        const { width: targetWidth, height: targetHeight } = await control.boundingBox();
        if (hasTouch) {
          // Firefox can report a fractional boundary for a 44px control.
          expect(Math.round(targetWidth * 100) / 100).toBeGreaterThanOrEqual(44);
          expect(Math.round(targetHeight * 100) / 100).toBeGreaterThanOrEqual(44);
        } else {
          expect(targetWidth).toBeLessThan(44);
          expect(targetHeight).toBeLessThan(44);
        }
      }

      // Press Escape as soon as the portaled menu mounts.
      await listActions.evaluate(trigger => new Promise(resolve => {
        const observer = new MutationObserver(() => {
          const menu = document.getElementById(trigger.getAttribute('aria-controls'));
          if (trigger.getAttribute('aria-expanded') !== 'true' || !menu || menu.getClientRects().length === 0) return;
          observer.disconnect();
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, composed: true }));
          resolve();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        trigger.focus();
        trigger.click();
      }));
      await expect(listActions).toHaveAttribute('aria-expanded', 'false');
      const listSettings = page.getByRole('menuitem', { name: 'Menu Settings', exact: true });
      await expect(listSettings).toBeHidden();
      await expect(listActions).toBeFocused();

      const search = main.getByPlaceholder('Search items...');
      await search.focus();
      if (hasTouch) await listActions.tap({ position: { x: 2, y: 22 } });
      else await listActions.press('Enter');
      await expect(listSettings).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(page.getByRole('menuitem', { name: 'Delete Menu', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(listActions).toHaveAttribute('aria-expanded', 'false');
      await expect(listActions).toBeFocused();

      await expect(listSettings).toBeHidden();
      await listActions.press('Enter');
      await expect(listSettings).toBeVisible();
      await search.click();
      await expect(listActions).toHaveAttribute('aria-expanded', 'false');
      await expect(search).toBeFocused();

      const row = page.getByTestId('item-row-0-0');
      await expect(row).toBeVisible();
      await expect(collapse).toHaveAttribute('aria-expanded', 'true');
      await collapse.press('Enter');
      await expect(row).toBeHidden();
      await expect(expand).toHaveAttribute('aria-expanded', 'false');
      await expect(expand).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(row).toBeVisible();

      await sectionActions.press('Enter');
      const sectionSettings = page.getByRole('menuitem', { name: 'Section Settings', exact: true });
      await expect(sectionSettings).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sectionActions).toHaveAttribute('aria-expanded', 'false');
      await expect(sectionActions).toBeFocused();
      await expect(sectionSettings).toBeHidden();
      await sectionActions.press('Enter');
      await sectionSettings.click();
      const dialog = page.getByRole('dialog', { name: 'Section Settings: Tonight' });
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(sectionActions).toHaveAttribute('aria-expanded', 'false');

      await back.press('Enter');
      await expect(page).toHaveURL(new RegExp(index + '$'));
    });
  });
}
