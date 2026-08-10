import { expect, test } from '@playwright/test';

test('Card Game hand and scale challenge fit the 1280x800 piano viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/piano/games/card-game', { waitUntil: 'networkidle' });

  const continueWithoutPiano = page.getByRole('button', { name: 'Continue without piano' });
  await continueWithoutPiano.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (await continueWithoutPiano.isVisible()) await continueWithoutPiano.click();

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
  await expect(page.getByText('Play from left to right', { exact: true })).toBeVisible();
  const staff = page.locator('.piano-scale-challenge__staff');
  await expect(staff).toBeVisible();
  const staffBox = await staff.boundingBox();
  expect(staffBox).not.toBeNull();
  expect(staffBox.width).toBeGreaterThanOrEqual(viewport.width * 0.8);
  expect(staffBox.height).toBeGreaterThanOrEqual((viewport.height - 60) * 0.45);
  expect(staffBox.x + staffBox.width).toBeLessThanOrEqual(viewport.width);
  expect(staffBox.y + staffBox.height).toBeLessThanOrEqual(viewport.height);

  const staffLines = page.locator('.piano-scale-challenge__staff .abcjs-staff');
  await expect(staffLines).toBeVisible();
  const staffLinesBox = await staffLines.boundingBox();
  expect(staffLinesBox).not.toBeNull();
  expect(Math.abs((staffLinesBox.x + staffLinesBox.width / 2) - viewport.width / 2)).toBeLessThan(4);
  expect(Math.abs((staffLinesBox.y + staffLinesBox.height / 2) - (staffBox.y + staffBox.height / 2))).toBeLessThan(6);

  await expect(page.locator('.piano-scale-note--next')).toHaveCount(1);
});
