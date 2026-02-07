# 100% Backend Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all 68 function parity gaps to achieve 100% parity between legacy and DDD implementations.

**Architecture:** Implement missing functions in existing DDD adapters and services, create new adapters where needed (FitnessSyncer, Shopping), and add utility functions to shared modules. Each task follows TDD with tests before implementation.

**Tech Stack:** Node.js ES modules, Jest testing, YAML persistence, OpenAI/Anthropic APIs, OAuth2 flows

---

## Overview

Based on the Function Parity Audit (2026-01-13), the following gaps need to be addressed:

| Category | Gaps | Priority | Est. Effort |
|----------|------|----------|-------------|
| FitnessSyncer Integration | 9 | P1 | 3 days |
| Shopping Harvester | 11 | P1 | 4 days |
| Media Memory Validator | 9 | P1 | 2 days |
| Garmin Detailed Functions | 7 | P2 | 1 day |
| Buxfer Batch Operations | 3 | P2 | 0.5 days |
| Strava Reauth | 1 | P2 | 1 hour |
| YAML Sanitization | 2 | P3 | 2 hours |
| Plex Thumbnails | 1 | P3 | 1 hour |
| Thermal Printer Test | 1 | P3 | 30 min |
| Router Endpoints | 2 | P3 | 1 hour |
| Intentional Gaps | 11 | Skip | N/A |
| Schema Gaps | 16 | Separate | N/A |

**Total: ~12 days of implementation work**

---

## Phase 1: High Priority (P1) - Core Functionality

### Task 1: Create FitnessSyncerAdapter Port Interface

**Files:**
- Create: `backend/src/1_domains/fitness/ports/IFitnessSyncerGateway.mjs`
- Test: `tests/unit/domains/fitness/ports/IFitnessSyncerGateway.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/domains/fitness/ports/IFitnessSyncerGateway.test.mjs
import { describe, it, expect } from '@jest/globals';
import { IFitnessSyncerGateway } from '../../../../backend/src/1_domains/fitness/ports/IFitnessSyncerGateway.mjs';

describe('IFitnessSyncerGateway', () => {
  it('should define required methods', () => {
    expect(IFitnessSyncerGateway.requiredMethods).toEqual([
      'getAccessToken',
      'getActivities',
      'getSourceId',
      'setSourceId',
      'isInCooldown'
    ]);
  });

  it('should validate implementations', () => {
    const validImpl = {
      getAccessToken: () => {},
      getActivities: () => {},
      getSourceId: () => {},
      setSourceId: () => {},
      isInCooldown: () => {}
    };
    expect(IFitnessSyncerGateway.validate(validImpl)).toBe(true);
  });

  it('should reject invalid implementations', () => {
    const invalidImpl = { getAccessToken: () => {} };
    expect(() => IFitnessSyncerGateway.validate(invalidImpl)).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/domains/fitness/ports/IFitnessSyncerGateway.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/1_domains/fitness/ports/IFitnessSyncerGateway.mjs
/**
 * Port interface for FitnessSyncer integration (Garmin data via third-party service)
 */
export const IFitnessSyncerGateway = {
  requiredMethods: [
    'getAccessToken',
    'getActivities',
    'getSourceId',
    'setSourceId',
    'isInCooldown'
  ],

  validate(implementation) {
    for (const method of this.requiredMethods) {
      if (typeof implementation[method] !== 'function') {
        throw new Error(`IFitnessSyncerGateway: missing required method '${method}'`);
      }
    }
    return true;
  }
};
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/domains/fitness/ports/IFitnessSyncerGateway.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/fitness/ports/IFitnessSyncerGateway.mjs tests/unit/domains/fitness/ports/
git commit -m "feat(fitness): add IFitnessSyncerGateway port interface"
```

---

### Task 2: Create FitnessSyncerAdapter - OAuth Token Management

**Files:**
- Create: `backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs`
- Test: `tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`
- Reference: `backend/_legacy/lib/fitsync.mjs:117-215`

**Step 1: Write the failing test**

