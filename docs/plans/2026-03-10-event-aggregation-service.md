# Event Aggregation Service Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the stale static `common/events.yml` file with a live aggregation service that reads from harvested `current/` data stores and assembles events on the fly.

**Architecture:** New `EventAggregationService` in the application layer reads from three user-scoped `current/` stores (calendar, todoist, clickup) via `dataService.user.read()`, transforms each into a unified event schema, and returns the merged+sorted list. The `/home/events` endpoint calls this service instead of reading a static file.

**Tech Stack:** Node.js ES modules, existing DataService/ConfigService, Vitest for tests

---

### Task 1: Write EventAggregationService with tests

**Files:**
- Create: `backend/src/3_applications/home/EventAggregationService.mjs`
- Test: `tests/isolated/applications/home/EventAggregationService.unit.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/applications/home/EventAggregationService.unit.test.mjs`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { EventAggregationService } from '../../../../backend/src/3_applications/home/EventAggregationService.mjs';

function makeDataService(userData = {}) {
  return {
    user: {
      read: vi.fn((path, username) => userData[path] ?? null),
    },
  };
}

function makeConfigService(headOfHousehold = 'testuser') {
  return {
    getHeadOfHousehold: vi.fn(() => headOfHousehold),
  };
}

describe('EventAggregationService', () => {
  describe('getUpcomingEvents', () => {
    it('returns empty array when no data exists', () => {
      const service = new EventAggregationService({
        dataService: makeDataService(),
        configService: makeConfigService(),
      });

      const events = service.getUpcomingEvents();
      expect(events).toEqual([]);
    });

    it('maps calendar events to unified schema', () => {
      const service = new EventAggregationService({
        dataService: makeDataService({
          'current/calendar': [
            {
              id: 'cal-1',
              summary: 'Dentist',
              startDateTime: '2026-03-15T10:00:00-07:00',
              startDate: '2026-03-15',
              date: '2026-03-15',
              time: '10:00 AM',
              endTime: '11:00 AM',
              location: '123 Main St',
              allday: false,
              duration: 1,
              description: 'Checkup',
            },
          ],
        }),
        configService: makeConfigService(),
      });

      const events = service.getUpcomingEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        id: 'cal-1',
        start: '2026-03-15T10:00:00-07:00',
        end: '11:00 AM',
        summary: 'Dentist',
        description: 'Checkup',
        type: 'calendar',
        domain: null,
        location: '123 Main St',
        url: null,
        allday: false,
        status: null,
      });
    });

    it('maps calendar allday events correctly', () => {
      const service = new EventAggregationService({
        dataService: makeDataService({
          'current/calendar': [
            {
              id: 'cal-2',
              summary: 'Birthday',
              startDateTime: '2026-03-20',
              startDate: '2026-03-20',
              date: '2026-03-20',
              allday: true,
              duration: 24,
            },
          ],
        }),
        configService: makeConfigService(),
      });

      const events = service.getUpcomingEvents();
      expect(events[0].allday).toBe(true);
      expect(events[0].start).toBe('2026-03-20');
    });

    it('maps todoist tasks to unified schema', () => {
      const service = new EventAggregationService({
        dataService: makeDataService({
          'current/todoist': {
            tasks: [
              {
                id: 'abc123',
                content: 'Buy groceries',
                description: 'Milk, eggs',
                dueDate: '2026-03-12',
                url: 'https://app.todoist.com/app/task/abc123',
                priority: 1,
                labels: [],
                projectId: 'proj1',
              },
            ],
          },
        }),
        configService: makeConfigService(),
      });

      const events = service.getUpcomingEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        id: 'abc123',
        start: '2026-03-12',
        end: null,
        summary: 'Buy groceries',
        description: 'Milk, eggs',
        type: 'todoist',
        domain: 'app.todoist.com',
        location: null,
        url: 'https://app.todoist.com/app/task/abc123',
        allday: false,
        status: null,
      });
    });

    it('maps todoist tasks without due dates (start: null)', () => {
      const service = new EventAggregationService({
        dataService: makeDataService({
          'current/todoist': {
            tasks: [
              { id: 't1', content: 'Undated task', description: '', dueDate: null, url: null },
            ],
          },
        }),
        configService: makeConfigService(),
      });

      const events = service.getUpcomingEvents();
      expect(events[0].start).toBeNull();
    });

    it('maps clickup tasks to unified schema', () => {
      const service = new EventAggregationService({
        dataService: makeDataService({
          'current/clickup': {
            tasks: [
              {
                id: '86d1dwkv8',
                name: 'Entry Report Panel',
                status: 'in progress',
                date_created: '1767165871221',
                taxonomy: { '5887321': 'Personal Projects', '12120791': 'Daylight Station' },
              },
            ],
          },
        }),
        configService: makeConfigService(),
      });

      const events = service.getUpcomingEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        id: '86d1dwkv8',
        start: null,
        end: null,
        summary: 'Entry Report Panel',
        description: null,
        type: 'clickup',
        domain: 'app.clickup.com',
        location: null,
        url: 'https://app.clickup.com/t/86d1dwkv8',
        allday: false,
        status: 'in progress',
      });
    });

    it('merges all three sources and sorts by start date', () => {
      const service = new EventAggregationService({
        dataService: makeDataService({
          'current/calendar': [
            { id: 'cal-1', summary: 'Later event', startDateTime: '2026-03-20T10:00:00-07:00', startDate: '2026-03-20', allday: false },
            { id: 'cal-2', summary: 'Earlier event', startDateTime: '2026-03-10T10:00:00-07:00', startDate: '2026-03-10', allday: false },
          ],
          'current/todoist': {
            tasks: [
              { id: 't1', content: 'Mid task', dueDate: '2026-03-15', url: null },
            ],
          },
          'current/clickup': {
            tasks: [
              { id: 'c1', name: 'Undated clickup', status: 'todo' },
            ],
          },
        }),
        configService: makeConfigService(),
      });

      const events = service.getUpcomingEvents();
      expect(events).toHaveLength(4);
      // Dated events sorted ascending, then undated at the end
      expect(events[0].id).toBe('cal-2'); // Mar 10
      expect(events[1].id).toBe('t1');    // Mar 15
      expect(events[2].id).toBe('cal-1'); // Mar 20
      expect(events[3].id).toBe('c1');    // null (undated, at end)
    });

    it('uses configService.getHeadOfHousehold() for username', () => {
      const ds = makeDataService();
      const cs = makeConfigService('kckern');
      const service = new EventAggregationService({ dataService: ds, configService: cs });

      service.getUpcomingEvents();

      expect(cs.getHeadOfHousehold).toHaveBeenCalled();
      expect(ds.user.read).toHaveBeenCalledWith('current/calendar', 'kckern');
      expect(ds.user.read).toHaveBeenCalledWith('current/todoist', 'kckern');
      expect(ds.user.read).toHaveBeenCalledWith('current/clickup', 'kckern');
    });

    it('handles missing/null data gracefully', () => {
      const service = new EventAggregationService({
        dataService: makeDataService({
          'current/calendar': null,
          'current/todoist': null,
          'current/clickup': null,
        }),
        configService: makeConfigService(),
      });

      const events = service.getUpcomingEvents();
      expect(events).toEqual([]);
    });

    it('handles todoist data with empty tasks array', () => {
      const service = new EventAggregationService({
        dataService: makeDataService({
          'current/todoist': { tasks: [], taskCount: 0 },
        }),
        configService: makeConfigService(),
      });

      const events = service.getUpcomingEvents();
      expect(events).toEqual([]);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/applications/home/EventAggregationService.unit.test.mjs`
Expected: FAIL — module not found

**Step 3: Write the implementation**

Create `backend/src/3_applications/home/EventAggregationService.mjs`:

```javascript
/**
 * EventAggregationService
 *
 * Reads from user-scoped current/ data stores (calendar, todoist, clickup)
 * and assembles a unified event list for the Upcoming widget.
 *
 * Replaces the stale static common/events.yml approach with live aggregation.
 *
 * @module 3_applications/home/EventAggregationService
 */

export class EventAggregationService {
  #dataService;
  #configService;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.dataService - DataService with .user.read()
   * @param {Object} deps.configService - ConfigService for user resolution
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ dataService, configService, logger = console }) {
    this.#dataService = dataService;
    this.#configService = configService;
    this.#logger = logger;
  }

  /**
   * Get aggregated upcoming events from all sources
   * @param {string} [username] - Override username (defaults to head of household)
   * @returns {Array<Object>} Unified event objects sorted by start date
   */
  getUpcomingEvents(username) {
    const user = username || this.#configService.getHeadOfHousehold();

    const calendarEvents = this.#readCalendar(user);
    const todoistEvents = this.#readTodoist(user);
    const clickupEvents = this.#readClickup(user);

    const all = [...calendarEvents, ...todoistEvents, ...clickupEvents];

    // Sort: dated events ascending, undated at the end
    all.sort((a, b) => {
      if (!a.start && !b.start) return 0;
      if (!a.start) return 1;
      if (!b.start) return -1;
      return new Date(a.start) - new Date(b.start);
    });

    return all;
  }

  /** @private */
  #readCalendar(username) {
    const data = this.#dataService.user.read('current/calendar', username);
    if (!Array.isArray(data)) return [];

    return data.map(e => ({
      id: e.id,
      start: e.startDateTime || e.startDate || null,
      end: e.endTime || null,
      summary: e.summary || null,
      description: e.description || null,
      type: 'calendar',
      domain: e.calendarName || null,
      location: e.location || null,
      url: null,
      allday: !!e.allday,
      status: null,
    }));
  }

  /** @private */
  #readTodoist(username) {
    const data = this.#dataService.user.read('current/todoist', username);
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];

    return tasks.map(t => ({
      id: t.id,
      start: t.dueDate || null,
      end: null,
      summary: t.content || null,
      description: t.description || null,
      type: 'todoist',
      domain: 'app.todoist.com',
      location: null,
      url: t.url || null,
      allday: false,
      status: null,
    }));
  }

  /** @private */
  #readClickup(username) {
    const data = this.#dataService.user.read('current/clickup', username);
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];

    return tasks.map(t => ({
      id: t.id,
      start: null,
      end: null,
      summary: t.name || null,
      description: null,
      type: 'clickup',
      domain: 'app.clickup.com',
      location: null,
      url: `https://app.clickup.com/t/${t.id}`,
      allday: false,
      status: t.status || null,
    }));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/applications/home/EventAggregationService.unit.test.mjs`
Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/home/EventAggregationService.mjs tests/isolated/applications/home/EventAggregationService.unit.test.mjs
git commit -m "feat(home): add EventAggregationService for live event assembly"
```

