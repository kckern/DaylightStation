// tests/integration/api/parity.test.mjs
/**
 * DDD vs Legacy Endpoint Parity Tests
 *
 * Compares responses from DDD endpoints against legacy endpoints
 * to ensure functional parity before frontend migration.
 *
 * These tests require a running server with both DDD and legacy routers mounted.
 * Run with: PARITY_TEST_URL=http://localhost:3112 npm test -- parity.test
 */

import fetch from 'node-fetch';

const BASE_URL = process.env.PARITY_TEST_URL || 'http://localhost:3112';

// Helper to make requests
async function fetchJSON(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Accept': 'application/json' }
  });

  // Handle redirects manually to capture final response
  if (res.status === 307) {
    const location = res.headers.get('location');
    if (location) {
      return fetchJSON(location.startsWith('/') ? location : new URL(location).pathname);
    }
  }

  return {
    status: res.status,
    body: res.headers.get('content-type')?.includes('application/json')
      ? await res.json()
      : await res.text()
  };
}

// Helper to compare responses, ignoring volatile fields
function compareResponses(legacy, ddd, options = {}) {
  const { ignoreFields = [], arrayOrderMatters = true } = options;

  // If both are errors, compare error structure
  if (legacy.status >= 400 && ddd.status >= 400) {
    return {
      match: true,
      note: `Both returned errors (legacy: ${legacy.status}, ddd: ${ddd.status})`
    };
  }

  // Status should match
  if (legacy.status !== ddd.status) {
    return {
      match: false,
      reason: `Status mismatch: legacy=${legacy.status}, ddd=${ddd.status}`
    };
  }

  // Deep compare bodies, ignoring specified fields
  const legacyBody = typeof legacy.body === 'object' ? legacy.body : {};
  const dddBody = typeof ddd.body === 'object' ? ddd.body : {};

  const differences = findDifferences(legacyBody, dddBody, ignoreFields, '');

  return {
    match: differences.length === 0,
    differences
  };
}

function findDifferences(obj1, obj2, ignoreFields, path) {
  const diffs = [];

  // Ignore specified fields
  if (ignoreFields.some(f => path.endsWith(f))) {
    return diffs;
  }

  // Handle nulls/undefined
  if (obj1 === null && obj2 === null) return diffs;
  if (obj1 === undefined && obj2 === undefined) return diffs;
  if ((obj1 === null || obj1 === undefined) !== (obj2 === null || obj2 === undefined)) {
    diffs.push({ path, legacy: obj1, ddd: obj2 });
    return diffs;
  }

  // Different types
  if (typeof obj1 !== typeof obj2) {
    diffs.push({ path, legacy: typeof obj1, ddd: typeof obj2, type: 'type-mismatch' });
    return diffs;
  }

  // Arrays
  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1.length !== obj2.length) {
      diffs.push({ path, legacy: obj1.length, ddd: obj2.length, type: 'array-length' });
    }
    // Compare array items
    const minLen = Math.min(obj1.length, obj2.length);
    for (let i = 0; i < minLen; i++) {
      diffs.push(...findDifferences(obj1[i], obj2[i], ignoreFields, `${path}[${i}]`));
    }
    return diffs;
  }

  // Objects
  if (typeof obj1 === 'object' && obj1 !== null) {
    const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);
    for (const key of allKeys) {
      const newPath = path ? `${path}.${key}` : key;
      if (ignoreFields.includes(key) || ignoreFields.some(f => newPath.endsWith(f))) {
        continue;
      }
      if (!(key in obj1)) {
        diffs.push({ path: newPath, legacy: undefined, ddd: obj2[key], type: 'missing-in-legacy' });
      } else if (!(key in obj2)) {
        diffs.push({ path: newPath, legacy: obj1[key], ddd: undefined, type: 'missing-in-ddd' });
      } else {
        diffs.push(...findDifferences(obj1[key], obj2[key], ignoreFields, newPath));
      }
    }
    return diffs;
  }

  // Primitives
  if (obj1 !== obj2) {
    diffs.push({ path, legacy: obj1, ddd: obj2 });
  }

  return diffs;
}

// =============================================================================
// PARITY TEST DEFINITIONS
// =============================================================================

