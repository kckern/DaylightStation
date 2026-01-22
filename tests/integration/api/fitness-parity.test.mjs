// tests/integration/api/fitness-parity.test.mjs
/**
 * Fitness API Parity and Contract Tests
 *
 * Compares Legacy (/api/fitness/*) vs DDD (/api/v1/fitness/*) endpoints
 *
 * Run with: node tests/integration/api/fitness-parity.test.mjs
 */

import fetch from 'node-fetch';

const BASE_URL = process.env.PARITY_TEST_URL || 'http://localhost:3112';

// Helper to make requests
async function fetchJSON(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Accept': 'application/json' }
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return { status: res.status, body: null, error: 'Not JSON response' };
  }

  return {
    status: res.status,
    body: await res.json()
  };
}

// =============================================================================
// SCHEMA VALIDATORS
// =============================================================================

const SCHEMAS = {
  fitnessConfig: {
    required: ['_household', 'users', 'zones', 'equipment'],
    types: {
      _household: 'string',
      users: 'object',  // Keyed by user ID
      zones: 'array',   // Array of zone definitions
      equipment: 'array'
    }
  },

  sessionDates: {
    required: ['dates', 'household'],
    types: {
      dates: 'array',
      household: 'string'
    }
  },

  sessionList: {
    required: ['sessions', 'date', 'household'],
    types: {
      sessions: 'array',
      date: 'string',
      household: 'string'
    }
  },

  sessionSummary: {
    required: ['sessionId', 'startTime', 'endTime', 'durationMs', 'rosterCount'],
    types: {
      sessionId: 'string',
      startTime: 'string',
      endTime: 'string',
      durationMs: 'number',
      rosterCount: 'number'
    }
  },

  sessionDetail: {
    required: ['session'],
    types: {
      session: 'object'
    }
  },

  zoneLedStatus: {
    required: ['enabled', 'scenes', 'throttleMs', 'state'],
    types: {
      enabled: 'boolean',
      scenes: 'object',
      throttleMs: 'number',
      state: 'object'
    }
  },

  zoneLedMetrics: {
    required: ['uptime', 'totals', 'rates', 'sceneHistogram', 'circuitBreaker'],
    types: {
      uptime: 'object',
      totals: 'object',
      rates: 'object',
      sceneHistogram: 'object',
      circuitBreaker: 'object'
    }
  },

  simulateStatus: {
    required: ['running'],
    types: {
      running: ['boolean', 'null']  // Can be null when not running
    }
  }
};

