import { test, expect } from '@playwright/test';

const url = '/tests/_fixtures/school/rewards-controls/';
async function positionUnderlying(page) {
  const rect = await page.getByRole('button', { name: 'Close rewards' }).boundingBox();
  await page.locator('#under').evaluate((button, { x, y, width, height }) => Object.assign(button.style, {
    left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px`, right: 'auto',
  }), rect);
  return rect;
}
for (const touch of [false, true]) {
  test.describe(touch ? 'touch' : 'mouse', () => {
    test.use({ viewport: { width: 1280, height: 800 }, hasTouch: touch, isMobile: touch });
    test('close completes without activating the button underneath', async ({ page }) => {
      await page.goto(url);
      const rect = await positionUnderlying(page);
      if (touch) await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
      else await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('#under')).toHaveText('Log book 0');
      if (touch) await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
      else await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await expect(page.locator('#under')).toHaveText('Log book 1');
    });
  });
}
for (const viewport of [{ width: 1280, height: 800 }, { width: 640, height: 360 }]) test(`square reward footprints and a large close control at ${viewport.width}×${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport); await page.goto(url);
  const coin = await page.locator('.coin-icon').first().boundingBox();
  const ring = await page.locator('.ring-icon').boundingBox();
  const gem = await page.locator('.gem-glyph').boundingBox();
  const close = await page.getByRole('button', { name: 'Close rewards' }).boundingBox();
  const glyph = await page.locator('.school-rewards-modal__close svg').boundingBox();
  for (const box of [coin, ring, gem]) { expect(box.width).toBeCloseTo(box.height, 0); expect(box.width).toBeCloseTo(coin.width, 0); }
  expect(coin.width).toBeGreaterThanOrEqual(viewport.height === 800 ? 79 : 47);
  expect(close.width).toBeGreaterThanOrEqual(56); expect(close.height).toBeGreaterThanOrEqual(56);
  expect(glyph.width).toBeGreaterThanOrEqual(32);
});
for (const key of ['Enter', 'Space', 'Escape']) test(`${key} closes and returns focus to the opener`, async ({ page }) => {
  await page.goto(url); await expect(page.getByRole('button', { name: 'Close rewards' })).toBeFocused();
  await page.keyboard.press(key); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#under')).toBeFocused();
});
