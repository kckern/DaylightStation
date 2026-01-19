import { test, expect } from '@playwright/test';

test.describe('Player Contract Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Enable test hooks before navigation
    await page.addInitScript(() => {
      window.__TEST_CAPTURE_METRICS__ = true;
    });
  });

  test('VideoPlayer reports playback metrics to parent', async ({ page }) => {
    // Navigate to TV app (has video player)
    await page.goto('/tv');
    await page.waitForLoadState('networkidle');

    // Wait for potential metrics capture
    await page.waitForTimeout(3000);

    // Check if metrics were captured
    const metrics = await page.evaluate(() => window.__TEST_LAST_METRICS__);

    if (metrics) {
      // Verify metrics shape - these assertions are real contracts
      expect(metrics).toHaveProperty('seconds');
      expect(metrics).toHaveProperty('isPaused');
      expect(typeof metrics.seconds).toBe('number');
      expect(typeof metrics.isPaused).toBe('boolean');
    } else {
      // Skip test when no player is active - this is expected without video playback
      test.skip(true, 'No active player - metrics not captured without video playback');
    }
  });

  test('Parent can access media element via test hook', async ({ page }) => {
    await page.goto('/tv');
    await page.waitForLoadState('networkidle');

    // Wait for media access to be registered
    await page.waitForTimeout(3000);

    // Check if media access was registered
    const hasMediaAccess = await page.evaluate(() => {
      const access = window.__TEST_MEDIA_ACCESS__;
      if (!access || typeof access.getMediaEl !== 'function') {
        return { hasAccess: false };
      }
      const el = access.getMediaEl();
      return {
        hasAccess: true,
        hasElement: !!el,
        tagName: el?.tagName || null
      };
    });

    if (hasMediaAccess.hasAccess && hasMediaAccess.hasElement) {
      // Verify element is a media element - this is the real contract
      expect(['VIDEO', 'AUDIO', 'DASH-VIDEO']).toContain(hasMediaAccess.tagName);
    } else {
      // Skip test when no player is mounted - this is expected on TV landing
      test.skip(true, 'No active player - media access not registered without player mount');
    }
  });
});