```javascript
// tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('FitnessSyncerAdapter', () => {
  let adapter;
  let mockHttpClient;
  let mockAuthStore;
  let mockLogger;

  beforeEach(() => {
    mockHttpClient = {
      get: jest.fn(),
      post: jest.fn()
    };
    mockAuthStore = {
      get: jest.fn(),
      set: jest.fn()
    };
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    };
  });

  describe('getAccessToken', () => {
    it('should return cached token if not expired', async () => {
      const { FitnessSyncerAdapter } = await import(
        '../../../../backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs'
      );

      mockAuthStore.get.mockResolvedValue({
        access_token: 'cached-token',
        expires_at: Date.now() + 3600000 // 1 hour from now
      });

      adapter = new FitnessSyncerAdapter({
        httpClient: mockHttpClient,
        authStore: mockAuthStore,
        logger: mockLogger,
        clientId: 'test-client',
        clientSecret: 'test-secret'
      });

      const token = await adapter.getAccessToken();
      expect(token).toBe('cached-token');
      expect(mockHttpClient.post).not.toHaveBeenCalled();
    });

    it('should refresh token if expired', async () => {
      const { FitnessSyncerAdapter } = await import(
        '../../../../backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs'
      );

      mockAuthStore.get.mockResolvedValue({
        access_token: 'expired-token',
        refresh_token: 'refresh-token',
        expires_at: Date.now() - 1000 // expired
      });

      mockHttpClient.post.mockResolvedValue({
        data: {
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_in: 3600
        }
      });

      adapter = new FitnessSyncerAdapter({
        httpClient: mockHttpClient,
        authStore: mockAuthStore,
        logger: mockLogger,
        clientId: 'test-client',
        clientSecret: 'test-secret'
      });

      const token = await adapter.getAccessToken();
      expect(token).toBe('new-token');
      expect(mockAuthStore.set).toHaveBeenCalled();
    });
  });

  describe('isInCooldown', () => {
    it('should return false when no failures recorded', async () => {
      const { FitnessSyncerAdapter } = await import(
        '../../../../backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs'
      );

      adapter = new FitnessSyncerAdapter({
        httpClient: mockHttpClient,
        authStore: mockAuthStore,
        logger: mockLogger
      });

      expect(adapter.isInCooldown()).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs
import { CircuitBreaker } from '../../common/CircuitBreaker.mjs';

const FITSYNC_BASE_URL = 'https://api.fitnesssyncer.com';
const TOKEN_BUFFER_MS = 300000; // 5 minutes before expiry

/**
 * FitnessSyncer adapter for Garmin activity harvesting
 * Migrated from: backend/_legacy/lib/fitsync.mjs
 */
export class FitnessSyncerAdapter {
  #httpClient;
  #authStore;
  #logger;
  #config;
  #circuitBreaker;
  #sourceCache = new Map();

  constructor({ httpClient, authStore, logger, clientId, clientSecret, cooldownMinutes = 60 }) {
    this.#httpClient = httpClient;
    this.#authStore = authStore;
    this.#logger = logger || console;
    this.#config = { clientId, clientSecret };
    this.#circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownMs: cooldownMinutes * 60 * 1000
    });
  }

  /**
   * Get valid access token, refreshing if needed
   * Migrated from: fitsync.mjs:117-215
   */
  async getAccessToken() {
    const stored = await this.#authStore.get('fitsync');

    if (stored?.access_token && stored.expires_at > Date.now() + TOKEN_BUFFER_MS) {
      return stored.access_token;
    }

    if (!stored?.refresh_token) {
      throw new Error('No refresh token available - manual reauthorization required');
    }

    this.#logger.info('fitsync.refreshToken', { reason: 'token_expired' });

    const response = await this.#httpClient.post(`${FITSYNC_BASE_URL}/oauth/token`, {
      grant_type: 'refresh_token',
      refresh_token: stored.refresh_token,
      client_id: this.#config.clientId,
      client_secret: this.#config.clientSecret
    });

    const { access_token, refresh_token, expires_in } = response.data;

    await this.#authStore.set('fitsync', {
      access_token,
      refresh_token,
      expires_at: Date.now() + (expires_in * 1000)
    });

    return access_token;
  }

  /**
   * Check if adapter is in cooldown due to failures
   * Migrated from: fitsync.mjs:62-72
   */
  isInCooldown() {
    return this.#circuitBreaker.isOpen();
  }

  /**
   * Record failure for circuit breaker
   * Migrated from: fitsync.mjs:77-95
   */
  recordFailure(error) {
    this.#circuitBreaker.recordFailure(error);
  }

  /**
   * Record success, reset circuit breaker
   * Migrated from: fitsync.mjs:100-106
   */
  recordSuccess() {
    this.#circuitBreaker.recordSuccess();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs tests/unit/adapters/harvester/fitness/
git commit -m "feat(fitness): add FitnessSyncerAdapter with OAuth token management"
```

---

### Task 3: FitnessSyncerAdapter - Source ID Management

**Files:**
- Modify: `backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs`
- Test: `tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`
- Reference: `backend/_legacy/lib/fitsync.mjs:251-263`

**Step 1: Add tests for source ID methods**

```javascript
// Add to existing test file
describe('source ID management', () => {
  it('should fetch and cache source ID', async () => {
    const { FitnessSyncerAdapter } = await import(
      '../../../../backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs'
    );

    mockAuthStore.get.mockResolvedValue({
      access_token: 'valid-token',
      expires_at: Date.now() + 3600000
    });

    mockHttpClient.get.mockResolvedValue({
      data: {
        items: [
          { id: 'src-123', provider: 'garmin' },
          { id: 'src-456', provider: 'strava' }
        ]
      }
    });

    adapter = new FitnessSyncerAdapter({
      httpClient: mockHttpClient,
      authStore: mockAuthStore,
      logger: mockLogger
    });

    const sourceId = await adapter.getSourceId('garmin');
    expect(sourceId).toBe('src-123');
  });

  it('should use cached source ID on subsequent calls', async () => {
    const { FitnessSyncerAdapter } = await import(
      '../../../../backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs'
    );

    mockAuthStore.get.mockResolvedValue({
      access_token: 'valid-token',
      expires_at: Date.now() + 3600000
    });

    mockHttpClient.get.mockResolvedValue({
      data: { items: [{ id: 'src-123', provider: 'garmin' }] }
    });

    adapter = new FitnessSyncerAdapter({
      httpClient: mockHttpClient,
      authStore: mockAuthStore,
      logger: mockLogger
    });

    await adapter.getSourceId('garmin');
    await adapter.getSourceId('garmin');

    // Should only call API once
    expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`
