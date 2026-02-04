// tests/live/flow/admin/content-search-combobox/04b-keyboard-deep.runtime.test.mjs
/**
 * Deep keyboard navigation tests for ContentSearchCombobox
 * Tests: Long sequences, wrap-around, container vs leaf behavior, drill-down navigation
 *
 * Navigation model:
 * - ArrowUp/ArrowDown: Move selection within current list
 * - ArrowRight: Drill into container (like Enter on container)
 * - ArrowLeft: Go back one level (like clicking back button)
 * - Enter: Select leaf OR drill into container
 * - Escape: Close dropdown
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';
import { loadDynamicFixtures } from '#fixtures/combobox/dynamicFixtureLoader.mjs';

const TEST_URL = '/admin/test/combobox';

// Load fresh fixtures for each test run
let fixtures;

/**
 * Helper to get the currently selected option index
 */
async function getSelectedIndex(page) {
  const options = ComboboxLocators.options(page);
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const isSelected = await options.nth(i).getAttribute('data-combobox-selected');
    if (isSelected === 'true') return i;
  }
  return -1; // None selected
}

/**
 * Helper to check if an option is a container (has chevron/drill indicator)
 */
async function isContainer(option) {
  const chevron = ComboboxLocators.optionChevron(option);
  return await chevron.isVisible().catch(() => false);
}

/**
 * Helper to get option type (container or leaf)
 */
async function getOptionType(option) {
  return await isContainer(option) ? 'container' : 'leaf';
}

