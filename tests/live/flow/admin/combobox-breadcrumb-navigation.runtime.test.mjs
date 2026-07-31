import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

// Row 6 of the FHE menu ("Alan") is bound to a Plex episode deep in a season
// (Elijah the Prophet — S8 E33). Opening its picker lands inside Season 8. The
// back (←) arrow must CLIMB the content tree (Season 8 → the show's seasons →
// the show's siblings) with a clickable breadcrumb trail — not just dismiss.
const PAGE_URL = `${FRONTEND_URL}/admin/content/lists/menus/fhe`;
const REFERENCE_INPUT_TEXT = /Elijah the Prophet/i;

const openPicker = async (page) => {
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.items-container', { timeout: 15000 });
  const row = page.locator('.item-row', { hasText: REFERENCE_INPUT_TEXT }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.scrollIntoViewIfNeeded();
  const picker = row.locator('.col-input .content-display');
  await expect(picker).toBeVisible({ timeout: 5000 });
  await picker.click();
  await page.waitForFunction(
    () => document.querySelectorAll('.content-combobox-option[data-value]').length > 3,
    { timeout: 10000 },
  );
};

// Read the breadcrumb crumb texts (data-testid="combobox-crumb-N").
const crumbTexts = (page) => page.$$eval(
  '[data-testid^="combobox-crumb-"]',
  (els) => els.map((e) => e.textContent.trim()).filter(Boolean),
);

test.describe.serial('Combobox — breadcrumb up-navigation', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    page = await context.newPage();
  });

  test.afterAll(async () => { if (page) await page.close(); });

  test('shows an ancestor trail with no dupe/ghost/junk crumbs on open', async () => {
    await openPicker(page);
    const crumbs = await crumbTexts(page);
    console.log('   trail on open:', JSON.stringify(crumbs));
    // At minimum the immediate container (Season 8) is present.
    expect(crumbs.length).toBeGreaterThanOrEqual(1);
    expect(crumbs.some((c) => /season 8/i.test(c))).toBe(true);
    // Hygiene: no duplicates, no empty crumbs, no bare "Library" junk crumb.
    expect(new Set(crumbs).size).toBe(crumbs.length);
    expect(crumbs.every((c) => c.length > 0)).toBe(true);
    expect(crumbs.some((c) => /^library$/i.test(c))).toBe(false);
  });

  test('back arrow climbs to the seasons level (not dismiss)', async () => {
    // Distinguishing signal: the seasons level lists "Season N" containers.
    await page.locator('[aria-label="Back"]').click();
    await page.waitForFunction(
      () => document.querySelectorAll('.content-combobox-option[data-value]').length > 0,
      { timeout: 10000 },
    );
    // Dropdown must still be open (did NOT behave like Escape).
    await expect(page.locator('.content-combobox-option[data-value]').first()).toBeVisible();
    const optionTexts = await page.$$eval(
      '.content-combobox-option[data-value]',
      (els) => els.map((e) => e.textContent).join(' | '),
    );
    console.log('   after 1st back, options:', optionTexts.slice(0, 120));
    expect(/season/i.test(optionTexts)).toBe(true);
  });

  test('clicking an ancestor crumb jumps to that level', async () => {
    const crumbs = await crumbTexts(page);
    // If there is an ancestor above the current level, clicking crumb 0 jumps there.
    if (crumbs.length >= 2) {
      await page.locator('[data-testid="combobox-crumb-0"]').click();
      await page.waitForTimeout(400);
      const after = await crumbTexts(page);
      console.log('   trail after crumb-0 jump:', JSON.stringify(after));
      expect(after.length).toBeLessThanOrEqual(crumbs.length);
      await expect(page.locator('.content-combobox-option[data-value]').first()).toBeVisible();
    } else {
      // Single-crumb trail: nothing to jump to — assert the crumb is not a button.
      const isButton = await page.locator('[data-testid="combobox-crumb-0"]').evaluate(
        (el) => el.tagName === 'BUTTON' || !!el.closest('button'),
      ).catch(() => false);
      expect(isButton).toBe(false);
    }
  });
});
