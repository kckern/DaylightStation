// tests/live/flow/admin/content-search-combobox/12-freeform-commit.runtime.test.mjs
/**
 * Freeform commit tests for ContentSearchCombobox
 *
 * Invariant: ContentSearchCombobox must always save user freeform input,
 * regardless of search result availability.
 *
 * Tests: Enter with zero results, blur with zero results, Enter before
 * results arrive, blur before results arrive, special characters.
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Freeform Commit', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);
    await harness.teardown();
  });

  test('Enter commits freeform text with zero results', async ({ page }) => {
    await ComboboxActions.open(page);

    const freeformText = 'xyznonexistent999qqq';
    await ComboboxActions.search(page, freeformText);
    await ComboboxActions.waitForAllAdaptersComplete(page, 60000);

    // Press Enter to commit freeform text (no option highlighted)
    await ComboboxActions.pressKey(page, 'Enter');
    await page.waitForTimeout(200);

    // Value must be committed — this is the invariant
    const currentValue = page.locator('[data-testid="current-value"]');
    await expect(currentValue).toContainText(freeformText);

    // Change log must record the commit
    const changeLog = page.locator('[data-testid="change-log"]');
    const logText = await changeLog.textContent();
    expect(logText).not.toContain('No changes yet');
    expect(logText).toContain(freeformText);
  });

  test('blur reverts plain (non-id) freeform text instead of committing it', async ({ page }) => {
    await ComboboxActions.open(page);

    // Plain search text (no `source:` prefix) is exploratory — blur must NOT commit it.
    const freeformText = 'xyznonexistent888qqq';
    await ComboboxActions.search(page, freeformText);
    await ComboboxActions.waitForAllAdaptersComplete(page, 60000);

    // Blur the input by clicking outside
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // Value must NOT be committed — blur is non-destructive for plain text.
    const currentValue = page.locator('[data-testid="current-value"]');
    await expect(currentValue).not.toContainText(freeformText);

    // Change log must show no commit happened.
    const changeLog = page.locator('[data-testid="change-log"]');
    const logText = await changeLog.textContent();
    expect(logText).not.toContain(freeformText);
  });

  test('blur reverts plain search text but keeps the prior committed value', async ({ page }) => {
    await page.goto(`${TEST_URL}?value=${encodeURIComponent('plex:456724')}`);
    const input = ComboboxLocators.input(page);
    await input.click();
    await input.fill('beet');                 // exploratory search text
    await page.locator('body').click({ position: { x: 5, y: 5 } });  // blur
    await expect(page.getByTestId('current-value')).toContainText('plex:456724'); // unchanged
  });

  test('the freeform row commits arbitrary text explicitly', async ({ page }) => {
    await ComboboxActions.open(page);
    const input = ComboboxLocators.input(page);
    await input.fill('my custom value');
    await page.getByTestId('freeform-commit-option').click();
    await expect(page.getByTestId('current-value')).toContainText('my custom value');
  });

  test('Enter commits freeform text before results arrive', async ({ page }) => {
    await ComboboxActions.open(page);

    // Type text and immediately press Enter without waiting for results
    const freeformText = 'my-custom-content:12345';
    await ComboboxLocators.input(page).fill(freeformText);
    // No waitForStreamComplete — press Enter before results arrive
    await page.waitForTimeout(50); // minimal delay for React state update
    await ComboboxActions.pressKey(page, 'Enter');
    await page.waitForTimeout(200);

    // Value should be committed regardless of whether results loaded
    const currentValue = page.locator('[data-testid="current-value"]');
    await expect(currentValue).toContainText(freeformText);

    const changeLog = page.locator('[data-testid="change-log"]');
    const logText = await changeLog.textContent();
    expect(logText).not.toContain('No changes yet');
    expect(logText).toContain(freeformText);
  });

  test('blur commits freeform text before results arrive', async ({ page }) => {
    await ComboboxActions.open(page);

    // Type text and immediately blur without waiting for results
    const freeformText = 'my-custom-content:67890';
    await ComboboxLocators.input(page).fill(freeformText);
    // No waitForStreamComplete — blur before results arrive
    await page.waitForTimeout(50); // minimal delay for React state update
    await page.locator('body').click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    // Value should be committed on blur regardless of result state
    const currentValue = page.locator('[data-testid="current-value"]');
    await expect(currentValue).toContainText(freeformText);

    const changeLog = page.locator('[data-testid="change-log"]');
    const logText = await changeLog.textContent();
    expect(logText).not.toContain('No changes yet');
    expect(logText).toContain(freeformText);
  });

  test('freeform text with special characters commits correctly', async ({ page }) => {
    await ComboboxActions.open(page);

    // Use special characters that might trip up URL encoding or HTML escaping
    const freeformText = 'media:path/to/file (copy) [2024] & more';
    await ComboboxLocators.input(page).fill(freeformText);
    await page.waitForTimeout(50);
    await ComboboxActions.pressKey(page, 'Enter');
    await page.waitForTimeout(200);

    // Value should be committed exactly as typed
    const currentValue = page.locator('[data-testid="current-value"]');
    await expect(currentValue).toContainText(freeformText);

    const changeLog = page.locator('[data-testid="change-log"]');
    const logText = await changeLog.textContent();
    expect(logText).not.toContain('No changes yet');
    expect(logText).toContain(freeformText);
  });
});