Expected: FAIL with "adapter.getSourceId is not a function"

**Step 3: Add implementation**

```javascript
// Add to FitnessSyncerAdapter class

/**
 * Get source ID for provider type
 * Migrated from: fitsync.mjs:258-263
 */
async getSourceId(providerKey) {
  if (this.#sourceCache.has(providerKey)) {
    return this.#sourceCache.get(providerKey);
  }

  const token = await this.getAccessToken();
  const response = await this.#httpClient.get(`${FITSYNC_BASE_URL}/api/sources`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  for (const source of response.data.items || []) {
    this.#sourceCache.set(source.provider, source.id);
  }

  return this.#sourceCache.get(providerKey);
}

/**
 * Set source ID in cache (for testing/manual override)
 * Migrated from: fitsync.mjs:251-256
 */
setSourceId(providerKey, sourceId) {
  this.#sourceCache.set(providerKey, sourceId);
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs tests/unit/adapters/harvester/fitness/
git commit -m "feat(fitness): add source ID management to FitnessSyncerAdapter"
```

---

### Task 4: FitnessSyncerAdapter - Activity Harvesting

**Files:**
- Modify: `backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs`
- Test: `tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`
- Reference: `backend/_legacy/lib/fitsync.mjs:265-417`

**Step 1: Add tests for activity harvesting**

```javascript
// Add to existing test file
describe('getActivities', () => {
  it('should fetch activities from FitnessSyncer API', async () => {
    const { FitnessSyncerAdapter } = await import(
      '../../../../backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs'
    );

    mockAuthStore.get.mockResolvedValue({
      access_token: 'valid-token',
      expires_at: Date.now() + 3600000
    });

    mockHttpClient.get
      .mockResolvedValueOnce({ data: { items: [{ id: 'src-garmin', provider: 'garmin' }] } })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'act-1',
              startTime: '2026-01-13T10:00:00Z',
              type: 'running',
              duration: 1800,
              calories: 300,
              distance: 5000
            }
          ]
        }
      });

    adapter = new FitnessSyncerAdapter({
      httpClient: mockHttpClient,
      authStore: mockAuthStore,
      logger: mockLogger
    });

    const activities = await adapter.getActivities({ daysBack: 7 });
    expect(activities).toHaveLength(1);
    expect(activities[0].type).toBe('running');
  });

  it('should handle circuit breaker cooldown', async () => {
    const { FitnessSyncerAdapter } = await import(
      '../../../../backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs'
    );

    adapter = new FitnessSyncerAdapter({
      httpClient: mockHttpClient,
      authStore: mockAuthStore,
      logger: mockLogger,
      cooldownMinutes: 1
    });

    // Simulate 3 failures to open circuit
    adapter.recordFailure(new Error('fail 1'));
    adapter.recordFailure(new Error('fail 2'));
    adapter.recordFailure(new Error('fail 3'));

    await expect(adapter.getActivities()).rejects.toThrow('Circuit breaker is open');
  });
});

describe('harvest', () => {
  it('should implement IHarvester interface', async () => {
    const { FitnessSyncerAdapter } = await import(
      '../../../../backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs'
    );

    mockAuthStore.get.mockResolvedValue({
      access_token: 'valid-token',
      expires_at: Date.now() + 3600000
    });

    mockHttpClient.get
      .mockResolvedValueOnce({ data: { items: [{ id: 'src-garmin', provider: 'garmin' }] } })
      .mockResolvedValueOnce({ data: { items: [] } });

    adapter = new FitnessSyncerAdapter({
      httpClient: mockHttpClient,
      authStore: mockAuthStore,
      logger: mockLogger
    });

    const result = await adapter.harvest({ jobId: 'test-job' });
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('metadata');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`
Expected: FAIL

**Step 3: Add implementation**

```javascript
// Add to FitnessSyncerAdapter class

/**
 * Fetch activities from FitnessSyncer
 * Migrated from: fitsync.mjs:265-336
 */
async getActivities({ daysBack = 30, sourceKey = 'garmin' } = {}) {
  if (this.isInCooldown()) {
    throw new Error('Circuit breaker is open - FitnessSyncer in cooldown');
  }

  try {
    const token = await this.getAccessToken();
    const sourceId = await this.getSourceId(sourceKey);

    if (!sourceId) {
      throw new Error(`No source found for provider: ${sourceKey}`);
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const response = await this.#httpClient.get(`${FITSYNC_BASE_URL}/api/activities`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        sourceId,
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString()
      }
    });

    this.recordSuccess();
    return response.data.items || [];
  } catch (error) {
    this.recordFailure(error);
    throw error;
  }
}

/**
 * Main harvest function implementing IHarvester interface
 * Migrated from: fitsync.mjs:338-417
 */
async harvest({ jobId, daysBack = 30 } = {}) {
  this.#logger.info('fitsync.harvest.start', { jobId, daysBack });

  const activities = await this.getActivities({ daysBack });

  const transformed = activities.map(activity => ({
    source: 'fitsync',
    externalId: activity.id,
    startTime: activity.startTime,
    endTime: activity.endTime,
    type: activity.type,
    title: activity.name || activity.type,
    duration: activity.duration,
    calories: activity.calories,
    distance: activity.distance,
    avgHr: activity.avgHeartRate,
    maxHr: activity.maxHeartRate,
    raw: activity
  }));

  this.#logger.info('fitsync.harvest.complete', {
    jobId,
    count: transformed.length
  });

  return {
    items: transformed,
    metadata: {
      source: 'fitsync',
      harvestedAt: new Date().toISOString(),
      daysBack
    }
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs tests/unit/adapters/harvester/fitness/
git commit -m "feat(fitness): add activity harvesting to FitnessSyncerAdapter"
```

