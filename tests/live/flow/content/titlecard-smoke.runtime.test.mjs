import { test, expect } from '@playwright/test';

test('title card renders on TV queue page', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('/tv?queue=mar4-videos-photos', { waitUntil: 'domcontentloaded', timeout: 15000 });

  // Wait for titlecard to appear
  const titlecard = page.locator('.titlecard');
  await titlecard.waitFor({ state: 'visible', timeout: 15000 });

  // Verify title text
  const title = page.locator('.titlecard-tpl__title');
  await expect(title.first()).toHaveText('Happy Birthday Alan');

  // Verify subtitle
  const subtitle = page.locator('.titlecard-tpl__subtitle');
  await expect(subtitle.first()).toHaveText('A Look Back');

  // Verify warm-gold theme
  const classes = await titlecard.first().getAttribute('class');
  expect(classes).toContain('titlecard--theme-warm-gold');

  // No page errors
  expect(errors.length).toBe(0);
});
