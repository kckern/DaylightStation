/**
 * Admin Content Happy Path Runtime Test
 *
 * Tests the complete CRUD flow for the admin content lists interface:
 * 1. Navigate to admin interface
 * 2. Create a test list
 * 3. Add an item to the list
 * 4. Edit the item
 * 5. Delete the item
 * 6. Delete the list
 *
 * Uses a dedicated "e2e-test-list" list that can be freely manipulated.
 *
 * Prerequisites:
 * - Dev server running (npm run dev)
 * - Backend and frontend on configured ports
 *
 * Created: 2026-02-01
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;
const TEST_LIST_NAME = 'E2E Test List';
const TEST_LIST_SLUG = 'e2e-test-list';
const TEST_ITEM = {
  label: 'Test Content Item',
  input: 'test:12345'
};
const UPDATED_LABEL = 'Updated Content Item';

let sharedPage;
let sharedContext;

test.describe.configure({ mode: 'serial' });

test.describe('Admin Content Happy Path', () => {

  test.beforeAll(async ({ browser }) => {
    sharedContext = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    sharedPage = await sharedContext.newPage();

    // Track console errors
    sharedPage.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`Browser console error: ${msg.text()}`);
      }
    });

    // Clean up any existing test list via API
    try {
      await fetch(`${BASE_URL}/api/v1/admin/content/lists/${TEST_LIST_SLUG}`, {
        method: 'DELETE'
      });
    } catch (e) {
      // Ignore if doesn't exist
    }
  });

  test.afterAll(async () => {
    // Clean up test list via API
    try {
      await fetch(`${BASE_URL}/api/v1/admin/content/lists/${TEST_LIST_SLUG}`, {
        method: 'DELETE'
      });
    } catch (e) {
      // Ignore
    }

    if (sharedPage) await sharedPage.close();
    if (sharedContext) await sharedContext.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Navigate to admin interface
  // ═══════════════════════════════════════════════════════════════════════════
  test('1. Navigate to admin interface', async () => {
    test.setTimeout(15000);

    const adminUrl = `${BASE_URL}/admin`;
    console.log(`\nNavigating to: ${adminUrl}`);

    await sharedPage.goto(adminUrl, {
      waitUntil: 'networkidle',
      timeout: 10000
    });

    // Should redirect to /admin/content/lists
    await expect(sharedPage).toHaveURL(/\/admin\/content\/lists/);

    // Should see the "Watchlists" title
    await expect(sharedPage.getByRole('heading', { name: /watchlists/i })).toBeVisible();

    // Should see the "New List" button
    await expect(sharedPage.getByTestId('new-list-button')).toBeVisible();

    console.log('Admin interface loaded successfully');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Create a test list
  // ═══════════════════════════════════════════════════════════════════════════
  test('2. Create a test list', async () => {
    test.setTimeout(15000);

    // Click "New List" button
    await sharedPage.getByTestId('new-list-button').click();

    // Wait for modal to appear
    await expect(sharedPage.getByRole('dialog')).toBeVisible();

    // Fill in the list name
    await sharedPage.getByTestId('list-name-input').fill(TEST_LIST_NAME);

    // Click create
    await sharedPage.getByTestId('create-list-submit').click();

    // Modal should close
    await expect(sharedPage.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });

    // List card should appear
    await expect(sharedPage.getByTestId(`list-card-${TEST_LIST_SLUG}`)).toBeVisible();

    console.log(`Created list: ${TEST_LIST_NAME}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Navigate to list and add an item
  // ═══════════════════════════════════════════════════════════════════════════
  test('3. Navigate to list and add an item', async () => {
    test.setTimeout(15000);

    // Click on the list card
    await sharedPage.getByTestId(`list-card-${TEST_LIST_SLUG}`).click();

    // Should navigate to list view
    await expect(sharedPage).toHaveURL(/\/admin\/content\/lists\/e2e-test-list/);

    // Should see the list title
    await expect(sharedPage.getByRole('heading', { name: /e2e test list/i })).toBeVisible();

    // Click "Add Item" button
    await sharedPage.getByTestId('add-item-button').click();

    // Wait for modal
    await expect(sharedPage.getByRole('dialog')).toBeVisible();

    // Fill in item details
    await sharedPage.getByTestId('item-label-input').fill(TEST_ITEM.label);
    await sharedPage.getByTestId('item-input-input').fill(TEST_ITEM.input);

    // Click save
    await sharedPage.getByTestId('save-item-button').click();

    // Modal should close
    await expect(sharedPage.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });

    // Item should appear in the list
    await expect(sharedPage.getByText(TEST_ITEM.label)).toBeVisible();

    console.log(`Added item: ${TEST_ITEM.label}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: Edit the item
  // ═══════════════════════════════════════════════════════════════════════════
  test('4. Edit the item', async () => {
    test.setTimeout(15000);

    // Find the item row and open its menu
    const itemRow = sharedPage.locator('.item-row').filter({ hasText: TEST_ITEM.label });
    await itemRow.locator('button').last().click(); // Open the dots menu

    // Click Edit in menu
    await sharedPage.getByRole('menuitem', { name: /edit/i }).click();

    // Wait for modal
    await expect(sharedPage.getByRole('dialog')).toBeVisible();

    // Clear and update the label
    await sharedPage.getByTestId('item-label-input').clear();
    await sharedPage.getByTestId('item-label-input').fill(UPDATED_LABEL);

    // Save
    await sharedPage.getByTestId('save-item-button').click();

    // Modal should close
    await expect(sharedPage.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });

    // Updated label should appear
    await expect(sharedPage.getByText(UPDATED_LABEL)).toBeVisible();

    console.log(`Updated item to: ${UPDATED_LABEL}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 5: Delete the item
  // ═══════════════════════════════════════════════════════════════════════════
  test('5. Delete the item', async () => {
    test.setTimeout(15000);

    // Find the item row and open its menu
    const itemRow = sharedPage.locator('.item-row').filter({ hasText: UPDATED_LABEL });
    await itemRow.locator('button').last().click(); // Open the dots menu

    // Click Delete in menu
    await sharedPage.getByRole('menuitem', { name: /delete/i }).click();

    // Item should be removed
    await expect(sharedPage.getByText(UPDATED_LABEL)).not.toBeVisible({ timeout: 5000 });

    // Should show "No items yet" message
    await expect(sharedPage.getByText(/no items/i)).toBeVisible();

    console.log('Deleted item');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 6: Delete the list
  // ═══════════════════════════════════════════════════════════════════════════
  test('6. Delete the list', async () => {
    test.setTimeout(15000);

    // Set up dialog handler before clicking
    sharedPage.on('dialog', dialog => dialog.accept());

    // Open the list menu
    await sharedPage.getByTestId('list-menu-button').click();

    // Click delete in menu
    await sharedPage.getByRole('menuitem', { name: /delete list/i }).click();

    // Should navigate back to lists
    await expect(sharedPage).toHaveURL(/\/admin\/content\/lists$/, { timeout: 5000 });

    // Test list should no longer exist
    await expect(sharedPage.getByTestId(`list-card-${TEST_LIST_SLUG}`)).not.toBeVisible({ timeout: 5000 });

    console.log('Deleted list - happy path complete!');
  });
});
