# Lifeplan Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the Lifeplan domain — a living JOP (Joy on Purpose) framework with alignment engine, notification domain, ceremony system, and unified LifeApp frontend.

**Architecture:** DDD with 6 layers (system → adapters → domains → applications → API → frontend). Injectable Clock for time control. Notification domain as cross-cutting transport-agnostic layer. LifelogAggregator extended with range queries. Metric snapshots for drift calculation. All development is TDD with synthetic data and lifecycle simulation.

**Tech Stack:** Node.js (ESM), Express, React, Mantine, YAML persistence, Jest (backend tests), Vitest (frontend tests), Playwright (flow tests), WebSocket (real-time)

**Design Docs:**
- Domain model: `docs/roadmap/2026-01-29-lifeplan-domain-design.md`
- Integration: `docs/plans/2026-03-12-lifeplan-integration-design.md`

**Test Command:** `npm run test:isolated` (runs via `tests/_infrastructure/harnesses/isolated.harness.mjs`)

**Import Aliases:** `#system/*`, `#domains/*`, `#adapters/*`, `#apps/*`, `#api/*` (configured in `jest.config.js`)

---

## Phase 0: Infrastructure

Everything else depends on this. Clock, test utilities, notification skeleton, aggregator extension, LifeApp shell.

---

### Task 0.1: Injectable Clock

**Files:**
- Create: `backend/src/0_system/clock/Clock.mjs`
- Create: `backend/src/0_system/clock/index.mjs`
- Test: `tests/isolated/system/clock.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/isolated/system/clock.test.mjs
import { describe, it, expect, beforeEach } from '@jest/globals';
import { Clock } from '#system/clock/Clock.mjs';

describe('Clock', () => {
  let clock;

  beforeEach(() => {
    clock = new Clock();
  });

  describe('now()', () => {
    it('returns current time when not frozen', () => {
      const before = Date.now();
      const result = clock.now().getTime();
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });

  describe('today()', () => {
    it('returns YYYY-MM-DD string', () => {
      const result = clock.today();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('freeze()', () => {
    it('freezes time at given date string', () => {
      clock.freeze('2025-06-15T10:30:00Z');
      expect(clock.today()).toBe('2025-06-15');
      expect(clock.isFrozen()).toBe(true);
    });

    it('freezes time at given Date object', () => {
      clock.freeze(new Date('2025-06-15'));
      expect(clock.today()).toBe('2025-06-15');
    });

    it('returns same time on repeated calls', () => {
      clock.freeze('2025-06-15T10:30:00Z');
      const first = clock.now().getTime();
      const second = clock.now().getTime();
      expect(first).toBe(second);
    });
  });

  describe('advance()', () => {
    it('advances frozen clock by days', () => {
      clock.freeze('2025-06-15');
      clock.advance('3 days');
      expect(clock.today()).toBe('2025-06-18');
    });

    it('advances frozen clock by hours', () => {
      clock.freeze('2025-06-15T10:00:00Z');
      clock.advance('5 hours');
      expect(clock.now().toISOString()).toContain('T15:00:00');
    });

    it('advances by weeks', () => {
      clock.freeze('2025-06-01');
      clock.advance('2 weeks');
      expect(clock.today()).toBe('2025-06-15');
    });

    it('advances by months (30 days)', () => {
      clock.freeze('2025-06-01');
      clock.advance('1 month');
      expect(clock.today()).toBe('2025-07-01');
    });
  });

  describe('reset()', () => {
    it('unfreezes the clock', () => {
      clock.freeze('2025-06-15');
      clock.reset();
      expect(clock.isFrozen()).toBe(false);
      expect(clock.today()).not.toBe('2025-06-15');
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:isolated -- --pattern=clock
```
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```javascript
// backend/src/0_system/clock/Clock.mjs

const DURATION_MS = {
  day: 86400000,
  days: 86400000,
  hour: 3600000,
  hours: 3600000,
  week: 604800000,
  weeks: 604800000,
  month: 2592000000,   // 30 days
  months: 2592000000,
  minute: 60000,
  minutes: 60000,
};

function parseDuration(str) {
  const match = str.match(/^(\d+)\s*(\w+)$/);
  if (!match) throw new Error(`Invalid duration: ${str}`);
  const [, amount, unit] = match;
  const ms = DURATION_MS[unit.toLowerCase()];
  if (!ms) throw new Error(`Unknown duration unit: ${unit}`);
  return parseInt(amount) * ms;
}

export class Clock {
  #offset = 0;
  #frozen = null;

  now() {
    if (this.#frozen !== null) return new Date(this.#frozen);
    return new Date(Date.now() + this.#offset);
  }

  today() {
    return this.now().toISOString().slice(0, 10);
  }

  freeze(dateOrString) {
    this.#frozen = new Date(dateOrString).getTime();
  }

  advance(duration) {
    const ms = parseDuration(duration);
    if (this.#frozen !== null) {
      this.#frozen += ms;
    } else {
      this.#offset += ms;
    }
  }

  reset() {
    this.#offset = 0;
    this.#frozen = null;
  }

  isFrozen() {
    return this.#frozen !== null;
  }
}

export { parseDuration };
```

```javascript
// backend/src/0_system/clock/index.mjs
export { Clock, parseDuration } from './Clock.mjs';
```

**Step 4: Run test to verify it passes**

```bash
npm run test:isolated -- --pattern=clock
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/clock/ tests/isolated/system/clock.test.mjs
git commit -m "feat(lifeplan): add injectable Clock with freeze/advance for time control"
```

---

### Task 0.2: Test Data Factory — Lifeplan Generator