---

### Task 5: FitnessSyncerAdapter - Error Message Cleaning

**Files:**
- Modify: `backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs`
- Reference: `backend/_legacy/lib/fitsync.mjs:25-47`

**Step 1: Add test for error message cleaning**

```javascript
// Add to existing test file
describe('cleanErrorMessage', () => {
  it('should extract error from HTML response', async () => {
    const { FitnessSyncerAdapter } = await import(
      '../../../../backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs'
    );

    const htmlError = '<html><body><h1>Error</h1><p>Rate limit exceeded</p></body></html>';
    const cleaned = FitnessSyncerAdapter.cleanErrorMessage(htmlError);
    expect(cleaned).toBe('Rate limit exceeded');
  });

  it('should return original message if not HTML', async () => {
    const { FitnessSyncerAdapter } = await import(
      '../../../../backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs'
    );

    const plainError = 'Connection refused';
    const cleaned = FitnessSyncerAdapter.cleanErrorMessage(plainError);
    expect(cleaned).toBe('Connection refused');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`
Expected: FAIL

**Step 3: Add implementation**

```javascript
// Add as static method to FitnessSyncerAdapter class

/**
 * Extract clean error message from HTML error responses
 * Migrated from: fitsync.mjs:25-47
 */
static cleanErrorMessage(error) {
  if (typeof error !== 'string') {
    return error?.message || String(error);
  }

  // Check if it's HTML
  if (!error.includes('<html') && !error.includes('<body')) {
    return error;
  }

  // Extract text from common error containers
  const patterns = [
    /<p[^>]*>([^<]+)<\/p>/i,
    /<h1[^>]*>([^<]+)<\/h1>/i,
    /<title[^>]*>([^<]+)<\/title>/i,
    /<body[^>]*>([^<]+)<\/body>/i
  ];

  for (const pattern of patterns) {
    const match = error.match(pattern);
    if (match?.[1]?.trim() && match[1].trim() !== 'Error') {
      return match[1].trim();
    }
  }

  // Fallback: strip all HTML tags
  return error.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/adapters/harvester/fitness/FitnessSyncerAdapter.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs tests/unit/adapters/harvester/fitness/
git commit -m "feat(fitness): add error message cleaning to FitnessSyncerAdapter"
```

---

### Task 6: Register FitnessSyncerAdapter in Bootstrap

**Files:**
- Modify: `backend/src/0_infrastructure/bootstrap.mjs`
- Test: Verify adapter is available via DI

**Step 1: Add FitnessSyncerAdapter to bootstrap exports**

```javascript
// Add to backend/src/0_infrastructure/bootstrap.mjs imports
import { FitnessSyncerAdapter } from '../2_adapters/harvester/fitness/FitnessSyncerAdapter.mjs';

// Add factory function
export function createFitnessSyncerAdapter(config) {
  return new FitnessSyncerAdapter({
    httpClient: createHttpClient(),
    authStore: createYamlAuthStore(config),
    logger: createLogger('fitsync'),
    clientId: config.fitsync?.clientId || process.env.FITSYNC_CLIENT_ID,
    clientSecret: config.fitsync?.clientSecret || process.env.FITSYNC_CLIENT_SECRET,
    cooldownMinutes: config.fitsync?.cooldownMinutes || 60
  });
}
```

**Step 2: Run integration test**

Run: `npm test -- --testPathPattern=bootstrap`
Expected: PASS

**Step 3: Commit**

```bash
git add backend/src/0_infrastructure/bootstrap.mjs
git commit -m "feat(bootstrap): register FitnessSyncerAdapter factory"
```

---

### Task 7: Create ShoppingHarvester - Gmail Receipt Integration

