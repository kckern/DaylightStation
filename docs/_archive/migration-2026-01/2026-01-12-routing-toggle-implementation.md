# Routing Toggle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a config-driven routing system that switches endpoints between legacy and new implementations with optional schema shims.

**Architecture:** Express middleware reads `routing.yml` at startup, routes requests to legacy or new Express routers based on path matching. Schema shims transform new responses to legacy format on versioned paths. Metrics track shim usage for safe removal.

**Tech Stack:** Express.js, YAML config, Jest for testing

**Design Doc:** `docs/_wip/plans/2026-01-11-routing-toggle-design.md`

---

## Task 1: Config Loader

**Files:**
- Create: `backend/src/0_infrastructure/routing/ConfigLoader.mjs`
- Create: `backend/config/routing.yml`
- Test: `tests/unit/infrastructure/routing/ConfigLoader.test.mjs`

**Step 1: Write the failing test for config loading**

```javascript
// tests/unit/infrastructure/routing/ConfigLoader.test.mjs
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { loadRoutingConfig } from '../../../../backend/src/0_infrastructure/routing/ConfigLoader.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('ConfigLoader', () => {
  let tempDir;
  let configPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-test-'));
    configPath = path.join(tempDir, 'routing.yml');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true });
  });

  describe('loadRoutingConfig', () => {
    it('loads valid config with simple path mappings', () => {
      fs.writeFileSync(configPath, `
default: legacy
routing:
  /api/finance: new
  /api/content: legacy
`);
      const availableShims = {};

      const config = loadRoutingConfig(configPath, availableShims);

      expect(config.default).toBe('legacy');
      expect(config.routing['/api/finance']).toBe('new');
      expect(config.routing['/api/content']).toBe('legacy');
    });

    it('loads config with shim references', () => {
      fs.writeFileSync(configPath, `
default: legacy
routing:
  /api/finance:
    target: new
    shim: finance-data-v1
`);
      const availableShims = { 'finance-data-v1': { transform: () => {} } };

      const config = loadRoutingConfig(configPath, availableShims);

      expect(config.routing['/api/finance'].target).toBe('new');
      expect(config.routing['/api/finance'].shim).toBe('finance-data-v1');
    });

    it('throws error for unknown shim reference', () => {
      fs.writeFileSync(configPath, `
default: legacy
routing:
  /api/finance:
    target: new
    shim: nonexistent-shim
`);
      const availableShims = {};

      expect(() => loadRoutingConfig(configPath, availableShims))
        .toThrow('references unknown shim "nonexistent-shim"');
    });

    it('throws error for invalid target', () => {
      fs.writeFileSync(configPath, `
default: legacy
routing:
  /api/finance: invalid
`);
      const availableShims = {};

      expect(() => loadRoutingConfig(configPath, availableShims))
        .toThrow('has invalid target "invalid"');
    });

    it('throws error for missing config file', () => {
      expect(() => loadRoutingConfig('/nonexistent/path.yml', {}))
        .toThrow();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/infrastructure/routing/ConfigLoader.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/0_infrastructure/routing/ConfigLoader.mjs
import fs from 'fs';
import yaml from 'js-yaml';

/**
 * Load and validate routing configuration
 * @param {string} configPath - Path to routing.yml
 * @param {Object} availableShims - Map of shim name to shim object
 * @returns {Object} Validated config
 * @throws {Error} If config is invalid
 */
export function loadRoutingConfig(configPath, availableShims) {
  const content = fs.readFileSync(configPath, 'utf8');
  const config = yaml.load(content);

  const errors = [];

  for (const [path, rule] of Object.entries(config.routing || {})) {
    const shimName = typeof rule === 'object' ? rule.shim : null;
    const target = typeof rule === 'string' ? rule : rule?.target;

    if (shimName && !availableShims[shimName]) {
      errors.push(`Path "${path}" references unknown shim "${shimName}"`);
    }

    if (!['new', 'legacy'].includes(target)) {
      errors.push(`Path "${path}" has invalid target "${target}"`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Routing config invalid:\n${errors.join('\n')}`);
  }

  return config;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/infrastructure/routing/ConfigLoader.test.mjs`
Expected: PASS (5 tests)

**Step 5: Create initial routing config**

```yaml
# backend/config/routing.yml
# Routing configuration
# Loaded at server startup, restart required for changes

default: legacy  # Unlisted paths go here

routing:
  # Finance domain - migrated with shims
  # /api/v2/finance: new
  # /api/finance:
  #   target: new
  #   shim: finance-data-v1

  # Content domain - migrated with shims
  # /api/v2/content: new
  # /api/content:
  #   target: new
  #   shim: content-list-v1

  # All paths default to legacy until explicitly migrated
