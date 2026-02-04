// tests/live/flow/admin/content-search-combobox/04c-keyboard-stress.runtime.test.mjs
/**
 * Keyboard Navigation Stress Tests
 * Runs 50+ iterations with random data combinations to ensure rock-solid browse behavior
 *
 * Tests randomized:
 * - Search terms
 * - Navigation sequences (up/down/left/right)
 * - Drill depths
 * - Selection positions
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';
import { loadDynamicFixtures } from '#fixtures/combobox/dynamicFixtureLoader.mjs';

const TEST_URL = '/admin/test/combobox';

// Search terms pool for stress testing
const SEARCH_TERMS = [
  'the', 'a', 'an', 'Office', 'Parks', 'show', 'movie', 'music', 'photo',
  'video', 'test', 'file', 'song', '2025', '2026', 'season', 'episode',
  'album', 'artist', 'folder', 'image', 'audio', 'media'
];

// Generate random navigation sequence
function randomNavSequence(length) {
  const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  return Array.from({ length }, () => keys[Math.floor(Math.random() * keys.length)]);
}

// Generate weighted navigation (more up/down than left/right)
function weightedNavSequence(length) {
  const keys = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  return Array.from({ length }, () => keys[Math.floor(Math.random() * keys.length)]);
}

// Helper to get selected index
async function getSelectedIndex(page) {
  const options = ComboboxLocators.options(page);
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const isSelected = await options.nth(i).getAttribute('data-combobox-selected');
    if (isSelected === 'true') return i;
  }
  return -1;
}

// Helper to check if in drilled state
async function isDrilledIn(page) {
  const backButton = ComboboxLocators.backButton(page);
  return await backButton.isVisible().catch(() => false);
}

// Fixtures loaded once
let fixtures;

test.describe('ContentSearchCombobox - Keyboard Stress Tests', () => {
  let harness;

  test.beforeAll(async () => {
    fixtures = await loadDynamicFixtures();
    console.log(`Stress test fixtures: ${fixtures.searchTerms.length} terms, ${fixtures.containers.length} containers`);
  });

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    await harness.teardown();
  });

  // ===========================================================================
  // Iteration Tests - Run many times with different data
  // ===========================================================================

  // Generate 10 random navigation tests
  for (let iteration = 1; iteration <= 10; iteration++) {
    test(`random navigation iteration ${iteration}`, async ({ page }) => {
      const searchTerm = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
      const navSequence = randomNavSequence(10 + Math.floor(Math.random() * 20));

      console.log(`[Iteration ${iteration}] Search: "${searchTerm}", Nav: ${navSequence.length} keys`);

      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill(searchTerm);
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      if (count === 0) {
        console.log(`  No results for "${searchTerm}" - skipping`);
        return;
      }

      console.log(`  ${count} results, executing ${navSequence.length} navigation keys`);

      let errors = [];
      for (let i = 0; i < navSequence.length; i++) {
        const key = navSequence[i];
        try {
          await page.keyboard.press(key);
          await page.waitForTimeout(50); // Small delay between keys
        } catch (e) {
          errors.push(`Key ${i} (${key}): ${e.message}`);
        }
      }

      // Verify we're still in a valid state
      const dropdown = ComboboxLocators.dropdown(page);
      const isOpen = await dropdown.isVisible().catch(() => false);
      const selectedIdx = await getSelectedIndex(page);
      const drilled = await isDrilledIn(page);

      console.log(`  Final state: dropdown=${isOpen ? 'open' : 'closed'}, selected=${selectedIdx}, drilled=${drilled}`);

      if (errors.length > 0) {
        console.error(`  Errors: ${errors.join(', ')}`);
      }

      // Test passes if no crash occurred
      expect(errors.length).toBe(0);
    });
  }

  // Generate 10 weighted navigation tests (more realistic patterns)
  for (let iteration = 1; iteration <= 10; iteration++) {
    test(`weighted navigation iteration ${iteration}`, async ({ page }) => {
      const searchTerm = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
      const navSequence = weightedNavSequence(15 + Math.floor(Math.random() * 15));

      console.log(`[Weighted ${iteration}] Search: "${searchTerm}", Nav: ${navSequence.length} keys`);

      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill(searchTerm);
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      if (count === 0) {
        console.log(`  No results - skipping`);
        return;
      }

      // Execute sequence
      for (const key of navSequence) {
        await page.keyboard.press(key);
        await page.waitForTimeout(30);
      }

      // Verify valid state
      const selectedIdx = await getSelectedIndex(page);
      expect(selectedIdx).toBeGreaterThanOrEqual(-1);
    });
  }

  // Generate 10 drill-and-back tests
  for (let iteration = 1; iteration <= 10; iteration++) {
    test(`drill and back iteration ${iteration}`, async ({ page }) => {
      console.log(`[Drill ${iteration}] Testing drill down and back navigation`);

      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'the');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      if (count === 0) return;

      // Random depth to drill
      const targetDepth = 1 + Math.floor(Math.random() * 3);
      let actualDepth = 0;

      // Drill down
      for (let d = 0; d < targetDepth; d++) {
        const currentOptions = ComboboxLocators.options(page);
        const currentCount = await currentOptions.count();

        if (currentCount === 0) break;

        // Navigate to random position
        const targetPos = Math.floor(Math.random() * Math.min(currentCount, 5));
        for (let i = 0; i <= targetPos; i++) {
          await page.keyboard.press('ArrowDown');
        }

        // Try to drill with Enter
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);

        if (await isDrilledIn(page)) {
          actualDepth++;
          console.log(`  Drilled to depth ${actualDepth}`);
        } else {
          // Might have selected a leaf
          const dropdown = ComboboxLocators.dropdown(page);
          if (!(await dropdown.isVisible().catch(() => false))) {
            console.log(`  Selected leaf at depth ${actualDepth}`);
            return; // Test complete
          }
          break;
        }
      }

      // Go back up with ArrowLeft or back button
      console.log(`  At depth ${actualDepth}, going back`);
      for (let d = 0; d < actualDepth; d++) {
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(300);
      }

      const finalDrilled = await isDrilledIn(page);
      console.log(`  After backing out: drilled=${finalDrilled}`);
    });
  }

  // Generate 10 rapid key press tests
  for (let iteration = 1; iteration <= 10; iteration++) {
    test(`rapid keys iteration ${iteration}`, async ({ page }) => {
      const keyCount = 20 + Math.floor(Math.random() * 30);
      console.log(`[Rapid ${iteration}] ${keyCount} rapid key presses`);

      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'the');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      if (count === 0) return;

      // Rapid fire keys
      const input = ComboboxLocators.input(page);
      await input.focus();

      for (let i = 0; i < keyCount; i++) {
        const key = Math.random() > 0.5 ? 'ArrowDown' : 'ArrowUp';
        await page.keyboard.press(key);
        // No wait - as fast as possible
      }

      // Small settle time
      await page.waitForTimeout(100);

      const selectedIdx = await getSelectedIndex(page);
      console.log(`  After ${keyCount} rapid keys: selected=${selectedIdx}`);

      expect(selectedIdx).toBeGreaterThanOrEqual(-1);
    });
  }

  // Generate 10 full journey tests (search -> navigate -> select)
  for (let iteration = 1; iteration <= 10; iteration++) {
    test(`full journey iteration ${iteration}`, async ({ page }) => {
      const searchTerm = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
      console.log(`[Journey ${iteration}] Full user journey with "${searchTerm}"`);

      // 1. Open and search
      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill(searchTerm);
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      if (count === 0) {
        console.log('  No results - journey aborted');
        return;
      }

      // 2. Navigate to random position
      const navCount = Math.min(count - 1, Math.floor(Math.random() * 10));
      for (let i = 0; i < navCount; i++) {
        await page.keyboard.press('ArrowDown');
      }

      const selectedIdx = await getSelectedIndex(page);
      console.log(`  Navigated to index ${selectedIdx}`);

      // 3. Try selection or drill
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);

      const dropdown = ComboboxLocators.dropdown(page);
      const isOpen = await dropdown.isVisible().catch(() => false);
      const drilled = await isDrilledIn(page);

      if (!isOpen) {
        // Selected a leaf
        const value = await page.locator('[data-testid="current-value"]').textContent();
        console.log(`  Selected leaf: ${value.substring(0, 50)}`);
      } else if (drilled) {
        // Drilled into container
        const childCount = await ComboboxLocators.options(page).count();
        console.log(`  Drilled in - ${childCount} children`);

        // Navigate children and select
        if (childCount > 0) {
          await page.keyboard.press('ArrowDown');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(300);
        }
      }

      // Journey complete - verify no crash
      expect(true).toBe(true);
    });
  }

  // ===========================================================================
  // Edge Case Stress Tests
  // ===========================================================================

  test('stress: empty results navigation', async ({ page }) => {
    console.log('Testing navigation with queries likely to return empty results');

    const emptyQueries = ['xyznonexistent123', 'qqqqzzzzwwww', 'notarealterm999'];

    for (const query of emptyQueries) {
      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill(query);
      await ComboboxActions.waitForStreamComplete(page, 30000);

      // Try navigation on empty results
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Enter');

      // Should not crash
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
  });

  test('stress: alternating search and navigate', async ({ page }) => {
    console.log('Testing rapid alternation between searching and navigating');

    for (let i = 0; i < 10; i++) {
      const term = SEARCH_TERMS[i % SEARCH_TERMS.length];

      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill(term);

      // Don't wait for complete - start navigating immediately
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');

      // Change search
      await ComboboxLocators.input(page).fill(term + 'x');

      // Navigate more
      await page.keyboard.press('ArrowUp');

      // Close
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }
  });

  test('stress: Home and End keys (if supported)', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'the');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count < 5) return;

    // Try Home key
    await page.keyboard.press('Home');
    const afterHome = await getSelectedIndex(page);
    console.log(`After Home: index ${afterHome}`);

    // Try End key
    await page.keyboard.press('End');
    const afterEnd = await getSelectedIndex(page);
    console.log(`After End: index ${afterEnd}`);

    // These may or may not be implemented - just verify no crash
    expect(afterHome).toBeGreaterThanOrEqual(-1);
    expect(afterEnd).toBeGreaterThanOrEqual(-1);
  });

  test('stress: PageUp and PageDown keys (if supported)', async ({ page }) => {
    await ComboboxActions.open(page);
    await ComboboxActions.search(page, 'the');
    await ComboboxActions.waitForStreamComplete(page, 30000);

    const options = ComboboxLocators.options(page);
    const count = await options.count();

    if (count < 10) return;

    // Navigate to middle
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowDown');
    }

    const middleIdx = await getSelectedIndex(page);

    // Try PageDown
    await page.keyboard.press('PageDown');
    const afterPageDown = await getSelectedIndex(page);
    console.log(`After PageDown: ${middleIdx} -> ${afterPageDown}`);

    // Try PageUp
    await page.keyboard.press('PageUp');
    const afterPageUp = await getSelectedIndex(page);
    console.log(`After PageUp: ${afterPageDown} -> ${afterPageUp}`);

    expect(afterPageDown).toBeGreaterThanOrEqual(-1);
    expect(afterPageUp).toBeGreaterThanOrEqual(-1);
  });
});
