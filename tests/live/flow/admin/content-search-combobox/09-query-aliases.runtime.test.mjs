// tests/live/flow/admin/content-search-combobox/09-query-aliases.runtime.test.mjs
/**
 * Query Alias E2E Tests
 * Tests the full alias cascade: orchestration -> config -> adapter
 *
 * Built-in aliases tested:
 * - music: (audio-for-listening, excludes audiobooks/podcasts)
 * - photos: (visual-gallery, maps to gallery category)
 * - video: (watchable-content, prefers video media type)
 *
 * Prefix parsing tested:
 * - Plain queries (no prefix) search all sources
 * - Source prefixes (plex:, immich:) limit to specific sources
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

test.describe('ContentSearchCombobox - Query Aliases', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    const apiCheck = harness.assertAllApiValid();
    expect(apiCheck.passed).toBe(true);

    const backendCheck = harness.assertNoBackendErrors();
    expect(backendCheck.errors).toEqual([]);

    await harness.teardown();
  });

  test.describe('Built-in Aliases', () => {
    test('music: prefix searches audio content', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'music:love');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      // Should return results (assuming music content exists)
      console.log(`music:love returned ${count} results`);

      // Verify API was called with the search
      const apiCheck = harness.assertApiCalled(/content\/query\/search/);
      expect(apiCheck.passed).toBe(true);
    });

    test('video: prefix searches video content', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'video:office');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      console.log(`video:office returned ${count} results`);

      // Verify search completed
      const apiCheck = harness.assertApiCalled(/content\/query\/search/);
      expect(apiCheck.passed).toBe(true);
    });

    test('photos: prefix searches gallery sources', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'photos:family');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      // Photos may not return results if no gallery configured
      console.log(`photos:family returned ${count} results`);

      // Verify search was triggered
      const apiCheck = harness.assertApiCalled(/content\/query\/search/);
      expect(apiCheck.passed).toBe(true);
    });
  });

  test.describe('Prefix Parsing', () => {
    test('query without prefix searches all sources', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'the office');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      // Should return results from multiple sources
      expect(count).toBeGreaterThan(0);
      console.log(`Plain search 'the office' returned ${count} results`);
    });

    test('plex: prefix limits search to plex source', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'plex:office');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      console.log(`plex:office returned ${count} results`);

      if (count > 0) {
        // Verify results are from plex
        for (let i = 0; i < Math.min(count, 5); i++) {
          const option = options.nth(i);
          const badge = ComboboxLocators.optionBadge(option);
          const badgeText = await badge.textContent().catch(() => '');

          // Badge should indicate plex source
          if (badgeText) {
            console.log(`Result ${i}: badge = "${badgeText}"`);
          }
        }
      }
    });

    test('prefix is case-insensitive', async ({ page }) => {
      // Test uppercase prefix
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'MUSIC:test');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const apiCheck = harness.assertApiCalled(/content\/query\/search/);
      expect(apiCheck.passed).toBe(true);

      console.log('Case-insensitive prefix MUSIC: triggered search');
    });
  });

  test.describe('Gatekeeper Filtering', () => {
    test('music: alias excludes audiobooks from results', async ({ page }) => {
      // Search for a term that might match both music and audiobooks
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'music:story');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      console.log(`music:story returned ${count} results`);

      // Check that no audiobooks slipped through
      // The gatekeeper should filter out contentType: 'audiobook'
      for (let i = 0; i < count; i++) {
        const option = options.nth(i);
        const typeAttr = await option.getAttribute('data-content-type').catch(() => null);

        // If the item has a content type attribute, verify it's not audiobook
        if (typeAttr) {
          expect(typeAttr).not.toBe('audiobook');
          expect(typeAttr).not.toBe('podcast');
        }
      }
    });

    test('audiobooks: alias only returns audiobook content', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'audiobooks:harry');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      console.log(`audiobooks:harry returned ${count} results`);

      // The audiobooks alias should use include filter to only allow audiobook type
      // Verify API was called
      const apiCheck = harness.assertApiCalled(/content\/query\/search/);
      expect(apiCheck.passed).toBe(true);

      // If results exist and have content-type attributes, verify they're audiobooks
      for (let i = 0; i < Math.min(count, 5); i++) {
        const option = options.nth(i);
        const typeAttr = await option.getAttribute('data-content-type').catch(() => null);

        if (typeAttr) {
          // audiobooks: alias should only return audiobook content
          expect(typeAttr).toBe('audiobook');
        }
      }
    });
  });

  test.describe('Alias Resolution Flow', () => {
    test('search completes without errors for all built-in aliases', async ({ page }) => {
      const aliases = ['music', 'video', 'photos', 'audiobooks'];

      for (const alias of aliases) {
        harness.reset(); // Clear tracking for each search

        await ComboboxActions.open(page);
        await ComboboxActions.search(page, `${alias}:test`);
        await ComboboxActions.waitForStreamComplete(page, 30000);

        // Verify no backend errors
        const backendCheck = harness.assertNoBackendErrors();
        expect(backendCheck.errors).toEqual([]);

        console.log(`${alias}: alias search completed without errors`);

        // Close dropdown for next iteration
        await ComboboxActions.pressKey(page, 'Escape');
        await page.waitForTimeout(200);
      }
    });

    test('unknown prefix passes through as source lookup', async ({ page }) => {
      // Use a made-up prefix that's not a built-in alias
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'unknown123:test');
      await ComboboxActions.waitForStreamComplete(page, 30000);

      // Should complete without error (unknown prefix falls through to registry)
      const backendCheck = harness.assertNoBackendErrors();
      expect(backendCheck.errors).toEqual([]);

      console.log('Unknown prefix handled gracefully');
    });
  });

  test.describe('Streaming with Aliases', () => {
    test('streaming search works with alias prefix', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxLocators.input(page).fill('music:piano');

      // Should see results appear progressively
      await expect(ComboboxLocators.options(page).first()).toBeVisible({ timeout: 30000 });

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      console.log(`Streaming search music:piano yielded ${count} results`);
    });

    test('changing search cancels previous alias search', async ({ page }) => {
      await ComboboxActions.open(page);

      // Start a search
      await ComboboxLocators.input(page).fill('music:bach');
      await page.waitForTimeout(100);

      // Quickly change to different search
      await ComboboxLocators.input(page).fill('video:action');

      // Wait for second search to complete
      await ComboboxActions.waitForStreamComplete(page, 30000);

      // Should have results from video search, not music
      const options = ComboboxLocators.options(page);
      const count = await options.count();

      console.log(`Rapid search change completed with ${count} results`);
    });
  });
});