**Files:**
- Create: `tests/_lib/lifeplan-test-factory.mjs`
- Test: `tests/isolated/lifeplan/test-factory.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/isolated/lifeplan/test-factory.test.mjs
import { describe, it, expect } from '@jest/globals';
import { createTestLifeplan, createMatchingLifelog } from '../../_lib/lifeplan-test-factory.mjs';

describe('createTestLifeplan', () => {
  it('returns a valid lifeplan structure with defaults', () => {
    const plan = createTestLifeplan();
    expect(plan.meta.testdata).toBe(true);
    expect(plan.meta.version).toBe('2.0');
    expect(plan.purpose.statement).toBeTruthy();
    expect(plan.cadence.unit.duration).toBe('1 day');
    expect(plan.values).toHaveLength(5);
    expect(plan.beliefs).toHaveLength(4);
    expect(plan.goals).toHaveLength(5);
  });

  it('respects custom options', () => {
    const plan = createTestLifeplan({ goalCount: 3, beliefCount: 2, valueCount: 3 });
    expect(plan.goals).toHaveLength(3);
    expect(plan.beliefs).toHaveLength(2);
    expect(plan.values).toHaveLength(3);
  });

  it('produces deterministic output with same seed', () => {
    const plan1 = createTestLifeplan({ seed: 99 });
    const plan2 = createTestLifeplan({ seed: 99 });
    expect(JSON.stringify(plan1)).toBe(JSON.stringify(plan2));
  });

  it('produces different output with different seeds', () => {
    const plan1 = createTestLifeplan({ seed: 1 });
    const plan2 = createTestLifeplan({ seed: 2 });
    expect(JSON.stringify(plan1)).not.toBe(JSON.stringify(plan2));
  });

  it('generates goals across multiple states', () => {
    const plan = createTestLifeplan({ goalCount: 6 });
    const states = plan.goals.map(g => g.state);
    expect(states).toContain('dream');
    expect(states).toContain('committed');
  });

  it('generates beliefs with evidence histories', () => {
    const plan = createTestLifeplan({ spanMonths: 6 });
    const beliefWithEvidence = plan.beliefs.find(b => b.evidence && b.evidence.length > 0);
    expect(beliefWithEvidence).toBeTruthy();
  });

  it('includes value_mapping with defaults', () => {
    const plan = createTestLifeplan();
    expect(plan.value_mapping).toBeTruthy();
    expect(plan.value_mapping.category_defaults).toBeTruthy();
  });
});

describe('createMatchingLifelog', () => {
  it('returns date-keyed data for each source', () => {
    const plan = createTestLifeplan({ startDate: '2025-01-01', spanMonths: 1 });
    const lifelog = createMatchingLifelog(plan);
    expect(lifelog.strava).toBeTruthy();
    expect(lifelog.calendar).toBeTruthy();
    expect(lifelog.weight).toBeTruthy();
    // Check date-keyed format
    const firstKey = Object.keys(lifelog.strava)[0];
    expect(firstKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('generates strava activities consistent with fitness goals', () => {
    const plan = createTestLifeplan({ startDate: '2025-01-01', spanMonths: 1 });
    const lifelog = createMatchingLifelog(plan);
    const dates = Object.keys(lifelog.strava);
    expect(dates.length).toBeGreaterThan(0);
    const firstDay = lifelog.strava[dates[0]];
    expect(Array.isArray(firstDay)).toBe(true);
    if (firstDay.length > 0) {
      expect(firstDay[0]).toHaveProperty('title');
      expect(firstDay[0]).toHaveProperty('type');
      expect(firstDay[0]).toHaveProperty('duration');
    }
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:isolated -- --pattern=test-factory
```

**Step 3: Implement the test factory**

Create `tests/_lib/lifeplan-test-factory.mjs` with:
- Seeded PRNG (simple mulberry32) for deterministic output
- `createTestLifeplan(options)` — generates full lifeplan.yml structure
  - Purpose, qualities (3: physical, intellectual, relational), values (ranked), beliefs (with if/then + signals), goals (distributed across states: dream, considered, ready, committed, achieved, abandoned), cadence config, ceremony config, empty feedback/tasks, value_mapping with built-in defaults
  - Goals include state_history with timestamps relative to startDate
  - Beliefs include evidence arrays with confirmation/disconfirmation mix
- `createMatchingLifelog(lifeplan, options)` — generates date-keyed lifelog data
  - strava: activities ~3x/week, with duration, type, avgHR
  - calendar: work events on weekdays, family events on weekends
  - weight: daily measurements with small random variance
  - todoist: task completions per weekday

**Step 4: Run test to verify it passes**

```bash
npm run test:isolated -- --pattern=test-factory
```

**Step 5: Commit**

```bash
git add tests/_lib/lifeplan-test-factory.mjs tests/isolated/lifeplan/test-factory.test.mjs
git commit -m "test(lifeplan): add synthetic data factory with seeded generation"
```

---

### Task 0.3: Clock Test Helper

**Files:**
- Create: `tests/_lib/clock-helper.mjs`