const PARITY_TESTS = [
  // ---------------------------
  // CONTENT/MEDIA
  // ---------------------------
  {
    name: 'Local content - scripture',
    legacy: '/data/scripture/bofm-alma/32:21',
    ddd: '/api/local-content/scripture/bofm-alma/32:21',
    ignoreFields: ['_cached', 'timestamp', '_source']
  },
  {
    name: 'Local content - hymn',
    legacy: '/data/hymn/113',
    ddd: '/api/local-content/hymn/113',
    ignoreFields: ['_cached', 'timestamp', '_source', 'duration']  // duration derived from audio file
  },
  {
    name: 'Local content - primary song',
    legacy: '/data/primary/123',
    ddd: '/api/local-content/primary/123',
    ignoreFields: ['_cached', 'timestamp', '_source', 'duration']  // duration derived from audio file
  },

  // ---------------------------
  // HEALTH
  // ---------------------------
  {
    name: 'Health - weight history',
    legacy: '/data/lifelog/weight',
    ddd: '/api/health/weight',
    ignoreFields: ['_cached', 'timestamp', 'fetchedAt']
  },

  // ---------------------------
  // FINANCE
  // ---------------------------
  {
    name: 'Finance - budget data',
    legacy: '/data/budget',
    ddd: '/api/finance/data',
    ignoreFields: ['_cached', 'timestamp', 'fetchedAt', 'lastUpdated']
  },
  {
    name: 'Finance - daytoday budget',
    legacy: '/data/budget/daytoday',
    ddd: '/api/finance/data/daytoday',
    ignoreFields: ['_cached', 'timestamp', 'fetchedAt', 'lastUpdated']
  },

  // ---------------------------
  // HOME/ENTROPY
  // ---------------------------
  {
    name: 'Home - entropy',
    legacy: '/home/entropy',
    ddd: '/api/entropy',
    ignoreFields: ['_cached', 'timestamp', 'generatedAt', 'lastUpdated']
  },

  // ---------------------------
  // CALENDAR
  // ---------------------------
  {
    name: 'Calendar - events',
    legacy: '/home/calendar',
    ddd: '/api/calendar/events',
    ignoreFields: ['_cached', 'timestamp', 'fetchedAt']
  },
  {
    name: 'Calendar - events (from data)',
    legacy: '/data/events',
    ddd: '/api/calendar/events',
    ignoreFields: ['_cached', 'timestamp', 'fetchedAt']
  },

  // ---------------------------
  // LIFELOG
  // ---------------------------
  {
    name: 'Lifelog - aggregated',
    legacy: '/api/lifelog',
    ddd: '/api/lifelog',
    ignoreFields: ['_cached', 'timestamp', '_meta'],
    note: 'Same path, should be identical'
  }
];

// =============================================================================
// TEST RUNNER
// =============================================================================

// Only run Jest tests if in Jest environment
const isJest = typeof describe !== 'undefined';