```

**Step 6: Commit**

```bash
git add backend/src/0_infrastructure/routing/ConfigLoader.mjs \
        backend/config/routing.yml \
        tests/unit/infrastructure/routing/ConfigLoader.test.mjs
git commit -m "feat(routing): add config loader with validation"
```

---

## Task 2: Route Matcher

**Files:**
- Create: `backend/src/0_infrastructure/routing/RouteMatcher.mjs`
- Test: `tests/unit/infrastructure/routing/RouteMatcher.test.mjs`

**Step 1: Write the failing test for route matching**

```javascript
// tests/unit/infrastructure/routing/RouteMatcher.test.mjs
import { describe, it, expect } from '@jest/globals';
import { buildRoutingTable, matchRoute } from '../../../../backend/src/0_infrastructure/routing/RouteMatcher.mjs';

describe('RouteMatcher', () => {
  describe('buildRoutingTable', () => {
    it('builds table from config routing section', () => {
      const routing = {
        '/api/finance': 'new',
        '/api/content': { target: 'new', shim: 'content-v1' },
      };

      const table = buildRoutingTable(routing);

      expect(table).toHaveLength(2);
      expect(table[0].path).toBe('/api/finance');
      expect(table[0].target).toBe('new');
      expect(table[0].shim).toBeNull();
      expect(table[1].path).toBe('/api/content');
      expect(table[1].target).toBe('new');
      expect(table[1].shim).toBe('content-v1');
    });

    it('sorts by path length descending (longest prefix first)', () => {
      const routing = {
        '/api': 'legacy',
        '/api/finance/data': 'new',
        '/api/finance': 'new',
      };

      const table = buildRoutingTable(routing);

      expect(table[0].path).toBe('/api/finance/data');
      expect(table[1].path).toBe('/api/finance');
      expect(table[2].path).toBe('/api');
    });
  });

  describe('matchRoute', () => {
    it('matches exact path', () => {
      const table = buildRoutingTable({
        '/api/finance': 'new',
      });

      const result = matchRoute('/api/finance', table, 'legacy');

      expect(result.target).toBe('new');
      expect(result.matched).toBe('/api/finance');
    });

    it('matches path prefix', () => {
      const table = buildRoutingTable({
        '/api/finance': 'new',
      });

      const result = matchRoute('/api/finance/data/budget', table, 'legacy');

      expect(result.target).toBe('new');
      expect(result.matched).toBe('/api/finance');
    });

    it('uses longest prefix match', () => {
      const table = buildRoutingTable({
        '/api': 'legacy',
        '/api/finance': 'new',
      });

      const result = matchRoute('/api/finance/data', table, 'legacy');

      expect(result.target).toBe('new');
      expect(result.matched).toBe('/api/finance');
    });

    it('returns default when no match', () => {
      const table = buildRoutingTable({
        '/api/finance': 'new',
      });

      const result = matchRoute('/api/health', table, 'legacy');

      expect(result.target).toBe('legacy');
      expect(result.matched).toBeNull();
    });

    it('includes shim name when matched route has shim', () => {
      const table = buildRoutingTable({
        '/api/finance': { target: 'new', shim: 'finance-v1' },
      });

      const result = matchRoute('/api/finance/data', table, 'legacy');

      expect(result.shim).toBe('finance-v1');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/infrastructure/routing/RouteMatcher.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/0_infrastructure/routing/RouteMatcher.mjs

/**
 * Build routing table from config, sorted by path length (longest first)
 * @param {Object} routing - Map of path to target/shim config
 * @returns {Array} Sorted routing table entries
 */
export function buildRoutingTable(routing) {
  const entries = Object.entries(routing).map(([path, rule]) => {
    const target = typeof rule === 'string' ? rule : rule.target;
    const shim = typeof rule === 'object' ? rule.shim : null;
    return { path, target, shim };
  });

  // Sort by path length descending (longest prefix first)
  entries.sort((a, b) => b.path.length - a.path.length);

  return entries;
}

/**
 * Match request path against routing table
 * @param {string} requestPath - Incoming request path
 * @param {Array} routingTable - Sorted routing table
 * @param {string} defaultTarget - Default target if no match ('legacy' or 'new')
 * @returns {Object} { target, shim, matched }
 */
export function matchRoute(requestPath, routingTable, defaultTarget) {
  for (const entry of routingTable) {
    if (requestPath === entry.path || requestPath.startsWith(entry.path + '/')) {
      return {
        target: entry.target,
        shim: entry.shim,
        matched: entry.path,
      };
    }
  }

  return {
    target: defaultTarget,
    shim: null,
    matched: null,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/infrastructure/routing/RouteMatcher.test.mjs`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add backend/src/0_infrastructure/routing/RouteMatcher.mjs \
        tests/unit/infrastructure/routing/RouteMatcher.test.mjs
git commit -m "feat(routing): add route matcher with longest-prefix matching"
```

---

## Task 3: Shim Metrics

**Files:**
- Create: `backend/src/0_infrastructure/routing/ShimMetrics.mjs`
- Test: `tests/unit/infrastructure/routing/ShimMetrics.test.mjs`

**Step 1: Write the failing test for metrics tracking**

```javascript
// tests/unit/infrastructure/routing/ShimMetrics.test.mjs
import { describe, it, expect, beforeEach } from '@jest/globals';
import { ShimMetrics } from '../../../../backend/src/0_infrastructure/routing/ShimMetrics.mjs';

describe('ShimMetrics', () => {
  let metrics;

  beforeEach(() => {
    metrics = new ShimMetrics();
  });

  describe('record', () => {
    it('tracks first use of a shim', () => {
      metrics.record('finance-v1');

      const report = metrics.getReport();

      expect(report).toHaveLength(1);
      expect(report[0].shim).toBe('finance-v1');
      expect(report[0].totalRequests).toBe(1);
    });

    it('increments count for repeated uses', () => {
      metrics.record('finance-v1');
      metrics.record('finance-v1');
      metrics.record('finance-v1');

      const report = metrics.getReport();

      expect(report[0].totalRequests).toBe(3);
    });

    it('tracks multiple shims independently', () => {
      metrics.record('finance-v1');
      metrics.record('content-v1');
      metrics.record('finance-v1');

      const report = metrics.getReport();

      expect(report).toHaveLength(2);
      const finance = report.find(r => r.shim === 'finance-v1');
      const content = report.find(r => r.shim === 'content-v1');
      expect(finance.totalRequests).toBe(2);
      expect(content.totalRequests).toBe(1);
    });

    it('updates lastSeen timestamp', () => {
      const before = new Date().toISOString();
      metrics.record('finance-v1');
      const after = new Date().toISOString();

      const report = metrics.getReport();

      expect(report[0].lastSeen >= before).toBe(true);
      expect(report[0].lastSeen <= after).toBe(true);
    });
  });

  describe('getReport', () => {
    it('returns empty array when no shims recorded', () => {
      expect(metrics.getReport()).toEqual([]);
    });

    it('includes daysSinceLastUse calculation', () => {
      metrics.record('finance-v1');

      const report = metrics.getReport();

      expect(report[0].daysSinceLastUse).toBe(0);
    });
  });

  describe('reset', () => {
    it('clears all metrics', () => {
      metrics.record('finance-v1');
      metrics.record('content-v1');

      metrics.reset();

      expect(metrics.getReport()).toEqual([]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/infrastructure/routing/ShimMetrics.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/0_infrastructure/routing/ShimMetrics.mjs

/**
 * Track shim usage for monitoring and safe removal
 */
export class ShimMetrics {
  constructor() {
    this.counts = {};
  }

  /**
   * Record a shim being applied
   * @param {string} shimName - Name of the shim
   */
  record(shimName) {
    if (!this.counts[shimName]) {
      this.counts[shimName] = { total: 0, lastSeen: null };
    }
    this.counts[shimName].total++;
    this.counts[shimName].lastSeen = new Date().toISOString();
  }

  /**
   * Get report of all shim usage
   * @returns {Array} Shim usage report
   */
  getReport() {
    return Object.entries(this.counts).map(([name, data]) => ({
      shim: name,
      totalRequests: data.total,
      lastSeen: data.lastSeen,
      daysSinceLastUse: this.#daysSince(data.lastSeen),
    }));
  }

  /**
   * Reset all metrics
   */
  reset() {
    this.counts = {};
  }

  #daysSince(isoString) {
    if (!isoString) return null;
    const then = new Date(isoString);
    const now = new Date();
    const diffMs = now - then;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/infrastructure/routing/ShimMetrics.test.mjs`
Expected: PASS (8 tests)

**Step 5: Commit**

```bash
git add backend/src/0_infrastructure/routing/ShimMetrics.mjs \
        tests/unit/infrastructure/routing/ShimMetrics.test.mjs
git commit -m "feat(routing): add shim metrics tracking"
```

---

## Task 4: Shim Registry

**Files:**
- Create: `backend/src/4_api/shims/index.mjs`
- Create: `backend/src/4_api/shims/finance.mjs`
- Create: `backend/src/4_api/shims/content.mjs`
- Test: `tests/unit/api/shims/finance.test.mjs`

**Step 1: Write the failing test for finance shims**

```javascript
// tests/unit/api/shims/finance.test.mjs
import { describe, it, expect } from '@jest/globals';
import { financeShims } from '../../../../backend/src/4_api/shims/finance.mjs';

describe('Finance Shims', () => {
  describe('finance-data-v1', () => {
    const shim = financeShims['finance-data-v1'];

    it('exists with required properties', () => {
      expect(shim).toBeDefined();
      expect(shim.name).toBe('finance-data-v1');
      expect(typeof shim.transform).toBe('function');
    });

    it('transforms new format to legacy format', () => {
      const newFormat = {
        budgets: [
          { periodStart: '2025-01-01', periodEnd: '2025-12-31', allocated: 5000 }
        ],
        mortgage: { balance: 250000, rate: 0.065 }
      };

      const legacy = shim.transform(newFormat);

      // Legacy uses object keyed by periodStart
      expect(legacy.budgets['2025-01-01']).toBeDefined();
      expect(legacy.budgets['2025-01-01'].allocated).toBe(5000);
      expect(legacy.mortgage.balance).toBe(250000);
    });

    it('handles empty budgets array', () => {
      const newFormat = { budgets: [], mortgage: null };

      const legacy = shim.transform(newFormat);

      expect(legacy.budgets).toEqual({});
    });
  });

  describe('finance-daytoday-v1', () => {
    const shim = financeShims['finance-daytoday-v1'];

    it('exists with required properties', () => {
      expect(shim).toBeDefined();
      expect(shim.name).toBe('finance-daytoday-v1');
      expect(typeof shim.transform).toBe('function');
    });

    it('flattens current month data to legacy format', () => {
      const newFormat = {
        current: {
          month: '2025-01',
          spending: 1234.56,
          allocated: 1500.00,
          balance: 265.44
        }
      };

      const legacy = shim.transform(newFormat);

      expect(legacy.spending).toBe(1234.56);
      expect(legacy.budget).toBe(1500.00);
      expect(legacy.remaining).toBe(265.44);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/api/shims/finance.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write shim implementations**

```javascript
// backend/src/4_api/shims/finance.mjs

/**
 * Finance domain shims - transform new API responses to legacy format
 *
 * REMOVAL CHECKLIST:
 * 1. Check /admin/shims/report - daysSinceLastUse > 7
 * 2. Verify frontend uses /api/v2/finance endpoints
 * 3. Remove shim entry from routing.yml
 * 4. Delete this file
 */

export const financeShims = {
  'finance-data-v1': {
    name: 'finance-data-v1',
    description: 'Transforms budget array to legacy object-keyed format',
    transform: (newResponse) => {
      const budgets = {};
      for (const budget of (newResponse.budgets || [])) {
        budgets[budget.periodStart] = {
          ...budget,
          budgetStart: budget.periodStart,
          budgetEnd: budget.periodEnd,
        };
      }
      return {
        budgets,
        mortgage: newResponse.mortgage,
      };
    },
  },

  'finance-daytoday-v1': {
    name: 'finance-daytoday-v1',
    description: 'Flattens current month data to legacy flat format',
    transform: (newResponse) => ({
      spending: newResponse.current?.spending,
      budget: newResponse.current?.allocated,
      remaining: newResponse.current?.balance,
    }),
  },
};
```

```javascript
// backend/src/4_api/shims/content.mjs

/**
 * Content domain shims - transform new API responses to legacy format
 */

export const contentShims = {
  'content-list-v1': {
    name: 'content-list-v1',
    description: 'Transforms content list response to legacy format',
    transform: (newResponse) => {
      // Placeholder - implement when content schema changes
      return newResponse;
    },
  },
};
```

```javascript
// backend/src/4_api/shims/index.mjs
import { financeShims } from './finance.mjs';
import { contentShims } from './content.mjs';

/**
 * Registry of all available shims
 * Shim names must match references in routing.yml
 */
export const allShims = {
  ...financeShims,
  ...contentShims,
};
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/api/shims/finance.test.mjs`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add backend/src/4_api/shims/index.mjs \
        backend/src/4_api/shims/finance.mjs \
        backend/src/4_api/shims/content.mjs \
        tests/unit/api/shims/finance.test.mjs
git commit -m "feat(routing): add shim registry with finance and content shims"
```

---

## Task 5: Routing Middleware

**Files:**
- Create: `backend/src/0_infrastructure/routing/RoutingMiddleware.mjs`
- Test: `tests/unit/infrastructure/routing/RoutingMiddleware.test.mjs`

**Step 1: Write the failing test for routing middleware**

```javascript
// tests/unit/infrastructure/routing/RoutingMiddleware.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createRoutingMiddleware, wrapResponseWithShim } from '../../../../backend/src/0_infrastructure/routing/RoutingMiddleware.mjs';

describe('RoutingMiddleware', () => {
  let mockLegacyApp;
  let mockNewApp;
  let mockLogger;
  let mockMetrics;

  beforeEach(() => {
    mockLegacyApp = { handle: jest.fn((req, res, next) => next()) };
    mockNewApp = { handle: jest.fn((req, res, next) => next()) };
    mockLogger = { info: jest.fn(), error: jest.fn() };
    mockMetrics = { record: jest.fn() };
  });

  describe('createRoutingMiddleware', () => {
    it('routes to legacy when config says legacy', () => {
      const config = {
        default: 'legacy',
        routing: { '/api/health': 'legacy' },
      };
      const middleware = createRoutingMiddleware({
        config, legacyApp: mockLegacyApp, newApp: mockNewApp,
        shims: {}, logger: mockLogger, metrics: mockMetrics,
      });

      const req = { path: '/api/health' };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(mockLegacyApp.handle).toHaveBeenCalled();
      expect(mockNewApp.handle).not.toHaveBeenCalled();
    });

    it('routes to new when config says new', () => {
      const config = {
        default: 'legacy',
        routing: { '/api/finance': 'new' },
      };
      const middleware = createRoutingMiddleware({
        config, legacyApp: mockLegacyApp, newApp: mockNewApp,
        shims: {}, logger: mockLogger, metrics: mockMetrics,
      });

      const req = { path: '/api/finance/data' };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(mockNewApp.handle).toHaveBeenCalled();
      expect(mockLegacyApp.handle).not.toHaveBeenCalled();
    });

    it('uses default when path not in config', () => {
      const config = {
        default: 'legacy',
        routing: {},
      };
      const middleware = createRoutingMiddleware({
        config, legacyApp: mockLegacyApp, newApp: mockNewApp,
        shims: {}, logger: mockLogger, metrics: mockMetrics,
      });

      const req = { path: '/api/unknown' };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(mockLegacyApp.handle).toHaveBeenCalled();
    });

    it('sets x-served-by header', () => {
      const config = {
        default: 'legacy',
        routing: { '/api/finance': 'new' },
      };
      const middleware = createRoutingMiddleware({
        config, legacyApp: mockLegacyApp, newApp: mockNewApp,
        shims: {}, logger: mockLogger, metrics: mockMetrics,
      });

      const req = { path: '/api/finance' };
      const res = { setHeader: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith('x-served-by', 'new');
    });

    it('records shim usage when shim is applied', () => {
      const config = {
        default: 'legacy',
        routing: { '/api/finance': { target: 'new', shim: 'finance-v1' } },
      };
      const shims = {
        'finance-v1': { name: 'finance-v1', transform: (x) => x },
      };
      const middleware = createRoutingMiddleware({
        config, legacyApp: mockLegacyApp, newApp: mockNewApp,
        shims, logger: mockLogger, metrics: mockMetrics,
      });

      const req = { path: '/api/finance', method: 'GET', headers: {} };
      const res = { setHeader: jest.fn(), json: jest.fn() };
      const next = jest.fn();

      middleware(req, res, next);

      expect(mockMetrics.record).toHaveBeenCalledWith('finance-v1');
    });
  });

  describe('wrapResponseWithShim', () => {
    it('transforms json response using shim', () => {
      const shim = {
        name: 'test-shim',
        transform: (data) => ({ transformed: true, ...data }),
      };
      const res = {
        json: jest.fn(),
        setHeader: jest.fn(),
      };
      const req = { path: '/test', method: 'GET', headers: {} };

      wrapResponseWithShim(res, req, shim, mockLogger, mockMetrics);
      res.json({ original: true });

      expect(res.json).toHaveBeenCalledWith({ transformed: true, original: true });
    });

    it('logs shim application', () => {
      const shim = {
        name: 'test-shim',
        transform: (data) => data,
      };
      const res = { json: jest.fn(), setHeader: jest.fn() };
      const req = { path: '/test', method: 'GET', headers: {} };

      wrapResponseWithShim(res, req, shim, mockLogger, mockMetrics);
      res.json({});

      expect(mockLogger.info).toHaveBeenCalledWith('shim.applied', expect.objectContaining({
        shim: 'test-shim',
        path: '/test',
      }));
    });

    it('returns untransformed data on shim error', () => {
      const shim = {
        name: 'broken-shim',
        transform: () => { throw new Error('transform failed'); },
      };
      const originalJson = jest.fn();
      const res = { json: originalJson, setHeader: jest.fn() };
      const req = { path: '/test', method: 'GET', headers: {} };

      wrapResponseWithShim(res, req, shim, mockLogger, mockMetrics);
      res.json({ original: true });

      expect(originalJson).toHaveBeenCalledWith({ original: true });
      expect(mockLogger.error).toHaveBeenCalledWith('shim.failed', expect.objectContaining({
        shim: 'broken-shim',
      }));
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/infrastructure/routing/RoutingMiddleware.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/0_infrastructure/routing/RoutingMiddleware.mjs
import { buildRoutingTable, matchRoute } from './RouteMatcher.mjs';

/**
 * Create Express middleware that routes to legacy or new implementation
 * @param {Object} options
 * @param {Object} options.config - Routing configuration
 * @param {Router} options.legacyApp - Express router for legacy routes
 * @param {Router} options.newApp - Express router for new routes
 * @param {Object} options.shims - Map of shim name to shim object
 * @param {Object} options.logger - Logger instance
 * @param {ShimMetrics} options.metrics - Metrics tracker
 * @returns {Function} Express middleware
 */
export function createRoutingMiddleware({ config, legacyApp, newApp, shims, logger, metrics }) {
  const routingTable = buildRoutingTable(config.routing || {});
  const defaultTarget = config.default || 'legacy';

  return (req, res, next) => {
    const route = matchRoute(req.path, routingTable, defaultTarget);

    res.setHeader('x-served-by', route.target);

    if (route.target === 'new') {
      if (route.shim && shims[route.shim]) {
        const shim = shims[route.shim];
        res.setHeader('x-shim-applied', shim.name);
        metrics.record(shim.name);
        wrapResponseWithShim(res, req, shim, logger, metrics);
      }
      newApp.handle(req, res, next);
    } else {
      legacyApp.handle(req, res, next);
    }
  };
}

/**
 * Wrap response.json to apply shim transformation
 * @param {Response} res - Express response
 * @param {Request} req - Express request
 * @param {Object} shim - Shim object with transform function
 * @param {Object} logger - Logger instance
 * @param {ShimMetrics} metrics - Metrics tracker
 */
export function wrapResponseWithShim(res, req, shim, logger, metrics) {
  const originalJson = res.json.bind(res);

  res.json = (data) => {
    try {
      const transformed = shim.transform(data);
      logger.info('shim.applied', {
        shim: shim.name,
        path: req.path,
        method: req.method,
        userAgent: req.headers['user-agent'],
        timestamp: Date.now(),
      });
      return originalJson(transformed);
    } catch (error) {
      logger.error('shim.failed', {
        shim: shim.name,
        path: req.path,
        error: error.message,
      });
      return originalJson(data);
    }
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/infrastructure/routing/RoutingMiddleware.test.mjs`
Expected: PASS (9 tests)

**Step 5: Commit**

```bash
git add backend/src/0_infrastructure/routing/RoutingMiddleware.mjs \
        tests/unit/infrastructure/routing/RoutingMiddleware.test.mjs
git commit -m "feat(routing): add routing middleware with shim support"
```

---

## Task 6: Admin Shims Router

**Files:**
- Create: `backend/src/4_api/routers/admin/shims.mjs`
- Test: `tests/unit/api/routers/admin/shims.test.mjs`

**Step 1: Write the failing test for admin shims router**

```javascript
// tests/unit/api/routers/admin/shims.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createShimsRouter } from '../../../../../backend/src/4_api/routers/admin/shims.mjs';

describe('Admin Shims Router', () => {
  let app;
  let mockMetrics;

  beforeEach(() => {
    mockMetrics = {
      getReport: jest.fn(),
      reset: jest.fn(),
    };
    app = express();
    app.use('/admin/shims', createShimsRouter({ metrics: mockMetrics }));
  });

  describe('GET /admin/shims/report', () => {
    it('returns shim usage report', async () => {
      mockMetrics.getReport.mockReturnValue([
        { shim: 'finance-v1', totalRequests: 100, lastSeen: '2026-01-11T10:00:00Z', daysSinceLastUse: 1 },
        { shim: 'content-v1', totalRequests: 50, lastSeen: '2026-01-10T10:00:00Z', daysSinceLastUse: 2 },
      ]);

      const res = await request(app).get('/admin/shims/report');

      expect(res.status).toBe(200);
      expect(res.body.shims).toHaveLength(2);
      expect(res.body.shims[0].shim).toBe('finance-v1');
      expect(res.body.shims[0].totalRequests).toBe(100);
    });

    it('returns empty array when no shims recorded', async () => {
      mockMetrics.getReport.mockReturnValue([]);

      const res = await request(app).get('/admin/shims/report');

      expect(res.status).toBe(200);
      expect(res.body.shims).toEqual([]);
    });
  });

  describe('POST /admin/shims/reset', () => {
    it('resets metrics and returns success', async () => {
      const res = await request(app).post('/admin/shims/reset');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('reset');
      expect(mockMetrics.reset).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/api/routers/admin/shims.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/4_api/routers/admin/shims.mjs
import express from 'express';

/**
 * Create admin router for shim metrics
 * @param {Object} options
 * @param {ShimMetrics} options.metrics - Shim metrics instance
 * @returns {Router} Express router
 */
export function createShimsRouter({ metrics }) {
  const router = express.Router();

  /**
   * GET /admin/shims/report
   * Returns shim usage statistics
   */
  router.get('/report', (req, res) => {
    const report = metrics.getReport();
    res.json({ shims: report });
  });

  /**
   * POST /admin/shims/reset
   * Resets all shim metrics (use after deployment to start fresh)
   */
  router.post('/reset', (req, res) => {
    metrics.reset();
    res.json({ status: 'reset', timestamp: new Date().toISOString() });
  });

  return router;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/api/routers/admin/shims.test.mjs`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add backend/src/4_api/routers/admin/shims.mjs \
        tests/unit/api/routers/admin/shims.test.mjs
git commit -m "feat(routing): add admin shims router for metrics"
```

---

## Task 7: Index Exports

**Files:**
- Create: `backend/src/0_infrastructure/routing/index.mjs`

**Step 1: Create barrel export file**

```javascript
// backend/src/0_infrastructure/routing/index.mjs
export { loadRoutingConfig } from './ConfigLoader.mjs';
export { buildRoutingTable, matchRoute } from './RouteMatcher.mjs';
export { createRoutingMiddleware, wrapResponseWithShim } from './RoutingMiddleware.mjs';
export { ShimMetrics } from './ShimMetrics.mjs';
```

**Step 2: Commit**

```bash
git add backend/src/0_infrastructure/routing/index.mjs
git commit -m "feat(routing): add barrel exports"
```

---

## Task 8: Integration with Legacy Index

**Files:**
- Modify: `backend/_legacy/index.js`

**Step 1: Read current index.js structure**

Run: Review the current mounting order and Express app setup in `backend/_legacy/index.js`

**Step 2: Add routing middleware integration**

Add to top of file after imports:

```javascript
// Routing toggle system
import { loadRoutingConfig, createRoutingMiddleware, ShimMetrics } from '../src/0_infrastructure/routing/index.mjs';
import { allShims } from '../src/4_api/shims/index.mjs';
import { createShimsRouter } from '../src/4_api/routers/admin/shims.mjs';
```

Add after Express app creation, before any route mounting:

```javascript
// Initialize routing toggle
const shimMetrics = new ShimMetrics();
let routingConfig;
try {
  routingConfig = loadRoutingConfig('./backend/config/routing.yml', allShims);
  console.log('[routing] Config loaded successfully');
} catch (error) {
  console.error('[routing] Config error:', error.message);
  console.log('[routing] Defaulting all routes to legacy');
  routingConfig = { default: 'legacy', routing: {} };
}

// Create separate routers for legacy and new implementations
const legacyRouter = express.Router();
const newRouter = express.Router();

// Mount routing middleware
app.use(createRoutingMiddleware({
  config: routingConfig,
  legacyApp: legacyRouter,
  newApp: newRouter,
  shims: allShims,
  logger: rootLogger.child({ module: 'routing' }),
  metrics: shimMetrics,
}));

// Mount admin shims router
app.use('/admin/shims', createShimsRouter({ metrics: shimMetrics }));
```

Change all `app.use(...)` route mounts to use `legacyRouter.use(...)` or `newRouter.use(...)` based on whether they're legacy or new.

**Step 3: Test manually**

Run: `npm run dev`
Expected: Server starts without errors, routing config loads

**Step 4: Commit**

```bash
git add backend/_legacy/index.js
git commit -m "feat(routing): integrate routing middleware into legacy index"
```

---

## Task 9: Integration Test

**Files:**
- Create: `tests/integration/routing/routing-toggle.test.mjs`

**Step 1: Write integration test**

```javascript
// tests/integration/routing/routing-toggle.test.mjs
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createRoutingMiddleware, ShimMetrics } from '../../../backend/src/0_infrastructure/routing/index.mjs';

describe('Routing Toggle Integration', () => {
  let app;
  let metrics;

  beforeAll(() => {
    app = express();
    metrics = new ShimMetrics();

    const legacyRouter = express.Router();
    legacyRouter.get('/api/finance/data', (req, res) => {
      res.json({ source: 'legacy', budgets: { '2025-01-01': { amount: 1000 } } });
    });

    const newRouter = express.Router();
    newRouter.get('/api/finance/data', (req, res) => {
      res.json({ source: 'new', budgets: [{ periodStart: '2025-01-01', amount: 1000 }] });
    });
    newRouter.get('/api/v2/finance/data', (req, res) => {
      res.json({ source: 'new-v2', budgets: [{ periodStart: '2025-01-01', amount: 1000 }] });
    });

    const config = {
      default: 'legacy',
      routing: {
        '/api/finance': { target: 'new', shim: 'finance-data-v1' },
        '/api/v2/finance': 'new',
      },
    };

    const shims = {
      'finance-data-v1': {
        name: 'finance-data-v1',
        transform: (data) => ({
          source: data.source + '-shimmed',
          budgets: Object.fromEntries(
            data.budgets.map(b => [b.periodStart, { amount: b.amount }])
          ),
        }),
      },
    };

    app.use(createRoutingMiddleware({
      config,
      legacyApp: legacyRouter,
      newApp: newRouter,
      shims,
      logger: { info: () => {}, error: () => {} },
      metrics,
    }));
  });

  it('routes /api/finance to new with shim applied', async () => {
    const res = await request(app).get('/api/finance/data');

    expect(res.status).toBe(200);
    expect(res.headers['x-served-by']).toBe('new');
    expect(res.headers['x-shim-applied']).toBe('finance-data-v1');
    expect(res.body.source).toBe('new-shimmed');
    expect(res.body.budgets['2025-01-01']).toBeDefined();
  });

  it('routes /api/v2/finance to new without shim', async () => {
    const res = await request(app).get('/api/v2/finance/data');

    expect(res.status).toBe(200);
    expect(res.headers['x-served-by']).toBe('new');
    expect(res.headers['x-shim-applied']).toBeUndefined();
    expect(res.body.source).toBe('new-v2');
    expect(Array.isArray(res.body.budgets)).toBe(true);
  });

  it('routes unknown paths to legacy by default', async () => {
    const res = await request(app).get('/api/health/status');

    expect(res.headers['x-served-by']).toBe('legacy');
  });

  it('tracks shim usage in metrics', async () => {
    metrics.reset();
    await request(app).get('/api/finance/data');
    await request(app).get('/api/finance/data');

    const report = metrics.getReport();
    const financeShim = report.find(r => r.shim === 'finance-data-v1');

    expect(financeShim.totalRequests).toBe(2);
  });
});
```

**Step 2: Run integration test**

Run: `npm test -- tests/integration/routing/routing-toggle.test.mjs`
Expected: PASS (4 tests)

**Step 3: Commit**

```bash
git add tests/integration/routing/routing-toggle.test.mjs
git commit -m "test(routing): add integration tests for routing toggle"
```

---

## Task 10: Run Full Test Suite

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass (1140+ tests)

**Step 2: Manual verification**

Run: `npm run dev`
Then: `curl -i http://localhost:3112/api/finance/data`
Expected: Response with `x-served-by: legacy` (since config has everything commented out)

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(routing): complete routing toggle implementation"
```

---

## Summary

| Task | Description | Files Created |
|------|-------------|---------------|
| 1 | Config Loader | ConfigLoader.mjs, routing.yml |
| 2 | Route Matcher | RouteMatcher.mjs |
| 3 | Shim Metrics | ShimMetrics.mjs |
| 4 | Shim Registry | shims/index.mjs, finance.mjs, content.mjs |
| 5 | Routing Middleware | RoutingMiddleware.mjs |
| 6 | Admin Router | admin/shims.mjs |
| 7 | Index Exports | routing/index.mjs |
| 8 | Legacy Integration | index.js (modified) |
| 9 | Integration Test | routing-toggle.test.mjs |
| 10 | Full Test Run | - |

**Total new files:** 11
**Total test files:** 6
**Estimated new tests:** 40+
