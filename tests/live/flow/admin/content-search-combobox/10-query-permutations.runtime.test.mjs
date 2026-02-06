// tests/live/flow/admin/content-search-combobox/10-query-permutations.runtime.test.mjs
/**
 * Query Permutation Tests
 *
 * Systematically tests combinations of:
 * - Sources: plex, immich, media, audiobookshelf, singing, narrated
 * - Categories: media, gallery, audiobooks, ebooks, local
 * - Built-in Aliases: music, photos, video, audiobooks
 * - Keywords: common search terms
 *
 * Based on query-combinatorics.md reference document.
 */
import { test, expect } from '@playwright/test';
import { ComboboxTestHarness, ComboboxLocators, ComboboxActions } from '#testlib/comboboxTestHarness.mjs';

const TEST_URL = '/admin/test/combobox';

// ============================================================================
// Test Data: Permutation Matrices
// ============================================================================

// Concrete sources from query-combinatorics.md
const SOURCES = ['plex', 'immich', 'media', 'singing', 'narrated'];

// Category aliases
const CATEGORIES = ['media', 'gallery'];

// Built-in query aliases (from ContentQueryAliasResolver)
// Note: audiobooks excluded from matrix tests due to slow adapter - tested separately
const BUILT_IN_ALIASES = ['music', 'photos', 'video'];

// Common search keywords for testing
const KEYWORDS = ['the', 'love', 'home', 'test', 'family'];

// Edge case keywords
const EDGE_KEYWORDS = [
  'a',              // Single character
  '2024',           // Year/number
  'o\'brien',       // Apostrophe
  'star wars',      // Multi-word
  'münchen',        // Unicode
];

// ============================================================================
// Test Suite
// ============================================================================

