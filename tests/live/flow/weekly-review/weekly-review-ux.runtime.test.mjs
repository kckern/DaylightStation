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
    // Stub the AudioBridge WS so pre-flight clears AND stays cleared.
    // Sends a JSON sample-rate header, then a continuous stream of audible PCM
    // buffers — without continuous frames, the recorder's level monitor would
    // see silence and the preflight overlay would re-show, intercepting keys.
    await page.addInitScript(() => {
      class FakeWS {
        constructor() {
          this.binaryType = 'arraybuffer';
          const send = () => {
            this.onmessage?.({ data: JSON.stringify({ sampleRate: 48000 }) });
            const buf = new ArrayBuffer(2048);
            const view = new Int16Array(buf);
            for (let i = 0; i < view.length; i++) view[i] = (i % 2) ? 8000 : -8000;
            this.onmessage?.({ data: buf });
          };
          setTimeout(() => {
            send();
            this._iv = setInterval(send, 100);
          }, 50);
        }
        send() {}
        close() { if (this._iv) clearInterval(this._iv); }
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
    // Tiny settle: preflight just cleared and the React tree just re-rendered.
    // Without this, the first keypress can race the keydown listener re-attach.
    await page.waitForTimeout(100);

    // Bootstrap focuses the last day. ArrowLeft moves selection to the previous day (still TOC view).
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.weekly-review-grid')).toBeVisible();
    // Enter opens the focused day's detail view.
    await page.keyboard.press('Enter');
    await expect(page.locator('.day-detail')).toBeVisible({ timeout: 5000 });

    // Down at day → returns to TOC. Wait for day-detail to actually unmount before
    // pressing Escape; the grid is always present underneath, so its visibility
    // alone doesn't prove we're back at TOC.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.day-detail')).toBeHidden();
    await expect(page.locator('.weekly-review-grid')).toBeVisible();

    // Esc at TOC → save-confirm modal. No Discard option allowed.
    await page.keyboard.press('Escape');
    await expect(page.locator('.weekly-review-confirm-overlay')).toBeVisible();
    const buttons = await page.locator('.weekly-review-confirm-overlay .confirm-btn').allTextContents();
    expect(buttons.some(b => /discard/i.test(b))).toBe(false);
    expect(buttons.some(b => /continue/i.test(b))).toBe(true);
    expect(buttons.some(b => /save/i.test(b))).toBe(true);
  });

  test('recording bar shows exactly one stop affordance during recording', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });

    // While recording: the small Stop button must NOT be present; only the Save Recording button.
    await expect(page.locator('.recording-stop-btn')).toHaveCount(0);
    await expect(page.locator('.recording-bar__save')).toBeVisible();
  });

  test('Enter at TOC opens the focused day', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });
    await expect(page.locator('.weekly-review-grid')).toBeVisible();

    // Press Enter on whatever day is currently focused (bootstrap selects the last day).
    await page.keyboard.press('Enter');
    await expect(page.locator('.day-detail')).toBeVisible({ timeout: 5000 });
  });

  test('Up at day with photos enters fullscreen image view', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });
    await expect(page.locator('.weekly-review-grid')).toBeVisible();
    // Settle after preflight clears so the keydown listener is reattached on the latest view.
    await page.waitForTimeout(100);

    // Move selection to the previous day, then Enter to open day-detail.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(page.locator('.day-detail')).toBeVisible({ timeout: 5000 });

    const photoCount = await page.locator('.day-detail-photo').count();
    test.skip(photoCount === 0, 'Day in this slot has no photos to fullscreen');

    await page.keyboard.press('ArrowUp');
    await expect(page.locator('.weekly-review-fullscreen-image')).toBeVisible();

    // Left at fullscreen cycles photos (no longer jumps to a different day).
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.weekly-review-fullscreen-image')).toBeVisible();

    // Right at fullscreen also cycles photos (still fullscreen).
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.weekly-review-fullscreen-image')).toBeVisible();

    // Down at fullscreen climbs back to day view — D-pad path out without Esc,
    // since FKB on the Shield swallows Esc unpredictably.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.day-detail')).toBeVisible();
    await expect(page.locator('.weekly-review-fullscreen-image')).toBeHidden();
  });

  test('double-Enter at TOC opens save-confirm and reverts to TOC on cancel', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });
    await expect(page.locator('.weekly-review-grid')).toBeVisible();
    await page.waitForTimeout(100);

    // Two rapid Enters: first opens a day, second reverts and opens stopConfirm.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('.weekly-review-confirm-overlay')).toBeVisible({ timeout: 2000 });
    // Snapshot was TOC, so the view underneath should have been restored to the grid.
    await expect(page.locator('.weekly-review-grid')).toBeVisible();
    await expect(page.locator('.day-detail')).toBeHidden();

    // Cancel the confirm modal (default focus is "Continue" / focusIndex 0).
    await page.keyboard.press('Enter');
    await expect(page.locator('.weekly-review-confirm-overlay')).toBeHidden();
    await expect(page.locator('.weekly-review-grid')).toBeVisible();
  });

  test('double-Enter at day opens save-confirm and reverts to day on cancel', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });
    await expect(page.locator('.weekly-review-grid')).toBeVisible();
    await page.waitForTimeout(100);

    // Open a day first.
    await page.keyboard.press('Enter');
    await expect(page.locator('.day-detail')).toBeVisible({ timeout: 5000 });

    // Pause longer than the double-Enter window, then double-tap to exit.
    await page.waitForTimeout(700);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('.weekly-review-confirm-overlay')).toBeVisible({ timeout: 2000 });
    // Snapshot was day, so the view underneath should be the day-detail (not fullscreen, not TOC).
    await expect(page.locator('.day-detail')).toBeVisible();
    await expect(page.locator('.weekly-review-grid')).toBeHidden();

    // Cancel restores us to day.
    await page.keyboard.press('Enter');
    await expect(page.locator('.weekly-review-confirm-overlay')).toBeHidden();
    await expect(page.locator('.day-detail')).toBeVisible();
  });

  test('two Enters separated by >500ms navigate twice (not treated as a double)', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });
    await expect(page.locator('.weekly-review-grid')).toBeVisible();
    await page.waitForTimeout(100);

    // First Enter: TOC → day.
    await page.keyboard.press('Enter');
    await expect(page.locator('.day-detail')).toBeVisible({ timeout: 5000 });

    // Wait past the double-Enter window, then a second Enter — should NOT trigger the exit prompt.
    await page.waitForTimeout(700);
    await page.keyboard.press('Enter');

    // No stopConfirm should appear within a reasonable window.
    await page.waitForTimeout(200);
    await expect(page.locator('.weekly-review-confirm-overlay')).toBeHidden();
  });

  test('Space and Backspace are no longer aliased to Enter and Escape', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });
    await expect(page.locator('.weekly-review-grid')).toBeVisible();

    // Space at TOC must NOT open a day (it would have under the old Space==Enter aliasing).
    await page.keyboard.press(' ');
    await expect(page.locator('.weekly-review-grid')).toBeVisible();
    await expect(page.locator('.day-detail')).toBeHidden();

    // Backspace at TOC must NOT open the stop-confirm modal (it would have under old Backspace==Esc).
    await page.keyboard.press('Backspace');
    await expect(page.locator('.weekly-review-confirm-overlay')).toBeHidden();
  });
});
