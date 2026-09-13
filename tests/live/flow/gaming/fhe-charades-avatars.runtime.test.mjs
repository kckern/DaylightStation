import { test, expect } from '@playwright/test';

test('FHE Charades wheel renders and keeps every participant portrait upright', async ({ page, request }, testInfo) => {
  const loaded = new Set();
  const failures = [];
  page.on('response', response => {
    if (!response.url().includes('/api/v1/static/users/')) return;
    if (response.ok() && response.headers()['content-type']?.startsWith('image/')) loaded.add(new URL(response.url()).pathname);
    else failures.push({ url: response.url(), status: response.status() });
  });
  await page.setViewportSize({ width: 960, height: 540 });
  const profileResponse = await request.get('/api/v1/gaming/environments/party-games/profile');
  expect(profileResponse.ok()).toBe(true);
  const profile = await profileResponse.json();
  const expected = profile.household_members.map(member => member.avatar).sort();
  await page.goto('/app/party-games/charades:fhe');
  expect(expected).toHaveLength(6);
  const wheel = page.locator('.family-selector');
  await expect(wheel).toHaveAttribute('data-selected-id', /.+/);
  await expect(wheel.locator('image.segment-avatar')).toHaveCount(expected.length, { timeout: 2000 });
  expect(await wheel.locator('image.segment-avatar').evaluateAll(images => images.map(image => image.getAttribute('href')).sort())).toEqual(expected);
  await expect.poll(() => [...loaded].sort(), { timeout: 2000 }).toEqual(expected);
  await expect(wheel.locator('.segment-initials')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('wheel-avatars.png') });
  const orientationError = async () => wheel.evaluate(root => {
    const angle = selector => {
      const matrix = new DOMMatrix(getComputedStyle(root.querySelector(selector)).transform);
      return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
    };
    const combined = angle('.wheel-rotator') + angle('.avatar-wrapper');
    return Math.abs(((combined + 180) % 360 + 360) % 360 - 180);
  });
  const errors = [];
  while (await wheel.count() && await wheel.getAttribute('data-state') === 'spinning') {
    errors.push(await orientationError());
    await page.waitForTimeout(100);
  }
  expect(errors.length).toBeGreaterThan(15);
  expect(Math.max(...errors), `portrait tilted during spin: ${errors.join(', ')}`).toBeLessThan(2);
  const confirmation = page.locator('.winner-modal');
  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator('.winner-name')).toHaveText(/.+/);
  await page.screenshot({ path: testInfo.outputPath('winner-confirmation.png') });
  await page.waitForTimeout(1000);
  await expect(confirmation).toBeVisible();
  await expect(page.locator('main.charades')).toHaveAttribute('data-phase', 'challenge-ready');
  expect(failures).toEqual([]);
});