---

### Task 2: Wire service into homeAutomation router

**Files:**
- Modify: `backend/src/4_api/v1/routers/homeAutomation.mjs:306-314` (replace static file read)
- Modify: `backend/src/0_system/bootstrap.mjs:1471-1506` (pass service through)
- Modify: `backend/src/app.mjs:1382-1390` (create and inject service)

**Step 1: Update homeAutomation.mjs router**

In `backend/src/4_api/v1/routers/homeAutomation.mjs`, the `createHomeAutomationRouter` function signature (line 31) accepts a config object. Add `eventAggregationService` to the destructured config (line 33-45). Then update the `/events` endpoint (lines 306-314).

Change the config destructuring (~line 33-45) to add:
```javascript
eventAggregationService,
```

Replace the `/events` handler (lines 306-314) with:
```javascript
  /**
   * GET /home/events
   * Get aggregated events from calendar, todoist, clickup
   */
  router.get('/events', asyncHandler(async (req, res) => {
    if (eventAggregationService) {
      const events = eventAggregationService.getUpcomingEvents();
      return res.json(events);
    }

    // Fallback to static file if service not available
    if (!loadFile) {
      return res.status(503).json({ error: 'Event data not configured' });
    }
    const eventsData = loadFile('common/events') || [];
    res.json(eventsData);
  }));
```