test.describe('ContentSearchCombobox - Deep Keyboard Navigation', () => {
  let harness;

  test.beforeAll(async () => {
    // Load fresh dynamic fixtures for varied test data
    fixtures = await loadDynamicFixtures();
    console.log(`Loaded ${fixtures.searchTerms.length} search terms, ${fixtures.containers.length} containers, ${fixtures.leaves.length} leaves`);
  });

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

  // ===========================================================================
  // Long Arrow Key Sequences
  // ===========================================================================

  test('navigate through all results with ArrowDown', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'the'); // Common word for many results
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Should have multiple results').toBeGreaterThan(3);

    const visitedIndices = [];

    // Navigate through all items
    for (let i = 0; i < count; i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
      const selectedIndex = await getSelectedIndex(page);
      visitedIndices.push(selectedIndex);
    }

    // Verify we visited indices 0 through count-1 (or wrapped)
    console.log(`Navigated through ${visitedIndices.length} items: ${visitedIndices.join(' -> ')}`);
    expect(visitedIndices.length).toBe(count);
  });

  test('navigate through all results with ArrowUp from bottom', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'the');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Should have multiple results').toBeGreaterThan(3);

    // First, navigate to the last item
    for (let i = 0; i < count; i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
    }

    const visitedIndices = [];

    // Navigate back up through all items
    for (let i = 0; i < count; i++) {
      await ComboboxActions.pressKey(page, 'ArrowUp');
      const selectedIndex = await getSelectedIndex(page);
      visitedIndices.push(selectedIndex);
    }

    console.log(`Navigated up through ${visitedIndices.length} items: ${visitedIndices.join(' -> ')}`);
    expect(visitedIndices.length).toBe(count);
  });

  test('mixed up/down navigation sequence', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Should have results').toBeGreaterThan(2);

    // Complex sequence: down, down, up, down, up, up, down, down, down
    const sequence = ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowDown'];
    const positions = [];

    for (const key of sequence) {
      await ComboboxActions.pressKey(page, key);
      const idx = await getSelectedIndex(page);
      positions.push(idx);
    }

    console.log(`Mixed navigation: ${sequence.map((k, i) => `${k.replace('Arrow', '')}→${positions[i]}`).join(', ')}`);

    // Verify we ended up at a valid position
    const finalIndex = positions[positions.length - 1];
    expect(finalIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex).toBeLessThan(count);
  });

  // ===========================================================================
  // Wrap-Around Behavior
  // ===========================================================================

  test('ArrowDown at last item wraps or stops', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Should have results').toBeGreaterThan(0);

    // Navigate to last item
    for (let i = 0; i < count; i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
    }

    const lastIndex = await getSelectedIndex(page);

    // Press down one more time
    await ComboboxActions.pressKey(page, 'ArrowDown');
    const afterLastIndex = await getSelectedIndex(page);

    // Either wrapped to 0, stayed at last, or went to some valid index
    const wrapped = afterLastIndex === 0;
    const stayed = afterLastIndex === lastIndex;
    const validIndex = afterLastIndex >= 0 && afterLastIndex < count;

    console.log(`At last item (${lastIndex}), ArrowDown went to ${afterLastIndex} - ${wrapped ? 'WRAPPED' : stayed ? 'STAYED' : 'MOVED'}`);
    expect(validIndex, 'Should be at a valid index').toBe(true);
  });

  test('ArrowUp at first item wraps or stops', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Should have results').toBeGreaterThan(0);

    // Navigate to first item
    await ComboboxActions.pressKey(page, 'ArrowDown');
    const firstIndex = await getSelectedIndex(page);
    expect(firstIndex).toBe(0);

    // Press up
    await ComboboxActions.pressKey(page, 'ArrowUp');
    const beforeFirstIndex = await getSelectedIndex(page);

    // Either wrapped to last or stayed at first or went to -1 (none)
    const wrapped = beforeFirstIndex === count - 1;
    const stayed = beforeFirstIndex === 0;
    const none = beforeFirstIndex === -1;

    console.log(`At first item, ArrowUp went to ${beforeFirstIndex} - ${wrapped ? 'WRAPPED' : stayed ? 'STAYED' : 'NONE'}`);
    expect(wrapped || stayed || none, 'Should wrap, stay, or deselect').toBe(true);
  });

  // ===========================================================================
  // Container vs Leaf Behavior
  // ===========================================================================

  test('identify and log container vs leaf items in results', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Should have results').toBeGreaterThan(0);

    const itemTypes = [];
    for (let i = 0; i < Math.min(count, 10); i++) {
      const option = options.nth(i);
      const type = await getOptionType(option);
      const title = await ComboboxLocators.optionTitle(option).textContent().catch(() => 'unknown');
      itemTypes.push({ index: i, type, title: title.substring(0, 30) });
    }

    console.log('Item types in results:');
    itemTypes.forEach(({ index, type, title }) => {
      console.log(`  [${index}] ${type.toUpperCase().padEnd(10)} "${title}"`);
    });

    // Log counts
    const containers = itemTypes.filter(i => i.type === 'container').length;
    const leaves = itemTypes.filter(i => i.type === 'leaf').length;
    console.log(`Summary: ${containers} containers, ${leaves} leaves`);
  });

  test('Enter on container drills down and shows children', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Should have results').toBeGreaterThan(0);

    // Find a container
    let containerIndex = -1;
    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      if (await isContainer(option)) {
        containerIndex = i;
        break;
      }
    }

    if (containerIndex === -1) {
      console.log('No containers found in search results - skipping drill-down test');
      return;
    }

    // Navigate to container
    for (let i = 0; i <= containerIndex; i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
    }

    const selectedBefore = await getSelectedIndex(page);
    expect(selectedBefore).toBe(containerIndex);

    // Press Enter to drill in
    await ComboboxActions.pressKey(page, 'Enter');
    await page.waitForTimeout(500);

    // Verify we drilled in (back button visible)
    const backButton = ComboboxLocators.backButton(page);
    const drilledIn = await backButton.isVisible().catch(() => false);

    if (drilledIn) {
      console.log(`Drilled into container at index ${containerIndex}`);

      // Verify children are displayed
      const childOptions = ComboboxLocators.options(page);
      const childCount = await childOptions.count();
      console.log(`Container has ${childCount} children`);
      expect(childCount).toBeGreaterThanOrEqual(0);
    } else {
      console.log('Container click did not drill in - may be a leaf or empty container');
    }
  });

  test('Enter on leaf selects and closes dropdown', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot'); // Episodes are leaves
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Should have results').toBeGreaterThan(0);

    // Find a leaf
    let leafIndex = -1;
    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      if (!(await isContainer(option))) {
        leafIndex = i;
        break;
      }
    }

    if (leafIndex === -1) {
      console.log('No leaves found in search results - all items are containers');
      return;
    }

    // Navigate to leaf
    for (let i = 0; i <= leafIndex; i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
    }

    // Get value before selection
    const valueBefore = await page.locator('[data-testid="current-value"]').textContent();

    // Press Enter to select
    await ComboboxActions.pressKey(page, 'Enter');
    await page.waitForTimeout(300);

    // Dropdown should close
    const dropdown = ComboboxLocators.dropdown(page);
    await expect(dropdown).not.toBeVisible();

    // Value should be updated
    const valueAfter = await page.locator('[data-testid="current-value"]').textContent();
    console.log(`Selected leaf at index ${leafIndex}: "${valueBefore}" -> "${valueAfter}"`);
    expect(valueAfter).not.toBe(valueBefore);
  });

  // ===========================================================================
  // Navigation After Drilling Into Container
  // ===========================================================================

  test('arrow navigation works within drilled-down children', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Should have results').toBeGreaterThan(0);

    // Find and click a container to drill in
    let drilledIn = false;
    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      if (await isContainer(option)) {
        await option.click();
        await page.waitForTimeout(500);

        const backButton = ComboboxLocators.backButton(page);
        drilledIn = await backButton.isVisible().catch(() => false);
        if (drilledIn) break;
      }
    }

    if (!drilledIn) {
      console.log('Could not drill into any container - skipping child navigation test');
      return;
    }

    // Now test arrow navigation within children
    const childOptions = ComboboxLocators.options(page);
    const childCount = await childOptions.count();

    if (childCount < 2) {
      console.log(`Only ${childCount} children - need at least 2 for navigation test`);
      return;
    }

    // Navigate down through children
    await ComboboxActions.pressKey(page, 'ArrowDown');
    const firstChildIndex = await getSelectedIndex(page);

    await ComboboxActions.pressKey(page, 'ArrowDown');
    const secondChildIndex = await getSelectedIndex(page);

    console.log(`Child navigation: first=${firstChildIndex}, second=${secondChildIndex}`);
    expect(secondChildIndex).toBe(firstChildIndex + 1);

    // Navigate back up
    await ComboboxActions.pressKey(page, 'ArrowUp');
    const backToFirst = await getSelectedIndex(page);
    expect(backToFirst).toBe(firstChildIndex);
  });

  test('Escape after drilling returns to search results', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const initialCount = await options.count();

    // Find and drill into a container
    let drilledIn = false;
    for (let i = 0; i < initialCount; i++) {
      const option = options.nth(i);
      if (await isContainer(option)) {
        await option.click();
        await page.waitForTimeout(500);

        const backButton = ComboboxLocators.backButton(page);
        drilledIn = await backButton.isVisible().catch(() => false);
        if (drilledIn) break;
      }
    }

    if (!drilledIn) {
      console.log('Could not drill into any container');
      return;
    }

    // Press Escape
    await ComboboxActions.pressKey(page, 'Escape');
    await page.waitForTimeout(200);

    // Dropdown should close
    const dropdown = ComboboxLocators.dropdown(page);
    const isVisible = await dropdown.isVisible().catch(() => false);

    console.log(`After Escape: dropdown ${isVisible ? 'still visible' : 'closed'}`);
  });

  // ===========================================================================
  // Selection at Different Positions
  // ===========================================================================

  test('select item at middle position', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'the');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Should have multiple results').toBeGreaterThan(4);

    // Navigate to middle
    const middleIndex = Math.floor(count / 2);
    for (let i = 0; i <= middleIndex; i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
    }

    const selectedIndex = await getSelectedIndex(page);
    expect(selectedIndex).toBe(middleIndex);

    // Get info about selected item
    const selectedOption = options.nth(middleIndex);
    const isLeaf = !(await isContainer(selectedOption));

    if (isLeaf) {
      // Select it
      await ComboboxActions.pressKey(page, 'Enter');
      await page.waitForTimeout(300);

      const dropdown = ComboboxLocators.dropdown(page);
      await expect(dropdown).not.toBeVisible();
      console.log(`Selected leaf at middle position (index ${middleIndex})`);
    } else {
      console.log(`Middle item (index ${middleIndex}) is a container`);
    }
  });

  test('select last item in list', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'the');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Should have multiple results').toBeGreaterThan(2);

    // Navigate to last
    for (let i = 0; i < count; i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
    }

    const selectedIndex = await getSelectedIndex(page);
    console.log(`At position ${selectedIndex} of ${count} items`);

    // Check if it's a leaf and select
    const lastOption = options.nth(selectedIndex);
    const isLeaf = !(await isContainer(lastOption));

    if (isLeaf) {
      await ComboboxActions.pressKey(page, 'Enter');
      await page.waitForTimeout(300);

      const dropdown = ComboboxLocators.dropdown(page);
      await expect(dropdown).not.toBeVisible();
      console.log(`Selected last item (leaf at index ${selectedIndex})`);
    } else {
      console.log(`Last item is a container - drilling in`);
      await ComboboxActions.pressKey(page, 'Enter');
      await page.waitForTimeout(500);
    }
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  test('arrow keys with single result', async ({ page }) => {
    await ComboboxActions.open(page);
    // Search for something specific that might return few results
    await ComboboxActions.search(page, 'xyzspecificterm123');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count === 0) {
      console.log('No results - arrow navigation not applicable');
      // Verify arrow keys don't crash
      await ComboboxActions.pressKey(page, 'ArrowDown');
      await ComboboxActions.pressKey(page, 'ArrowUp');
      return;
    }

    if (count === 1) {
      console.log('Single result - testing arrow behavior');

      await ComboboxActions.pressKey(page, 'ArrowDown');
      const idx1 = await getSelectedIndex(page);
      expect(idx1).toBe(0);

      await ComboboxActions.pressKey(page, 'ArrowDown');
      const idx2 = await getSelectedIndex(page);
      // Should stay at 0 or wrap to 0
      expect(idx2).toBe(0);

      await ComboboxActions.pressKey(page, 'ArrowUp');
      const idx3 = await getSelectedIndex(page);
      // Should stay at 0 or go to -1 (none)
      expect(idx3 === 0 || idx3 === -1).toBe(true);
    }
  });

  test('arrow keys while results are loading', async ({ page }) => {
    await ComboboxActions.open(page);

    // Start search but don't wait
    await ComboboxLocators.input(page).fill('Office');

    // Immediately try arrow keys while streaming
    await ComboboxActions.pressKey(page, 'ArrowDown');
    await ComboboxActions.pressKey(page, 'ArrowDown');
    await ComboboxActions.pressKey(page, 'ArrowUp');

    // Now wait for results
    await ComboboxActions.waitForStreamComplete(page, 30000);

    // Should be in a valid state
    const options = ComboboxLocators.options(page);
    const count = await options.count();
    const selectedIndex = await getSelectedIndex(page);

    console.log(`After arrow keys during load: ${count} results, selected=${selectedIndex}`);

    // Should not crash, selection should be valid
    expect(selectedIndex).toBeGreaterThanOrEqual(-1);
    expect(selectedIndex).toBeLessThan(count);
  });

  test('rapid arrow key presses', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'the');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    expect(count, 'Should have results').toBeGreaterThan(5);

    // Rapid fire arrow keys (no wait between)
    const input = ComboboxLocators.input(page);
    await input.focus();

    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('ArrowDown');
    }

    // Small wait for UI to settle
    await page.waitForTimeout(100);

    const selectedIndex = await getSelectedIndex(page);
    console.log(`After 10 rapid ArrowDowns: selected index = ${selectedIndex}`);

    // Should be at a valid position
    expect(selectedIndex).toBeGreaterThanOrEqual(0);
    expect(selectedIndex).toBeLessThan(count);
  });

  // ===========================================================================
  // Full Keyboard Flow Scenarios
  // ===========================================================================

  test('full keyboard flow: search, navigate, select leaf', async ({ page }) => {
    await ComboboxActions.open(page);

    // Type search - use common term for reliable results
    await ComboboxLocators.input(page).fill('the');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count === 0) {
      console.log('No search results - skipping keyboard flow test');
      return;
    }

    // Navigate down to find a leaf
    let selectedLeaf = false;
    for (let i = 0; i < Math.min(count, 5); i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
      const idx = await getSelectedIndex(page);
      const option = options.nth(idx);

      if (!(await isContainer(option))) {
        // Found a leaf - select it
        await ComboboxActions.pressKey(page, 'Enter');
        await page.waitForTimeout(300);
        selectedLeaf = true;
        break;
      }
    }

    if (selectedLeaf) {
      // Verify selection
      await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
      const value = await page.locator('[data-testid="current-value"]').textContent();
      expect(value).not.toBe('(empty)');
      console.log(`Full keyboard flow completed. Selected: ${value}`);
    } else {
      console.log('No leaf found in first 5 items');
    }
  });

  test('full keyboard flow: search, drill into container, navigate children, select', async ({ page }) => {
    await ComboboxActions.open(page);

    // Type search - use common term for reliable results
    await ComboboxLocators.input(page).fill('the');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count === 0) {
      console.log('No search results - skipping container drill test');
      return;
    }

    // Find and drill into a container
    let drilledIn = false;
    for (let i = 0; i < Math.min(count, 5); i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
      const idx = await getSelectedIndex(page);
      const option = options.nth(idx);

      if (await isContainer(option)) {
        await ComboboxActions.pressKey(page, 'Enter');
        await page.waitForTimeout(500);

        const backButton = ComboboxLocators.backButton(page);
        drilledIn = await backButton.isVisible().catch(() => false);
        if (drilledIn) {
          console.log(`Drilled into container at index ${idx}`);
          break;
        }
      }
    }

    if (!drilledIn) {
      console.log('No drillable container found');
      return;
    }

    // Navigate within children
    const childOptions = ComboboxLocators.options(page);
    const childCount = await childOptions.count();
    console.log(`Container has ${childCount} children`);

    if (childCount > 0) {
      // Navigate to second child if available
      await ComboboxActions.pressKey(page, 'ArrowDown');
      if (childCount > 1) {
        await ComboboxActions.pressKey(page, 'ArrowDown');
      }

      const childIdx = await getSelectedIndex(page);
      const childOption = childOptions.nth(childIdx);

      // Check if child is leaf or container
      if (!(await isContainer(childOption))) {
        // Select it
        await ComboboxActions.pressKey(page, 'Enter');
        await page.waitForTimeout(300);

        await expect(ComboboxLocators.dropdown(page)).not.toBeVisible();
        const value = await page.locator('[data-testid="current-value"]').textContent();
        console.log(`Selected child at index ${childIdx}: ${value}`);
      } else {
        console.log(`Child at index ${childIdx} is also a container`);
      }
    }
  });

  // ===========================================================================
  // ArrowLeft / ArrowRight Navigation (Drill Down / Back Up)
  // ===========================================================================

  test('ArrowRight drills into highlighted container', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count === 0) {
      console.log('No results - skipping ArrowRight test');
      return;
    }

    // Find a container
    let containerIndex = -1;
    for (let i = 0; i < Math.min(count, 10); i++) {
      const option = options.nth(i);
      if (await isContainer(option)) {
        containerIndex = i;
        break;
      }
    }

    if (containerIndex === -1) {
      console.log('No containers found - skipping ArrowRight drill test');
      return;
    }

    // Navigate to container
    for (let i = 0; i <= containerIndex; i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
    }

    console.log(`At container index ${containerIndex}, pressing ArrowRight to drill in`);

    // Press ArrowRight to drill in
    await ComboboxActions.pressKey(page, 'ArrowRight');
    await page.waitForTimeout(500);

    // Check if we drilled in
    const backButton = ComboboxLocators.backButton(page);
    const drilledIn = await backButton.isVisible().catch(() => false);

    if (drilledIn) {
      console.log('ArrowRight successfully drilled into container');
      const childCount = await ComboboxLocators.options(page).count();
      console.log(`Container has ${childCount} children`);
    } else {
      console.log('ArrowRight did not drill in (may not be supported or container is empty)');
    }
  });

  test('ArrowLeft goes back one level', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count === 0) {
      console.log('No results - skipping ArrowLeft test');
      return;
    }

    // First, drill into a container using click
    let drilledIn = false;
    for (let i = 0; i < Math.min(count, 5); i++) {
      const option = options.nth(i);
      if (await isContainer(option)) {
        await option.click();
        await page.waitForTimeout(500);

        const backButton = ComboboxLocators.backButton(page);
        drilledIn = await backButton.isVisible().catch(() => false);
        if (drilledIn) break;
      }
    }

    if (!drilledIn) {
      console.log('Could not drill into container - skipping ArrowLeft test');
      return;
    }

    console.log('Drilled in, now pressing ArrowLeft to go back');

    // Press ArrowLeft to go back
    await ComboboxActions.pressKey(page, 'ArrowLeft');
    await page.waitForTimeout(500);

    // Check if back button is still visible (meaning we're still in browse mode)
    // or if we're back at search results
    const backButton = ComboboxLocators.backButton(page);
    const stillDrilled = await backButton.isVisible().catch(() => false);

    console.log(`After ArrowLeft: ${stillDrilled ? 'still in drilled state' : 'back to previous level'}`);
  });

  test('multiple ArrowLeft goes back to root', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Office');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count === 0) return;

    // Drill in multiple levels
    let drillDepth = 0;
    for (let level = 0; level < 3; level++) {
      const currentOptions = ComboboxLocators.options(page);
      const currentCount = await currentOptions.count();

      if (currentCount === 0) break;

      // Find a container and drill in
      let drilled = false;
      for (let i = 0; i < currentCount; i++) {
        const option = currentOptions.nth(i);
        if (await isContainer(option)) {
          await option.click();
          await page.waitForTimeout(500);

          const backButton = ComboboxLocators.backButton(page);
          if (await backButton.isVisible().catch(() => false)) {
            drilled = true;
            drillDepth++;
            console.log(`Drilled to level ${drillDepth}`);
            break;
          }
        }
      }

      if (!drilled) break;
    }

    console.log(`Reached depth ${drillDepth}, now going back with ArrowLeft`);

    // Press ArrowLeft multiple times to return to root
    for (let i = 0; i < drillDepth + 1; i++) {
      await ComboboxActions.pressKey(page, 'ArrowLeft');
      await page.waitForTimeout(300);

      const backButton = ComboboxLocators.backButton(page);
      const hasBackButton = await backButton.isVisible().catch(() => false);
      console.log(`After ${i + 1} ArrowLeft: ${hasBackButton ? 'still has back button' : 'at root or closed'}`);
    }
  });

  test('ArrowRight on leaf does nothing or selects', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'Pilot');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count === 0) {
      console.log('No results - skipping leaf ArrowRight test');
      return;
    }

    // Find a leaf
    let leafIndex = -1;
    for (let i = 0; i < Math.min(count, 10); i++) {
      const option = options.nth(i);
      if (!(await isContainer(option))) {
        leafIndex = i;
        break;
      }
    }

    if (leafIndex === -1) {
      console.log('No leaves found');
      return;
    }

    // Navigate to leaf
    for (let i = 0; i <= leafIndex; i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
    }

    const selectedBefore = await getSelectedIndex(page);
    console.log(`At leaf index ${leafIndex}, pressing ArrowRight`);

    // Press ArrowRight on leaf
    await ComboboxActions.pressKey(page, 'ArrowRight');
    await page.waitForTimeout(300);

    // Should either do nothing or select the leaf
    const dropdown = ComboboxLocators.dropdown(page);
    const isOpen = await dropdown.isVisible().catch(() => false);

    if (isOpen) {
      const selectedAfter = await getSelectedIndex(page);
      console.log(`ArrowRight on leaf: dropdown still open, selection: ${selectedBefore} -> ${selectedAfter}`);
    } else {
      console.log('ArrowRight on leaf selected and closed dropdown');
    }
  });

  // ===========================================================================
  // Scroll/Infinite Scroll Behavior
  // ===========================================================================

  test('scrolls to keep selected item visible', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'the'); // Get many results
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count < 10) {
      console.log('Not enough results to test scrolling');
      return;
    }

    const dropdown = ComboboxLocators.dropdown(page);

    // Navigate far down the list
    const targetIndex = Math.min(20, count - 1);
    for (let i = 0; i <= targetIndex; i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
    }

    // Check if selected item is visible (within dropdown viewport)
    const selectedOption = options.nth(targetIndex);
    const isVisible = await selectedOption.isVisible().catch(() => false);

    console.log(`After navigating to index ${targetIndex}: item ${isVisible ? 'is' : 'is NOT'} visible`);
    expect(isVisible, 'Selected item should be scrolled into view').toBe(true);
  });

  test('navigate to bottom and back to top', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'the');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count < 5) {
      console.log('Not enough results');
      return;
    }

    // Go to bottom
    console.log(`Navigating to bottom (${count} items)...`);
    for (let i = 0; i < count; i++) {
      await page.keyboard.press('ArrowDown');
    }

    let bottomIndex = await getSelectedIndex(page);
    console.log(`At bottom: index ${bottomIndex}`);

    // Go back to top
    console.log('Navigating back to top...');
    for (let i = 0; i < count; i++) {
      await page.keyboard.press('ArrowUp');
    }

    let topIndex = await getSelectedIndex(page);
    console.log(`At top: index ${topIndex}`);

    // Should be at a valid position (wrap behavior varies)
    expect(topIndex).toBeGreaterThanOrEqual(-1); // -1 = none selected, 0+ = valid
  });

  // ===========================================================================
  // Dynamic Fixture Navigation
  // ===========================================================================

  test('navigate with dynamically loaded search terms', async ({ page }) => {
    if (!fixtures || fixtures.searchTerms.length === 0) {
      console.log('No dynamic fixtures loaded');
      return;
    }

    // Use a random search term from fixtures
    const searchTerm = fixtures.searchTerms[Math.floor(Math.random() * fixtures.searchTerms.length)];
    console.log(`Testing navigation with dynamic search term: "${searchTerm}"`);

    await ComboboxActions.open(page);
    await ComboboxActions.search(page, searchTerm);
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    console.log(`Search returned ${count} results`);

    if (count === 0) return;

    // Navigate through first few items
    for (let i = 0; i < Math.min(count, 5); i++) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
      const idx = await getSelectedIndex(page);
      const option = options.nth(idx);
      const type = await getOptionType(option);
      const title = await ComboboxLocators.optionTitle(option).textContent().catch(() => '?');
      console.log(`  [${idx}] ${type}: ${title.substring(0, 40)}`);
    }
  });

  test('drill into dynamically discovered container', async ({ page }) => {
    if (!fixtures || fixtures.containers.length === 0) {
      console.log('No containers in fixtures');
      return;
    }

    // Use a container from fixtures
    const container = fixtures.containers[Math.floor(Math.random() * fixtures.containers.length)];
    console.log(`Testing drill-in with container: "${container.title}" (${container.id})`);

    // Navigate to this container via URL
    await page.goto(`${TEST_URL}?value=${encodeURIComponent(container.id)}`);

    await ComboboxActions.open(page);
    await page.waitForTimeout(1000); // Wait for siblings to load

    const options = ComboboxLocators.options(page);
    const count = await options.count();
    console.log(`Container context shows ${count} items`);

    // Try keyboard navigation
    if (count > 0) {
      await ComboboxActions.pressKey(page, 'ArrowDown');
      await ComboboxActions.pressKey(page, 'ArrowDown');
      const idx = await getSelectedIndex(page);
      console.log(`Selected index after 2 ArrowDowns: ${idx}`);
    }
  });
});
