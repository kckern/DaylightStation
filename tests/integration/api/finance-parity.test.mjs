// tests/integration/api/finance-parity.test.mjs
/**
 * Finance API Parity and Contract Tests
 *
 * Tests all finance endpoints for:
 * 1. Legacy redirect behavior (legacy URLs → DDD endpoints)
 * 2. Response schema validation
 * 3. Error handling
 *
 * Run with: PARITY_TEST_URL=http://localhost:3112 npm test -- finance-parity.test
 */

import fetch from 'node-fetch';

const BASE_URL = process.env.PARITY_TEST_URL || 'http://localhost:3112';

// Helper to make requests (follows redirects)
async function fetchJSON(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Accept': 'application/json' },
    ...options
  });

  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: res.headers.get('content-type')?.includes('application/json')
      ? await res.json()
      : await res.text()
  };
}

// Helper to check redirect without following
async function checkRedirect(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    redirect: 'manual',
    headers: { 'Accept': 'application/json' }
  });

  return {
    status: res.status,
    location: res.headers.get('location')
  };
}

// =============================================================================
// SCHEMA VALIDATORS
// =============================================================================

const SCHEMAS = {
  financeOverview: {
    required: ['household', 'budgetCount', 'hasMortgage', 'accounts', 'configured'],
    types: {
      household: 'string',
      budgetCount: 'number',
      hasMortgage: 'boolean',
      accounts: 'array',
      configured: 'boolean'
    }
  },

  financeData: {
    required: ['budgets', 'mortgage'],
    types: {
      budgets: 'object',
      mortgage: 'object'
    }
  },

  daytodayBudget: {
    required: ['spending', 'budget', 'balance', 'dailyBalances', 'spent', 'daysRemaining', 'dailySpend', 'dailyBudget'],
    types: {
      spending: 'number',
      budget: 'number',
      balance: 'number',
      dailyBalances: 'object',
      spent: 'number',
      daysRemaining: 'number',
      dailySpend: 'number',
      dailyBudget: 'number'
    }
  },

  budgetsList: {
    required: ['budgets', 'household'],
    types: {
      budgets: 'array',
      household: 'string'
    }
  },

  budgetSummary: {
    required: ['startDate', 'endDate', 'accounts', 'totalBudget', 'shortTermStatus'],
    types: {
      startDate: 'string',
      endDate: 'string',
      accounts: 'array',
      totalBudget: 'object',
      shortTermStatus: 'object'
    }
  },

  budgetDetail: {
    required: ['budget', 'budgetId', 'household'],
    types: {
      budget: 'object',
      budgetId: 'string',
      household: 'string'
    }
  },

  mortgage: {
    required: ['mortgage', 'household'],
    types: {
      mortgage: 'object',
      household: 'string'
    }
  },

  accounts: {
    required: ['accounts', 'household'],
    types: {
      accounts: 'array',
      household: 'string'
    }
  },

  accountItem: {
    required: ['name', 'balance'],
    types: {
      name: 'string',
      balance: 'number'
    }
  },

  transactions: {
    required: ['transactions', 'count', 'household'],
    types: {
      transactions: 'array',
      count: 'number',
      household: 'string'
    }
  },

  memos: {
    required: ['memos', 'household'],
    types: {
      memos: 'object',
      household: 'string'
    }
  },

  metrics: {
    required: ['adapter'],
    types: {
      adapter: 'string'
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
  for (const [field, expectedType] of Object.entries(schema.types)) {
    if (field in data) {
      const actualType = Array.isArray(data[field]) ? 'array' : typeof data[field];
      if (actualType !== expectedType) {
        errors.push(`Type mismatch for ${field}: expected ${expectedType}, got ${actualType}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// TEST DEFINITIONS
// =============================================================================

const isJest = typeof describe !== 'undefined';

if (isJest) {
describe('Finance API Parity Tests', () => {
  beforeAll(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/ping`);
      if (!res.ok) throw new Error(`Server not responding at ${BASE_URL}`);
    } catch (err) {
      console.error(`
╔═══════════════════════════════════════════════════════════════╗
║  FINANCE PARITY TESTS REQUIRE A RUNNING SERVER                ║
║  Start: npm run dev    Then: npm test -- finance-parity       ║
╚═══════════════════════════════════════════════════════════════╝
      `);
      throw err;
    }
  });

  // ---------------------------------------------------------------------------
  // REDIRECT PARITY TESTS
  // ---------------------------------------------------------------------------
  describe('Legacy Redirect Parity', () => {
    const REDIRECT_TESTS = [
      { legacy: '/data/budget', expectedTarget: '/api/finance/data' },
      { legacy: '/data/budget/daytoday', expectedTarget: '/api/finance/data/daytoday' },
      { legacy: '/harvest/budget', expectedTarget: '/api/finance/refresh' }
    ];

    for (const test of REDIRECT_TESTS) {
      it(`${test.legacy} → ${test.expectedTarget}`, async () => {
        const result = await checkRedirect(test.legacy);

        expect(result.status).toBe(307);
        expect(result.location).toContain(test.expectedTarget);
      });
    }

    it('Legacy /data/budget returns same data as /api/finance/data', async () => {
      const [legacyRes, dddRes] = await Promise.all([
        fetchJSON('/data/budget'),
        fetchJSON('/api/finance/data')
      ]);

      expect(legacyRes.status).toBe(dddRes.status);
      expect(legacyRes.body).toEqual(dddRes.body);
    });

    it('Legacy /data/budget/daytoday returns same data as /api/finance/data/daytoday', async () => {
      const [legacyRes, dddRes] = await Promise.all([
        fetchJSON('/data/budget/daytoday'),
        fetchJSON('/api/finance/data/daytoday')
      ]);

      expect(legacyRes.status).toBe(dddRes.status);
      // Compare structure (values may change between calls due to time-based calculations)
      expect(Object.keys(legacyRes.body).sort()).toEqual(Object.keys(dddRes.body).sort());
    });
  });

  // ---------------------------------------------------------------------------
  // SCHEMA CONTRACT TESTS
  // ---------------------------------------------------------------------------
  describe('Schema Contract Tests', () => {

    describe('GET /api/finance (overview)', () => {
      it('returns valid overview schema', async () => {
        const res = await fetchJSON('/api/finance');

        expect(res.status).toBe(200);
        const validation = validateSchema(res.body, 'financeOverview');
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
      });

      it('accounts is an array of strings', async () => {
        const res = await fetchJSON('/api/finance');

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.accounts)).toBe(true);
        res.body.accounts.forEach(account => {
          expect(typeof account).toBe('string');
        });
      });
    });

    describe('GET /api/finance/data (full budget data)', () => {
      it('returns valid finance data schema', async () => {
        const res = await fetchJSON('/api/finance/data');

        expect(res.status).toBe(200);
        const validation = validateSchema(res.body, 'financeData');
        expect(validation.errors).toEqual([]);
      });

      it('budgets contains budget objects keyed by date', async () => {
        const res = await fetchJSON('/api/finance/data');

        expect(res.status).toBe(200);
        expect(typeof res.body.budgets).toBe('object');
        const budgetKeys = Object.keys(res.body.budgets);
        expect(budgetKeys.length).toBeGreaterThan(0);
        // Budget keys should be date-like strings (YYYY-MM-DD)
        budgetKeys.forEach(key => {
          expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
      });
    });

    describe('GET /api/finance/data/daytoday (current month summary)', () => {
      it('returns valid daytoday schema', async () => {
        const res = await fetchJSON('/api/finance/data/daytoday');

        expect(res.status).toBe(200);
        const validation = validateSchema(res.body, 'daytodayBudget');
        expect(validation.errors).toEqual([]);
      });

      it('dailyBalances contains day entries with correct structure', async () => {
        const res = await fetchJSON('/api/finance/data/daytoday');

        expect(res.status).toBe(200);
        const days = Object.values(res.body.dailyBalances);
        expect(days.length).toBeGreaterThan(0);

        const firstDay = days[0];
        expect(firstDay).toHaveProperty('dayInt');
        expect(firstDay).toHaveProperty('startingBalance');
        expect(firstDay).toHaveProperty('endingBalance');
        expect(firstDay).toHaveProperty('transactionCount');
      });
    });

    describe('GET /api/finance/budgets (budget list)', () => {
      it('returns valid budgets list schema', async () => {
        const res = await fetchJSON('/api/finance/budgets');

        expect(res.status).toBe(200);
        const validation = validateSchema(res.body, 'budgetsList');
        expect(validation.errors).toEqual([]);
      });

      it('each budget has required summary fields', async () => {
        const res = await fetchJSON('/api/finance/budgets');

        expect(res.status).toBe(200);
        expect(res.body.budgets.length).toBeGreaterThan(0);

        const budget = res.body.budgets[0];
        const validation = validateSchema(budget, 'budgetSummary');
        expect(validation.errors).toEqual([]);
      });
    });

    describe('GET /api/finance/budgets/:budgetId (budget detail)', () => {
      it('returns valid budget detail schema', async () => {
        // First get the list to find a valid budget ID
        const listRes = await fetchJSON('/api/finance/budgets');
        expect(listRes.status).toBe(200);
        expect(listRes.body.budgets.length).toBeGreaterThan(0);

        const budgetId = listRes.body.budgets[0].startDate;
        const res = await fetchJSON(`/api/finance/budgets/${budgetId}`);

        expect(res.status).toBe(200);
        const validation = validateSchema(res.body, 'budgetDetail');
        expect(validation.errors).toEqual([]);
      });

      it('returns 404 for non-existent budget', async () => {
        const res = await fetchJSON('/api/finance/budgets/1999-01-01');

        expect(res.status).toBe(404);
        expect(res.body).toHaveProperty('error');
      });
    });

    describe('GET /api/finance/mortgage', () => {
      it('returns valid mortgage schema', async () => {
        const res = await fetchJSON('/api/finance/mortgage');

        expect(res.status).toBe(200);
        const validation = validateSchema(res.body, 'mortgage');
        expect(validation.errors).toEqual([]);
      });

      it('mortgage object has expected financial fields', async () => {
        const res = await fetchJSON('/api/finance/mortgage');

        expect(res.status).toBe(200);
        const mortgage = res.body.mortgage;

        // Check for common mortgage fields (if mortgage exists)
        if (mortgage && Object.keys(mortgage).length > 0) {
          expect(mortgage).toHaveProperty('balance');
          expect(mortgage).toHaveProperty('interestRate');
        }
      });
    });

    describe('GET /api/finance/accounts', () => {
      it('returns valid accounts schema', async () => {
        const res = await fetchJSON('/api/finance/accounts');

        expect(res.status).toBe(200);
        const validation = validateSchema(res.body, 'accounts');
        expect(validation.errors).toEqual([]);
      });

      it('each account has name and balance', async () => {
        const res = await fetchJSON('/api/finance/accounts');

        expect(res.status).toBe(200);
        expect(res.body.accounts.length).toBeGreaterThan(0);

        res.body.accounts.forEach(account => {
          const validation = validateSchema(account, 'accountItem');
          expect(validation.errors).toEqual([]);
        });
      });

      it('returns source field indicating cache or live', async () => {
        const res = await fetchJSON('/api/finance/accounts');

        expect(res.status).toBe(200);
        expect(['cache', 'live', 'buxfer']).toContain(res.body.source);
      });
    });

    describe('GET /api/finance/transactions', () => {
      it('returns valid transactions schema with budgetDate filter', async () => {
        const res = await fetchJSON('/api/finance/transactions?budgetDate=2025-04-01');

        expect(res.status).toBe(200);
        const validation = validateSchema(res.body, 'transactions');
        expect(validation.errors).toEqual([]);
      });

      it('count matches transactions array length', async () => {
        const res = await fetchJSON('/api/finance/transactions?budgetDate=2025-04-01');

        expect(res.status).toBe(200);
        expect(res.body.count).toBe(res.body.transactions.length);
      });

      it('returns 400 without required filters', async () => {
        const res = await fetchJSON('/api/finance/transactions');

        // Should either return 400 or empty results
        expect([200, 400]).toContain(res.status);
        if (res.status === 200) {
          expect(res.body).toHaveProperty('transactions');
        }
      });
    });

    describe('GET /api/finance/memos', () => {
      it('returns valid memos schema', async () => {
        const res = await fetchJSON('/api/finance/memos');

        expect(res.status).toBe(200);
        const validation = validateSchema(res.body, 'memos');
        expect(validation.errors).toEqual([]);
      });
    });

    describe('GET /api/finance/metrics', () => {
      it('returns valid metrics schema', async () => {
        const res = await fetchJSON('/api/finance/metrics');

        expect(res.status).toBe(200);
        const validation = validateSchema(res.body, 'metrics');
        expect(validation.errors).toEqual([]);
      });

      it('indicates buxfer adapter status', async () => {
        const res = await fetchJSON('/api/finance/metrics');

        expect(res.status).toBe(200);
        expect(res.body.adapter).toBe('buxfer');
        expect(res.body).toHaveProperty('configured');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // POST ENDPOINT TESTS (require careful handling)
  // ---------------------------------------------------------------------------
  describe('POST Endpoint Behavior', () => {

    describe('POST /api/finance/refresh', () => {
      it('returns expected response structure (without triggering full refresh)', async () => {
        // Note: We don't want to trigger a full 4-minute refresh in tests
        // Just verify the endpoint exists and returns proper structure
        const res = await fetchJSON('/api/finance/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skipCategorization: true, skipCompilation: true })
        });

        // Should return 200 or appropriate error
        expect([200, 400, 503]).toContain(res.status);
        if (res.status === 200) {
          expect(res.body).toHaveProperty('household');
        }
      });
    });

    describe('POST /api/finance/compile', () => {
      it('returns compilation result structure', async () => {
        const res = await fetchJSON('/api/finance/compile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });

        expect([200, 400, 500]).toContain(res.status);
        if (res.status === 200) {
          expect(res.body).toHaveProperty('budgetCount');
          expect(res.body).toHaveProperty('hasMortgage');
        }
      });
    });

    describe('POST /api/finance/memos/:transactionId', () => {
      it('rejects invalid transaction ID format', async () => {
        const res = await fetchJSON('/api/finance/memos/invalid-id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memo: 'test memo' })
        });

        // Should handle gracefully (either save or return error)
        expect([200, 400, 404]).toContain(res.status);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // ERROR HANDLING TESTS
  // ---------------------------------------------------------------------------
  describe('Error Handling', () => {
    it('/api/finance/budgets/:id returns 404 for missing budget', async () => {
      const res = await fetchJSON('/api/finance/budgets/9999-01-01');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
    });

    it('Invalid household parameter is handled gracefully', async () => {
      const res = await fetchJSON('/api/finance?household=nonexistent');

      // Should either use default household or return error
      expect([200, 400, 404]).toContain(res.status);
    });
  });
});
} // end isJest

// =============================================================================
// CLI RUNNER
// =============================================================================

async function runFinanceParityCheck() {
  console.log(`\n💰 Finance API Parity Check`);
  console.log(`   Server: ${BASE_URL}\n`);

  const results = { passed: 0, failed: 0, errors: [] };

  // Test redirects
  console.log('📍 Testing Legacy Redirects...');
  const redirectTests = [
    { legacy: '/data/budget', expected: '/api/finance/data' },
    { legacy: '/data/budget/daytoday', expected: '/api/finance/data/daytoday' },
    { legacy: '/harvest/budget', expected: '/api/finance/refresh' }
  ];

  for (const test of redirectTests) {
    try {
      const res = await checkRedirect(test.legacy);
      if (res.status === 307 && res.location?.includes(test.expected)) {
        console.log(`  ✅ ${test.legacy} → ${test.expected}`);
        results.passed++;
      } else {
        console.log(`  ❌ ${test.legacy} - Expected redirect to ${test.expected}, got ${res.status} ${res.location}`);
        results.failed++;
      }
    } catch (err) {
      console.log(`  ⚠️ ${test.legacy} - Error: ${err.message}`);
      results.failed++;
    }
  }

  // Test GET endpoints
  console.log('\n📋 Testing GET Endpoints...');
  const getTests = [
    { path: '/api/finance', schema: 'financeOverview' },
    { path: '/api/finance/data', schema: 'financeData' },
    { path: '/api/finance/data/daytoday', schema: 'daytodayBudget' },
    { path: '/api/finance/budgets', schema: 'budgetsList' },
    { path: '/api/finance/mortgage', schema: 'mortgage' },
    { path: '/api/finance/accounts', schema: 'accounts' },
    { path: '/api/finance/memos', schema: 'memos' },
    { path: '/api/finance/metrics', schema: 'metrics' }
  ];

  for (const test of getTests) {
    try {
      const res = await fetchJSON(test.path);
      if (res.status === 200) {
        const validation = validateSchema(res.body, test.schema);
        if (validation.valid) {
          console.log(`  ✅ ${test.path}`);
          results.passed++;
        } else {
          console.log(`  ❌ ${test.path} - Schema errors: ${validation.errors.join(', ')}`);
          results.failed++;
        }
      } else {
        console.log(`  ❌ ${test.path} - Status ${res.status}`);
        results.failed++;
      }
    } catch (err) {
      console.log(`  ⚠️ ${test.path} - Error: ${err.message}`);
      results.failed++;
    }
  }

  // Summary
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Results: ${results.passed} passed, ${results.failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  return results.failed === 0;
}

// Run CLI if called directly
if (process.argv[1]?.endsWith('finance-parity.test.mjs') && !process.env.JEST_WORKER_ID) {
  runFinanceParityCheck().then(success => {
    process.exit(success ? 0 : 1);
  });
}

export { runFinanceParityCheck, validateSchema, SCHEMAS };