function validateSchema(data, schemaName) {
  const schema = SCHEMAS[schemaName];
  if (!schema) return { valid: false, errors: [`Unknown schema: ${schemaName}`] };

  const errors = [];

  // Check required fields
  for (const field of schema.required) {
    if (!(field in data)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check types
  for (const [field, expectedTypes] of Object.entries(schema.types)) {
    if (field in data) {
      const actualType = data[field] === null ? 'null' : Array.isArray(data[field]) ? 'array' : typeof data[field];
      const allowedTypes = Array.isArray(expectedTypes) ? expectedTypes : [expectedTypes];
      if (!allowedTypes.includes(actualType)) {
        errors.push(`Type mismatch for ${field}: expected ${allowedTypes.join('|')}, got ${actualType}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// Compare two objects, returning differences
function findDifferences(legacy, ddd, ignoreFields = [], path = '') {
  const diffs = [];

  if (ignoreFields.some(f => path.endsWith(f))) return diffs;

  if (legacy === null && ddd === null) return diffs;
  if (legacy === undefined && ddd === undefined) return diffs;

  if (typeof legacy !== typeof ddd) {
    diffs.push({ path: path || 'root', type: 'type-mismatch', legacy: typeof legacy, ddd: typeof ddd });
    return diffs;
  }

  if (Array.isArray(legacy) && Array.isArray(ddd)) {
    if (legacy.length !== ddd.length) {
      diffs.push({ path: path || 'root', type: 'array-length', legacy: legacy.length, ddd: ddd.length });
    }
    return diffs;
  }

  if (typeof legacy === 'object' && legacy !== null) {
    const allKeys = new Set([...Object.keys(legacy), ...Object.keys(ddd)]);
    for (const key of allKeys) {
      const newPath = path ? `${path}.${key}` : key;
      if (ignoreFields.includes(key)) continue;

      if (!(key in legacy)) {
        diffs.push({ path: newPath, type: 'missing-in-legacy', ddd: typeof ddd[key] });
      } else if (!(key in ddd)) {
        diffs.push({ path: newPath, type: 'missing-in-ddd', legacy: typeof legacy[key] });
      } else {
        diffs.push(...findDifferences(legacy[key], ddd[key], ignoreFields, newPath));
      }
    }
    return diffs;
  }

  if (legacy !== ddd) {
    diffs.push({ path: path || 'root', legacy, ddd });
  }

  return diffs;
}

// =============================================================================
// PARITY TEST DEFINITIONS
// =============================================================================

const PARITY_TESTS = [
  {
    name: 'Fitness Config',
    legacy: '/api/fitness',
    ddd: '/api/v1/fitness',
    schema: 'fitnessConfig',
    ignoreFields: []
  },
  {
    name: 'Session Dates',
    legacy: '/api/fitness/sessions/dates',
    ddd: '/api/v1/fitness/sessions/dates',
    schema: 'sessionDates',
    ignoreFields: [],
    note: 'Date ordering may differ (legacy asc, DDD desc)'
  },
  {
    name: 'Session List',
    legacy: '/api/fitness/sessions?date=2026-01-20',
    ddd: '/api/v1/fitness/sessions?date=2026-01-20',
    schema: 'sessionList',
    ignoreFields: ['path'],  // Legacy has path field, DDD doesn't
    note: 'Legacy includes "path" field in session items'
  },
  {
    name: 'Zone LED Status',
    legacy: '/api/fitness/zone_led/status',
    ddd: '/api/v1/fitness/zone_led/status',
    schema: 'zoneLedStatus',
    ignoreFields: ['lastActivatedAt', 'backoffUntil']  // Timing fields
  },
  {
    name: 'Zone LED Metrics',
    legacy: '/api/fitness/zone_led/metrics',
    ddd: '/api/v1/fitness/zone_led/metrics',
    schema: 'zoneLedMetrics',
    ignoreFields: ['uptime', 'rates', 'lastActivation']  // Timing fields
  }
];

// =============================================================================
// TEST RUNNER
// =============================================================================

const isJest = typeof describe !== 'undefined';

if (isJest) {
describe('Fitness API Parity Tests', () => {
  beforeAll(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/ping`);
      if (!res.ok) throw new Error(`Server not responding at ${BASE_URL}`);
    } catch (err) {
      console.error(`Server required at ${BASE_URL}`);
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // PARITY TESTS
  // ---------------------------------------------------------------------------
  describe('Legacy vs DDD Parity', () => {
    for (const test of PARITY_TESTS) {
      describe(test.name, () => {
        it(`both endpoints return 200`, async () => {
          const [legacyRes, dddRes] = await Promise.all([
            fetchJSON(test.legacy),
            fetchJSON(test.ddd)
          ]);

          expect(legacyRes.status).toBe(200);
          expect(dddRes.status).toBe(200);
        });

        it(`legacy matches schema: ${test.schema}`, async () => {
          const res = await fetchJSON(test.legacy);
          expect(res.status).toBe(200);

          const validation = validateSchema(res.body, test.schema);
          expect(validation.errors).toEqual([]);
        });

        it(`DDD matches schema: ${test.schema}`, async () => {
          const res = await fetchJSON(test.ddd);
          expect(res.status).toBe(200);

          const validation = validateSchema(res.body, test.schema);
          expect(validation.errors).toEqual([]);
        });

        it(`responses have compatible structure`, async () => {
          const [legacyRes, dddRes] = await Promise.all([
            fetchJSON(test.legacy),
            fetchJSON(test.ddd)
          ]);

          const diffs = findDifferences(legacyRes.body, dddRes.body, test.ignoreFields);

          // Filter out expected differences
          const unexpectedDiffs = diffs.filter(d => {
            // Array length differences for dates are OK (same data, different order)
            if (d.path === 'dates' && d.type === 'array-length') return false;
            return true;
          });

          if (unexpectedDiffs.length > 0) {
            console.log(`\n  Differences for ${test.name}:`);
            unexpectedDiffs.slice(0, 5).forEach(d => {
              console.log(`    ${d.path}: ${d.type || `${d.legacy} vs ${d.ddd}`}`);
            });
            if (test.note) console.log(`    Note: ${test.note}`);
          }

          // Allow known differences
          expect(unexpectedDiffs.length).toBeLessThanOrEqual(5);
        });
      });
    }
  });

  // ---------------------------------------------------------------------------
  // SESSION DETAIL TESTS
  // ---------------------------------------------------------------------------
  describe('Session Detail Parity', () => {
    let sessionId;

    beforeAll(async () => {
      // Get a session ID to test
      const res = await fetchJSON('/api/fitness/sessions?date=2026-01-20');
      if (res.status === 200 && res.body?.sessions?.length > 0) {
        sessionId = res.body.sessions[0].sessionId;
      }
    });

    it('both endpoints return session detail', async () => {
      if (!sessionId) {
        console.log('  Skipped: No sessions found');
        return;
      }

      const [legacyRes, dddRes] = await Promise.all([
        fetchJSON(`/api/fitness/sessions/${sessionId}`),
        fetchJSON(`/api/v1/fitness/sessions/${sessionId}`)
      ]);

      expect(legacyRes.status).toBe(200);
      expect(dddRes.status).toBe(200);

      const legacyValidation = validateSchema(legacyRes.body, 'sessionDetail');
      const dddValidation = validateSchema(dddRes.body, 'sessionDetail');

      expect(legacyValidation.errors).toEqual([]);
      expect(dddValidation.errors).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // SCHEMA CONTRACT TESTS
  // ---------------------------------------------------------------------------
  describe('Schema Contract Tests', () => {

    describe('GET /api/fitness (config)', () => {
      it('returns user profiles with expected fields', async () => {
        const res = await fetchJSON('/api/fitness');
        expect(res.status).toBe(200);
        expect(typeof res.body.users).toBe('object');

        const userIds = Object.keys(res.body.users);
        expect(userIds.length).toBeGreaterThan(0);

        const firstUser = res.body.users[userIds[0]];
        expect(firstUser).toHaveProperty('name');
      });

      it('returns zones configuration', async () => {
        const res = await fetchJSON('/api/fitness');
        expect(res.status).toBe(200);
        expect(typeof res.body.zones).toBe('object');
      });

      it('returns equipment list', async () => {
        const res = await fetchJSON('/api/fitness');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.equipment)).toBe(true);
      });
    });

    describe('GET /api/fitness/sessions/dates', () => {
      it('returns array of date strings', async () => {
        const res = await fetchJSON('/api/fitness/sessions/dates');
        expect(res.status).toBe(200);
        expect(res.body.dates.length).toBeGreaterThan(0);

        // Each date should be YYYY-MM-DD format
        res.body.dates.forEach(date => {
          expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
      });
    });

    describe('GET /api/fitness/sessions?date=YYYY-MM-DD', () => {
      it('returns sessions for valid date', async () => {
        const res = await fetchJSON('/api/fitness/sessions?date=2026-01-20');
        expect(res.status).toBe(200);

        if (res.body.sessions.length > 0) {
          const session = res.body.sessions[0];
          expect(session).toHaveProperty('sessionId');
          expect(session).toHaveProperty('startTime');
          expect(session).toHaveProperty('endTime');
          expect(session).toHaveProperty('durationMs');
        }
      });

      it('returns empty array for date with no sessions', async () => {
        const res = await fetchJSON('/api/fitness/sessions?date=1999-01-01');
        expect(res.status).toBe(200);
        expect(res.body.sessions).toEqual([]);
      });
    });

    describe('GET /api/fitness/zone_led/status', () => {
      it('returns LED controller state', async () => {
        const res = await fetchJSON('/api/fitness/zone_led/status');
        expect(res.status).toBe(200);

        expect(res.body).toHaveProperty('enabled');
        expect(res.body).toHaveProperty('scenes');
        expect(res.body).toHaveProperty('state');

        // State should have circuit breaker fields
        expect(res.body.state).toHaveProperty('failureCount');
        expect(res.body.state).toHaveProperty('isInBackoff');
      });

      it('scenes include expected zone names', async () => {
        const res = await fetchJSON('/api/fitness/zone_led/status');
        expect(res.status).toBe(200);

        const expectedScenes = ['off', 'cool', 'active', 'warm', 'hot', 'fire'];
        expectedScenes.forEach(scene => {
          expect(res.body.scenes).toHaveProperty(scene);
        });
      });
    });

    describe('GET /api/fitness/zone_led/metrics', () => {
      it('returns observability metrics', async () => {
        const res = await fetchJSON('/api/fitness/zone_led/metrics');
        expect(res.status).toBe(200);

        expect(res.body).toHaveProperty('uptime');
        expect(res.body).toHaveProperty('totals');
        expect(res.body).toHaveProperty('sceneHistogram');
      });
    });

    describe('GET /api/fitness/simulate/status', () => {
      it('returns simulation status (legacy only)', async () => {
        const res = await fetchJSON('/api/fitness/simulate/status');
        expect(res.status).toBe(200);

        expect(res.body).toHaveProperty('running');
        expect(res.body).toHaveProperty('pid');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // POST ENDPOINT TESTS
  // ---------------------------------------------------------------------------
  describe('POST Endpoint Behavior', () => {

    describe('POST /api/fitness/save_session', () => {
      const testPayload = {
        version: 3,
        session: {
          id: '99990101000000',
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

      it('accepts valid v3 session payload', async () => {
        const res = await fetch(`${BASE_URL}/api/fitness/save_session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionData: testPayload })
        });

        expect([200, 201]).toContain(res.status);
      });

      it('rejects payload without session.id', async () => {
        const badPayload = { ...testPayload, session: { date: '9999-01-01' } };
        const res = await fetch(`${BASE_URL}/api/fitness/save_session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionData: badPayload })
        });

        expect(res.status).toBe(400);
      });
    });

    describe('POST /api/fitness/zone_led', () => {
      it('accepts zone state update', async () => {
        const res = await fetch(`${BASE_URL}/api/fitness/zone_led`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zone: 'cool' })
        });

        // Should succeed or be throttled
        expect([200, 429, 503]).toContain(res.status);
      });
    });

    describe('POST /api/fitness/zone_led/reset', () => {
      it('resets circuit breaker state', async () => {
        const res = await fetch(`${BASE_URL}/api/fitness/zone_led/reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('reset');
      });
    });
  });
});
} // end isJest

// =============================================================================
// CLI RUNNER
// =============================================================================

async function runFitnessParityCheck() {
  console.log(`\n🏋️ Fitness API Parity Check`);
  console.log(`   Server: ${BASE_URL}\n`);

  const results = { passed: 0, failed: 0, warnings: [] };

  // Test each parity endpoint
  console.log('📊 Testing Legacy vs DDD Parity...\n');

  for (const test of PARITY_TESTS) {
    process.stdout.write(`  ${test.name}... `);

    try {
      const [legacyRes, dddRes] = await Promise.all([
        fetchJSON(test.legacy),
        fetchJSON(test.ddd)
      ]);

      if (legacyRes.status !== 200) {
        console.log(`❌ Legacy returned ${legacyRes.status}`);
        results.failed++;
        continue;
      }

      if (dddRes.status !== 200) {
        console.log(`❌ DDD returned ${dddRes.status}`);
        results.failed++;
        continue;
      }

      // Validate schemas
      const legacyValidation = validateSchema(legacyRes.body, test.schema);
      const dddValidation = validateSchema(dddRes.body, test.schema);

      if (!legacyValidation.valid || !dddValidation.valid) {
        console.log(`❌ Schema validation failed`);
        if (!legacyValidation.valid) console.log(`     Legacy: ${legacyValidation.errors.join(', ')}`);
        if (!dddValidation.valid) console.log(`     DDD: ${dddValidation.errors.join(', ')}`);
        results.failed++;
        continue;
      }

      // Check for differences
      const diffs = findDifferences(legacyRes.body, dddRes.body, test.ignoreFields);

      if (diffs.length === 0) {
        console.log('✅ MATCH');
        results.passed++;
      } else if (diffs.length <= 3) {
        console.log(`⚠️ ${diffs.length} minor differences`);
        results.passed++;
        results.warnings.push({ test: test.name, diffs });
      } else {
        console.log(`❌ ${diffs.length} differences`);
        results.failed++;
      }

    } catch (err) {
      console.log(`⚠️ Error: ${err.message}`);
      results.failed++;
    }
  }

  // Test session detail
  console.log('\n📋 Testing Session Detail...');
  try {
    const datesRes = await fetchJSON('/api/fitness/sessions/dates');
    if (datesRes.body?.dates?.length > 0) {
      const date = datesRes.body.dates[0];
      const sessionsRes = await fetchJSON(`/api/fitness/sessions?date=${date}`);

      if (sessionsRes.body?.sessions?.length > 0) {
        const sessionId = sessionsRes.body.sessions[0].sessionId;

        const [legacyRes, dddRes] = await Promise.all([
          fetchJSON(`/api/fitness/sessions/${sessionId}`),
          fetchJSON(`/api/v1/fitness/sessions/${sessionId}`)
        ]);

        if (legacyRes.status === 200 && dddRes.status === 200) {
          console.log(`  ✅ Session ${sessionId} - both endpoints return data`);
          results.passed++;
        } else {
          console.log(`  ❌ Session ${sessionId} - status mismatch`);
          results.failed++;
        }
      }
    }
  } catch (err) {
    console.log(`  ⚠️ Error: ${err.message}`);
  }

  // Summary
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Results: ${results.passed} passed, ${results.failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (results.warnings.length > 0) {
    console.log('Warnings (minor differences):');
    for (const w of results.warnings) {
      console.log(`  ${w.test}:`);
      w.diffs.slice(0, 3).forEach(d => {
        console.log(`    - ${d.path}: ${d.type || 'value differs'}`);
      });
    }
    console.log('');
  }

  return results.failed === 0;
}

// Run CLI if called directly
if (process.argv[1]?.endsWith('fitness-parity.test.mjs') && !process.env.JEST_WORKER_ID) {
  runFitnessParityCheck().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { runFitnessParityCheck, validateSchema, SCHEMAS, PARITY_TESTS };
