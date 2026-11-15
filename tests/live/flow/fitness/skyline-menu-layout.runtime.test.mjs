import { test, expect } from '@playwright/test';
import { expectMenuGeometry, expectSelectedRowVisible, readMenuGeometry } from '../../../_lib/skylineLayoutAssertions.mjs';

const sizes = [[1381, 777], [1920, 934], [1024, 600], [700, 1000]];
export const scenario = (page, patch) => page.evaluate(p => window.__skylineLayout.setScenario(p), patch);
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', r => { throw new Error(`Unexpected API request: ${r.request().url()}`); });
  await page.goto('/'); await page.locator('body[data-ready="true"]').waitFor();
  await page.evaluate(async () => {
    await Promise.all([document.fonts.load('22px "SNES Mario Paint"'), document.fonts.load('22px "Press Start 2P"')]);
    await document.fonts.ready;
  });
  expect(await page.evaluate(() => document.fonts.check('22px "SNES Mario Paint"') && document.fonts.check('22px "Press Start 2P"'))).toBe(true);
});
for (const game of ['glider', 'invaders']) for (const [width, height] of sizes) {
  test(`${game} five logical rows stay contained and selection remains reachable ${width}x${height} @shell-list`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await scenario(page, { game, screen: game === 'glider' ? 'flights' : 'waves', longText: true });
    const first = await readMenuGeometry(page);
    for (const selectedIndex of [0, 7, 13]) {
      await scenario(page, { selectedIndex });
      await expect(page.locator('.skyline-menus__options button')).toHaveCount(5);
      await expectMenuGeometry(page); await expectSelectedRowVisible(page);
      const next = await readMenuGeometry(page);
      expect(Math.abs(next.actionRegion.top - first.actionRegion.top)).toBeLessThanOrEqual(1);
    }
  });
}
test('host resize keeps selection visible @shell-list', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await scenario(page, { game: 'invaders', screen: 'waves', selectedIndex: 13, longText: true, host: { width: 1024, height: 600 } });
  await expectMenuGeometry(page); await expectSelectedRowVisible(page);
  await scenario(page, { host: { width: 700, height: 500 } });
  await expectMenuGeometry(page); await expectSelectedRowVisible(page);
});
test('delayed bundled fonts keep selection visible @shell-list', async ({ context }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1024, height: 600 });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/fonts/arcade/*', async route => { await gate; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__skylineLayout?.setScenario === 'function');
    await page.evaluate(() => { void window.__skylineLayout.setScenario({ selectedIndex: 13, longText: true }); });
    await page.locator('[data-row="a13"][aria-pressed="true"]').waitFor();
    release();
    await page.evaluate(async () => { await document.fonts.load('22px "SNES Mario Paint"'); await document.fonts.ready; });
    await expectSelectedRowVisible(page);
    await expectMenuGeometry(page);
  } finally { release(); await page.close(); }
});
test('an unrelated render does not recapture manual scroll @shell-list', async ({ page }) => {
  await scenario(page, { selectedIndex: 13, longText: true });
  await expectSelectedRowVisible(page);
  await page.locator('[data-skyline-scroll]').evaluate(e => { e.scrollTop = 0; });
  await scenario(page, { notice: 'Reading a notice must not drag the menu back to the chosen flight.' });
  expect((await readMenuGeometry(page)).scrollTop).toBe(0);
});
test('an oversized row exposes its start and can be read by scrolling @shell-list', async ({ page }) => {
  await scenario(page, { game: 'glider', screen: 'flights', longText: true, selectedIndex: 13, host: { width: 700, height: 500 } });
  await expectSelectedRowVisible(page);
  const g = await readMenuGeometry(page);
  expect(g.scrollHeight).toBeGreaterThan(g.clientHeight);
  await page.locator('[data-skyline-scroll]').evaluate(e => { e.scrollTop += 60; });
  expect((await readMenuGeometry(page)).scrollTop).toBeGreaterThan(g.scrollTop);
});
test('Tab reveals an offscreen row without document scrolling @shell-list', async ({ page }) => {
  await scenario(page, { longText: true, selectedIndex: 0, host: { width: 1024, height: 600 } });
  const last = page.locator('.skyline-menus__options button').last();
  await last.focus();
  await expect(last).toBeFocused();
  const bounds = await last.boundingBox(), g = await readMenuGeometry(page);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(g.content.bottom + 1);
  expect(g.document).toEqual(g.viewport);
});
