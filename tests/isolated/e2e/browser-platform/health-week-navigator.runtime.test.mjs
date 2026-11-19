import { expect, test } from '@playwright/test';
import { installHealthFixtures } from '../../../live/flow/health/healthFixtures.mjs';

test.use({
  hasTouch: true, locale: 'en-US', serviceWorkers: 'block', timezoneId: 'UTC',
  viewport: { width: 320, height: 850 },
});

test('Health keeps the last day of a week reachable without scrolling the page sideways', async ({ page }) => {
  await page.routeWebSocket('**/*', () => {});
  await installHealthFixtures(page);
  await page.route('**/supervision/bootstrap', route => route.fulfill({ json: { enabled: false } }));
  await page.clock.setFixedTime(new Date('2026-11-22T18:00:00Z'));

  await page.goto('/health?date=2026-11-18');
  await page.getByText('Week & weight history', { exact: true }).click();
  const week = page.getByRole('group', { name: 'Week navigator' });
  const days = week.locator('.health-weekstrip__days');
  const saturday = week.getByRole('button', { name: /Saturday, November 21/ });
  const sunday = week.getByRole('button', { name: /Sunday, November 22/ });
  await expect(sunday).toBeVisible();
  const main = page.getByRole('main');
  const horizontalOverflow = await main.evaluate(node => node.scrollWidth - node.clientWidth);
  expect(horizontalOverflow).toBe(0);
  expect(await days.evaluate(node => node.scrollWidth - node.clientWidth)).toBeGreaterThan(0);
  expect((await sunday.boundingBox()).width).toBeGreaterThanOrEqual(44);

  await saturday.focus();
  await page.keyboard.press('Tab');
  await expect(sunday).toBeFocused();
  const dayBox = await sunday.boundingBox();
  const visibleBox = await days.boundingBox();
  expect(dayBox.x + dayBox.width).toBeLessThanOrEqual(visibleBox.x + visibleBox.width + 1);
  expect(await days.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  expect(await main.evaluate(node => node.scrollLeft)).toBe(0);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/date=2026-11-22/);
  await expect(sunday).toHaveAttribute('aria-current', 'date');

  await page.setViewportSize({ width: 390, height: 850 });
  await expect.poll(() => days.evaluate(node => node.scrollWidth - node.clientWidth)).toBe(0);
  expect(await main.evaluate(node => node.scrollWidth - node.clientWidth)).toBe(0);
});