**Files:**
- Create: `backend/src/2_adapters/harvester/finance/ShoppingHarvester.mjs`
- Test: `tests/unit/adapters/harvester/finance/ShoppingHarvester.test.mjs`
- Reference: `backend/_legacy/lib/shopping.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/adapters/harvester/finance/ShoppingHarvester.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('ShoppingHarvester', () => {
  let harvester;
  let mockGmailAdapter;
  let mockAIGateway;
  let mockReceiptStore;
  let mockLogger;

  beforeEach(() => {
    mockGmailAdapter = {
      harvestEmails: jest.fn(),
      getAttachment: jest.fn()
    };
    mockAIGateway = {
      chat: jest.fn()
    };
    mockReceiptStore = {
      get: jest.fn(),
      set: jest.fn(),
      has: jest.fn()
    };
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };
  });

  describe('harvest', () => {
    it('should fetch and parse shopping receipts from Gmail', async () => {
      const { ShoppingHarvester } = await import(
        '../../../../backend/src/2_adapters/harvester/finance/ShoppingHarvester.mjs'
      );

      mockGmailAdapter.harvestEmails.mockResolvedValue([
        {
          id: 'email-1',
          from: 'receipts@amazon.com',
          subject: 'Your Amazon.com order',
          body: 'Order Total: $42.99',
          date: '2026-01-13T10:00:00Z'
        }
      ]);

      mockAIGateway.chat.mockResolvedValue({
        content: JSON.stringify({
          vendor: 'Amazon',
          total: 42.99,
          items: [{ name: 'Widget', price: 42.99 }]
        })
      });

      mockReceiptStore.has.mockResolvedValue(false);

      harvester = new ShoppingHarvester({
        gmailAdapter: mockGmailAdapter,
        aiGateway: mockAIGateway,
        receiptStore: mockReceiptStore,
        logger: mockLogger
      });

      const result = await harvester.harvest({ jobId: 'test-job' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].vendor).toBe('Amazon');
    });

    it('should skip already processed receipts', async () => {
      const { ShoppingHarvester } = await import(
        '../../../../backend/src/2_adapters/harvester/finance/ShoppingHarvester.mjs'
      );

      mockGmailAdapter.harvestEmails.mockResolvedValue([
        { id: 'email-1', from: 'receipts@amazon.com' }
      ]);

      mockReceiptStore.has.mockResolvedValue(true); // Already processed

      harvester = new ShoppingHarvester({
        gmailAdapter: mockGmailAdapter,
        aiGateway: mockAIGateway,
        receiptStore: mockReceiptStore,
        logger: mockLogger
      });

      const result = await harvester.harvest({ jobId: 'test-job' });
      expect(result.items).toHaveLength(0);
      expect(mockAIGateway.chat).not.toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/adapters/harvester/finance/ShoppingHarvester.test.mjs`
Expected: FAIL with "Cannot find module"

**Step 3: Write implementation**