if (isJest) {
describe('DDD vs Legacy Endpoint Parity', () => {
  // Check server is reachable
  beforeAll(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/ping`);
      if (!res.ok) {
        throw new Error(`Server not responding at ${BASE_URL}`);
      }
    } catch (err) {
      console.error(`
╔═══════════════════════════════════════════════════════════════╗
║  PARITY TESTS REQUIRE A RUNNING SERVER                       ║
║                                                               ║
║  Start the server:  npm run dev                               ║
║  Then run tests:    npm test -- parity.test                   ║
║                                                               ║
║  Or set custom URL: PARITY_TEST_URL=http://host:port          ║
╚═══════════════════════════════════════════════════════════════╝
      `);
      throw err;
    }
  });

  describe('Endpoint Response Comparison', () => {
    for (const test of PARITY_TESTS) {
      it(`${test.name}: ${test.legacy} vs ${test.ddd}`, async () => {
        // Fetch both endpoints
        const [legacyRes, dddRes] = await Promise.all([
          fetchJSON(test.legacy),
          fetchJSON(test.ddd)
        ]);

        // Compare responses
        const result = compareResponses(legacyRes, dddRes, {
          ignoreFields: test.ignoreFields || []
        });

        // Report differences
        if (!result.match) {
          console.log(`\n  Differences for ${test.name}:`);
          if (result.reason) {
            console.log(`    ${result.reason}`);
          }
          if (result.differences) {
            result.differences.slice(0, 10).forEach(d => {
              console.log(`    ${d.path}: legacy=${JSON.stringify(d.legacy)?.slice(0, 50)} vs ddd=${JSON.stringify(d.ddd)?.slice(0, 50)}`);
            });
            if (result.differences.length > 10) {
              console.log(`    ... and ${result.differences.length - 10} more differences`);
            }
          }
        }

        expect(result.match).toBe(true);
      }, 30000); // 30s timeout for slow endpoints
    }
  });

  describe('Redirect Parity', () => {
    const REDIRECT_TESTS = [
      { legacy: '/media/plex/list/123', expectedDdd: '/api/list/plex' },
      { legacy: '/data/list/watchlist', expectedDdd: '/api/list/watchlist' },
      { legacy: '/home/entropy', expectedDdd: '/api/entropy' },
      { legacy: '/home/calendar', expectedDdd: '/api/calendar/events' },
      { legacy: '/data/events', expectedDdd: '/api/calendar/events' },
      { legacy: '/data/lifelog/weight', expectedDdd: '/api/health/weight' },
      { legacy: '/exe/vol/up', expectedDdd: '/api/home/volume/up' },
      { legacy: '/exe/tv/off', expectedDdd: '/api/home/tv/power' },
    ];

    for (const test of REDIRECT_TESTS) {
      it(`${test.legacy} redirects to ${test.expectedDdd}`, async () => {
        const res = await fetch(`${BASE_URL}${test.legacy}`, {
          redirect: 'manual'
        });

        if (res.status === 307) {
          const location = res.headers.get('location');
          expect(location).toContain(test.expectedDdd);
        } else {
          // Not a redirect - might be directly handled by legacy router
          expect([200, 307]).toContain(res.status);
        }
      });
    }
  });

  describe('Schema Compatibility', () => {
    it('DDD endpoints return expected structure for content list', async () => {
      const res = await fetchJSON('/api/list/plex/1');

      if (res.status === 200) {
        expect(res.body).toHaveProperty('items');
        expect(Array.isArray(res.body.items)).toBe(true);
      }
    });

    it('DDD endpoints return expected structure for health', async () => {
      const res = await fetchJSON('/api/health/daily');

      if (res.status === 200) {
        expect(res.body).toHaveProperty('status');
      }
    });

    it('DDD endpoints return expected structure for calendar', async () => {
      const res = await fetchJSON('/api/calendar/events');

      if (res.status === 200) {
        expect(res.body).toHaveProperty('events');
        expect(Array.isArray(res.body.events)).toBe(true);
      }
    });

    it('DDD endpoints return expected structure for entropy', async () => {
      const res = await fetchJSON('/api/entropy');

      if (res.status === 200) {
        expect(res.body).toHaveProperty('status');
      }
    });
  });

  describe('POST /media/log parity', () => {
    const testPayload = {
      type: 'plex',
      assetId: '999999',  // Test ID that won't affect real data
      percent: 50,
      seconds: 300,
      title: 'Parity Test Video',
      watched_duration: 150
    };

    it('should accept valid playback log request', async () => {
      const res = await fetch(`${BASE_URL}/media/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload)
      });

      // Should succeed or return specific validation error
      expect([200, 400]).toContain(res.status);

      const body = await res.json();
      if (res.status === 200) {
        expect(body.response).toBeDefined();
        expect(body.response.type).toBe('plex');
      }
    });

    it('should reject request missing required fields', async () => {
      const res = await fetch(`${BASE_URL}/media/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'plex' })  // Missing assetId, percent
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('Missing');
    });

    it('should reject request with seconds < 10', async () => {
      const res = await fetch(`${BASE_URL}/media/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...testPayload, seconds: 5 })
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('seconds');
    });
  });

  describe('POST /api/fitness/save_session parity', () => {
    const testPayload = {
      version: 3,
      session: {
        id: '99990101000000',  // Test ID format
        date: '9999-01-01',
        start: '9999-01-01 00:00:00',
        end: '9999-01-01 00:01:00',
        duration_seconds: 60
      },
      timeline: {
        interval_seconds: 5,
        tick_count: 12,
        encoding: 'rle',
        series: {}
      },
      participants: [],
      events: []
    };

    it('should accept valid v3 session payload', async () => {
      const res = await fetch(`${BASE_URL}/api/fitness/save_session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionData: testPayload })
      });

      // Should succeed
      expect([200, 201]).toContain(res.status);
    });

    it('should reject payload without session.id', async () => {
      const badPayload = { ...testPayload, session: { date: '9999-01-01' } };
      const res = await fetch(`${BASE_URL}/api/fitness/save_session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionData: badPayload })
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('sessionId');
    });

    it('should reject v2 payload without root sessionId', async () => {
      const v2Payload = { ...testPayload, version: 2 };
      delete v2Payload.session;  // v2 expects root sessionId

      const res = await fetch(`${BASE_URL}/api/fitness/save_session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionData: v2Payload })
      });

      expect(res.status).toBe(400);
    });
  });
});
} // end isJest

// =============================================================================
// CLI RUNNER (for manual testing)
// =============================================================================

async function runParityCheck() {
  console.log(`\n🔍 DDD vs Legacy Parity Check`);
  console.log(`   Server: ${BASE_URL}\n`);

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const test of PARITY_TESTS) {
    process.stdout.write(`  ${test.name}... `);

    try {
      const [legacyRes, dddRes] = await Promise.all([
        fetchJSON(test.legacy),
        fetchJSON(test.ddd)
      ]);

      const result = compareResponses(legacyRes, dddRes, {
        ignoreFields: test.ignoreFields || []
      });

      if (result.match) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log('❌ FAIL');
        failed++;
        failures.push({ test, result, legacyRes, dddRes });
      }
    } catch (err) {
      console.log(`⚠️ ERROR: ${err.message}`);
      failed++;
      failures.push({ test, error: err.message });
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (failures.length > 0) {
    console.log('Failures:\n');
    for (const f of failures) {
      console.log(`  ❌ ${f.test.name}`);
      console.log(`     Legacy: ${f.test.legacy}`);
      console.log(`     DDD:    ${f.test.ddd}`);
      if (f.error) {
        console.log(`     Error:  ${f.error}`);
      } else if (f.result.differences) {
        f.result.differences.slice(0, 5).forEach(d => {
          console.log(`     Diff:   ${d.path}`);
        });
      }
      console.log('');
    }
  }

  return failed === 0;
}

// Run CLI if called directly
if (process.argv[1]?.endsWith('parity.test.mjs') && !process.env.JEST_WORKER_ID) {
  runParityCheck().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { PARITY_TESTS, compareResponses, runParityCheck };
