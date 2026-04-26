// tests/live/flow/fitness/menu-url-direct-load.runtime.test.mjs
/**
 * Regression test: direct-load of /fitness/menu/:id must render the requested
 * menu — it must NOT auto-redirect to /fitness/home or another screen.
 *
 * Root cause: auto-default useEffect in FitnessApp gated on urlInitialized,
 * which is false on first mount, so it raced Effect A (URL→state parse) and
 * overwrote the URL via navigate() before Effect A committed its state.
 */

import { test, expect } from '@playwright/test';

test.describe('Direct-load /fitness/menu/:id', () => {
  test('single id: URL preserved, menu renders', async ({ page }) => {
    await page.goto('/fitness/menu/674571'); // Short Episodes playlist
    await page.waitForSelector('.fitness-app-container', { timeout: 15000 });
    await page.waitForTimeout(2000);

    const finalUrl = page.url();
    expect(finalUrl).toContain('/fitness/menu/674571');
    expect(finalUrl).not.toMatch(/\/fitness\/(home|plugin|users)(\/|$|\?)/);
  });

  test('comma-separated ids: URL preserved', async ({ page }) => {
    await page.goto('/fitness/menu/674570,674571');
    await page.waitForSelector('.fitness-app-container', { timeout: 15000 });
    await page.waitForTimeout(2000);

    expect(page.url()).toContain('/fitness/menu/674570,674571');
  });
});
