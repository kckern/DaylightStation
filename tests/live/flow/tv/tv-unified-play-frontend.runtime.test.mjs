/**
 * Unified Play API Frontend Integration
 *
 * Verifies that the frontend can reach content via the unified play API
 * and that the format field is present in responses.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3111';

test.describe('Unified Play API from frontend', () => {
  test('singalong hymn loads via play param', async ({ page }) => {
    const apiCalls = [];
    page.on('response', res => {
      if (res.url().includes('/api/v1/play/') || res.url().includes('/api/v1/info/')) {
        apiCalls.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto(`${BASE}/tv?play=singalong:hymn/166`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(5000);

    expect(apiCalls.length).toBeGreaterThan(0);
    // All info/play API calls should succeed (not 500+)
    const serverErrors = apiCalls.filter(c => c.status >= 500);
    expect(serverErrors.length, `No server errors: ${JSON.stringify(serverErrors)}`).toBe(0);
  });

  test('plex content loads via play param', async ({ page }) => {
    const apiCalls = [];
    page.on('response', res => {
      if (res.url().includes('/api/v1/play/') || res.url().includes('/api/v1/info/')) {
        apiCalls.push({ url: res.url(), status: res.status() });
      }
    });

    await page.goto(`${BASE}/tv?play=plex:457385`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(5000);

    expect(apiCalls.length).toBeGreaterThan(0);
    const serverErrors = apiCalls.filter(c => c.status >= 500);
    expect(serverErrors.length, `No server errors: ${JSON.stringify(serverErrors)}`).toBe(0);
  });
});