**Step 1: Create utility (no test needed — it's a test utility itself)**

```javascript
// tests/_lib/clock-helper.mjs
import { Clock } from '../../backend/src/0_system/clock/Clock.mjs';

/**
 * Create a frozen clock for testing.
 * @param {string} date - ISO date string to freeze at
 * @returns {Clock}
 */
export function frozenClock(date = '2025-06-01') {
  const clock = new Clock();
  clock.freeze(date);
  return clock;
}

/**
 * Create a clock and advance it through a sequence of steps,
 * calling a callback at each step.
 * @param {string} startDate
 * @param {Array<{advance: string, fn: Function}>} steps
 */
export async function walkClock(startDate, steps) {
  const clock = frozenClock(startDate);
  const results = [];
  for (const step of steps) {
    if (step.advance) clock.advance(step.advance);
    if (step.fn) results.push(await step.fn(clock));
  }
  return { clock, results };
}

export { Clock };
```

**Step 2: Commit**

```bash
git add tests/_lib/clock-helper.mjs
git commit -m "test(lifeplan): add clock-helper utility for frozen/walk patterns"
```

---

### Task 0.4: LifelogAggregator.aggregateRange()

**Files:**
- Modify: `backend/src/3_applications/lifelog/LifelogAggregator.mjs`
- Test: `tests/isolated/lifeplan/aggregator-range.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/isolated/lifeplan/aggregator-range.test.mjs
import { describe, it, expect, beforeEach } from '@jest/globals';
import { LifelogAggregator } from '#apps/lifelog/LifelogAggregator.mjs';

describe('LifelogAggregator.aggregateRange', () => {
  let aggregator;

  const mockLoadFile = (username, filename) => {
    // Simulate date-keyed YAML files
    if (filename === 'strava') {
      return {
        '2025-06-01': [{ title: 'Morning Run', type: 'Run', duration: 30 }],
        '2025-06-02': [{ title: 'Bike Ride', type: 'Ride', duration: 45 }],
        '2025-06-03': [],
      };
    }
    if (filename === 'weight') {
      return {
        '2025-06-01': { lbs: 180 },
        '2025-06-02': { lbs: 179.5 },
      };
    }
    return null;
  };

  beforeEach(() => {
    aggregator = new LifelogAggregator({ userLoadFile: mockLoadFile });
  });

  it('returns data for each day in range', async () => {
    const result = await aggregator.aggregateRange('testuser', '2025-06-01', '2025-06-03');
    expect(result.startDate).toBe('2025-06-01');
    expect(result.endDate).toBe('2025-06-03');
    expect(Object.keys(result.days)).toHaveLength(3);
    expect(result.days['2025-06-01']).toBeTruthy();
    expect(result.days['2025-06-02']).toBeTruthy();
    expect(result.days['2025-06-03']).toBeTruthy();
  });

  it('includes source data per day', async () => {
    const result = await aggregator.aggregateRange('testuser', '2025-06-01', '2025-06-01');
    const day = result.days['2025-06-01'];
    expect(day.sources.strava).toBeTruthy();
  });

  it('reports metadata', async () => {
    const result = await aggregator.aggregateRange('testuser', '2025-06-01', '2025-06-03');
    expect(result._meta.username).toBe('testuser');
    expect(result._meta.dayCount).toBe(3);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test:isolated -- --pattern=aggregator-range
```
Expected: FAIL — `aggregateRange` is not a function

**Step 3: Add aggregateRange() to LifelogAggregator**

Read the existing file first. Add the new method without modifying `aggregate()`. Key implementation:
- Load all source files in parallel via `Promise.all`
- Generate date range array (inclusive)
- For each date, call existing extractor `extractForDate()` on pre-loaded data
- Return `{ startDate, endDate, days: { [date]: { sources, summaries, categories } }, _meta }`

**Step 4: Run test to verify it passes**

```bash
npm run test:isolated -- --pattern=aggregator-range
```

**Step 5: Run existing lifelog tests to ensure no regression**

```bash
npm run test:isolated -- --pattern=lifelog
```

**Step 6: Commit**

```bash
git add backend/src/3_applications/lifelog/LifelogAggregator.mjs tests/isolated/lifeplan/aggregator-range.test.mjs
git commit -m "feat(lifelog): add aggregateRange() for multi-day parallel aggregation"
```

---

### Task 0.5: Notification Domain — Value Objects

**Files:**
- Create: `backend/src/2_domains/notification/value-objects/NotificationChannel.mjs`
- Create: `backend/src/2_domains/notification/value-objects/NotificationUrgency.mjs`
- Create: `backend/src/2_domains/notification/value-objects/NotificationCategory.mjs`
- Create: `backend/src/2_domains/notification/value-objects/index.mjs`
- Test: `tests/isolated/notification/value-objects.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/isolated/notification/value-objects.test.mjs
import { describe, it, expect } from '@jest/globals';
import { NotificationChannel } from '#domains/notification/value-objects/NotificationChannel.mjs';
import { NotificationUrgency } from '#domains/notification/value-objects/NotificationUrgency.mjs';
import { NotificationCategory } from '#domains/notification/value-objects/NotificationCategory.mjs';

describe('NotificationChannel', () => {
  it('defines valid channels', () => {
    expect(NotificationChannel.TELEGRAM).toBe('telegram');
    expect(NotificationChannel.EMAIL).toBe('email');
    expect(NotificationChannel.PUSH).toBe('push');
    expect(NotificationChannel.APP).toBe('app');
  });

  it('validates known channels', () => {
    expect(NotificationChannel.isValid('telegram')).toBe(true);
    expect(NotificationChannel.isValid('carrier_pigeon')).toBe(false);
  });

  it('returns all channels', () => {
    expect(NotificationChannel.values()).toEqual(['telegram', 'email', 'push', 'app']);
  });
});

describe('NotificationUrgency', () => {
  it('defines urgency levels', () => {
    expect(NotificationUrgency.LOW).toBe('low');
    expect(NotificationUrgency.NORMAL).toBe('normal');
    expect(NotificationUrgency.HIGH).toBe('high');
    expect(NotificationUrgency.CRITICAL).toBe('critical');
  });

  it('validates known urgencies', () => {
    expect(NotificationUrgency.isValid('high')).toBe(true);
    expect(NotificationUrgency.isValid('panic')).toBe(false);
  });
});

describe('NotificationCategory', () => {
  it('defines categories', () => {
    expect(NotificationCategory.CEREMONY).toBe('ceremony');
    expect(NotificationCategory.DRIFT_ALERT).toBe('drift_alert');
    expect(NotificationCategory.GOAL_UPDATE).toBe('goal_update');
    expect(NotificationCategory.SYSTEM).toBe('system');
  });
});
```

**Step 2: Run to fail, then implement**

Each value object follows the same enum pattern:
```javascript
export const NotificationChannel = Object.freeze({
  TELEGRAM: 'telegram',
  EMAIL: 'email',
  PUSH: 'push',
  APP: 'app',
  values() { return ['telegram', 'email', 'push', 'app']; },
  isValid(v) { return this.values().includes(v); },
});
```

**Step 3: Run tests, commit**

```bash
git add backend/src/2_domains/notification/ tests/isolated/notification/
git commit -m "feat(notification): add value objects for channel, urgency, category"
```

---

### Task 0.6: Notification Domain — Entities

**Files:**
- Create: `backend/src/2_domains/notification/entities/NotificationIntent.mjs`
- Create: `backend/src/2_domains/notification/entities/NotificationPreference.mjs`
- Create: `backend/src/2_domains/notification/entities/index.mjs`
- Test: `tests/isolated/notification/entities.test.mjs`

**Step 1: Write tests for NotificationIntent and NotificationPreference**

Test NotificationIntent:
- Construction with title, body, category, urgency, actions[], metadata
- Validates category and urgency against value objects
- `toJSON()` serialization

Test NotificationPreference:
- Construction from preference config YAML structure
- `getChannelsFor(category, urgency)` returns correct channel array
- Falls back to 'normal' urgency if specific urgency not configured
- Returns `['app']` as ultimate fallback if no preference configured

**Step 2: Implement, test, commit**

```bash
git commit -m "feat(notification): add NotificationIntent and NotificationPreference entities"
```

---

### Task 0.7: Notification Domain — Router, Port, Service

**Files:**
- Create: `backend/src/3_applications/notification/ports/INotificationChannel.mjs`
- Create: `backend/src/3_applications/notification/ports/INotificationPreferenceStore.mjs`
- Create: `backend/src/3_applications/notification/NotificationService.mjs`
- Create: `backend/src/1_adapters/notification/AppNotificationAdapter.mjs`
- Create: `backend/src/1_adapters/notification/TelegramNotificationAdapter.mjs`
- Create: `backend/src/1_adapters/notification/EmailNotificationAdapter.mjs`
- Create: `backend/src/1_adapters/notification/PushNotificationAdapter.mjs`
- Create: `backend/src/3_applications/notification/NotificationContainer.mjs`
- Test: `tests/isolated/notification/routing.test.mjs`
- Test: `tests/isolated/notification/preference-resolution.test.mjs`

**Step 1: Write tests for NotificationService**

Test routing:
- Sends to telegram adapter when preference says telegram
- Sends to multiple channels when preference says [telegram, app]
- Skeleton adapters (email, push) return `{ delivered: false, error: 'not configured' }`
- AppNotificationAdapter calls `eventBus.broadcast('notification', payload)`

Test preference resolution:
- Resolves (ceremony, normal) → [telegram]
- Resolves (drift_alert, critical) → [telegram, app, email]
- Falls back when urgency not found
- Falls back to [app] when category not found

**Step 2: Implement port interfaces, service, adapters, container**

- `INotificationChannel`: interface with `send(intent)` → `{ delivered, channelId, error? }`
- `NotificationService`: loads preferences, resolves channels, dispatches to adapters
- `AppNotificationAdapter`: wraps `WebSocketEventBus.broadcast()`
- `TelegramNotificationAdapter`: wraps existing `TelegramAdapter.sendMessage()`
- `EmailNotificationAdapter` / `PushNotificationAdapter`: skeleton, returns not-configured
- `NotificationContainer`: DI container wiring all pieces

**Step 3: Test, commit**

```bash
git commit -m "feat(notification): add NotificationService with routing, adapters, and container"
```

---

### Task 0.8: Notification API Router

**Files:**
- Create: `backend/src/4_api/v1/routers/notification.mjs`
- Test: `tests/isolated/api/routers/notification.test.mjs`

**Step 1: Write test for router endpoints**

Test:
- `GET /preferences` returns user's notification preferences
- `PATCH /preferences` updates preferences
- `GET /pending` returns undelivered in-app notifications
- `POST /dismiss/:id` marks notification as dismissed

**Step 2: Implement router following existing pattern** (`createNotificationRouter(config)`)

**Step 3: Test, commit**

```bash
git commit -m "feat(notification): add /api/v1/notification router"
```

---

### Task 0.9: LifeApp Frontend Shell + Route Setup

**Files:**
- Delete: `frontend/src/Apps/LifelogApp.jsx`
- Create: `frontend/src/Apps/LifeApp.jsx`
- Modify: `frontend/src/main.jsx` (replace `/lifelog` route with `/life/*`)
- Create: `frontend/src/modules/Life/context/LifeAppContext.jsx`
- Create: `frontend/src/modules/Life/views/now/NowView.jsx` (placeholder)
- Create: `frontend/src/modules/Life/views/log/LogTimeline.jsx` (placeholder)
- Create: `frontend/src/modules/Life/views/plan/PlanOverview.jsx` (placeholder)

**Step 1: Create LifeApp shell**

```jsx
// frontend/src/Apps/LifeApp.jsx
import React, { useMemo } from 'react';
import { MantineProvider, AppShell } from '@mantine/core';
import { Outlet, Navigate, Routes, Route } from 'react-router-dom';
import '@mantine/core/styles.css';
import { getChildLogger } from '../lib/logging/singleton.js';

const LifeApp = () => {
  const logger = useMemo(() => getChildLogger({ app: 'life' }), []);

  return (
    <MantineProvider>
      <AppShell header={{ height: 48 }} navbar={{ width: 220 }}>
        <AppShell.Header>
          {/* LifeAppHeader placeholder */}
        </AppShell.Header>
        <AppShell.Navbar>
          {/* LifeAppNav placeholder */}
        </AppShell.Navbar>
        <AppShell.Main>
          <Routes>
            <Route index element={<Navigate to="now" />} />
            <Route path="now" element={<div>Now — coming soon</div>} />
            <Route path="log" element={<div>Log — coming soon</div>} />
            <Route path="plan" element={<div>Plan — coming soon</div>} />
          </Routes>
        </AppShell.Main>
      </AppShell>
    </MantineProvider>
  );
};

export default LifeApp;
```

**Step 2: Update main.jsx routing**

Replace:
```jsx
<Route path="/lifelog" element={<LifelogApp />} />
```
With:
```jsx
<Route path="/life/*" element={<LifeApp />} />
```

Update import from `LifelogApp` to `LifeApp`.

**Step 3: Delete `frontend/src/Apps/LifelogApp.jsx`**

**Step 4: Commit**

```bash
git commit -m "feat(life): rename LifelogApp→LifeApp, set up /life/* route shell"
```

---

## Phase 1: Foundation — Domain Entities & State Machines

Core domain model. All entities, value objects, domain services, persistence, and plan CRUD API.

---

### Task 1.1: Lifeplan Value Objects

**Files:**
- Create: `backend/src/2_domains/lifeplan/value-objects/GoalState.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/BeliefState.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/AlignmentState.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/EvidenceType.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/CeremonyType.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/CadenceLevel.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/DependencyType.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/LifeEventType.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/LifeEventImpact.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/LifeEventDuration.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/AttributionBias.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/BiasStatus.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/BeliefOriginType.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/ShadowState.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/NightmareProximity.mjs`
- Create: `backend/src/2_domains/lifeplan/value-objects/index.mjs`
- Test: `tests/isolated/lifeplan/entities/value-objects.test.mjs`

Follow the same enum pattern as notification value objects. Key ones:

**GoalState** must include valid transitions map:
```javascript
export const GOAL_TRANSITIONS = {
  dream: ['considered', 'abandoned', 'invalidated'],
  considered: ['ready', 'dream', 'abandoned', 'invalidated'],
  ready: ['committed', 'considered', 'abandoned', 'invalidated'],
  committed: ['achieved', 'failed', 'paused', 'abandoned', 'invalidated'],
  paused: ['committed', 'abandoned', 'invalidated'],
  failed: ['considered', 'invalidated'],
  achieved: [],
  abandoned: [],
  invalidated: [],
};
```

**BeliefState** must include cascade states:
```javascript
export const BELIEF_TRANSITIONS = {
  hypothesized: ['testing', 'dormant'],
  testing: ['confirmed', 'uncertain', 'refuted'],
  confirmed: ['testing', 'questioning'],
  uncertain: ['testing', 'questioning'],
  refuted: ['revised', 'abandoned'],
  dormant: ['testing', 'abandoned'],
  questioning: ['testing', 'revised', 'abandoned'],
  revised: ['testing'],
  abandoned: [],
};
```

Test that transitions are valid, invalid transitions throw, terminal states have no transitions.

```bash
git commit -m "feat(lifeplan): add all domain value objects with transition maps"
```

---

### Task 1.2: Goal Entity

**Files:**
- Create: `backend/src/2_domains/lifeplan/entities/Goal.mjs`
- Test: `tests/isolated/lifeplan/entities/goal-state-machine.test.mjs`

**Test coverage:**
- Construction from YAML data (all states)
- `transition(newState, reason)` — valid transitions succeed, invalid throw
- Auto-populates `state_history` on transition
- Required fields per state (committed requires deadline, metrics, sacrifice)
- `isTerminal()` returns true for achieved/abandoned/invalidated
- `isBlocked()` checks dependencies
- `toJSON()` / `fromJSON()` round-trip
- Progress calculation from metrics

```bash
git commit -m "feat(lifeplan): add Goal entity with state machine and transitions"
```

---

### Task 1.3: Belief Entity

**Files:**
- Create: `backend/src/2_domains/lifeplan/entities/Belief.mjs`
- Test: `tests/isolated/lifeplan/entities/belief-evidence.test.mjs`

**Test coverage:**
- Construction with if/then, signals, confidence, evidence history
- `addEvidence(evidence)` updates confidence based on evidence type matrix
- Effective confidence calculation (raw - bias adjustments - sample penalty)
- Dormancy detection (>60 days untested → dormant)
- State transitions (hypothesized → testing → confirmed/uncertain/refuted)
- Foundational flag and `depends_on` tracking
- `toJSON()` / `fromJSON()` round-trip

```bash
git commit -m "feat(lifeplan): add Belief entity with evidence and confidence model"
```

---

### Task 1.4: Value, Quality, Rule, Purpose Entities

**Files:**
- Create: `backend/src/2_domains/lifeplan/entities/Value.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/Quality.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/Rule.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/Purpose.mjs`
- Test: `tests/isolated/lifeplan/entities/value-drift.test.mjs`
- Test: `tests/isolated/lifeplan/entities/quality-rules.test.mjs`

**Value tests:**
- Ranked ordering, `conflicts_with` tracking, `justified_by` beliefs
- Alignment state (aligned/drifting/reconsidering)

**Quality tests:**
- Principles, rules collection, shadow quality tracking
- `grounded_in` beliefs and values

**Rule tests:**
- Trigger/action pairs, effectiveness stats, state transitions
- `evaluateEffectiveness()` returns effective/mixed/ineffective/not_followed

**Purpose tests:**
- Statement, `grounded_in` beliefs/values, review tracking

```bash
git commit -m "feat(lifeplan): add Value, Quality, Rule, Purpose entities"
```

---

### Task 1.5: Supporting Entities (Dependency, LifeEvent, AntiGoal, Milestone, etc.)

**Files:**
- Create: `backend/src/2_domains/lifeplan/entities/Dependency.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/LifeEvent.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/AntiGoal.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/Milestone.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/BeliefOrigin.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/Shadow.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/Ceremony.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/CeremonyRecord.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/Cycle.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/FeedbackEntry.mjs`
- Create: `backend/src/2_domains/lifeplan/entities/LifePlan.mjs` (aggregate root)
- Create: `backend/src/2_domains/lifeplan/entities/index.mjs`
- Test: `tests/isolated/lifeplan/entities/supporting-entities.test.mjs`

**LifePlan** is the aggregate root that holds all collections. Test:
- Construction from full YAML structure (using test factory data)
- `getGoalsByState(state)`, `getActiveGoals()`, `getBeliefById(id)`
- `toJSON()` produces valid YAML-serializable output
- `fromJSON()` round-trip with factory data

```bash
git commit -m "feat(lifeplan): add supporting entities and LifePlan aggregate root"
```

---

### Task 1.6: GoalStateService (Domain Service)

**Files:**
- Create: `backend/src/2_domains/lifeplan/services/GoalStateService.mjs`
- Test: `tests/isolated/lifeplan/services/goal-state-service.test.mjs`

**Test coverage:**
- `transition(goal, newState, reason, clock)` — validates, transitions, records history
- Automatic transitions: considered→ready when all deps clear
- Automatic transitions: ready→considered when new dep added
- Commitment gate validation (checks required fields)
- Progress evaluation (on_track/at_risk/behind)

```bash
git commit -m "feat(lifeplan): add GoalStateService with transition validation"
```

---

### Task 1.7: BeliefEvaluator (Domain Service)

**Files:**
- Create: `backend/src/2_domains/lifeplan/services/BeliefEvaluator.mjs`
- Test: `tests/isolated/lifeplan/services/belief-evaluator.test.mjs`

**Test coverage:**
- `evaluateEvidence(belief, evidence)` — applies confidence deltas
- Evidence type matrix (confirmation +0.02-0.05, disconfirmation -0.05-0.10, spurious -0.10-0.15)
- Dormancy decay calculation (~2% per month after 60 days)
- Effective confidence with bias adjustments
- `canTransitionToConfirmed(belief)` — blocked if bias > 30% or sample < 5

```bash
git commit -m "feat(lifeplan): add BeliefEvaluator with evidence and dormancy logic"
```

---

### Task 1.8: DependencyResolver & BeliefCascadeProcessor

**Files:**
- Create: `backend/src/2_domains/lifeplan/services/DependencyResolver.mjs`
- Create: `backend/src/2_domains/lifeplan/services/BeliefCascadeProcessor.mjs`
- Test: `tests/isolated/lifeplan/services/dependency-resolver.test.mjs`
- Test: `tests/isolated/lifeplan/services/belief-cascade.test.mjs`

**DependencyResolver tests:**
- `isGoalReady(goal, dependencies, goals, lifeEvents)` — checks all deps satisfied
- Prerequisite: requires_goal must be achieved
- Life event: awaits_event must have status=occurred
- Resource: current >= threshold
- Recommended: can be overridden

**BeliefCascadeProcessor tests:**
- `processBelief Refutation(belief, allBeliefs, values, qualities, purpose)`:
  - Non-foundational refutation does not cascade
  - Foundational refutation → dependent beliefs enter 'questioning'
  - Values justified_by refuted belief → flagged for review
  - Qualities grounded_in refuted belief → flagged for review
  - Purpose grounded_in refuted belief → triggers emergency_retro
  - Paradigm collapse (3+ foundational refuted in season) → emergency_retro

```bash
git commit -m "feat(lifeplan): add DependencyResolver and BeliefCascadeProcessor"
```

---

### Task 1.9: CadenceService

**Files:**
- Create: `backend/src/2_domains/lifeplan/services/CadenceService.mjs`
- Test: `tests/isolated/lifeplan/services/cadence-service.test.mjs`

**Test coverage (uses frozen clock):**
- `resolve(cadenceConfig, today)` — returns current position in all cadence levels
- `currentPeriodId(timing)` — returns unique period ID (e.g., "2025-C12" for cycle 12)
- `isCeremonyDue(type, ceremony, cadence)` — checks if ceremony should fire
- `getNextCeremonyTime(type, ceremony, cadence)` — when is next ceremony due
- Handles custom cadence durations (not just 7-day weeks)

```bash
git commit -m "feat(lifeplan): add CadenceService with flexible cadence resolution"
```

---

### Task 1.10: YamlLifePlanStore

**Files:**
- Create: `backend/src/1_adapters/persistence/yaml/YamlLifePlanStore.mjs`
- Create: `backend/src/1_adapters/persistence/yaml/YamlLifeplanMetricsStore.mjs`
- Create: `backend/src/1_adapters/persistence/yaml/YamlCeremonyRecordStore.mjs`
- Test: `tests/isolated/lifeplan/persistence/yaml-stores.test.mjs`

**Pattern:** Follow `YamlSessionDatastore` — extends port interface, uses `loadYamlSafe`/`saveYaml` from FileIO utils.

**Test coverage:**
- `load(username)` — reads lifeplan.yml, returns LifePlan entity
- `save(username, lifeplan)` — writes lifeplan.yml
- `load()` returns null if file doesn't exist
- Metrics store: `getLatest()`, `saveSnapshot()`, `getHistory()`
- Ceremony record store: `hasRecord()`, `saveRecord()`

Use tmp directories for test isolation.

```bash
git commit -m "feat(lifeplan): add YAML persistence stores for plan, metrics, ceremonies"
```

---

### Task 1.11: Life Plan API Router

**Files:**
- Create: `backend/src/4_api/v1/routers/life.mjs` (parent router mounting sub-routers)
- Create: `backend/src/4_api/v1/routers/life/plan.mjs`
- Test: `tests/isolated/api/routers/life-plan.test.mjs`

**Endpoints to implement:**
- `GET /` — full plan
- `PATCH /:section` — update section
- `GET /goals` — all goals by state
- `GET /goals/:goalId` — single goal
- `POST /goals/:goalId/transition` — state transition
- `GET /beliefs` — all beliefs
- `POST /beliefs/:id/evidence` — add evidence
- `GET /cadence` — cadence config
- `PATCH /cadence` — update cadence

Wire into bootstrap via `life.mjs` parent router.

```bash
git commit -m "feat(lifeplan): add /api/v1/life/plan router with CRUD endpoints"
```

---

### Task 1.12: LifeplanContainer (DI)

**Files:**
- Create: `backend/src/3_applications/lifeplan/LifeplanContainer.mjs`
- Create: `backend/src/3_applications/lifeplan/ports/ILifePlanRepository.mjs`
- Create: `backend/src/3_applications/lifeplan/ports/ICeremonyRecordRepository.mjs`
- Create: `backend/src/3_applications/lifeplan/ports/IMetricSource.mjs`
- Create: `backend/src/3_applications/lifeplan/ports/index.mjs`

**Pattern:** Follow `JournalistContainer` — private fields, lazy-loaded use cases, dependency validation.

```bash
git commit -m "feat(lifeplan): add LifeplanContainer DI and port interfaces"
```

---

## Phase 2: Alignment Engine

ValueDriftCalculator, categorization mapping, AlignmentService, metric snapshots, /life/now endpoints, dashboard UI.

---

### Task 2.1: ValueDriftCalculator

**Files:**
- Create: `backend/src/2_domains/lifeplan/services/ValueDriftCalculator.mjs`
- Test: `tests/isolated/lifeplan/services/drift-detection.test.mjs`

**Test coverage (uses test factory data + frozen clock):**
- `calculateAllocation(lifelogRange, valueMapping, values)` — returns proportional allocation
- Built-in defaults used when no user mapping
- User overrides take precedence
- Calendar rules match by calendarName and summary_contains
- Extractor overrides are highest priority
- `null` mapping excludes source from allocation
- `calculateDrift(allocation, values)` — returns Spearman correlation + status
- Correlation > 0.8 = aligned, 0.5-0.8 = drifting, < 0.5 = reconsidering
- Minute estimation per source type

```bash
git commit -m "feat(lifeplan): add ValueDriftCalculator with categorization mapping"
```

---

### Task 2.2: DriftService (Application)

**Files:**
- Create: `backend/src/3_applications/lifeplan/services/DriftService.mjs`
- Test: `tests/isolated/lifeplan/services/drift-service.test.mjs`

**Test coverage:**
- `computeAndSave(username)` — calls aggregateRange for current cycle, computes snapshot, persists
- `getLatestSnapshot(username)` — reads from metrics store
- `getHistory(username)` — returns cycle-over-cycle history
- Uses clock for date resolution

```bash
git commit -m "feat(lifeplan): add DriftService for snapshot computation and persistence"
```

---

### Task 2.3: AlignmentService

**Files:**
- Create: `backend/src/3_applications/lifeplan/services/AlignmentService.mjs`
- Test: `tests/isolated/lifeplan/services/alignment-engine.test.mjs`

**Test coverage:**
- `computeAlignment(username)` returns priorities, dashboard, briefingContext
- Priority scoring: forcing functions ranked highest, then ceremonies, then goal actions
- Value-aligned items score higher
- Urgency boosts score
- Dashboard includes drift, goal progress, belief summaries, ceremony adherence
- Briefing context includes all data needed for AI generation

```bash
git commit -m "feat(lifeplan): add AlignmentService with priority scoring"
```

---

### Task 2.4: Life Now API Router

**Files:**
- Create: `backend/src/4_api/v1/routers/life/now.mjs`
- Test: `tests/isolated/api/routers/life-now.test.mjs`

**Endpoints:**
- `GET /?mode=priorities|dashboard|briefing`
- `GET /drift`
- `GET /drift/history`
- `POST /drift/refresh`
- `GET /rules/applicable`

```bash
git commit -m "feat(lifeplan): add /api/v1/life/now router with alignment endpoints"
```

---

### Task 2.5: Dashboard Frontend View

**Files:**
- Create: `frontend/src/modules/Life/hooks/useAlignment.js`
- Create: `frontend/src/modules/Life/hooks/useDrift.js`
- Create: `frontend/src/modules/Life/views/now/Dashboard.jsx`
- Create: `frontend/src/modules/Life/views/now/PriorityList.jsx`
- Create: `frontend/src/modules/Life/widgets/DriftGauge.jsx`
- Create: `frontend/src/modules/Life/widgets/GoalProgressBar.jsx`
- Create: `frontend/src/modules/Life/widgets/BeliefConfidenceChip.jsx`
- Create: `frontend/src/modules/Life/widgets/CadenceIndicator.jsx`
- Create: `frontend/src/modules/Life/widgets/ValueAllocationChart.jsx`

**Implementation:**
- `useAlignment(mode)` — calls `GET /api/v1/life/now?mode=...`, returns `{ data, loading, error, refetch }`
- `useDrift()` — calls `GET /api/v1/life/now/drift`
- Dashboard renders: CadenceIndicator, DriftGauge, PriorityList (top 5), GoalProgressBar per active goal, BeliefConfidenceChip per belief
- PriorityList renders ranked action cards with type icon, title, reason, score
- All use Mantine components (Paper, Stack, Group, Progress, Badge, Text)

```bash
git commit -m "feat(life): add Dashboard and PriorityList views with alignment hooks"
```

---

## Phase 3: Log Views

Lifelog range/scope/category endpoints and all log view components.

---

### Task 3.1: Life Log API Router

**Files:**
- Create: `backend/src/4_api/v1/routers/life/log.mjs`
- Test: `tests/isolated/api/routers/life-log.test.mjs`

**Endpoints:**
- `GET /:username/:date` — single day (wraps existing aggregator)
- `GET /:username/range?start=&end=` — date range
- `GET /:username/scope/:scope` — week|month|season|year|decade
- `GET /:username/scope/:scope?at=YYYY-MM` — specific period
- `GET /:username/category/:category?start=&end=` — category filtered
- `GET /:username/category/:category?scope=month` — category + scope
- `GET /sources` — available extractors

Scope resolution:
- week → 7 days back from today
- month → 30 days back
- season → 90 days back
- year → reads from monthly rollups in lifeplan-metrics.yml
- decade → reads from yearly rollups

```bash
git commit -m "feat(life): add /api/v1/life/log router with range, scope, category"
```

---

### Task 3.2: Log Shared Components

**Files:**
- Create: `frontend/src/modules/Life/hooks/useLifelog.js`
- Create: `frontend/src/modules/Life/views/log/shared/ScopeSelector.jsx`
- Create: `frontend/src/modules/Life/views/log/shared/CategoryFilter.jsx`
- Create: `frontend/src/modules/Life/views/log/shared/SourceIcon.jsx`
- Create: `frontend/src/modules/Life/views/log/shared/ActivityHeatmap.jsx`

- `useLifelog({ date, start, end, scope, category })` — unified hook for all log queries
- `ScopeSelector` — segmented control: Day | Week | Month | Season | Year | Decade
- `CategoryFilter` — checkbox group for extractor categories
- `SourceIcon` — maps source name to icon
- `ActivityHeatmap` — GitHub-style contribution heatmap (reusable across scopes)

```bash
git commit -m "feat(life): add log shared components (ScopeSelector, CategoryFilter, Heatmap)"
```

---

### Task 3.3: Log Day/Week/Month Views

**Files:**
- Create: `frontend/src/modules/Life/views/log/LogTimeline.jsx`
- Create: `frontend/src/modules/Life/views/log/LogDayDetail.jsx`
- Create: `frontend/src/modules/Life/views/log/LogWeekView.jsx`
- Create: `frontend/src/modules/Life/views/log/LogMonthView.jsx`
- Create: `frontend/src/modules/Life/views/log/LogBrowser.jsx`

```bash
git commit -m "feat(life): add log day, week, month views"
```

---

### Task 3.4: Log Season/Year/Decade Views

**Files:**
- Create: `frontend/src/modules/Life/views/log/LogSeasonView.jsx`
- Create: `frontend/src/modules/Life/views/log/LogYearView.jsx`
- Create: `frontend/src/modules/Life/views/log/LogDecadeView.jsx`
- Create: `frontend/src/modules/Life/views/log/LogCategoryView.jsx`

```bash
git commit -m "feat(life): add log season, year, decade, category views"
```

---

### Task 3.5: Wire Log Routes into LifeApp

**Files:**
- Modify: `frontend/src/Apps/LifeApp.jsx`

Add all log routes with actual view components replacing placeholders. Add LifeAppNav sidebar with navigation links.

```bash
git commit -m "feat(life): wire log views into LifeApp router and nav"
```

---

## Phase 4: Plan Management UI

Frontend views for managing the lifeplan — goals, beliefs, values, qualities, ceremonies.

---

### Task 4.1: Plan Hooks

**Files:**
- Create: `frontend/src/modules/Life/hooks/useLifePlan.js`

- `useLifePlan()` — fetches full plan, provides mutation helpers
- `useGoals()` — fetches goals grouped by state
- `useGoalDetail(goalId)` — single goal with metrics, milestones
- `useBeliefs()` — fetches beliefs
- `useCeremonyConfig()` — ceremony preferences + adherence

```bash
git commit -m "feat(life): add plan management hooks"
```

---

### Task 4.2: Plan Views — Purpose, Qualities, Values

**Files:**
- Create: `frontend/src/modules/Life/views/plan/PurposeView.jsx`
- Create: `frontend/src/modules/Life/views/plan/QualitiesView.jsx`
- Create: `frontend/src/modules/Life/views/plan/ValuesView.jsx`

- PurposeView: displays statement, grounded_in, review history, edit capability
- QualitiesView: qualities with expandable rules list, shadow indicators, effectiveness stats
- ValuesView: ranked values with drag-to-reorder (using `@mantine/core` Draggable or simple move up/down buttons), conflict resolution display

```bash
git commit -m "feat(life): add Purpose, Qualities, Values plan views"
```

---

### Task 4.3: Plan Views — Beliefs, Goals

**Files:**
- Create: `frontend/src/modules/Life/views/plan/BeliefsView.jsx`
- Create: `frontend/src/modules/Life/views/plan/GoalsView.jsx`
- Create: `frontend/src/modules/Life/views/plan/GoalDetail.jsx`

- BeliefsView: card per belief showing if/then, confidence bar, state badge, evidence timeline
- GoalsView: grouped by state columns (kanban-style) — dream | considered | ready | committed | achieved/failed/abandoned
- GoalDetail: full view with milestones, metrics, dependencies, state history, retrospective

```bash
git commit -m "feat(life): add Beliefs and Goals plan views"
```

---

### Task 4.4: Plan Views — Ceremony Config

**Files:**
- Create: `frontend/src/modules/Life/views/plan/CeremonyConfig.jsx`

- Ceremony config: enable/disable per ceremony type, set timing, set channel
- Adherence display: streak counts, phase adherence percentages

```bash
git commit -m "feat(life): add CeremonyConfig plan view"
```

---

### Task 4.5: Wire Plan Routes into LifeApp

**Files:**
- Modify: `frontend/src/Apps/LifeApp.jsx`

Add all plan routes with actual view components.

```bash
git commit -m "feat(life): wire plan views into LifeApp router and nav"
```

---

## Phase 5: Feedback & Ceremonies

CeremonyService, CeremonyScheduler, ceremony flow UI, feedback capture.

---

### Task 5.1: CeremonyService & CeremonyScheduler

**Files:**
- Create: `backend/src/3_applications/lifeplan/services/CeremonyService.mjs`
- Create: `backend/src/0_system/scheduling/CeremonyScheduler.mjs`
- Test: `tests/isolated/lifeplan/services/ceremony-scheduling.test.mjs`

**CeremonyService tests:**
- `getCeremonyContent(type, username)` — assembles data for ceremony prompts
- `completeCeremony(type, username, responses)` — records completion, processes responses
- Unit intention: returns calendar, active goals, applicable rules
- Cycle retro: returns goal progress, belief evidence, value drift, rule effectiveness

**CeremonyScheduler tests (uses frozen clock):**
- `checkAndNotify()` — sends notification when ceremony is due
- Skips already-completed ceremonies
- Respects enabled/disabled config
- Cadence-relative timing (not fixed cron)

```bash
git commit -m "feat(lifeplan): add CeremonyService and CeremonyScheduler"
```

---

### Task 5.2: FeedbackService & RetroService

**Files:**
- Create: `backend/src/3_applications/lifeplan/services/FeedbackService.mjs`
- Create: `backend/src/3_applications/lifeplan/services/RetroService.mjs`
- Test: `tests/isolated/lifeplan/services/feedback-service.test.mjs`

**FeedbackService:** record observation, link to plan element (goal/belief/value/quality), optionally spawn rules from friction entries

**RetroService:** generate retrospective content for given period — aggregates feedback, drift, goal status, belief evidence

```bash
git commit -m "feat(lifeplan): add FeedbackService and RetroService"
```

---

### Task 5.3: Ceremony API Endpoints

**Files:**
- Modify: `backend/src/4_api/v1/routers/life/plan.mjs`

Add:
- `GET /ceremony/:type` — get ceremony content
- `POST /ceremony/:type/complete` — record completion
- `POST /feedback` — record observation
- `GET /feedback?period=cycle` — get feedback
- `GET /retro?period=cycle` — generate retrospective

```bash
git commit -m "feat(lifeplan): add ceremony and feedback API endpoints"
```

---

### Task 5.4: Ceremony Flow UI

**Files:**
- Create: `frontend/src/modules/Life/hooks/useCeremony.js`
- Create: `frontend/src/modules/Life/views/ceremony/CeremonyFlow.jsx`
- Create: `frontend/src/modules/Life/views/ceremony/UnitIntention.jsx`
- Create: `frontend/src/modules/Life/views/ceremony/UnitCapture.jsx`
- Create: `frontend/src/modules/Life/views/ceremony/CycleRetro.jsx`
- Create: `frontend/src/modules/Life/views/ceremony/PhaseReview.jsx`

- `useCeremony(type)` — fetches ceremony content, manages step state, submits responses
- `CeremonyFlow` — full-screen step-by-step conductor: shows one prompt at a time with relevant context, collects responses, POSTs completion
- Each ceremony type component renders type-specific prompts and context panels

```bash
git commit -m "feat(life): add ceremony flow UI with step-by-step conductor"
```

---

### Task 5.5: Register Scheduled Jobs

**Files:**
- Create: `backend/src/0_system/bootstrap/lifeplan.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` (import and call bootstrapLifeplan)

Wire all pieces together:
- Register 5 scheduled jobs (evidence collection, daily snapshot, ceremony check, forcing functions, monthly rollup)
- Create LifeplanContainer with all dependencies
- Mount life.mjs router
- Mount notification.mjs router

```bash
git commit -m "feat(lifeplan): add bootstrap wiring and scheduled job registration"
```

---

## Phase 6: External Integration & Lifecycle Testing

Metric adapters, signal detection, AI briefing, lifecycle simulation test suite.

---

### Task 6.1: Remaining Domain Services

**Files:**
- Create: `backend/src/2_domains/lifeplan/services/RuleMatchingService.mjs`
- Create: `backend/src/2_domains/lifeplan/services/ProgressCalculator.mjs`
- Create: `backend/src/2_domains/lifeplan/services/LifeEventProcessor.mjs`
- Create: `backend/src/2_domains/lifeplan/services/BiasCalibrationService.mjs`
- Create: `backend/src/2_domains/lifeplan/services/ShadowDetectionService.mjs`
- Create: `backend/src/2_domains/lifeplan/services/NightmareProximityService.mjs`
- Create: `backend/src/2_domains/lifeplan/services/PastProcessingService.mjs`
- Create: `backend/src/2_domains/lifeplan/services/index.mjs`
- Tests for each service

**Each service:** TDD — write failing test, implement minimally, verify, commit.

```bash
git commit -m "feat(lifeplan): add remaining domain services"
```

---

### Task 6.2: Metric Adapters

**Files:**
- Create: `backend/src/1_adapters/lifeplan/metrics/StravaMetricAdapter.mjs`
- Create: `backend/src/1_adapters/lifeplan/metrics/CalendarMetricAdapter.mjs`
- Create: `backend/src/1_adapters/lifeplan/metrics/TodoistMetricAdapter.mjs`
- Create: `backend/src/1_adapters/lifeplan/metrics/SelfReportMetricAdapter.mjs`

Each adapter implements `IMetricSource`:
- `getMetricValue(username, measure, date)` — reads from lifelog data, returns numeric value

```bash
git commit -m "feat(lifeplan): add metric adapters for Strava, Calendar, Todoist"
```

---

### Task 6.3: BeliefSignalDetector

**Files:**
- Create: `backend/src/1_adapters/lifeplan/signals/BeliefSignalDetector.mjs`
- Create: `backend/src/1_adapters/lifeplan/signals/LifeEventSignalDetector.mjs`
- Test: `tests/isolated/lifeplan/signals/belief-signal-detector.test.mjs`

**BeliefSignalDetector:**
- Takes a belief with `if_signal` and `then_signal` definitions
- Evaluates against lifelog data for a period
- Returns evidence entries (did_if, got_then, type)

**LifeEventSignalDetector:**
- Scans calendar and other sources for life event signals
- Returns suggested life events for user confirmation

```bash
git commit -m "feat(lifeplan): add BeliefSignalDetector and LifeEventSignalDetector"
```

---

### Task 6.4: AI Briefing Renderer

**Files:**
- Create: `backend/src/3_applications/lifeplan/services/BriefingService.mjs`
- Create: `frontend/src/modules/Life/views/now/Briefing.jsx`

**BriefingService:**
- Takes alignment computation briefingContext
- Sends to AI gateway (Anthropic) with structured prompt
- Returns natural language briefing

**Briefing.jsx:**
- Displays AI narrative with markdown rendering
- Refresh button to regenerate

```bash
git commit -m "feat(lifeplan): add AI briefing generation and display"
```

---

### Task 6.5: Lifecycle Simulation Harness

**Files:**
- Create: `tests/_lib/lifeplan-simulation.mjs`
- Test: `tests/isolated/lifeplan/lifecycle/goal-full-journey.test.mjs`
- Test: `tests/isolated/lifeplan/lifecycle/belief-dormancy-decay.test.mjs`
- Test: `tests/isolated/lifeplan/lifecycle/value-reordering.test.mjs`
- Test: `tests/isolated/lifeplan/lifecycle/life-event-cascade.test.mjs`
- Test: `tests/isolated/lifeplan/lifecycle/paradigm-shift.test.mjs`

**LifeplanSimulation class:**
- `tick(duration)` — advance clock, run due jobs
- `runCycle()` — tick through a full cycle
- `runCycles(n)` — run N cycles, return snapshots
- `injectLifeEvent(event)` — insert life event mid-simulation
- `injectEvidence(beliefId, evidence)` — add belief evidence
- `injectLifelogOverride(source, data)` — replace lifelog source data
- `snapshot()` — return current plan state + metrics + alerts

**Lifecycle tests:**

1. **goal-full-journey:** dream → considered → ready → committed → achieved (over multiple cycles)
2. **belief-dormancy-decay:** untested belief confidence decays after 60 days
3. **value-reordering:** sustained drift triggers reorder prompt, reorder changes ranking
4. **life-event-cascade:** life event blocks goal → event resolves → goal auto-transitions to ready
5. **paradigm-shift:** foundational belief refuted → cascades to dependent beliefs → values flagged → emergency retro triggered

```bash
git commit -m "test(lifeplan): add lifecycle simulation harness and longitudinal tests"
```

---

### Task 6.6: Monthly Rollup Service

**Files:**
- Create: `backend/src/3_applications/lifeplan/services/MetricsService.mjs`

Computes monthly rollup from daily lifelog data:
- Total minutes by category
- Value allocation for the month
- Highlights (top activities/achievements)
- Stores under `rollups` key in lifeplan-metrics.yml

```bash
git commit -m "feat(lifeplan): add MetricsService with monthly rollup computation"
```

---

### Task 6.7: Integration Tests

**Files:**
- Create: `tests/integrated/lifeplan/aggregator-range.test.mjs`
- Create: `tests/integrated/lifeplan/metric-snapshot.test.mjs`
- Create: `tests/integrated/lifeplan/ceremony-delivery.test.mjs`

Test full flows with real YAML I/O (using tmp directories):
1. aggregateRange with real extractor pipeline
2. DriftService computes + persists + reads back snapshot
3. CeremonyScheduler triggers → NotificationService routes → adapter receives

```bash
git commit -m "test(lifeplan): add integration tests for aggregator, metrics, ceremonies"
```

---

### Task 6.8: Health Check Endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/life.mjs`

Add `GET /api/v1/life/health` endpoint that reports:
- Plan loaded status
- Last snapshot timestamp + age
- Scheduled job statuses (last run, errors)
- Ceremony adherence
- Notification channel statuses

```bash
git commit -m "feat(life): add /api/v1/life/health endpoint"
```

---

### Task 6.9: Update Documentation

**Files:**
- Modify: `docs/reference/core/backend-architecture.md` — add Lifeplan domain section
- Create: `docs/reference/life/life-domain-architecture.md` — architecture reference

```bash
git commit -m "docs(lifeplan): add architecture documentation"
```

---

## Task Summary

| Phase | Tasks | New Files | Test Files | Focus |
|-------|-------|-----------|------------|-------|
| **0: Infrastructure** | 0.1–0.9 | ~25 | ~8 | Clock, test factory, notification, aggregator, LifeApp shell |
| **1: Foundation** | 1.1–1.12 | ~40 | ~10 | Entities, state machines, domain services, persistence, API |
| **2: Alignment** | 2.1–2.5 | ~15 | ~5 | Drift calc, alignment engine, /life/now, dashboard UI |
| **3: Log Views** | 3.1–3.5 | ~15 | ~2 | Log API, shared components, all scope views |
| **4: Plan UI** | 4.1–4.5 | ~12 | ~0 | Plan management views (goals, beliefs, values, ceremonies) |
| **5: Ceremonies** | 5.1–5.5 | ~12 | ~3 | Ceremony service, scheduler, flow UI, bootstrap wiring |
| **6: Integration** | 6.1–6.9 | ~20 | ~8 | Metric adapters, signal detection, AI briefing, lifecycle tests |
| **Total** | **~40 tasks** | **~139 files** | **~36 test files** | |

Each phase can be executed independently after Phase 0 completes. Phases 1-5 have linear dependencies. Phase 6 can begin after Phase 2.
