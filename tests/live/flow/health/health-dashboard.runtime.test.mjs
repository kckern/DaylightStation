/**
 * Health Dashboard Runtime Test
 *
 * Verifies the health dashboard loads and all cards/detail views render
 * without crashing. Clicks through each widget and checks for errors.
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const HEALTH_URL = `${FRONTEND_URL}/health`;

test.describe('Health Dashboard', () => {

  test.beforeEach(async ({ page }) => {
    // Collect console errors
    page.on('pageerror', (err) => {
      console.error('[PAGE ERROR]', err.message);
    });
  });

  test('dashboard loads with all hub cards', async ({ page }) => {
    await page.goto(HEALTH_URL, { waitUntil: 'networkidle' });

    // Should not show loading skeleton after data arrives
    await page.waitForSelector('.dashboard-card', { timeout: 10000 });

    // Count visible cards — expect at least 4 (weight, nutrition, sessions, recency, goals)
    const cards = await page.locator('.dashboard-card').count();
    expect(cards).toBeGreaterThanOrEqual(4);
  });

  test('weight card shows data and drills down', async ({ page }) => {
    await page.goto(HEALTH_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.dashboard-card', { timeout: 10000 });

    // Find the weight card by its title text
    const weightCard = page.locator('.dashboard-card', { has: page.locator('text=Weight') }).first();
    await expect(weightCard).toBeVisible();

    // Should show a number (weight value)
    const statValue = weightCard.locator('.dashboard-stat-value');
    await expect(statValue).toBeVisible();
    const text = await statValue.textContent();
    expect(parseFloat(text)).toBeGreaterThan(0);

    // Click to drill down
    await weightCard.click();

    // Should show back button
    const backButton = page.locator('.health-detail__back');
    await expect(backButton).toBeVisible({ timeout: 5000 });

    // Should NOT show an error boundary message
    const errorText = page.locator('text=Error:');
    await expect(errorText).not.toBeVisible();

    // Should show detail content (recent readings or chart)
    await page.waitForTimeout(1000);

    // Go back
    await backButton.click();
    await page.waitForSelector('.dashboard-card', { timeout: 5000 });
  });

  test('nutrition card shows data and has input field', async ({ page }) => {
    await page.goto(HEALTH_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.dashboard-card', { timeout: 10000 });

    const nutritionCard = page.locator('.dashboard-card', { has: page.locator('text=Nutrition') }).first();
    await expect(nutritionCard).toBeVisible();

    // Should have the input field
    const input = nutritionCard.locator('input[placeholder="Log food..."]');
    await expect(input).toBeVisible();

    // Click the stats area (calories) to drill down — input area doesn't navigate
    const statsArea = nutritionCard.locator('.dashboard-stat-value').first();
    await statsArea.click();

    // Should show detail view or back button
    const backButton = page.locator('.health-detail__back');
    await expect(backButton).toBeVisible({ timeout: 5000 });

    // No error
    await expect(page.locator('text=Error:')).not.toBeVisible();

    await backButton.click();
    await page.waitForSelector('.dashboard-card', { timeout: 5000 });
  });

  test('sessions card drills down without error', async ({ page }) => {
    await page.goto(HEALTH_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.dashboard-card', { timeout: 10000 });

    const sessionsCard = page.locator('.dashboard-card', { has: page.locator('text=Sessions') }).first();
    await expect(sessionsCard).toBeVisible();

    await sessionsCard.click();

    const backButton = page.locator('.health-detail__back');
    await expect(backButton).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Error:')).not.toBeVisible();

    await backButton.click();
    await page.waitForSelector('.dashboard-card', { timeout: 5000 });
  });

  test('recency card shows traffic light indicators', async ({ page }) => {
    await page.goto(HEALTH_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.dashboard-card', { timeout: 10000 });

    const recencyCard = page.locator('.dashboard-card', { has: page.locator('text=Self-Care') }).first();
    await expect(recencyCard).toBeVisible();

    // Should have colored dots
    const dots = recencyCard.locator('[class*="recency-item__dot"]');
    expect(await dots.count()).toBeGreaterThan(0);
  });

  test('goals card drills down without error', async ({ page }) => {
    await page.goto(HEALTH_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.dashboard-card', { timeout: 10000 });

    const goalsCard = page.locator('.dashboard-card', { has: page.locator('text=Goals') }).first();
    await expect(goalsCard).toBeVisible();

    await goalsCard.click();

    const backButton = page.locator('.health-detail__back');
    await expect(backButton).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Error:')).not.toBeVisible();

    await backButton.click();
    await page.waitForSelector('.dashboard-card', { timeout: 5000 });
  });

  test('history chart renders in weight detail', async ({ page }) => {
    await page.goto(HEALTH_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.dashboard-card', { timeout: 10000 });

    // Click weight card
    const weightCard = page.locator('.dashboard-card', { has: page.locator('text=Weight') }).first();
    await weightCard.click();

    await page.waitForSelector('.health-detail__back', { timeout: 5000 });

    // Highcharts renders an SVG container
    const chart = page.locator('.highcharts-container');
    await expect(chart).toBeVisible({ timeout: 5000 });

    // Range buttons should exist
    await expect(page.locator('button', { hasText: '90 Days' })).toBeVisible();
    await expect(page.locator('button', { hasText: '6 Months' })).toBeVisible();
    await expect(page.locator('button', { hasText: '2 Years' })).toBeVisible();

    // Click 6 months — should not crash
    await page.locator('button', { hasText: '6 Months' }).click();
    await page.waitForTimeout(500);
    await expect(chart).toBeVisible();
    await expect(page.locator('text=Error:')).not.toBeVisible();

    // Click 2 years
    await page.locator('button', { hasText: '2 Years' }).click();
    await page.waitForTimeout(500);
    await expect(chart).toBeVisible();
    await expect(page.locator('text=Error:')).not.toBeVisible();
  });

  test('no console errors during full walkthrough', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(HEALTH_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.dashboard-card', { timeout: 10000 });

    // Click through each drillable card
    const cardNames = ['Weight', 'Sessions', 'Goals'];
    for (const name of cardNames) {
      const card = page.locator('.dashboard-card', { has: page.locator(`text=${name}`) }).first();
      if (await card.isVisible()) {
        await card.click();
        await page.waitForTimeout(1500);
        const back = page.locator('.health-detail__back');
        if (await back.isVisible()) {
          await back.click();
          await page.waitForTimeout(500);
        }
      }
    }

    // Filter out known non-critical errors
    const criticalErrors = errors.filter(e =>
      !e.includes('ResizeObserver') &&
      !e.includes('WebSocket')
    );

    expect(criticalErrors).toEqual([]);
  });

});
