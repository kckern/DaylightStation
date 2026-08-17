// preview-player-centering.runtime.test.mjs
//
// `.stanza` was a block div, so useCenterByWidest measured the full container
// width and every hymn rendered flush left. Proves the shrink-wrap: the text
// block's centre must land on the content box's centre.
import { test, expect } from '@playwright/test';

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
