/**
 * Emergency Lockdown — e2e happy path.
 *
 * The real trigger is a garage fingerprint scan (no reader in CI), so this drives
 * the overlay via the dev URL seam (`?emergency=triggering|locked`, which seeds
 * the hook's initial phase) and route-mocks the server-scan POSTs so the cancel
 * and release transitions can be exercised deterministically.
 *
 * Per CLAUDE.md test discipline: assertions always run; we fail fast if the
 * overlay never appears rather than skipping.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = FRONTEND_URL;

test.describe('emergency lockdown overlay', () => {
  test('triggering screen shows the DEFCON overlay + cancel affordance', async ({ page }) => {
    await page.goto(`${BASE_URL}/fitness?emergency=triggering`);

    const overlay = page.locator('.emergency-overlay--triggering');
    await expect(overlay).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.emergency-headline')).toHaveText('SYSTEM LOCKDOWN INITIATED');
    // Cancel affordance is present while the ceremony runs.
    await expect(page.locator('.emergency-cancel')).toBeVisible();
  });

  test('cancel requires a confirming scan, then returns to normal', async ({ page }) => {
    // Mock the server-side admin scan as confirmed.
    await page.route('**/api/v1/fitness/emergency/abort', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ confirmed: true }) })
    );

    await page.goto(`${BASE_URL}/fitness?emergency=triggering`);
    const cancelBtn = page.locator('.emergency-cancel');
    await expect(cancelBtn).toBeVisible({ timeout: 15000 });

    // First tap arms the confirm prompt…
    await cancelBtn.dispatchEvent('pointerdown');
    await expect(cancelBtn).toHaveText('SCAN TO CONFIRM CANCEL');

    // …second tap runs the (mocked, confirmed) scan → overlay dismisses.
    await cancelBtn.dispatchEvent('pointerdown');
    await expect(page.locator('.emergency-overlay')).toHaveCount(0, { timeout: 15000 });
  });

  test('locked screen shows release time and is inert', async ({ page }) => {
    await page.goto(`${BASE_URL}/fitness?emergency=locked`);

    const overlay = page.locator('.emergency-overlay--locked');
    await expect(overlay).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.emergency-headline--locked')).toHaveText('LOCKED');
    await expect(page.locator('.emergency-subline')).toContainText('Back at');
  });

  test('press-and-hold 3s releases the lock (confirmed scan)', async ({ page }) => {
    await page.route('**/api/v1/fitness/emergency/release', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ released: true }) })
    );

    await page.goto(`${BASE_URL}/fitness?emergency=locked`);
    const overlay = page.locator('.emergency-overlay--locked');
    await expect(overlay).toBeVisible({ timeout: 15000 });

    // Begin the hold; the 3s timer fires the release scan without needing pointerup.
    // (The "Scanning…" affordance flashes only briefly before the mocked release
    // resolves and unmounts the overlay, so assert the end state — overlay gone.)
    await overlay.dispatchEvent('pointerdown');
    await expect(page.locator('.emergency-overlay')).toHaveCount(0, { timeout: 15000 });
  });
});
