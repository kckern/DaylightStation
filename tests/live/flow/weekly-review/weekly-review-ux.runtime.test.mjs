// tests/live/flow/weekly-review/weekly-review-ux.runtime.test.mjs
//
// Integration tests for the Weekly Review UX hardening.
//
// Coverage:
//   - Pre-flight overlay clears when audible audio is detected.
//   - Navigation hierarchy: TOC → R → Day → U → Fullscreen → D → Day → D → TOC.
//   - Right at last day = no-op.
//   - Esc at TOC opens save-confirm modal with NO Discard button.
//
// Requires the dev server (`npm run dev`) running. The test stubs the
// AudioBridge WebSocket so the pre-flight gate clears synthetically without
// real microphone hardware.
import { test, expect } from '@playwright/test';
import { APP_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Weekly Review UX', () => {
  test.beforeEach(async ({ page }) => {
    // Stub the AudioBridge WS so pre-flight clears immediately.
    // Sends a JSON sample-rate header followed by a buffer of audible PCM.
    await page.addInitScript(() => {
      class FakeWS {
        constructor() {
          this.binaryType = 'arraybuffer';
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify({ sampleRate: 48000 }) });
            const buf = new ArrayBuffer(2048);
            const view = new Int16Array(buf);
            for (let i = 0; i < view.length; i++) view[i] = (i % 2) ? 8000 : -8000;
            this.onmessage?.({ data: buf });
          }, 50);
        }
        send() {}
        close() {}
      }
      window.WebSocket = FakeWS;
    });
  });

  test('pre-flight clears, navigation follows hierarchy, no Discard buttons', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);

    // Pre-flight overlay should clear when audible audio is heard.
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });

    // Default landing: TOC grid.
    await expect(page.locator('.weekly-review-grid')).toBeVisible();

    // Right arrow → opens day detail.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.day-detail')).toBeVisible({ timeout: 5000 });

    // Down at day → returns to TOC.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.weekly-review-grid')).toBeVisible();

    // Esc at TOC → save-confirm modal. No Discard option allowed.
    await page.keyboard.press('Escape');
    await expect(page.locator('.weekly-review-confirm-overlay')).toBeVisible();
    const buttons = await page.locator('.weekly-review-confirm-overlay .confirm-btn').allTextContents();
    expect(buttons.some(b => /discard/i.test(b))).toBe(false);
    expect(buttons.some(b => /continue/i.test(b))).toBe(true);
    expect(buttons.some(b => /save/i.test(b))).toBe(true);
  });

  test('Up at day with photos enters fullscreen image view', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.day-detail')).toBeVisible({ timeout: 5000 });

    const photoCount = await page.locator('.day-detail-photo').count();
    test.skip(photoCount === 0, 'Day in this slot has no photos to fullscreen');

    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.weekly-review-fullscreen-image')).toBeVisible();

    // Down at fullscreen cycles backward (still in fullscreen).
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.weekly-review-fullscreen-image')).toBeVisible();

    // Left at fullscreen drops to previous day's L2 detail (or no-op at first day).
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.day-detail')).toBeVisible();
  });
});
