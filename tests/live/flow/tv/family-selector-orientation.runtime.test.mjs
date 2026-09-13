import { test, expect } from '@playwright/test';

const normalizedAngle = transform => {
  const match = transform.match(/^matrix\(([^)]+)\)$/);
  if (!match) return 0;
  const [a, b] = match[1].split(',').map(Number);
  return Math.atan2(b, a) * 180 / Math.PI;
};

test('FamilySelector keeps portraits upright throughout its shared wheel animation', async ({ page }) => {
  await page.goto('/app/family-selector/mom');
  const wheel = page.locator('.family-selector');
  await expect(wheel.locator('image.segment-avatar')).toHaveCount(6);
  await page.keyboard.press('Enter');
  await expect(wheel).toHaveAttribute('data-state', 'spinning');

  const errors = [];
  while (await wheel.getAttribute('data-state') === 'spinning') {
    const transforms = await wheel.evaluate(root => ({
      wheel: getComputedStyle(root.querySelector('.wheel-rotator')).transform,
      portrait: getComputedStyle(root.querySelector('.avatar-wrapper')).transform,
    }));
    const combined = normalizedAngle(transforms.wheel) + normalizedAngle(transforms.portrait);
    errors.push(Math.abs(((combined + 180) % 360 + 360) % 360 - 180));
    await page.waitForTimeout(150);
  }
  await expect(wheel).toHaveAttribute('data-state', 'result');
  const finalTransforms = await wheel.evaluate(root => ({
    wheel: getComputedStyle(root.querySelector('.wheel-rotator')).transform,
    portrait: getComputedStyle(root.querySelector('.avatar-wrapper')).transform,
  }));
  const finalCombined = normalizedAngle(finalTransforms.wheel) + normalizedAngle(finalTransforms.portrait);
  errors.push(Math.abs(((finalCombined + 180) % 360 + 360) % 360 - 180));
  expect(errors.length).toBeGreaterThan(40);
  expect(Math.max(...errors), `portrait tilted during spin: ${errors.join(', ')}`).toBeLessThan(2);
});