```javascript
// backend/src/2_adapters/harvester/finance/ShoppingHarvester.mjs

const RECEIPT_SENDERS = [
  'receipts@amazon.com',
  'noreply@target.com',
  'orders@costco.com',
  'noreply@walmart.com',
  'receipts@bestbuy.com'
];

const EXTRACTION_PROMPT = `Extract shopping receipt data from this email. Return JSON:
{
  "vendor": "store name",
  "total": number,
  "tax": number or null,
  "date": "YYYY-MM-DD",
  "items": [{"name": "item name", "price": number, "quantity": number}]
}
If not a valid receipt, return {"error": "not_a_receipt"}`;

/**
 * Shopping receipt harvester - extracts purchase data from Gmail
 * Migrated from: backend/_legacy/lib/shopping.mjs
 */
export class ShoppingHarvester {
  #gmailAdapter;
  #aiGateway;
  #receiptStore;
  #logger;

  constructor({ gmailAdapter, aiGateway, receiptStore, logger }) {
    this.#gmailAdapter = gmailAdapter;
    this.#aiGateway = aiGateway;
    this.#receiptStore = receiptStore;
    this.#logger = logger || console;
  }

  /**
   * Main harvest function implementing IHarvester
   * Migrated from: shopping.mjs main harvest flow
   */
  async harvest({ jobId, daysBack = 30 } = {}) {
    this.#logger.info('shopping.harvest.start', { jobId, daysBack });

    const emails = await this.#gmailAdapter.harvestEmails({
      query: this.#buildQuery(daysBack),
      maxResults: 100
    });

    const receipts = [];
    for (const email of emails) {
      // Skip if already processed
      if (await this.#receiptStore.has(email.id)) {
        this.#logger.debug('shopping.skip', { emailId: email.id, reason: 'already_processed' });
        continue;
      }

      try {
        const receipt = await this.#extractReceipt(email);
        if (receipt && !receipt.error) {
          receipt.emailId = email.id;
          receipt.emailDate = email.date;
          receipts.push(receipt);
          await this.#receiptStore.set(email.id, receipt);
        }
      } catch (error) {
        this.#logger.error('shopping.extract.error', { emailId: email.id, error: error.message });
      }
    }

    this.#logger.info('shopping.harvest.complete', { jobId, count: receipts.length });

    return {
      items: receipts,
      metadata: {
        source: 'shopping',
        harvestedAt: new Date().toISOString(),
        daysBack,
        emailsScanned: emails.length
      }
    };
  }

  /**
   * Build Gmail search query for receipts
   */
  #buildQuery(daysBack) {
    const fromFilter = RECEIPT_SENDERS.map(s => `from:${s}`).join(' OR ');
    const dateFilter = `newer_than:${daysBack}d`;
    return `(${fromFilter}) ${dateFilter}`;
  }

  /**
   * Extract receipt data using AI
   * Migrated from: shopping.mjs AI extraction logic
   */
  async #extractReceipt(email) {
    const response = await this.#aiGateway.chat({
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}` }
      ],
      responseFormat: 'json'
    });

    try {
      return JSON.parse(response.content);
    } catch {
      return { error: 'parse_failed' };
    }
  }

  /**
   * Check if email is from known receipt sender
   */
  isReceiptSender(from) {
    return RECEIPT_SENDERS.some(sender => from.toLowerCase().includes(sender));
  }

  /**
   * Merge duplicate receipts
   * Migrated from: shopping.mjs deduplication logic
   */
  mergeReceipts(receipts) {
    const byVendorDate = new Map();

    for (const receipt of receipts) {
      const key = `${receipt.vendor}-${receipt.date}-${receipt.total}`;
      if (!byVendorDate.has(key)) {
        byVendorDate.set(key, receipt);
      }
    }

    return Array.from(byVendorDate.values());
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/adapters/harvester/finance/ShoppingHarvester.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/harvester/finance/ShoppingHarvester.mjs tests/unit/adapters/harvester/finance/
git commit -m "feat(finance): add ShoppingHarvester for Gmail receipt extraction"
```

---

### Task 8: Create MediaMemoryValidatorService

**Files:**
- Create: `backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs`
- Test: `tests/unit/domains/content/services/MediaMemoryValidatorService.test.mjs`
- Reference: `backend/_legacy/lib/mediaMemoryValidator.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/domains/content/services/MediaMemoryValidatorService.test.mjs
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('MediaMemoryValidatorService', () => {
  let service;
  let mockPlexClient;
  let mockWatchStateStore;
  let mockLogger;

  beforeEach(() => {
    mockPlexClient = {
      request: jest.fn(),
      hubSearch: jest.fn()
    };
    mockWatchStateStore = {
      getAllOrphans: jest.fn(),
      updateId: jest.fn(),
      remove: jest.fn()
    };
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
  });

  describe('validateMediaMemory', () => {
    it('should find and backfill orphan IDs', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      mockWatchStateStore.getAllOrphans.mockResolvedValue([
        { id: 'orphan-1', title: 'Test Movie', guid: 'plex://movie/abc123' }
      ]);

      mockPlexClient.hubSearch.mockResolvedValue({
        results: [{ ratingKey: '12345', title: 'Test Movie', guid: 'plex://movie/abc123' }]
      });

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const result = await service.validateMediaMemory();
      expect(result.backfilled).toBe(1);
      expect(mockWatchStateStore.updateId).toHaveBeenCalledWith('orphan-1', '12345');
    });
  });

  describe('calculateConfidence', () => {
    it('should return high confidence for exact match', async () => {
      const { MediaMemoryValidatorService } = await import(
        '../../../../backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs'
      );

      service = new MediaMemoryValidatorService({
        plexClient: mockPlexClient,
        watchStateStore: mockWatchStateStore,
        logger: mockLogger
      });

      const stored = { title: 'The Matrix', year: 1999 };
      const result = { title: 'The Matrix', year: 1999 };

      expect(service.calculateConfidence(stored, result)).toBeGreaterThan(0.9);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/domains/content/services/MediaMemoryValidatorService.test.mjs`
Expected: FAIL

**Step 3: Write implementation**

```javascript
// backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs

const CONFIDENCE_THRESHOLD = 0.8;
const SAMPLE_SIZE = 50;

/**
 * Service for validating and backfilling orphan Plex IDs in media memory
 * Migrated from: backend/_legacy/lib/mediaMemoryValidator.mjs
 */
export class MediaMemoryValidatorService {
  #plexClient;
  #watchStateStore;
  #logger;

  constructor({ plexClient, watchStateStore, logger }) {
    this.#plexClient = plexClient;
    this.#watchStateStore = watchStateStore;
    this.#logger = logger || console;
  }

  /**
   * Main validation function - find and backfill orphan IDs
   * Migrated from: mediaMemoryValidator.mjs:165-278
   */
  async validateMediaMemory(options = {}) {
    const { maxItems = SAMPLE_SIZE, dryRun = false } = options;

    this.#logger.info('validator.start', { maxItems, dryRun });

    // Get orphan entries (IDs that no longer exist in Plex)
    const orphans = await this.#watchStateStore.getAllOrphans();
    const selected = this.selectEntriesToCheck(orphans, maxItems);

    const results = { checked: 0, backfilled: 0, removed: 0, failed: 0 };

    for (const entry of selected) {
      results.checked++;

      try {
        const match = await this.findBestMatch(entry);

        if (match && match.confidence >= CONFIDENCE_THRESHOLD) {
          if (!dryRun) {
            await this.#watchStateStore.updateId(entry.id, match.ratingKey);
          }
          results.backfilled++;
          this.#logger.info('validator.backfill', {
            oldId: entry.id,
            newId: match.ratingKey,
            confidence: match.confidence
          });
        } else if (!match) {
          if (!dryRun) {
            await this.#watchStateStore.remove(entry.id);
          }
          results.removed++;
        }
      } catch (error) {
        results.failed++;
        this.#logger.error('validator.error', { id: entry.id, error: error.message });
      }
    }

    this.#logger.info('validator.complete', results);
    return results;
  }

  /**
   * Select random sample of entries to validate
   * Migrated from: mediaMemoryValidator.mjs:141-163
   */
  selectEntriesToCheck(entries, maxItems = SAMPLE_SIZE) {
    if (entries.length <= maxItems) return entries;

    // Shuffle and take first N
    const shuffled = [...entries].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, maxItems);
  }

  /**
   * Find best matching Plex item for orphan entry
   * Migrated from: mediaMemoryValidator.mjs:113-139
   */
  async findBestMatch(entry) {
    const searchTerms = [entry.title];
    if (entry.year) searchTerms.push(String(entry.year));

    const results = await this.#plexClient.hubSearch(searchTerms.join(' '));

    if (!results?.results?.length) return null;

    let bestMatch = null;
    let bestConfidence = 0;

    for (const result of results.results) {
      const confidence = this.calculateConfidence(entry, result);
      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestMatch = { ...result, confidence };
      }
    }

    return bestConfidence >= CONFIDENCE_THRESHOLD ? bestMatch : null;
  }

  /**
   * Calculate match confidence between stored entry and search result
   * Migrated from: mediaMemoryValidator.mjs:86-111
   */
  calculateConfidence(stored, result) {
    let score = 0;
    let factors = 0;

    // Title match (weighted heavily)
    if (stored.title && result.title) {
      const titleSimilarity = this.#stringSimilarity(stored.title, result.title);
      score += titleSimilarity * 0.5;
      factors += 0.5;
    }

    // Year match
    if (stored.year && result.year) {
      score += stored.year === result.year ? 0.3 : 0;
      factors += 0.3;
    }

    // GUID match (highest confidence)
    if (stored.guid && result.guid && stored.guid === result.guid) {
      return 1.0;
    }

    return factors > 0 ? score / factors : 0;
  }

  /**
   * Simple string similarity (Levenshtein-based)
   */
  #stringSimilarity(a, b) {
    const aLower = a.toLowerCase().trim();
    const bLower = b.toLowerCase().trim();

    if (aLower === bLower) return 1;

    const longer = aLower.length > bLower.length ? aLower : bLower;
    const shorter = aLower.length > bLower.length ? bLower : aLower;

    if (longer.length === 0) return 1;

    // Simple containment check
    if (longer.includes(shorter)) return shorter.length / longer.length;

    return 0;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/domains/content/services/MediaMemoryValidatorService.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/services/MediaMemoryValidatorService.mjs tests/unit/domains/content/services/
git commit -m "feat(content): add MediaMemoryValidatorService for orphan ID backfill"
```

---

### Task 9: Add PlexClient.hubSearch Method

**Files:**
- Modify: `backend/src/2_adapters/content/media/plex/PlexClient.mjs`
- Test: `tests/unit/adapters/content/media/plex/PlexClient.test.mjs`
- Reference: `backend/_legacy/lib/mediaMemoryValidator.mjs:66-84`

**Step 1: Add test for hubSearch**

```javascript
// Add to existing PlexClient test file
describe('hubSearch', () => {
  it('should search Plex hub and return results', async () => {
    const { PlexClient } = await import(
      '../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
    );

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        MediaContainer: {
          Hub: [{ Metadata: [{ ratingKey: '123', title: 'Test' }] }]
        }
      })
    });

    const client = new PlexClient({
      host: 'http://localhost:32400',
      token: 'test-token',
      fetch: mockFetch
    });

    const results = await client.hubSearch('Test Movie');
    expect(results.results).toHaveLength(1);
    expect(results.results[0].ratingKey).toBe('123');
  });

  it('should filter by library if provided', async () => {
    const { PlexClient } = await import(
      '../../../../backend/src/2_adapters/content/media/plex/PlexClient.mjs'
    );

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ MediaContainer: { Hub: [] } })
    });

    const client = new PlexClient({
      host: 'http://localhost:32400',
      token: 'test-token',
      fetch: mockFetch
    });

    await client.hubSearch('Test', { libraryId: '5' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('sectionId=5'),
      expect.any(Object)
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/adapters/content/media/plex/PlexClient.test.mjs`
Expected: FAIL

**Step 3: Add implementation**

```javascript
// Add to PlexClient class

/**
 * Search Plex hub for media items
 * Migrated from: mediaMemoryValidator.mjs:66-84
 */
async hubSearch(query, options = {}) {
  const { libraryId, limit = 10 } = options;

  let url = `/hubs/search?query=${encodeURIComponent(query)}&limit=${limit}`;
  if (libraryId) {
    url += `&sectionId=${libraryId}`;
  }

  const response = await this.request(url);
  const container = response.MediaContainer || {};

  // Flatten results from all hubs
  const results = [];
  for (const hub of container.Hub || []) {
    for (const item of hub.Metadata || []) {
      results.push({
        ratingKey: item.ratingKey,
        title: item.title,
        year: item.year,
        type: item.type,
        guid: item.guid
      });
    }
  }

  return { results };
}

/**
 * Check if Plex server is reachable
 * Migrated from: mediaMemoryValidator.mjs:52-59
 */
async checkConnectivity() {
  try {
    await this.request('/');
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify a Plex ID exists
 * Migrated from: mediaMemoryValidator.mjs:61-64
 */
async verifyId(plexId) {
  try {
    await this.getMetadata(plexId);
    return true;
  } catch {
    return false;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/unit/adapters/content/media/plex/PlexClient.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/content/media/plex/PlexClient.mjs tests/unit/adapters/content/media/plex/
git commit -m "feat(content): add hubSearch, checkConnectivity, verifyId to PlexClient"
```

---

## Phase 2: Medium Priority (P2) - Enhanced Functionality

### Task 10: Add Garmin Detailed Activity Methods

**Files:**
- Modify: `backend/src/2_adapters/harvester/health/GarminHarvester.mjs`
- Test: `tests/unit/adapters/harvester/health/GarminHarvester.test.mjs`
- Reference: `backend/_legacy/lib/garmin.mjs:176-218`

**Step 1: Add tests for detailed methods**

```javascript
// Add to existing GarminHarvester test file
describe('detailed activity methods', () => {
  it('should get activity details', async () => {
    // Test implementation for getActivityDetails
  });

  it('should get steps for date', async () => {
    // Test implementation for getSteps
  });

  it('should get heart rate for date', async () => {
    // Test implementation for getHeartRate
  });
});
```

**Step 2-5:** Implement `getActivityDetails()`, `getSteps()`, `getHeartRate()`, `downloadActivityData()`, etc. following TDD pattern.

**Commit:** `feat(health): add detailed activity methods to GarminHarvester`

---

### Task 11: Add Strava reauthSequence

**Files:**
- Modify: `backend/src/2_adapters/harvester/health/StravaHarvester.mjs`
- Reference: `backend/_legacy/lib/strava.mjs:159-165`

**Step 1: Add test**

```javascript
describe('reauthSequence', () => {
  it('should generate reauthorization URL', async () => {
    const { StravaHarvester } = await import('...');

    harvester = new StravaHarvester({ ... });
    const url = harvester.reauthSequence();

    expect(url).toContain('strava.com/oauth/authorize');
    expect(url).toContain('client_id=');
  });
});
```

**Step 2-5:** Implement and commit.

---

### Task 12: Add Buxfer processTransactions

**Files:**
- Modify: `backend/src/2_adapters/finance/BuxferAdapter.mjs`
- Reference: `backend/_legacy/lib/buxfer.mjs` batch operations

**Step 1-5:** TDD implementation for batch transaction processing with AI categorization.

---

## Phase 3: Low Priority (P3) - Utilities & Polish

### Task 13: Add YAML Sanitization Utilities

**Files:**
- Create: `backend/src/0_infrastructure/utils/yamlSanitizer.mjs`
- Test: `tests/unit/infrastructure/utils/yamlSanitizer.test.mjs`
- Reference: `backend/_legacy/lib/mediaMemory.mjs:23-64`

**Step 1: Write test**

```javascript
describe('yamlSanitizer', () => {
  describe('sanitizeForYAML', () => {
    it('should remove control characters', () => {
      const { sanitizeForYAML } = await import('...');
      expect(sanitizeForYAML('test\x00string')).toBe('test string');
    });

    it('should handle unicode safely', () => {
      const { sanitizeForYAML } = await import('...');
      expect(sanitizeForYAML('café')).toBe('café');
    });
  });

  describe('sanitizeObjectForYAML', () => {
    it('should recursively sanitize nested objects', () => {
      const { sanitizeObjectForYAML } = await import('...');
      const input = { name: 'test\x00', nested: { value: 'foo\x01bar' } };
      const result = sanitizeObjectForYAML(input);
      expect(result.name).toBe('test ');
      expect(result.nested.value).toBe('foo bar');
    });
  });
});
```

**Step 2-5:** Implement and commit.

---

### Task 14: Add PlexAdapter.loadImgFromKey

**Files:**
- Modify: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs`
- Reference: `backend/_legacy/lib/plex.mjs:432-438`

**Step 1-5:** TDD implementation for thumbnail URL retrieval.

---

### Task 15: Add ThermalPrinterAdapter.testFeedButton

**Files:**
- Modify: `backend/src/2_adapters/hardware/ThermalPrinterAdapter.mjs`
- Reference: `backend/_legacy/lib/thermalprint.mjs`

**Step 1-5:** TDD implementation for test utility.

---

### Task 16: Add Missing Router Endpoints

**Files:**
- Modify: `backend/src/4_api/routers/fetch.mjs` (keyboard endpoint)
- Modify: `backend/src/4_api/routers/media.mjs` (debug table endpoint)

**Step 1-5:** Add low-priority utility endpoints.

---

## Phase 4: Schema Parity Fixes

### Task 17: Update Journaling Entity

**Files:**
- Modify: `backend/src/1_domains/journaling/entities/JournalEntry.mjs`

Add missing `prompts` and `attachments` properties per schema audit.

---

### Task 18: Align Message Entity with Chatbots

**Files:**
- Modify: `backend/src/1_domains/messaging/entities/Message.mjs`

Add `direction` and `attachments` properties per schema audit.

---

## Verification

After completing all tasks:

1. **Run full test suite:**
   ```bash
   npm test
   ```

2. **Re-run parity audit:**
   ```bash
   # Run audit script or manual verification
   ```

3. **Update audit documents:**
   - Update `docs/_wip/audits/2026-01-13-function-parity-audit.md` with 100% status
   - Update `docs/_wip/audits/2026-01-13-schema-parity-audit.md` with fixes

4. **Final commit:**
   ```bash
   git commit -m "docs: mark parity audit complete at 100%"
   ```

---

## Notes

### Intentionally Skipped (by design)

These 11 gaps are architectural decisions, not missing functionality:

1. **Config loading functions** - Handled at server bootstrap level
2. **io.mjs direct usage** - Used internally by DDD adapters
3. **UserDataService functions** - Encapsulated in domain adapters
4. **AI error class hierarchy** - DDD uses simpler error codes
5. **Type guard functions** - Not needed with duck-typing

### Dependencies Between Tasks

- Tasks 1-6 must be done in sequence (FitnessSyncer)
- Task 7 (ShoppingHarvester) is independent
- Tasks 8-9 must be done together (MediaMemoryValidator needs hubSearch)
- Phase 2-3 tasks are independent

### Testing Strategy

- All new adapters implement IHarvester interface
- Circuit breaker pattern for external APIs
- Mock external services in unit tests
- Integration tests for OAuth flows (manual)
