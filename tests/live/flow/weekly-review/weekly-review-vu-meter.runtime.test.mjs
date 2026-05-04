// Asserts the recording-bar VU meter renders horizontally — the failure mode
// is `display: inline-block` from a later SCSS rule causing children to stack.
import { test, expect } from '@playwright/test';
import { APP_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Weekly Review VU meter', () => {
  test.beforeEach(async ({ page }) => {
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

  test('VU meter children lay out horizontally and are wider than tall', async ({ page }) => {
    await page.goto(`${APP_URL}/app/weekly-review`);
    await expect(page.locator('.weekly-review-preflight-overlay')).toBeHidden({ timeout: 12000 });

    const meter = page.locator('.vu-meter');
    await expect(meter).toBeVisible();

    // The meter must be a flex container — inline-block is the failure mode.
    const display = await meter.evaluate(el => getComputedStyle(el).display);
    expect(display).toBe('flex');

    // Children must lay out side-by-side: meter width must be much greater than its height.
    const meterBox = await meter.boundingBox();
    expect(meterBox.width).toBeGreaterThan(meterBox.height * 3);

    // At least one bar must have non-zero width.
    const bars = page.locator('.vu-bar');
    expect(await bars.count()).toBe(20);
    const firstBar = await bars.first().boundingBox();
    expect(firstBar.width).toBeGreaterThan(0);
    expect(firstBar.height).toBeGreaterThan(0);
  });
});
