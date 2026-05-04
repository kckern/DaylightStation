import { test, expect } from '@playwright/test';
import { APP_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Weekly Review accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      class FakeWS {
        constructor() {
          this.binaryType = 'arraybuffer';
          let interval;
          setTimeout(() => {
            this.onmessage?.({ data: JSON.stringify({ sampleRate: 48000 }) });
            interval = setInterval(() => {
              const buf = new ArrayBuffer(2048);
              const view = new Int16Array(buf);
              for (let i = 0; i < view.length; i++) view[i] = (i % 2) ? 8000 : -8000;
              this.onmessage?.({ data: buf });
            }, 100);
          }, 50);
          this._interval = () => interval;
        }
        send() {}
        close() { if (this._interval()) clearInterval(this._interval()); }
      }
      window.WebSocket = FakeWS;
    });
  });

  test('day columns are keyboard-reachable buttons', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });

    const firstDay = page.locator('.day-column').first();
    const role = await firstDay.getAttribute('role');
    expect(role).toBe('button');
    const tab = await firstDay.getAttribute('tabindex');
    expect(tab).toBe('0');
  });

  test('stop-confirm overlay has dialog ARIA', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });

    // Navigate through the hierarchy to re-attach keydown listeners
    await expect(page.locator('.weekly-review-grid')).toBeVisible();
    await page.waitForTimeout(100);

    // Move to previous day and open it
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(page.locator('.day-detail')).toBeVisible({ timeout: 5000 });

    // Return to TOC
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.weekly-review-grid')).toBeVisible();

    // Now press Escape to open the stop-confirm modal
    await page.keyboard.press('Escape');

    // The overlay should appear with the confirm-dialog inside
    const overlay = page.locator('.weekly-review-confirm-overlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    // Now check for the dialog role on the confirm-dialog
    const dialog = page.locator('.weekly-review-confirm-overlay .confirm-dialog');
    await expect(dialog).toBeVisible();
    expect(await dialog.getAttribute('role')).toBe('dialog');
    expect(await dialog.getAttribute('aria-modal')).toBe('true');
    expect(await dialog.getAttribute('aria-labelledby')).not.toBeNull();
  });
});
