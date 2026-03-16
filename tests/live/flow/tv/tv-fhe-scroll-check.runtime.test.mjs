// tests/live/flow/tv/tv-fhe-scroll-check.runtime.test.mjs
// Check: does selecting the 2nd row in a 2-row menu trigger scrolling?
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

test('FHE 2-row menu should NOT scroll when navigating to row 2', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  await page.goto(`${BACKEND_URL}/screens/living-room/fhe`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForSelector('.menu-item', { timeout: 15000 });
  await page.waitForTimeout(2000);

  // Count items and rows
  const itemCount = await page.locator('.menu-item').count();
  console.log(`FHE items: ${itemCount}`);

  // Check initial transform
  const initialTransform = await page.evaluate(() => {
    // Find the scrollable container — look for the element that gets translateY
    const candidates = document.querySelectorAll('.tv-menu, .menu-container, [class*="menu"]');
    for (const el of candidates) {
      if (el.style.transform) return { selector: el.className, transform: el.style.transform };
    }
    // Check computed
    for (const el of candidates) {
      const t = getComputedStyle(el).transform;
      if (t && t !== 'none') return { selector: el.className, transform: t };
    }
    return { selector: 'none found', transform: 'none' };
  });
  console.log('Initial:', JSON.stringify(initialTransform));

  // Navigate down to row 2
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(500);

  // Check transform after navigation
  const afterTransform = await page.evaluate(() => {
    const candidates = document.querySelectorAll('.tv-menu, .menu-container, [class*="menu"]');
    for (const el of candidates) {
      if (el.style.transform) return { selector: el.className, transform: el.style.transform };
    }
    for (const el of candidates) {
      const t = getComputedStyle(el).transform;
      if (t && t !== 'none') return { selector: el.className, transform: t };
    }
    return { selector: 'none found', transform: 'none' };
  });
  console.log('After ArrowDown:', JSON.stringify(afterTransform));

  // Check scroll metrics on the container that has translateY
  const metrics = await page.evaluate(() => {
    const all = document.querySelectorAll('*');
    for (const el of all) {
      if (el.style.transform && el.style.transform.includes('translateY') && el.style.transform !== 'translateY(0px)') {
        return {
          selector: el.className.substring(0, 60),
          transform: el.style.transform,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        };
      }
    }
    return null;
  });
  console.log('Scrolled element:', JSON.stringify(metrics));

  // The key assertion: a 2-row menu should NOT scroll
  if (metrics) {
    console.log(`BUG: 2-row menu is scrolling! Transform: ${metrics.transform}`);
  }
  expect(metrics, 'No element should have a non-zero translateY for a 2-row menu').toBeNull();

  await page.close();
  await ctx.close();
});
