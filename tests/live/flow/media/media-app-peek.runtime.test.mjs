import { test, expect } from '@playwright/test';
import { markFirstUseDone } from './lib/firstUse.mjs';

test.describe('MediaApp — P5 peek', () => {
  test.beforeEach(async ({ page, context }) => {
    await markFirstUseDone(context);
    await page.goto('/media');
    await page.evaluate(() => localStorage.clear());
  });

  test('FleetView has a Remote (peek) button per device that opens PeekPanel', async ({ page }) => {
    await page.goto('/media');
    // The header indicator hides when nothing plays; Devices is the always-there way in.
    await page.getByTestId('app-nav-fleet').click();
    await expect(page.getByTestId('fleet-view')).toBeVisible({ timeout: 10000 });

    const peekBtn = page.locator('[data-testid^="fleet-peek-"]').first();
    await expect(peekBtn).toBeVisible({ timeout: 5000 });
    await peekBtn.click();

    await expect(page.getByTestId('peek-panel')).toBeVisible({ timeout: 5000 });
    // The remote carries the shared transport: one toggle (Play/Pause by state),
    // previous/next and stop — peek-play/peek-pause were never separate controls here.
    await expect(page.getByTestId('np-transport')).toBeVisible();
    await expect(page.getByTestId('np-toggle')).toBeVisible();
    await expect(page.getByTestId('np-stop')).toBeVisible();
  });
});