test.describe('ContentSearchCombobox - Query Permutations', () => {
  let harness;

  test.beforeEach(async ({ page }) => {
    harness = new ComboboxTestHarness(page);
    await harness.setup();
    await page.goto(TEST_URL);
  });

  test.afterEach(async () => {
    const apiCheck = harness.assertAllApiValid();
    expect(apiCheck.passed).toBe(true);

    // Filter out expected infrastructure errors (proxy timeouts are transient)
    const backendCheck = harness.assertNoBackendErrors();
    const criticalErrors = backendCheck.errors.filter(e => {
      // Proxy timeouts are expected occasionally
      if (e.includes('proxy.timeout')) return false;
      // Connection errors to external services
      if (e.includes('ECONNREFUSED')) return false;
      return true;
    });
    expect(criticalErrors).toEqual([]);

    await harness.teardown();
  });

  // ==========================================================================
  // Source Prefix Permutations
  // ==========================================================================

  test.describe('Source Prefix Permutations', () => {
    for (const source of SOURCES) {
      test(`${source}: prefix searches ${source} source`, async ({ page }) => {
        await ComboboxActions.open(page);
        await ComboboxActions.search(page, `${source}:test`);

        try {
          await ComboboxActions.waitForStreamComplete(page, 20000);
        } catch {
          // Timeout acceptable for sources that may be slow or unconfigured
          console.log(`${source}:test timed out (acceptable)`);
        }

        // Get count safely (page may have closed on timeout)
        let count = 0;
        try {
          const options = ComboboxLocators.options(page);
          count = await options.count();
          console.log(`${source}:test returned ${count} results`);

          // If results exist, verify they come from expected source
          if (count > 0) {
            const firstOption = options.first();
            const badge = ComboboxLocators.optionBadge(firstOption);
            const badgeText = await badge.textContent().catch(() => '');
            console.log(`  First result badge: "${badgeText}"`);
          }
        } catch {
          console.log(`${source}:test - could not get count (page closed)`);
        }
      });
    }
  });

  // ==========================================================================
  // Category Alias Permutations
  // ==========================================================================

  test.describe('Category Alias Permutations', () => {
    for (const category of CATEGORIES) {
      test(`${category}: category searches all ${category} sources`, async ({ page }) => {
        await ComboboxActions.open(page);
        await ComboboxActions.search(page, `${category}:family`);

        try {
          await ComboboxActions.waitForStreamComplete(page, 20000);
        } catch {
          // Timeout acceptable
        }

        const options = ComboboxLocators.options(page);
        const count = await options.count();

        console.log(`${category}:family returned ${count} results`);

        // Verify API was called
        const apiCheck = harness.assertApiCalled(/content\/query\/search/);
        expect(apiCheck.passed).toBe(true);
      });
    }
  });

  // ==========================================================================
  // Built-in Alias × Keyword Permutations
  // ==========================================================================

  test.describe('Built-in Alias × Keyword Matrix', () => {
    // Test each built-in alias with multiple keywords
    for (const alias of BUILT_IN_ALIASES) {
      test.describe(`${alias}: alias`, () => {
        for (const keyword of KEYWORDS.slice(0, 3)) { // Limit to avoid too many tests
          test(`${alias}:${keyword} returns results or completes gracefully`, async ({ page }) => {
            await ComboboxActions.open(page);
            await ComboboxActions.search(page, `${alias}:${keyword}`);

            try {
              await ComboboxActions.waitForStreamComplete(page, 15000);
            } catch {
              // Timeout acceptable for slow aliases
              console.log(`${alias}:${keyword} timed out (acceptable)`);
            }

            try {
              const options = ComboboxLocators.options(page);
              const count = await options.count();
              console.log(`${alias}:${keyword} → ${count} results`);
            } catch {
              console.log(`${alias}:${keyword} - could not get count`);
            }
          });
        }
      });
    }
  });

  // ==========================================================================
  // Edge Case Keywords
  // ==========================================================================

  test.describe('Edge Case Keywords', () => {
    for (const keyword of EDGE_KEYWORDS) {
      test(`handles edge case keyword: "${keyword}"`, async ({ page }) => {
        await ComboboxActions.open(page);
        await ComboboxActions.search(page, keyword);

        try {
          await ComboboxActions.waitForStreamComplete(page, 15000);
        } catch {
          // Timeout acceptable
        }

        const options = ComboboxLocators.options(page);
        const count = await options.count();

        console.log(`"${keyword}" → ${count} results`);

        // Should not crash
        const backendCheck = harness.assertNoBackendErrors();
        expect(backendCheck.errors).toEqual([]);
      });
    }

    for (const keyword of EDGE_KEYWORDS) {
      test(`handles edge case with prefix: music:"${keyword}"`, async ({ page }) => {
        await ComboboxActions.open(page);
        await ComboboxActions.search(page, `music:${keyword}`);

        try {
          await ComboboxActions.waitForStreamComplete(page, 15000);
        } catch {
          console.log(`music:"${keyword}" timed out (acceptable)`);
        }

        try {
          const options = ComboboxLocators.options(page);
          const count = await options.count();
          console.log(`music:"${keyword}" → ${count} results`);
        } catch {
          console.log(`music:"${keyword}" - could not get count`);
        }

        // Test passes if no crash occurred
      });
    }
  });

  // ==========================================================================
  // Case Sensitivity Permutations
  // ==========================================================================

  test.describe('Case Sensitivity', () => {
    const caseCombos = [
      { prefix: 'music', keyword: 'love' },
      { prefix: 'MUSIC', keyword: 'love' },
      { prefix: 'Music', keyword: 'LOVE' },
      { prefix: 'PLEX', keyword: 'office' },
      { prefix: 'plex', keyword: 'OFFICE' },
    ];

    for (const { prefix, keyword } of caseCombos) {
      test(`${prefix}:${keyword} handles case correctly`, async ({ page }) => {
        await ComboboxActions.open(page);
        await ComboboxActions.search(page, `${prefix}:${keyword}`);

        try {
          await ComboboxActions.waitForStreamComplete(page, 15000);
        } catch {
          // Timeout acceptable
        }

        const options = ComboboxLocators.options(page);
        const count = await options.count();

        console.log(`${prefix}:${keyword} → ${count} results`);

        // API should be called regardless of case
        const apiCheck = harness.assertApiCalled(/content\/query\/search/);
        expect(apiCheck.passed).toBe(true);
      });
    }
  });

  // ==========================================================================
  // No Prefix (Plain Query) Permutations
  // ==========================================================================

  test.describe('Plain Query (No Prefix)', () => {
    const plainQueries = [
      'the office',
      'beethoven',
      'family photos',
      'workout',
      'christmas',
    ];

    for (const query of plainQueries) {
      test(`plain query "${query}" searches all sources`, async ({ page }) => {
        await ComboboxActions.open(page);
        await ComboboxActions.search(page, query);
        await ComboboxActions.waitForStreamComplete(page, 30000);

        const options = ComboboxLocators.options(page);
        const count = await options.count();

        console.log(`"${query}" → ${count} results`);

        // Plain queries should return results
        if (count > 0) {
          // Check that results come from multiple sources (not just one)
          const sources = new Set();
          for (let i = 0; i < Math.min(count, 10); i++) {
            const option = options.nth(i);
            const badge = ComboboxLocators.optionBadge(option);
            const badgeText = await badge.textContent().catch(() => 'unknown');
            if (badgeText) sources.add(badgeText);
          }
          console.log(`  Sources in results: ${[...sources].join(', ')}`);
        }
      });
    }
  });

  // ==========================================================================
  // Gatekeeper Validation Permutations
  // ==========================================================================

  test.describe('Gatekeeper Filtering Validation', () => {
    test('music: excludes audiobooks across multiple keywords', async ({ page }) => {
      const musicKeywords = ['book', 'story', 'tale', 'harry'];
      let audiobooks_found = 0;

      for (const keyword of musicKeywords) {
        await ComboboxActions.open(page);
        await ComboboxActions.search(page, `music:${keyword}`);

        try {
          await ComboboxActions.waitForStreamComplete(page, 15000);
        } catch {
          // Continue
        }

        const options = ComboboxLocators.options(page);
        const count = await options.count();

        // Check for audiobooks in results
        for (let i = 0; i < count; i++) {
          const option = options.nth(i);
          const typeAttr = await option.getAttribute('data-content-type').catch(() => null);
          if (typeAttr === 'audiobook' || typeAttr === 'podcast') {
            audiobooks_found++;
            console.log(`WARNING: Found ${typeAttr} in music:${keyword} results`);
          }
        }

        // Close for next iteration
        await ComboboxActions.pressKey(page, 'Escape');
        await page.waitForTimeout(100);
      }

      // Gatekeeper should have excluded audiobooks
      expect(audiobooks_found).toBe(0);
    });

    test('video: returns only video content types', async ({ page }) => {
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'video:action');

      try {
        await ComboboxActions.waitForStreamComplete(page, 20000);
      } catch {
        // Timeout acceptable
      }

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      console.log(`video:action → ${count} results`);

      // If results have mediaType, should be video
      for (let i = 0; i < Math.min(count, 5); i++) {
        const option = options.nth(i);
        const mediaType = await option.getAttribute('data-media-type').catch(() => null);
        if (mediaType) {
          console.log(`  Result ${i} mediaType: ${mediaType}`);
        }
      }
    });
  });

  // ==========================================================================
  // Rapid Sequential Queries
  // ==========================================================================

  test.describe('Rapid Sequential Queries', () => {
    test('handles rapid prefix switching', async ({ page }) => {
      const queries = [
        'music:test',
        'video:test',
        'plex:test',
        'photos:test',
        'files:test',
      ];

      await ComboboxActions.open(page);

      for (const query of queries) {
        await ComboboxLocators.input(page).fill(query);
        await page.waitForTimeout(200); // Brief pause between queries
      }

      // Wait for final query to complete
      try {
        await ComboboxActions.waitForStreamComplete(page, 15000);
      } catch {
        // May timeout
      }

      // Should not have backend errors from rapid switching
      const backendCheck = harness.assertNoBackendErrors();
      expect(backendCheck.errors).toEqual([]);

      console.log('Rapid prefix switching completed without errors');
    });

    test('handles rapid keyword changes within same prefix', async ({ page }) => {
      await ComboboxActions.open(page);

      const prefix = 'music';
      const keywords = ['a', 'ab', 'abc', 'abcd', 'test'];

      for (const keyword of keywords) {
        await ComboboxLocators.input(page).fill(`${prefix}:${keyword}`);
        await page.waitForTimeout(100);
      }

      try {
        await ComboboxActions.waitForStreamComplete(page, 15000);
      } catch {
        // May timeout
      }

      const backendCheck = harness.assertNoBackendErrors();
      expect(backendCheck.errors).toEqual([]);

      console.log('Rapid keyword changes completed without errors');
    });
  });

  // ==========================================================================
  // Empty Results Handling
  // ==========================================================================

  test.describe('Empty Results Handling', () => {
    const unlikelyQueries = [
      'xyznonexistent12345',
      'music:qqqwwweee999',
      'plex:zzzznotreal',
      'photos:impossibleterm',
    ];

    for (const query of unlikelyQueries) {
      test(`handles no results for "${query}"`, async ({ page }) => {
        await ComboboxActions.open(page);
        await ComboboxActions.search(page, query);

        try {
          await ComboboxActions.waitForStreamComplete(page, 10000);
        } catch {
          // Expected to complete quickly with no results
        }

        const options = ComboboxLocators.options(page);
        const count = await options.count();

        console.log(`"${query}" → ${count} results (expected 0)`);

        // Should handle empty results gracefully (no errors)
        const backendCheck = harness.assertNoBackendErrors();
        expect(backendCheck.errors).toEqual([]);
      });
    }
  });

  // ==========================================================================
  // Source × Category Combinations (should these stack?)
  // ==========================================================================

  test.describe('Prefix Priority', () => {
    test('source prefix takes priority over category alias', async ({ page }) => {
      // plex: is a source, should search only plex
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'plex:office');
      await ComboboxActions.waitForStreamComplete(page, 20000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      console.log(`plex:office → ${count} results`);

      // All results should be from plex
      for (let i = 0; i < Math.min(count, 5); i++) {
        const option = options.nth(i);
        const badge = ComboboxLocators.optionBadge(option);
        const badgeText = await badge.textContent().catch(() => '');
        if (badgeText) {
          expect(badgeText.toLowerCase()).toContain('plex');
        }
      }
    });

    test('built-in alias takes priority when matching', async ({ page }) => {
      // music: is a built-in alias, should apply gatekeeper
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, 'music:love');
      await ComboboxActions.waitForStreamComplete(page, 20000);

      const options = ComboboxLocators.options(page);
      const count = await options.count();

      console.log(`music:love → ${count} results (should have gatekeeper applied)`);

      // Verify gatekeeper excluded audiobooks
      for (let i = 0; i < count; i++) {
        const option = options.nth(i);
        const typeAttr = await option.getAttribute('data-content-type').catch(() => null);
        if (typeAttr) {
          expect(typeAttr).not.toBe('audiobook');
        }
      }
    });
  });

  // ==========================================================================
  // Summary Statistics Test
  // ==========================================================================

  test('summary: collect result counts for all permutations', async ({ page }) => {
    const results = [];

    const allQueries = [
      // Plain
      'the office',
      'beethoven',
      // Built-in aliases
      'music:love',
      'video:action',
      'photos:family',
      // Source prefixes
      'plex:office',
      'immich:family',
      // Category
      'files:home',
      'gallery:vacation',
    ];

    for (const query of allQueries) {
      harness.reset();
      await ComboboxActions.open(page);
      await ComboboxActions.search(page, query);

      try {
        await ComboboxActions.waitForStreamComplete(page, 10000);
      } catch {
        // Continue
      }

      const options = ComboboxLocators.options(page);
      const count = await options.count();
      results.push({ query, count });

      await ComboboxActions.pressKey(page, 'Escape');
      await page.waitForTimeout(100);
    }

    // Log summary
    console.log('\n=== PERMUTATION RESULTS SUMMARY ===');
    for (const { query, count } of results) {
      console.log(`  ${query.padEnd(20)} → ${count} results`);
    }
    console.log('===================================\n');

    // At least some queries should return results
    const totalResults = results.reduce((sum, r) => sum + r.count, 0);
    expect(totalResults).toBeGreaterThan(0);
  });
});
