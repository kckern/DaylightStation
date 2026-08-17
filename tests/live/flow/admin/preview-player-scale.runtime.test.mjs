// preview-player-scale.runtime.test.mjs
//
// The admin preview must lay out at the SELECTED screen's CSS-pixel resolution
// and zoom that box down to the 960px surface. Verified as two reads that
// disagree by exactly the zoom factor:
//   offsetWidth            -> unzoomed layout px  (== resolution.width)
//   getBoundingClientRect  -> zoomed visual px    (== 960)
// Confirmed Chromium behaviour, not an assumption.
//
// This is what the unit tests cannot prove: they assert the CSS custom property
// VALUES, but only a real engine shows that `zoom` consumes them the way the
// fix depends on.
import { test, expect } from '@playwright/test';

test('preview lays out at the selected screen resolution and zooms to 960px', async ({ page }) => {
  // NOT networkidle — the admin app holds a WebSocket open, so the network
  // never goes idle and the navigation times out.
  await page.goto('/admin/content/lists/menus/fhe', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.item-row:not(.empty-row)', { timeout: 20000 });

  await page.locator('.col-preview .mantine-ActionIcon-root').first().click();
  await expect(page.locator('.mantine-Modal-overlay:visible')).toBeVisible({ timeout: 5000 });

  const picker = page.getByLabel('Preview at screen');
  await expect(picker).toBeVisible({ timeout: 10000 });

  // Wait for the API-backed list. The picker renders immediately with the
  // in-flight FALLBACK_SCREEN, so reading options straight after it becomes
  // visible enumerates ONLY '__fallback' — the invariant then holds trivially
  // against a screen that is not a real screen, and the test proves nothing.
  await expect
    .poll(async () => picker.locator('option').evaluateAll((o) => o.map((x) => x.value)), { timeout: 15000 })
    .not.toContain('__fallback');

  // Every previewable screen must hold the invariant, not just the default.
  const optionValues = await picker.locator('option').evaluateAll((opts) => opts.map((o) => o.value));
  expect(optionValues.length).toBeGreaterThan(1);

  for (const value of optionValues) {
    await picker.selectOption(value);

    const geometry = await page.evaluate(() => {
      const inner = document.querySelector('.admin-preview-player__video-inner');
      const box = document.querySelector('.admin-preview-player__video');
      const cs = getComputedStyle(document.querySelector('.admin-preview-player'));
      return {
        layoutWidth: inner.offsetWidth,
        layoutHeight: inner.offsetHeight,
        visualWidth: Math.round(inner.getBoundingClientRect().width),
        boxWidth: Math.round(box.getBoundingClientRect().width),
        declaredWidth: parseFloat(cs.getPropertyValue('--preview-screen-width')),
        declaredHeight: parseFloat(cs.getPropertyValue('--preview-screen-height')),
      };
    });

    // The layout box IS the screen's resolution — this is what fixes rem-sized type.
    expect(geometry.layoutWidth).toBe(geometry.declaredWidth);
    expect(geometry.layoutHeight).toBe(geometry.declaredHeight);
    // ...rendered down to the 960px surface.
    expect(geometry.visualWidth).toBe(960);
    expect(geometry.boxWidth).toBe(960);
  }

  await page.screenshot({ path: 'test-results/preview-player-scale.png' });
});
