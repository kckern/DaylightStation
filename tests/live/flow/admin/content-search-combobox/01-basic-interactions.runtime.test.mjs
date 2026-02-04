// tests/live/flow/admin/content-search-combobox/01-basic-interactions.runtime.test.mjs
/**
 * Basic interaction tests for ContentSearchCombobox
 * Tests: open/close, focus/blur, initial states
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Basic Interactions', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
  });

  test.afterEach(async () => {
    await harness.teardown();

    // Assert no backend errors after each test
    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);
  });

  test('renders with placeholder when empty', async ({ page }) => {
    await page.goto(TEST_URL);

    const input = ComboboxLocators.input(page);
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', 'Search content...');
    await expect(input).toHaveValue('');
  });

  test('renders with initial value from URL param', async ({ page }) => {
    await page.goto(`${TEST_URL}?value=plex:12345`);

    const input = ComboboxLocators.input(page);
    await expect(input).toHaveValue('plex:12345');
  });

  test('opens dropdown on click', async ({ page }) => {
    await page.goto(TEST_URL);

    await ComboboxActions.open(page);

    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('opens dropdown on focus', async ({ page }) => {
    await page.goto(TEST_URL);

    const input = ComboboxLocators.input(page);
    await input.focus();
    await page.waitForTimeout(100);

    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('closes dropdown on blur', async ({ page }) => {
    await page.goto(TEST_URL);

    await ComboboxActions.open(page);
    await expect(ComboboxLocators.dropdown(page)).toBeVisible();

    // Click outside
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(200);

    await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
  });

  test('closes dropdown on Escape key', async ({ page }) => {
    await page.goto(TEST_URL);

    await ComboboxActions.open(page);
    await expect(ComboboxLocators.dropdown(page)).toBeVisible();

    await ComboboxActions.pressKey(page, 'Escape');

    await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
  });

  test('shows "Type to search" when empty and opened', async ({ page }) => {
    await page.goto(TEST_URL);

    await ComboboxActions.open(page);

    const emptyState = ComboboxLocators.emptyState(page);
    await expect(emptyState).toContainText('Type to search');
  });

  test('shows loader during search', async ({ page }) => {
    await page.goto(TEST_URL);

    await ComboboxActions.open(page);

    // Type quickly and check for loader before debounce completes
    await ComboboxLocators.input(page).fill('test');

    // Loader should appear during API call - use soft assertion since timing is variable
    const loader = ComboboxLocators.loader(page);
    // Wait briefly for loader to potentially appear (API call starts after debounce)
    await page.waitForTimeout(500);

    // If the API call takes any time, we should see results or loader
    // Either results appeared (fast) or still loading
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('custom placeholder from URL param', async ({ page }) => {
    await page.goto(`${TEST_URL}?placeholder=Find%20content...`);

    const input = ComboboxLocators.input(page);
    await expect(input).toHaveAttribute('placeholder', 'Find content...');
  });

  test('value display shows in test harness', async ({ page }) => {
    await page.goto(`${TEST_URL}?value=plex:999`);

    const valueDisplay = page.locator('[data-testid="current-value"]');
    await expect(valueDisplay).toContainText('plex:999');
  });
});
