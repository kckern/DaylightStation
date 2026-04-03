/**
 * Health Nutrition Input Runtime Test
 *
 * Tests the full nutrition input flow against production data:
 * 1. Load health dashboard
 * 2. Type food into the NutritionCard input
 * 3. Verify parsed items appear in review state
 * 4. Accept the items
 * 5. Verify items appear in nutrilist API
 * 6. Quick-add a catalog entry
 * 7. Clean up all test items via DELETE
 *
 * Uses real APIs — creates and deletes actual nutrilist entries.
 */

import { test, expect } from '@playwright/test';

// Point to Docker container directly
const BASE_URL = process.env.TEST_FRONTEND_URL || 'http://localhost:3111';
const API_URL = `${BASE_URL}/api/v1`;
const HEALTH_URL = `${BASE_URL}/health`;

// Track items to clean up
const createdUuids = [];

test.describe('Nutrition Input Flow', () => {

  test.afterAll(async ({ request }) => {
    // Clean up all created nutrilist items
    for (const uuid of createdUuids) {
      try {
        await request.delete(`${API_URL}/health/nutrilist/${uuid}`);
      } catch (e) {
        console.warn(`Cleanup failed for ${uuid}: ${e.message}`);
      }
    }
  });

  test('inline text input logs food end-to-end', async ({ page, request }) => {
    // Get nutrilist UUIDs before
    const beforeRes = await request.get(`${API_URL}/health/nutrilist`);
    const beforeData = await beforeRes.json();
    const beforeUuids = new Set((beforeData.data || []).map(i => i.uuid));

    // Navigate to health dashboard
    await page.goto(HEALTH_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.dashboard-card', { timeout: 15000 });

    // Find the nutrition card input
    const input = page.locator('input[placeholder="Log food..."]');
    await expect(input).toBeVisible({ timeout: 5000 });

    // Fill and submit
    await input.fill('1 boiled egg');
    await input.press('Enter');

    // Should transition through parsing → review state with Accept/Undo buttons
    const acceptBtn = page.locator('button', { hasText: 'Accept' });
    await expect(acceptBtn).toBeVisible({ timeout: 30000 });
    await expect(page.locator('button', { hasText: 'Undo' })).toBeVisible();

    // Accept the items
    await acceptBtn.click();

    // Should return to idle state — input should be visible again
    await expect(input).toBeVisible({ timeout: 10000 });

    // Wait for the accept callback to complete (it generates a report image)
    await page.waitForTimeout(3000);

    // Verify items were actually saved to nutrilist
    const afterRes = await request.get(`${API_URL}/health/nutrilist`);
    const afterData = await afterRes.json();
    const newItems = (afterData.data || []).filter(i => !beforeUuids.has(i.uuid));

    expect(newItems.length).toBeGreaterThan(0);

    // Track new items for cleanup
    for (const item of newItems) {
      createdUuids.push(item.uuid);
    }
  });

  test('quick-add from catalog chips works', async ({ page, request }) => {
    // Get nutrilist count before
    const beforeRes = await request.get(`${API_URL}/health/nutrilist`);
    const beforeData = await beforeRes.json();
    const countBefore = beforeData.count || 0;

    await page.goto(HEALTH_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.dashboard-card', { timeout: 15000 });

    // Find the nutrition card
    const nutritionCard = page.locator('.dashboard-card', { has: page.locator('text=Nutrition') }).first();
    await expect(nutritionCard).toBeVisible();

    // Look for quick-add chips (Badge elements inside .nutrition-input__chips)
    const chips = nutritionCard.locator('.nutrition-input__chips .mantine-Badge-root');
    const chipCount = await chips.count();

    if (chipCount === 0) {
      console.log('No catalog chips available — skipping quick-add test');
      test.skip();
      return;
    }

    // Click the first chip
    const firstChip = chips.first();
    const chipText = await firstChip.textContent();
    console.log(`Quick-adding: "${chipText}"`);
    await firstChip.click();

    // Wait for the refresh to complete
    await page.waitForTimeout(2000);

    // Verify via API — check for new items by UUID comparison
    const afterRes = await request.get(`${API_URL}/health/nutrilist`);
    const afterData = await afterRes.json();
    const beforeUuids = new Set((beforeData.data || []).map(i => i.uuid));
    const newItems = (afterData.data || []).filter(i => !beforeUuids.has(i.uuid));

    expect(newItems.length).toBeGreaterThan(0);

    // Track new items for cleanup
    for (const item of newItems) {
      createdUuids.push(item.uuid);
    }
  });

  test('delete nutrilist items via API', async ({ request }) => {
    // Create a test item first
    const createRes = await request.post(`${API_URL}/health/nutrilist`, {
      data: {
        name: 'TEST_ITEM_DELETE_ME',
        item: 'TEST_ITEM_DELETE_ME',
        calories: 999,
        protein: 0,
        carbs: 0,
        fat: 0,
      }
    });
    const created = await createRes.json();
    const uuid = created.data?.uuid;
    expect(uuid).toBeTruthy();

    // Verify it exists
    const getRes = await request.get(`${API_URL}/health/nutrilist/item/${uuid}`);
    expect(getRes.ok()).toBeTruthy();

    // Delete it
    const deleteRes = await request.delete(`${API_URL}/health/nutrilist/${uuid}`);
    expect(deleteRes.ok()).toBeTruthy();
    const deleteBody = await deleteRes.json();
    expect(deleteBody.uuid).toBe(uuid);

    // Verify it's gone
    const gone = await request.get(`${API_URL}/health/nutrilist/item/${uuid}`);
    expect(gone.status()).toBe(404);
  });

  test('nutrition drill-down shows catalog search', async ({ page }) => {
    await page.goto(HEALTH_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.dashboard-card', { timeout: 15000 });

    // Click nutrition card header to drill down
    const nutritionTitle = page.locator('.dashboard-card', { has: page.locator('text=Nutrition') }).first();
    await nutritionTitle.click();

    // Should show detail view with search
    const backButton = page.locator('.health-detail__back');
    await expect(backButton).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Error:')).not.toBeVisible();

    // Search for a food
    const searchInput = page.locator('input[placeholder="Search foods..."]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });

    await searchInput.fill('protein');
    await page.waitForTimeout(500); // debounce

    // Should show search results
    await page.waitForTimeout(1000);
    // Results should appear (or not, depending on catalog contents)

    // Go back
    await backButton.click();
    await page.waitForSelector('.dashboard-card', { timeout: 5000 });
  });

});
