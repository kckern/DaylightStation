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
// Both specs live in ONE file deliberately. playwright.config.mjs sets no
// `workers`/`fullyParallel`, so Playwright parallelises across FILES while
// running tests within a file serially. Both of these drive the same admin
// preview modal into real media playback against a single dev server and
// backend; run as two files they contend and both fail, run in one file they
// pass. Splitting them again reintroduces that flake.
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

// --- Hymn centring -----------------------------------------------------------
// `.stanza` was a block div, so useCenterByWidest measured the full container
// width and every hymn rendered flush left. Proves the shrink-wrap: the text
// block's centre must land on the content box's centre.
test('singalong stanzas centre in the text panel', async ({ page }) => {
  // NOT `networkidle`: the admin shell holds a long-lived log WebSocket open, so
  // the network never goes idle. The row selector below is the real readiness gate.
  await page.goto('/admin/content/lists/menus/fhe', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('.item-row:not(.empty-row)', { timeout: 10000 });

  // Case-insensitive and colon-free on purpose. A row shows its raw input
  // ("singalong:hymn/1054") only until it resolves, after which the text becomes
  // the resolved title plus a "SINGALONG" badge and "Hymn: 1054" — so a
  // lowercase `singalong:` / `hymn:` match goes stale the moment the row settles.
  const row = page.locator('.item-row', { hasText: /singalong/i }).first();
  await expect(row).toBeVisible({ timeout: 5000 });
  await row.locator('.col-preview .mantine-ActionIcon-root').click();

  await expect(page.locator('.mantine-Modal-overlay:visible')).toBeVisible({ timeout: 5000 });
  await page.waitForSelector('.singalong-text .stanza', { timeout: 15000 });
  await page.waitForTimeout(1000); // let the rAF re-measure and fonts settle

  const geo = await page.evaluate(() => {
    const text = document.querySelector('.singalong-text');
    const panel = text.closest('.textpanel');
    const scrolled = text.closest('.scrolled-content');
    const padLeft = parseFloat(getComputedStyle(scrolled).paddingLeft) || 0;
    const t = text.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    const contentCentre = p.left + padLeft + (p.width - padLeft) / 2;
    return { delta: Math.abs((t.left + t.width / 2) - contentCentre), textWidth: t.width, panelWidth: p.width };
  });

  // Must be narrower than the panel — if it still spans full width the
  // shrink-wrap did not take and "centred" would be vacuously true.
  expect(geo.textWidth).toBeLessThan(geo.panelWidth * 0.95);
  expect(geo.delta).toBeLessThanOrEqual(2);

  await page.screenshot({ path: 'test-results/preview-player-centering.png' });
});
