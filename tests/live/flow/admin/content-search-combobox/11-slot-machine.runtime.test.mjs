// tests/live/flow/admin/content-search-combobox/11-slot-machine.runtime.test.mjs
/**
 * Slot Machine Query Tests
 *
 * Stochastic testing with API-driven fixtures.
 * Run with: npm run test:slot-machine
 * Reproduce: TEST_SEED=<seed> npm run test:slot-machine
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';
import { initializeSlotMachine, getFixture, getSlotMachineSeed } from '#fixtures/combobox/dynamicFixtureLoader.mjs';

const TEST_URL = '/admin/test/combobox';
const SPIN_COUNT = parseInt(process.env.SPIN_COUNT) || 30;

test.describe('Slot Machine Query Tests', () => {
  let harness;
  let fixtureData;

  test.beforeAll(async () => {
    fixtureData = await initializeSlotMachine({ spinCount: SPIN_COUNT });
  });

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    harness.resetApiCalls?.();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    await harness.teardown();
  });

  // Generate tests dynamically
  for (let i = 0; i < SPIN_COUNT; i++) {
    test(`spin ${i}`, async ({ page }) => {
      const fixture = getFixture(i);
      expect(fixture, `Spin ${i}: fixture must be defined`).toBeDefined();

      console.log(`🎰 [${fixture.spinNumber}] ${fixture.query} (${fixture.stress})`);

      // Execute with stress factor
      await ComboboxActions.open(page);
      await executeWithStress(page, fixture.query, fixture.stress);

      // Collect results
      const { count, results } = await collectResults(page);
      console.log(`   → ${count} results`);

      // Assert expectations
      await assertExpectations(harness, fixture, count, results);
    });
  }
});

// =============================================================================
// Stress Executors
// =============================================================================

async function executeWithStress(page, query, stress) {
  const input = ComboboxLocators.input(page);

  try {
    switch (stress) {
      case 'normal':
        await input.fill(query);
        break;

      case 'rapid-fire':
        await input.focus();
        for (const char of query) {
          await page.keyboard.type(char, { delay: 0 });
        }
        break;

      case 'mid-stream-change':
        await input.fill('decoy:interrupt');
        await page.waitForTimeout(50);
        await input.fill(query);
        break;

      case 'backspace-retype':
        await input.fill(query + 'xxx');
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press('Backspace');
        }
        break;
    }

    // Wait for stream to complete
    await ComboboxActions.waitForStreamComplete(page, 15000);
  } catch {
    // Timeout acceptable
  }
}

// =============================================================================
// Result Collection
// =============================================================================

async function collectResults(page) {
  let count = 0;
  const results = [];

  try {
    const options = ComboboxLocators.options(page);
    count = await options.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const opt = options.nth(i);
      results.push({
        badge: await ComboboxLocators.optionBadge(opt).textContent().catch(() => null),
        type: await opt.getAttribute('data-content-type').catch(() => null),
        mediaType: await opt.getAttribute('data-media-type').catch(() => null),
      });
    }
  } catch {
    // Page may have closed
  }

  return { count, results };
}

// =============================================================================
// Expectation Assertions
// =============================================================================

async function assertExpectations(harness, fixture, count, results) {
  const { expectations } = fixture;

  // Always: no critical backend errors
  if (expectations.noBackendErrors) {
    const check = harness.assertNoBackendErrors();
    const critical = check.errors.filter(e =>
      !e.includes('proxy.timeout') && !e.includes('ECONNREFUSED')
    );
    expect(critical).toEqual([]);
  }

  // Source prefix: badges should match
  if (expectations.sourceBadge && results.length > 0) {
    const badges = results.map(r => r.badge?.toLowerCase()).filter(Boolean);
    if (badges.length > 0) {
      const matching = badges.filter(b => b.includes(expectations.sourceBadge));
      // Allow 70% match (some mixed results ok)
      expect(matching.length).toBeGreaterThanOrEqual(Math.floor(badges.length * 0.7));
    }
  }

  // Gatekeeper exclude: should not contain excluded types
  if (expectations.gatekeeper?.exclude && results.length > 0) {
    for (const result of results) {
      if (result.type) {
        expect(expectations.gatekeeper.exclude).not.toContain(result.type);
      }
    }
  }

  // Gatekeeper include: should only contain included types
  if (expectations.gatekeeper?.include && results.length > 0) {
    for (const result of results) {
      if (result.type) {
        expect(expectations.gatekeeper.include).toContain(result.type);
      }
    }
  }

  // Result range (loose)
  expect(count).toBeGreaterThanOrEqual(expectations.resultRange.min);
  expect(count).toBeLessThanOrEqual(expectations.resultRange.max);
}
