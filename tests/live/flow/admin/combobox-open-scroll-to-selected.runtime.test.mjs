import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

// Row 6 of the FHE menu ("Alan") is bound to a Plex episode deep in a season
// (Elijah the Prophet — S8 E33). On open the browse window is centered on that
// episode (E23..E43), so the selected row sits ~10 rows down. It must be
// scrolled into view on open, not left at the top of the window.
const PAGE_URL = `${FRONTEND_URL}/admin/content/lists/menus/fhe`;
const REFERENCE_INPUT_TEXT = /Elijah the Prophet/i;

test.describe.serial('Combobox — selected item visible on open', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    page = await context.newPage();
  });

  test.afterAll(async () => { if (page) await page.close(); });

  test('opens the picker centered on the committed selection', async () => {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.items-container', { timeout: 15000 });

    // Find the row whose committed input is the reference episode, open its picker.
    const row = page.locator('.item-row', { hasText: REFERENCE_INPUT_TEXT }).first();
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.scrollIntoViewIfNeeded();
    const picker = row.locator('.col-input .content-display');
    await expect(picker).toBeVisible({ timeout: 5000 });
    await picker.click();

    // Wait for the browse window to render enough options.
    await page.waitForFunction(
      () => document.querySelectorAll('.content-combobox-option[data-value]').length > 5,
      { timeout: 10000 },
    );
    // Allow the open-positioning to settle.
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
      const current = document.querySelector('.content-combobox-option.current')
        || document.querySelector('.content-combobox-option.highlighted');
      if (!current) return { found: false };
      // Nearest scrollable ancestor (the ScrollArea viewport).
      let vp = current.parentElement;
      while (vp && !(vp.scrollHeight > vp.clientHeight && vp.clientHeight > 0)) vp = vp.parentElement;
      if (!vp) return { found: true, hasViewport: false };
      const c = current.getBoundingClientRect();
      const v = vp.getBoundingClientRect();
      return {
        found: true,
        hasViewport: true,
        text: current.textContent.trim().slice(0, 60),
        scrollTop: Math.round(vp.scrollTop),
        isFullyVisible: c.top >= v.top - 1 && c.bottom <= v.bottom + 1,
      };
    });

    console.log('   open-position result:', JSON.stringify(result));
    expect(result.found, 'a current/highlighted option should exist on open').toBe(true);
    expect(result.hasViewport, 'a scrollable viewport should wrap the options').toBe(true);
    expect(result.isFullyVisible, 'the selected item must be fully in view on open').toBe(true);
  });
});
