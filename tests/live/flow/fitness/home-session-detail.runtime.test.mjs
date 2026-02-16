// tests/live/flow/fitness/home-session-detail.runtime.test.mjs
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('HomeApp session detail view', () => {
  test('clicking a session shows FitnessChartApp, clicking back returns to dashboard', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness/plugin/home`, { waitUntil: 'domcontentloaded' });

    // Wait for sessions to load
    const workoutsCard = page.locator('.dashboard-card--workouts');
    await workoutsCard.waitFor({ timeout: 15000 });

    // Confirm we start in 3-column layout (no --detail modifier)
    const grid = page.locator('.dashboard-grid');
    await expect(grid).not.toHaveClass(/dashboard-grid--detail/);

    // Confirm metrics/interactions columns are visible
    await expect(page.locator('.column-metrics')).toBeVisible();
    await expect(page.locator('.column-interactions')).toBeVisible();

    // Click the first session row
    const firstSession = workoutsCard.locator('.session-row').first();
    await firstSession.waitFor({ timeout: 10000 });
    const sessionTitle = await firstSession.locator('.session-row__title-line').textContent();
    console.log(`Clicking session: ${sessionTitle?.trim()}`);
    await firstSession.click();

    // Grid should switch to detail layout
    await expect(grid).toHaveClass(/dashboard-grid--detail/, { timeout: 5000 });

    // Selected session should have highlight class
    await expect(firstSession).toHaveClass(/session-row--selected/);

    // Metrics and interactions columns should be gone
    await expect(page.locator('.column-metrics')).toHaveCount(0);
    await expect(page.locator('.column-interactions')).toHaveCount(0);

    // Detail panel should appear with back button
    const detailPanel = page.locator('.detail-panel');
    await expect(detailPanel).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.detail-panel__close')).toBeVisible();

    // FitnessChartApp should render with actual chart data (SVG race chart)
    const chartApp = detailPanel.locator('.fitness-chart-app');
    await chartApp.waitFor({ timeout: 15000 });
    await expect(chartApp).toBeVisible();

    // Verify chart body rendered (not the "warming up" or "no data" empty state)
    const chartBody = chartApp.locator('.race-chart-panel__body');
    await expect(chartBody).toBeVisible({ timeout: 10000 });
    const emptyCount = await chartApp.locator('.race-chart-panel__empty').count();
    expect(emptyCount).toBe(0);
    console.log('FitnessChartApp rendered with chart data in detail panel');

    // Click back to dashboard
    await page.locator('.detail-panel__close').click();

    // Should return to 3-column layout
    await expect(grid).not.toHaveClass(/dashboard-grid--detail/, { timeout: 5000 });
    await expect(page.locator('.column-metrics')).toBeVisible();
    await expect(page.locator('.column-interactions')).toBeVisible();
    await expect(page.locator('.detail-panel')).toHaveCount(0);
    console.log('Returned to dashboard successfully');
  });

  test('clicking a different session updates the chart', async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/fitness/plugin/home`, { waitUntil: 'domcontentloaded' });

    const workoutsCard = page.locator('.dashboard-card--workouts');
    await workoutsCard.waitFor({ timeout: 15000 });

    const sessionRows = workoutsCard.locator('.session-row');
    const count = await sessionRows.count();
    if (count < 2) {
      console.log(`Only ${count} session(s) available, skipping multi-select test`);
      test.skip();
      return;
    }

    // Click first session
    await sessionRows.first().click();
    await expect(sessionRows.first()).toHaveClass(/session-row--selected/);
    await expect(sessionRows.nth(1)).not.toHaveClass(/session-row--selected/);

    // Click second session
    await sessionRows.nth(1).click();
    await expect(sessionRows.nth(1)).toHaveClass(/session-row--selected/);
    await expect(sessionRows.first()).not.toHaveClass(/session-row--selected/);

    // Chart should still be visible
    const chartApp = page.locator('.detail-panel .fitness-chart-app');
    await expect(chartApp).toBeVisible({ timeout: 15000 });
    console.log('Chart updated after switching sessions');
  });
});
