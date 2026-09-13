import { test, expect } from '@playwright/test';

test('FHE Charades wheel renders and loads every participant portrait', async ({ page }, testInfo) => {
  const loaded = new Set();
  const failures = [];
  page.on('response', response => {
    if (!response.url().includes('/api/v1/static/users/')) return;
    if (response.ok() && response.headers()['content-type']?.startsWith('image/')) loaded.add(new URL(response.url()).pathname);
    else failures.push({ url: response.url(), status: response.status() });
  });
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto('/screens/living-room/fhe');
  await expect(page.locator('.menu-item').filter({ hasText: 'Charades' })).toBeVisible();
  for (let step = 0; step < 25 && !(await page.locator('.menu-item.active').innerText()).includes('Charades'); step++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('.menu-item.active')).toContainText('Charades');
  const createdPromise = page.waitForResponse(response => response.url().endsWith('/api/v1/gaming/sessions') && response.request().method() === 'POST');
  await page.keyboard.press('Enter');
  const createdResponse = await createdPromise;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  const expected = created.header.seats.map(seat => seat.members[0].avatar).sort();
  expect(expected).toHaveLength(6);
  const wheel = page.locator('.family-selector');
  await expect(wheel).toHaveAttribute('data-selected-id', created.state.performer_id);
  await expect(wheel.locator('image.segment-avatar')).toHaveCount(expected.length, { timeout: 2000 });
  expect(await wheel.locator('image.segment-avatar').evaluateAll(images => images.map(image => image.getAttribute('href')).sort())).toEqual(expected);
  await expect.poll(() => [...loaded].sort(), { timeout: 2000 }).toEqual(expected);
  await expect(wheel.locator('.segment-initials')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('wheel-avatars.png') });
  await expect(page.locator('main.charades')).toHaveAttribute('data-phase', 'challenge-ready');
  expect(failures).toEqual([]);
});
