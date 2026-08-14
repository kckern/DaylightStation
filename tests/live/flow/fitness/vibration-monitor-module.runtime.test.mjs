/**
 * Vibration Monitor module route smoke test.
 *
 * Confirms the legacy deep-link id used by `/fitness/module/vibration_monitor` is
 * still resolvable by the fitness module registry and renders the module shell.
 */
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

test('Vibration Monitor module route renders from legacy id', async ({ page }) => {
  await page.goto(`${FRONTEND_URL}/fitness/module/vibration_monitor`);

  await expect(page.locator('.fitness-module-container')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('h3', { hasText: 'Vibration Monitor' })).toBeVisible({ timeout: 15000 });
  expect(page.url()).toContain('/fitness/module/vibration_monitor');
});
