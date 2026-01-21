// tests/integration/api/parity-data-driven.test.mjs
/**
 * Data-Driven Parity Tests (Jest Integration)
 *
 * Runs snapshot mode tests via Jest for CI integration.
 * Reads baselines from tests/fixtures/parity-baselines/
 *
 * Run with: npm test -- parity-data-driven
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { loadFixtures, dedupeFixtures, groupByType } from '../../lib/fixture-loader.mjs';
import { buildUrl, getSupportedTypes } from '../../lib/endpoint-map.mjs';
import {
  loadConfig,
  normalizeResponse,
  compareResponses,
  loadBaseline
} from '../../lib/parity-runner.mjs';

const config = loadConfig();
const BASE_URL = process.env.PARITY_TEST_URL || config.server.default_url;

async function fetchJSON(url) {
  const response = await fetch(`${BASE_URL}${url}`, {
    headers: { 'Accept': 'application/json' }
  });
  return {
    status: response.status,
    data: response.ok ? await response.json() : null
  };
}

describe('Parity Snapshot Tests', () => {
  let fixtures = [];
  let grouped = {};

  beforeAll(async () => {
    // Check server is running
    try {
      const res = await fetch(`${BASE_URL}/api/ping`);
      if (!res.ok) throw new Error('Server not responding');
    } catch (err) {
      console.error(`
╔═══════════════════════════════════════════════════════════════╗
║  PARITY TESTS REQUIRE A RUNNING SERVER                        ║
║                                                                ║
║  Start the server:  npm run dev                                ║
║  Then run tests:    npm test -- parity-data-driven             ║
╚═══════════════════════════════════════════════════════════════╝
      `);
      throw err;
    }

    fixtures = await loadFixtures();
    const unique = dedupeFixtures(fixtures);
    grouped = groupByType(unique);
  });

  it('runs all baseline comparisons', async () => {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const failures = [];

    for (const [type, items] of Object.entries(grouped)) {
      for (const item of items) {
        const baseline = loadBaseline(type, item.value);
        if (!baseline) {
          skipped++;
          continue;
        }

        const url = buildUrl(type, item.value, 'ddd');
        const result = await fetchJSON(url);

        if (result.status !== 200) {
          failed++;
          failures.push({ type, item, error: `HTTP ${result.status}` });
          continue;
        }

        const comparison = compareResponses(
          baseline.response.body,
          result.data,
          baseline
        );

        if (comparison.match) {
          passed++;
        } else {
          failed++;
          failures.push({ type, item, differences: comparison.differences });
        }
      }
    }

    console.log(`\nParity Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);

    if (failures.length > 0) {
      console.log('\nFailures:');
      for (const f of failures.slice(0, 10)) {
        console.log(`  ${f.type}/${f.item.value}: ${f.error || f.differences?.length + ' diffs'}`);
      }
    }

    // Only fail if there are actual failures (skip doesn't count)
    // If no baselines exist yet, this will pass with 0 passed, 0 failed
    expect(failed).toBe(0);
  }, 120000); // 2 minute timeout for all tests
});
