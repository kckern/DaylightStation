import { expect, test } from '@playwright/test';

test('Card Game hand and scale challenge fit the 1280x800 piano viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/gaming?game=card-game', { waitUntil: 'networkidle' });

  const cards = page.locator('.battle-card');
  await expect(cards).toHaveCount(3);
  const viewport = page.viewportSize();
  for (let index = 0; index < await cards.count(); index += 1) {
    const box = await cards.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.width).toBeGreaterThanOrEqual(160);
    expect(box.height).toBeGreaterThanOrEqual(120);
  }
  await expect(cards.first()).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);

  await cards.first().click();
  const overlay = page.locator('.gaming-challenge-overlay');
  await expect(overlay).toBeVisible();
  await expect(page.getByText('Play the scale from left to right', { exact: true })).toBeVisible();
  const staff = page.locator('.piano-scale-challenge__staff');
  await expect(staff).toBeVisible();
  const staffBox = await staff.boundingBox();
  expect(staffBox).not.toBeNull();
  expect(staffBox.x + staffBox.width).toBeLessThanOrEqual(viewport.width);
  expect(staffBox.y + staffBox.height).toBeLessThanOrEqual(viewport.height);
});
