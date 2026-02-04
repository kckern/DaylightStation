// tests/live/flow/admin/content-search-combobox/00-preflight.runtime.test.mjs
/**
 * Preflight checks for ContentSearchCombobox test suite
 *
 * Runs FIRST (alphabetically) to fail fast if infrastructure isn't ready.
 * All other tests depend on these checks passing.
 */
import { test, expect } from '@playwright/test';
import { BACKEND_URL, FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const API_TIMEOUT = 30000; // 30 seconds (search API can be slow on cold start)

test.describe('ContentSearchCombobox - Preflight Checks', () => {

  test.describe.configure({ mode: 'serial' }); // Run in order, stop on first failure

  test('backend API is responding', async ({ request }) => {
    const response = await request.get(`${BACKEND_URL}/api/v1/health`, {
      timeout: API_TIMEOUT,
    }).catch(e => null);

    if (!response) {
      throw new Error(
        `Backend API not responding at ${BACKEND_URL}\n` +
        `\n` +
        `To fix:\n` +
        `  1. Start the dev server: npm run dev\n` +
        `  2. Wait for "Server running on port..." message\n` +
        `  3. Re-run tests\n`
      );
    }

    expect(response.ok(), `Backend health check failed with status ${response.status()}`).toBe(true);
  });

  test('search API endpoint is available', async ({ request }) => {
    // Simple check that search endpoint responds
    // Don't retry - if backend is healthy, search should work
    // The actual search tests will exercise this more thoroughly
    const response = await request.get(`${BACKEND_URL}/api/v1/content/query/search?text=a&take=1`, {
      timeout: API_TIMEOUT,
    }).catch(e => {
      throw new Error(
        `Search API not responding at ${BACKEND_URL}/api/v1/content/query/search\n` +
        `Error: ${e?.message || 'Unknown'}\n` +
        `\n` +
        `The search endpoint is required for most tests.\n`
      );
    });

    // Accept 200 OK - search API is working
    // Note: May return empty results for single char search due to minimum query length
    expect(response.status()).toBe(200);
  });

  test('list API endpoint is available', async ({ request }) => {
    const response = await request.get(`${BACKEND_URL}/api/v1/list/media/`, {
      timeout: API_TIMEOUT,
    }).catch(e => null);

    if (!response) {
      throw new Error(
        `List API not responding at ${BACKEND_URL}/api/v1/list/media/\n` +
        `\n` +
        `The list endpoint is required for browse mode tests.\n`
      );
    }

    // Accept 200 OK or 404 (path not found) - both mean API is working
    expect([200, 404]).toContain(response.status());
  });

  test('frontend test page is accessible', async ({ page }) => {
    const response = await page.goto(`${FRONTEND_URL}/admin/test/combobox`, {
      timeout: API_TIMEOUT,
      waitUntil: 'domcontentloaded',
    }).catch(e => null);

    if (!response) {
      throw new Error(
        `Frontend not responding at ${FRONTEND_URL}\n` +
        `\n` +
        `To fix:\n` +
        `  1. Start the dev server: npm run dev\n` +
        `  2. Verify Vite is running on the configured port\n`
      );
    }

    expect(response.ok(), `Test page returned status ${response.status()}`).toBe(true);

    // Verify the test harness component rendered
    const title = page.locator('text=ContentSearchCombobox Test Harness');
    await expect(title).toBeVisible({ timeout: 5000 });
  });

  test('ComboboxTestHarness module loads', async () => {
    // This runs in Node context, verifying imports work
    const { ComboboxTestHarness, ComboboxLocators, ComboboxActions } =
      await import('#testlib/comboboxTestHarness.mjs');

    expect(ComboboxTestHarness).toBeDefined();
    expect(ComboboxLocators).toBeDefined();
    expect(ComboboxActions).toBeDefined();
  });

  test('dynamic fixture loader works', async () => {
    const { loadDynamicFixtures, EDGE_CASES } =
      await import('#fixtures/combobox/dynamicFixtureLoader.mjs');

    expect(loadDynamicFixtures).toBeDefined();
    expect(EDGE_CASES).toBeDefined();
    expect(Array.isArray(EDGE_CASES)).toBe(true);
    expect(EDGE_CASES.length).toBeGreaterThan(0);

    // Actually load fixtures to verify API connectivity
    const fixtures = await loadDynamicFixtures();

    expect(fixtures).toBeDefined();
    expect(fixtures.searchTerms).toBeDefined();
    expect(fixtures.sourceFixtures).toBeDefined();

    console.log(`Preflight: Loaded ${fixtures.searchTerms.length} search terms`);
    console.log(`Preflight: Discovered sources: ${Object.keys(fixtures.sourceFixtures).join(', ') || 'none'}`);
  });

});
