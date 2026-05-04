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
});
