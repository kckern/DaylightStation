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
    await ComboboxActions.gotoReady(page, TEST_URL);

    const input = ComboboxLocators.input(page);
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('placeholder', 'Search content...');
    await expect(input).toHaveValue('');
  });

  test('renders with initial value from URL param', async ({ page }) => {
    await ComboboxActions.gotoReady(page, `${TEST_URL}?value=plex:12345`);

    const input = ComboboxLocators.input(page);
    await expect(input).toHaveValue('plex:12345');
  });

  test('opens dropdown on click', async ({ page }) => {
    await ComboboxActions.gotoReady(page, TEST_URL);

    await ComboboxActions.open(page);

    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('opens dropdown on focus', async ({ page }) => {
    await ComboboxActions.gotoReady(page, TEST_URL);

    const input = ComboboxLocators.input(page);
    await input.focus();
    await page.waitForTimeout(100);

    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('closes dropdown on blur', async ({ page }) => {
    await ComboboxActions.gotoReady(page, TEST_URL);

    await ComboboxActions.open(page);
    await expect(ComboboxLocators.dropdown(page)).toBeVisible();

    // Click outside
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(200);

    await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
  });

  test('closes dropdown on Escape key', async ({ page }) => {
    await ComboboxActions.gotoReady(page, TEST_URL);

    await ComboboxActions.open(page);
    await expect(ComboboxLocators.dropdown(page)).toBeVisible();

    await ComboboxActions.pressKey(page, 'Escape');

    await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
  });

  test('shows "Type to search" when empty and opened', async ({ page }) => {
    await ComboboxActions.gotoReady(page, TEST_URL);

    await ComboboxActions.open(page);

    const emptyState = ComboboxLocators.emptyState(page);
    await expect(emptyState).toContainText('Type to search');
  });

  test('initiates search on typing', async ({ page }) => {
    await ComboboxActions.gotoReady(page, TEST_URL);

    await ComboboxActions.open(page);

    // Set up request listener BEFORE typing to catch the SSE connection
    const requestPromise = page.waitForRequest(
      req => req.url().includes('/api/v1/content/query/search'),
      { timeout: 30000 }
    );

    // Type search text (enough to trigger search - minimum 2 chars)
    await ComboboxLocators.input(page).fill('office');

    // Wait for the search request to be initiated
    const request = await requestPromise;
    expect(request.url()).toContain('/api/v1/content/query/search');

    // Wait for streaming search to produce results or empty state
    await ComboboxActions.waitForStreamComplete(page, 30000);

    // Verify dropdown shows results or empty state
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).toBeVisible();
  });

  test('custom placeholder from URL param', async ({ page }) => {
    await ComboboxActions.gotoReady(page, `${TEST_URL}?placeholder=Find%20content...`);

    const input = ComboboxLocators.input(page);
    await expect(input).toHaveAttribute('placeholder', 'Find content...');
  });

  test('value display shows in test harness', async ({ page }) => {
    await ComboboxActions.gotoReady(page, `${TEST_URL}?value=plex:999`);

    const valueDisplay = page.locator('[data-testid="current-value"]');
    await expect(valueDisplay).toContainText('plex:999');
  });

  test('opening with a committed value shows that value selected in the input', async ({ page }) => {
    await ComboboxActions.gotoReady(page, `${TEST_URL}?value=${encodeURIComponent('plex:456724')}`);
    const input = ComboboxLocators.input(page);
    await input.click();
    await expect(input).toHaveValue('plex:456724');   // not blanked
    const selection = await input.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd));
    // Unified design: select-after-colon — typing replaces the local id while
    // keeping the source prefix (was select-all in the legacy standalone).
    expect(selection).toBe('456724');
  });

  test('reopening after a search does not show stale results under an untouched input', async ({ page }) => {
    await ComboboxActions.gotoReady(page, TEST_URL);
    const input = ComboboxLocators.input(page);
    await input.fill('christmas');
    await page.waitForTimeout(1500);
    await page.keyboard.press('Escape');
    await input.click();                               // reopen
    await expect(page.getByText('Type to search...')).toBeVisible();
  });

  test('closing within the debounce window does not leak a late search into the next open', async ({ page }) => {
    await ComboboxActions.gotoReady(page, TEST_URL);
    const input = ComboboxLocators.input(page);
    await input.click();
    await input.fill('christmas');
    await page.keyboard.press('Escape');      // close BEFORE the 300ms debounce fires
    await page.waitForTimeout(700);            // let any leaked timer fire + stream
    await input.click();                       // reopen
    await expect(page.getByText('Type to search...')).toBeVisible();
  });
});
