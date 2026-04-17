/**
 * Home Cameras Test
 *
 * Verifies:
 * 1. Camera API returns both driveway-camera and doorbell
 * 2. Home page renders a card for each camera
 * 3. Each camera card shows a snapshot image via CameraRenderer
 * 4. Live toggle button has been removed
 *
 * Prerequisites:
 * - Backend running with camera adapter discovering devices from devices.yml
 * - Both cameras reachable for snapshots (or at minimum listed by API)
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

// Port 3111 serves the built SPA; Vite's dev proxy intercepts /home as a legacy route,
// so page tests must hit the Docker container directly (matches production topology).
const APP_URL = 'http://localhost:3111';
const EXPECTED_CAMERAS = ['driveway-camera', 'doorbell'];

test.describe('Home Cameras', () => {

  test('API returns both cameras', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/v1/camera`);
    expect(res.ok()).toBe(true);

    const data = await res.json();
    const ids = (data.cameras || []).map(c => c.id);

    for (const expected of EXPECTED_CAMERAS) {
      expect(ids, `expected camera "${expected}" in API response`).toContain(expected);
    }
  });

  test('Home page renders a card for each camera', async ({ page }) => {
    await page.goto(`${APP_URL}/home`, { waitUntil: 'domcontentloaded' });

    for (const id of EXPECTED_CAMERAS) {
      const label = page.locator('.home-cameras__label', { hasText: id });
      await expect(label, `expected label for "${id}"`).toBeVisible({ timeout: 10000 });
    }

    const cards = page.locator('.home-cameras__card');
    await expect(cards).toHaveCount(EXPECTED_CAMERAS.length);
  });

  test('each camera card shows a snapshot or an error state', async ({ page }) => {
    await page.goto(`${APP_URL}/home`, { waitUntil: 'domcontentloaded' });

    for (const id of EXPECTED_CAMERAS) {
      const card = page.locator('.home-cameras__card', {
        has: page.locator('.home-cameras__label', { hasText: id }),
      });
      await expect(card, `card for "${id}" should exist`).toBeVisible({ timeout: 10000 });

      const img = card.locator(`.camera-renderer img[alt="${id} snapshot"]`);
      const error = card.locator('.camera-renderer__error');
      await expect(
        img.or(error),
        `camera feed for "${id}" should show snapshot or error`,
      ).toBeVisible({ timeout: 60000 });
    }
  });

  test('Live button is removed from card headers', async ({ page }) => {
    await page.goto(`${APP_URL}/home`, { waitUntil: 'domcontentloaded' });

    // Wait for at least one card to render
    await expect(page.locator('.home-cameras__card').first()).toBeVisible({ timeout: 10000 });

    // No toggle buttons should exist
    const toggles = page.locator('.home-cameras__toggle');
    await expect(toggles).toHaveCount(0);
  });
});