**Step 2: Update bootstrap.mjs**

In `backend/src/0_system/bootstrap.mjs`, update `createHomeAutomationApiRouter` (line 1483):

Add `eventAggregationService` to the function's config destructuring (~line 1484-1492):
```javascript
eventAggregationService,
```

Pass it through to `createHomeAutomationRouter` (~line 1494-1506):
```javascript
eventAggregationService,
```

**Step 3: Update app.mjs**

In `backend/src/app.mjs`, before the home automation router creation (~line 1382), create the service:

```javascript
  // Event aggregation service (for Upcoming widget)
  const { EventAggregationService } = await import('./3_applications/home/EventAggregationService.mjs');
  const eventAggregationService = new EventAggregationService({
    dataService,
    configService,
    logger: rootLogger.child({ module: 'event-aggregation' }),
  });
```

Then add it to the `createHomeAutomationApiRouter` call (~line 1382-1390):
```javascript
eventAggregationService,
```

**Step 4: Run existing tests to verify no regressions**

Run: `npx vitest run tests/isolated/applications/home/`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/homeAutomation.mjs backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "feat(home): wire EventAggregationService into /home/events endpoint"
```

---

### Task 3: Verify live behavior

**Step 1: Check the dev API responds with fresh data**

Ensure the dev server is running, then:

```bash
curl -s http://localhost:3112/api/v1/home/events | head -40
```

Expected: JSON array with current todoist tasks (matching `current/todoist.yml` content like "Get groceries"), current calendar events, and clickup tasks.

**Step 2: Verify todoist items have correct shape**

```bash
curl -s http://localhost:3112/api/v1/home/events | jq '[.[] | select(.type == "todoist")]'
```

Expected: Todoist items with `summary` matching `content` from `current/todoist.yml`, `domain: "app.todoist.com"`, `type: "todoist"`.

**Step 3: Verify calendar items have correct shape**

```bash
curl -s http://localhost:3112/api/v1/home/events | jq '[.[] | select(.type == "calendar")] | length'
```

Expected: Count matching the number of entries in `current/calendar.yml`.

**Step 4: Commit (if any fixes were needed)**

---

### Task 4: Update architecture docs

**Files:**
- Modify: `docs/reference/core/2-architecture.md:1150-1165` (update the described pattern to match reality)

**Step 1: Update the architecture doc**

The doc at lines 1150-1165 describes a job-based aggregation approach that was never implemented. Update it to describe the new live aggregation service approach.

**Step 2: Commit**

```bash
git add docs/reference/core/2-architecture.md
git commit -m "docs: update architecture to reflect live event aggregation service"
```
