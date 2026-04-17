import { test, expect } from '@playwright/test';

test.describe('Office Screen PIP Overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/screen/office');
    await page.waitForSelector('.screen-root', { timeout: 15000 });
    // Wait for numpad adapter to attach and WS subscriptions to connect
    await page.waitForTimeout(3000);
  });

  test('Z key triggers doorbell PIP overlay', async ({ page }) => {
    // No PIP initially
    expect(await page.locator('.pip-container').count()).toBe(0);

    // Press Z to simulate doorbell
    await page.keyboard.press('z');

    // PIP should appear
    await page.waitForSelector('.pip-container', { timeout: 10000 });
    await expect(page.locator('.pip-container')).toBeVisible();
  });

  test('Escape dismisses PIP overlay', async ({ page }) => {
    // Trigger PIP
    await page.keyboard.press('z');
    await page.waitForSelector('.pip-container', { timeout: 10000 });

    // Press Escape to dismiss
    await page.keyboard.press('Escape');

    // PIP should disappear (300ms animation + margin)
    await page.waitForFunction(
      () => document.querySelectorAll('.pip-container').length === 0,
      { timeout: 5000 }
    );
  });

  test('PIP auto-dismisses after timeout', async ({ page }) => {
    // Override timeout to 3s for test speed — trigger via webhook with short timeout
    const baseUrl = page.url().replace(/\/screen\/office$/, '');
    await page.evaluate(async (url) => {
      await fetch(`${url}/api/v1/camera/doorbell/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'ring' }),
      });
    }, baseUrl);

    // PIP should appear
    await page.waitForSelector('.pip-container', { timeout: 10000 });

    // Config says timeout: 30 — wait for auto-dismiss
    await page.waitForFunction(
      () => document.querySelectorAll('.pip-container').length === 0,
      { timeout: 35000 }
    );
  });

  test('second doorbell ring resets dismiss timer', async ({ page }) => {
    // Trigger PIP
    await page.keyboard.press('z');
    await page.waitForSelector('.pip-container', { timeout: 10000 });

    // Wait 5s, then trigger again
    await page.waitForTimeout(5000);
    await page.keyboard.press('z');

    // PIP should still be visible (timer was reset)
    await expect(page.locator('.pip-container')).toBeVisible();

    // Should not spawn a second PIP
    expect(await page.locator('.pip-container').count()).toBe(1);
  });

  test('PIP does not disrupt video playback', async ({ page }) => {
    // Start a video via menu
    await page.keyboard.press('h'); // movie menu
    await page.waitForSelector('.screen-overlay--fullscreen', { timeout: 5000 });
    await page.waitForTimeout(1000);

    // Select first item to start playback
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);

    // Capture current playback position
    const posBefore = await page.evaluate(() => {
      const media = document.querySelector('video, audio, dash-video');
      if (!media) return null;
      const el = media.shadowRoot?.querySelector('video') || media;
      return el.currentTime;
    });

    // Trigger PIP
    await page.keyboard.press('z');
    await page.waitForSelector('.pip-container', { timeout: 10000 });
    await page.waitForTimeout(1000);

    // Check playback position — should have advanced, not reset
    const posAfter = await page.evaluate(() => {
      const media = document.querySelector('video, audio, dash-video');
      if (!media) return null;
      const el = media.shadowRoot?.querySelector('video') || media;
      return el.currentTime;
    });

    // Video should still be playing (position advanced)
    if (posBefore !== null && posAfter !== null) {
      expect(posAfter).toBeGreaterThan(posBefore);
    }

    // Dismiss PIP
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.querySelectorAll('.pip-container').length === 0,
      { timeout: 5000 }
    );

    // Video should still be playing after PIP dismiss
    const posAfterDismiss = await page.evaluate(() => {
      const media = document.querySelector('video, audio, dash-video');
      if (!media) return null;
      const el = media.shadowRoot?.querySelector('video') || media;
      return el.currentTime;
    });

    if (posAfter !== null && posAfterDismiss !== null) {
      expect(posAfterDismiss).toBeGreaterThan(posAfter);
    }
  });
});
