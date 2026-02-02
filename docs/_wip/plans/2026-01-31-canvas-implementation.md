# Canvas Art Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a robust TV art display system with context-aware selection, multiple content sources (Immich art library, filesystem), and configurable display options.

**Architecture:** New `canvas` integration category with adapters for Immich and filesystem. Domain layer handles pure selection logic. Application layer orchestrates via ports (no infrastructure knowledge). Adapters translate external events to abstract domain events.

**Tech Stack:** Node.js/ES modules, Jest for testing, existing DDD patterns from content domain.

---

## Task 1: DisplayableItem Capability

**Files:**
- Create: `backend/src/2_domains/content/capabilities/Displayable.mjs`
- Create: `tests/isolated/domain/content/capabilities/Displayable.test.mjs`
- Modify: `backend/src/2_domains/content/index.mjs`

**Step 1: Write the failing test**

```javascript
// tests/isolated/domain/content/capabilities/Displayable.test.mjs
import { describe, it, expect } from '@jest/globals';
import { DisplayableItem } from '../../../../backend/src/2_domains/content/capabilities/Displayable.mjs';

describe('DisplayableItem', () => {
  const validProps = {
    id: 'canvas:test-123',
    source: 'filesystem',
    title: 'Starry Night',
    imageUrl: '/api/v1/canvas/image/test-123',
    category: 'impressionist',
    artist: 'Vincent van Gogh',
    year: 1889,
    tags: ['night', 'calm'],
    frameStyle: 'ornate',
  };

  it('creates item with all properties', () => {
    const item = new DisplayableItem(validProps);

    expect(item.id).toBe('canvas:test-123');
    expect(item.category).toBe('impressionist');
    expect(item.artist).toBe('Vincent van Gogh');
    expect(item.year).toBe(1889);
    expect(item.tags).toEqual(['night', 'calm']);
    expect(item.frameStyle).toBe('ornate');
  });

  it('inherits from ViewableItem', () => {
    const item = new DisplayableItem(validProps);

    expect(item.imageUrl).toBe('/api/v1/canvas/image/test-123');
    expect(item.isViewable()).toBe(true);
  });

  it('defaults tags to empty array', () => {
    const props = { ...validProps, tags: undefined };
    const item = new DisplayableItem(props);

    expect(item.tags).toEqual([]);
  });

  it('defaults frameStyle to classic', () => {
    const props = { ...validProps, frameStyle: undefined };
    const item = new DisplayableItem(props);

    expect(item.frameStyle).toBe('classic');
  });

  it('requires imageUrl (inherited)', () => {
    const props = { ...validProps, imageUrl: undefined };

    expect(() => new DisplayableItem(props)).toThrow(/imageUrl/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="Displayable.test" -v`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/2_domains/content/capabilities/Displayable.mjs
import { ViewableItem } from './Viewable.mjs';

/**
 * Displayable capability - art for ambient TV display
 * Extends ViewableItem with art-specific metadata for context-aware selection
 */
export class DisplayableItem extends ViewableItem {
  /**
   * @param {Object} props
   * @param {string} props.id - Compound ID (canvas:xyz)
   * @param {string} props.source - Adapter source
   * @param {string} props.title - Art title
   * @param {string} props.imageUrl - Full resolution image URL
   * @param {string} [props.category] - Art category (landscapes, abstract, etc.)
   * @param {string} [props.artist] - Artist name
   * @param {number} [props.year] - Creation year
   * @param {string[]} [props.tags] - Context tags (mood, time-of-day, season)
   * @param {string} [props.frameStyle] - Display frame style (minimal, classic, ornate, none)
   */
  constructor(props) {
    super(props);
    this.category = props.category ?? null;
    this.artist = props.artist ?? null;
    this.year = props.year ?? null;
    this.tags = props.tags ?? [];
    this.frameStyle = props.frameStyle ?? 'classic';
  }
}

export default DisplayableItem;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="Displayable.test" -v`
Expected: PASS (5 tests)

**Step 5: Export from domain index**

```javascript
// Add to backend/src/2_domains/content/index.mjs after ViewableItem export
export { DisplayableItem } from './capabilities/Displayable.mjs';
```

**Step 6: Commit**

```bash
git add backend/src/2_domains/content/capabilities/Displayable.mjs \
        backend/src/2_domains/content/index.mjs \
        tests/isolated/domain/content/capabilities/Displayable.test.mjs
git commit -m "feat(canvas): add DisplayableItem capability

Extends ViewableItem with art-specific metadata:
- category, artist, year for cataloging
- tags for context-aware selection
- frameStyle for display customization"
```

---

## Task 2: CanvasSelectionService (Domain)

**Files:**
- Create: `backend/src/2_domains/content/services/CanvasSelectionService.mjs`
- Create: `tests/isolated/domain/content/services/CanvasSelectionService.test.mjs`

**Step 1: Write the failing tests**

```javascript
// tests/isolated/domain/content/services/CanvasSelectionService.test.mjs
import { describe, it, expect } from '@jest/globals';
import { CanvasSelectionService } from '../../../../backend/src/2_domains/content/services/CanvasSelectionService.mjs';

describe('CanvasSelectionService', () => {
  const service = new CanvasSelectionService();

  const mockItems = [
    { id: '1', category: 'landscapes', tags: ['morning', 'bright'], artist: 'Monet' },
    { id: '2', category: 'abstract', tags: ['evening', 'calm'], artist: 'Kandinsky' },
    { id: '3', category: 'landscapes', tags: ['night', 'dark'], artist: 'Van Gogh' },
    { id: '4', category: 'portraits', tags: ['morning', 'warm'], artist: 'Rembrandt' },
  ];

  describe('selectForContext', () => {
    it('filters by category', () => {
      const context = { categories: ['landscapes'] };
      const result = service.selectForContext(mockItems, context);

      expect(result).toHaveLength(2);
      expect(result.every(i => i.category === 'landscapes')).toBe(true);
    });

    it('filters by tags', () => {
      const context = { tags: ['morning'] };
      const result = service.selectForContext(mockItems, context);

      expect(result).toHaveLength(2);
      expect(result.map(i => i.id)).toEqual(['1', '4']);
    });

    it('combines category and tag filters (AND)', () => {
      const context = { categories: ['landscapes'], tags: ['morning'] };
      const result = service.selectForContext(mockItems, context);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('returns all items when no filters', () => {
      const result = service.selectForContext(mockItems, {});

      expect(result).toHaveLength(4);
    });
  });

  describe('pickNext', () => {
    it('picks random item from pool', () => {
      const result = service.pickNext(mockItems, [], { mode: 'random' });

      expect(mockItems).toContainEqual(result);
    });

    it('avoids items in shownHistory', () => {
      const shownHistory = ['1', '2', '3'];
      const result = service.pickNext(mockItems, shownHistory, { mode: 'random' });

      expect(result.id).toBe('4');
    });

    it('resets when all items shown', () => {
      const shownHistory = ['1', '2', '3', '4'];
      const result = service.pickNext(mockItems, shownHistory, { mode: 'random' });

      expect(mockItems).toContainEqual(result);
    });

    it('picks sequentially when mode is sequential', () => {
      const shownHistory = ['1'];
      const result = service.pickNext(mockItems, shownHistory, { mode: 'sequential' });

      expect(result.id).toBe('2');
    });

    it('returns null for empty pool', () => {
      const result = service.pickNext([], [], { mode: 'random' });

      expect(result).toBeNull();
    });
  });

  describe('buildContextFilters', () => {
    it('merges time, calendar, and device contexts', () => {
      const timeContext = { tags: ['morning'] };
      const calendarContext = { tags: ['holiday'] };
      const deviceContext = { categories: ['landscapes'], frameStyle: 'ornate' };

      const result = service.buildContextFilters(timeContext, calendarContext, deviceContext);

      expect(result.tags).toEqual(['morning', 'holiday']);
      expect(result.categories).toEqual(['landscapes']);
      expect(result.frameStyle).toBe('ornate');
    });

    it('device overrides calendar overrides time', () => {
      const timeContext = { frameStyle: 'classic' };
      const calendarContext = { frameStyle: 'minimal' };
      const deviceContext = { frameStyle: 'ornate' };

      const result = service.buildContextFilters(timeContext, calendarContext, deviceContext);

      expect(result.frameStyle).toBe('ornate');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="CanvasSelectionService.test" -v`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/2_domains/content/services/CanvasSelectionService.mjs

/**
 * Pure domain service for canvas art selection.
 * No I/O, no infrastructure knowledge - just selection logic.
 */
export class CanvasSelectionService {
  /**
   * Filter items by context criteria
   * @param {Array} items - Pool of DisplayableItems
   * @param {Object} context - Filter criteria { categories?, tags? }
   * @returns {Array} Filtered items
   */
  selectForContext(items, context) {
    let result = [...items];

    if (context.categories?.length > 0) {
      result = result.filter(item =>
        context.categories.includes(item.category)
      );
    }

    if (context.tags?.length > 0) {
      result = result.filter(item =>
        context.tags.some(tag => item.tags?.includes(tag))
      );
    }

    return result;
  }

  /**
   * Pick next item respecting history and mode
   * @param {Array} pool - Available items
   * @param {string[]} shownHistory - IDs of recently shown items
   * @param {Object} options - { mode: 'random' | 'sequential' }
   * @returns {Object|null} Selected item or null if pool empty
   */
  pickNext(pool, shownHistory, options) {
    if (pool.length === 0) return null;

    // Filter out recently shown
    let candidates = pool.filter(item => !shownHistory.includes(item.id));

    // Reset if all shown
    if (candidates.length === 0) {
      candidates = pool;
    }

    if (options.mode === 'sequential') {
      // Find first item not in history, or first item if all shown
      const lastShown = shownHistory[shownHistory.length - 1];
      const lastIndex = pool.findIndex(item => item.id === lastShown);
      const nextIndex = (lastIndex + 1) % pool.length;
      return pool[nextIndex];
    }

    // Random selection
    const randomIndex = Math.floor(Math.random() * candidates.length);
    return candidates[randomIndex];
  }

  /**
   * Merge context layers (time < calendar < device)
   * @param {Object} timeContext - Time-of-day context
   * @param {Object} calendarContext - Calendar/holiday context
   * @param {Object} deviceContext - Device-specific overrides
   * @returns {Object} Merged context filters
   */
  buildContextFilters(timeContext, calendarContext, deviceContext) {
    // Merge tags (additive)
    const tags = [
      ...(timeContext.tags || []),
      ...(calendarContext.tags || []),
      ...(deviceContext.tags || []),
    ];

    // Categories from device (most specific)
    const categories = deviceContext.categories ||
                       calendarContext.categories ||
                       timeContext.categories ||
                       [];

    // Frame style: device > calendar > time
    const frameStyle = deviceContext.frameStyle ??
                       calendarContext.frameStyle ??
                       timeContext.frameStyle ??
                       'classic';

    return { tags, categories, frameStyle };
  }
}

export default CanvasSelectionService;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="CanvasSelectionService.test" -v`
Expected: PASS (10 tests)

**Step 5: Export from domain index**

```javascript
// Add to backend/src/2_domains/content/index.mjs
export { CanvasSelectionService } from './services/CanvasSelectionService.mjs';
```

**Step 6: Commit**

```bash
git add backend/src/2_domains/content/services/CanvasSelectionService.mjs \
        backend/src/2_domains/content/index.mjs \
        tests/isolated/domain/content/services/CanvasSelectionService.test.mjs
git commit -m "feat(canvas): add CanvasSelectionService

Pure domain service for art selection:
- selectForContext: filter by category/tags
- pickNext: random/sequential with history avoidance
- buildContextFilters: merge time/calendar/device contexts"
```

---

## Task 3: Application Layer Ports

**Files:**
- Create: `backend/src/3_applications/canvas/ports/ICanvasEventSource.mjs`
- Create: `backend/src/3_applications/canvas/ports/ICanvasScheduler.mjs`
- Create: `backend/src/3_applications/canvas/ports/IContextProvider.mjs`
- Create: `backend/src/3_applications/canvas/ports/index.mjs`
- Create: `tests/isolated/contract/canvas/ports/ICanvasEventSource.test.mjs`

**Step 1: Write the contract test**

```javascript
// tests/isolated/contract/canvas/ports/ICanvasEventSource.test.mjs
import { describe, it, expect } from '@jest/globals';
import { validateEventSource } from '../../../../../backend/src/3_applications/canvas/ports/ICanvasEventSource.mjs';

describe('ICanvasEventSource contract', () => {
  it('validates compliant implementation', () => {
    const validImpl = {
      onMotionDetected: (cb) => {},
      onContextTrigger: (cb) => {},
      onManualAdvance: (cb) => {},
    };

    expect(() => validateEventSource(validImpl)).not.toThrow();
  });

  it('rejects missing onMotionDetected', () => {
    const invalid = {
      onContextTrigger: (cb) => {},
      onManualAdvance: (cb) => {},
    };

    expect(() => validateEventSource(invalid)).toThrow(/onMotionDetected/);
  });

  it('rejects non-function methods', () => {
    const invalid = {
      onMotionDetected: 'not a function',
      onContextTrigger: (cb) => {},
      onManualAdvance: (cb) => {},
    };

    expect(() => validateEventSource(invalid)).toThrow(/onMotionDetected.*function/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="ICanvasEventSource.test" -v`
Expected: FAIL with "Cannot find module"

**Step 3: Write port definitions**

```javascript
// backend/src/3_applications/canvas/ports/ICanvasEventSource.mjs

/**
 * Port for receiving canvas-related events from infrastructure.
 * Application layer consumes this; adapters implement it.
 *
 * @typedef {Object} ICanvasEventSource
 * @property {function(function(string): void): void} onMotionDetected - Register callback for motion events
 * @property {function(function(string, string): void): void} onContextTrigger - Register callback for context changes
 * @property {function(function(string): void): void} onManualAdvance - Register callback for manual advance
 */

/**
 * Validate that an object implements ICanvasEventSource
 * @param {Object} impl - Implementation to validate
 * @throws {Error} If implementation is invalid
 */
export function validateEventSource(impl) {
  const required = ['onMotionDetected', 'onContextTrigger', 'onManualAdvance'];

  for (const method of required) {
    if (typeof impl[method] !== 'function') {
      throw new Error(`ICanvasEventSource requires ${method} to be a function`);
    }
  }
}
```

```javascript
// backend/src/3_applications/canvas/ports/ICanvasScheduler.mjs

/**
 * Port for scheduling canvas rotation.
 * Application layer consumes this; adapters implement it.
 *
 * @typedef {Object} ICanvasScheduler
 * @property {function(string, number, function): void} scheduleRotation - Schedule periodic rotation
 * @property {function(string): void} resetTimer - Reset rotation timer for device
 * @property {function(string): void} cancelRotation - Cancel rotation for device
 */

/**
 * Validate that an object implements ICanvasScheduler
 * @param {Object} impl - Implementation to validate
 * @throws {Error} If implementation is invalid
 */
export function validateScheduler(impl) {
  const required = ['scheduleRotation', 'resetTimer', 'cancelRotation'];

  for (const method of required) {
    if (typeof impl[method] !== 'function') {
      throw new Error(`ICanvasScheduler requires ${method} to be a function`);
    }
  }
}
```

```javascript
// backend/src/3_applications/canvas/ports/IContextProvider.mjs

/**
 * Port for getting current context (time, calendar, device config).
 * Application layer consumes this; adapters implement it.
 *
 * @typedef {Object} IContextProvider
 * @property {function(string, string): Promise<Object>} getContext - Get context for device/household
 * @property {function(): string} getTimeSlot - Get current time slot (morning, afternoon, evening, night)
 */

/**
 * Validate that an object implements IContextProvider
 * @param {Object} impl - Implementation to validate
 * @throws {Error} If implementation is invalid
 */
export function validateContextProvider(impl) {
  const required = ['getContext', 'getTimeSlot'];

  for (const method of required) {
    if (typeof impl[method] !== 'function') {
      throw new Error(`IContextProvider requires ${method} to be a function`);
    }
  }
}
```

```javascript
// backend/src/3_applications/canvas/ports/index.mjs
export { validateEventSource } from './ICanvasEventSource.mjs';
export { validateScheduler } from './ICanvasScheduler.mjs';
export { validateContextProvider } from './IContextProvider.mjs';
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="ICanvasEventSource.test" -v`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/canvas/ports/*.mjs \
        tests/isolated/contract/canvas/ports/ICanvasEventSource.test.mjs
git commit -m "feat(canvas): add application layer ports

Define interfaces for infrastructure abstraction:
- ICanvasEventSource: motion, context, manual events
- ICanvasScheduler: rotation timer management
- IContextProvider: time/calendar/device context"
```

---

## Task 4: CanvasService (Application Layer)

**Files:**
- Create: `backend/src/3_applications/canvas/services/CanvasService.mjs`
- Create: `tests/isolated/flow/canvas/CanvasService.test.mjs`

**Step 1: Write the failing tests**

```javascript
// tests/isolated/flow/canvas/CanvasService.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { CanvasService } from '../../../../backend/src/3_applications/canvas/services/CanvasService.mjs';

describe('CanvasService', () => {
  let service;
  let mockContentSource;
  let mockSelectionService;
  let mockScheduler;
  let mockEventSource;
  let mockContextProvider;
  let mockHistoryStore;

  beforeEach(() => {
    mockContentSource = {
      source: 'test',
      list: jest.fn().mockResolvedValue([
        { id: '1', category: 'landscapes', tags: ['morning'] },
        { id: '2', category: 'abstract', tags: ['evening'] },
      ]),
    };

    mockSelectionService = {
      selectForContext: jest.fn().mockImplementation((items) => items),
      pickNext: jest.fn().mockImplementation((pool) => pool[0]),
      buildContextFilters: jest.fn().mockReturnValue({ tags: [], categories: [] }),
    };

    mockScheduler = {
      scheduleRotation: jest.fn(),
      resetTimer: jest.fn(),
      cancelRotation: jest.fn(),
    };

    mockEventSource = {
      onMotionDetected: jest.fn(),
      onContextTrigger: jest.fn(),
      onManualAdvance: jest.fn(),
    };

    mockContextProvider = {
      getContext: jest.fn().mockResolvedValue({
        timeSlot: 'morning',
        calendarTags: [],
        deviceConfig: {},
        options: { mode: 'random', interval: 300 },
      }),
      getTimeSlot: jest.fn().mockReturnValue('morning'),
    };

    mockHistoryStore = {
      getShownHistory: jest.fn().mockResolvedValue([]),
      recordShown: jest.fn().mockResolvedValue(undefined),
    };

    service = new CanvasService({
      contentSources: [mockContentSource],
      selectionService: mockSelectionService,
      scheduler: mockScheduler,
      eventSource: mockEventSource,
      contextProvider: mockContextProvider,
      historyStore: mockHistoryStore,
    });
  });

  describe('getCurrent', () => {
    it('fetches items from content sources', async () => {
      await service.getCurrent('device-1', 'household-1');

      expect(mockContentSource.list).toHaveBeenCalled();
    });

    it('applies context filtering', async () => {
      await service.getCurrent('device-1', 'household-1');

      expect(mockContextProvider.getContext).toHaveBeenCalledWith('device-1', 'household-1');
      expect(mockSelectionService.selectForContext).toHaveBeenCalled();
    });

    it('picks next item avoiding history', async () => {
      mockHistoryStore.getShownHistory.mockResolvedValue(['1']);

      await service.getCurrent('device-1', 'household-1');

      expect(mockSelectionService.pickNext).toHaveBeenCalledWith(
        expect.any(Array),
        ['1'],
        expect.any(Object)
      );
    });

    it('records shown item in history', async () => {
      await service.getCurrent('device-1', 'household-1');

      expect(mockHistoryStore.recordShown).toHaveBeenCalledWith('device-1', '1');
    });
  });

  describe('event wiring', () => {
    it('registers motion callback that resets timer', () => {
      expect(mockEventSource.onMotionDetected).toHaveBeenCalled();

      const callback = mockEventSource.onMotionDetected.mock.calls[0][0];
      callback('device-1');

      expect(mockScheduler.resetTimer).toHaveBeenCalledWith('device-1');
    });

    it('registers manual advance callback', () => {
      expect(mockEventSource.onManualAdvance).toHaveBeenCalled();
    });
  });

  describe('startRotation', () => {
    it('schedules rotation for device', async () => {
      await service.startRotation('device-1', 'household-1');

      expect(mockScheduler.scheduleRotation).toHaveBeenCalledWith(
        'device-1',
        300000, // 300 seconds in ms
        expect.any(Function)
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="flow/canvas/CanvasService.test" -v`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/3_applications/canvas/services/CanvasService.mjs
import { validateEventSource } from '../ports/ICanvasEventSource.mjs';
import { validateScheduler } from '../ports/ICanvasScheduler.mjs';
import { validateContextProvider } from '../ports/IContextProvider.mjs';

/**
 * Application service for canvas art display.
 * Orchestrates adapters and domain logic via ports.
 * No infrastructure knowledge - only interfaces.
 */
export class CanvasService {
  #contentSources;
  #selectionService;
  #scheduler;
  #contextProvider;
  #historyStore;

  /**
   * @param {Object} deps
   * @param {Array} deps.contentSources - Content source adapters (IContentSource[])
   * @param {Object} deps.selectionService - CanvasSelectionService (domain)
   * @param {Object} deps.scheduler - ICanvasScheduler implementation
   * @param {Object} deps.eventSource - ICanvasEventSource implementation
   * @param {Object} deps.contextProvider - IContextProvider implementation
   * @param {Object} deps.historyStore - History storage { getShownHistory, recordShown }
   */
  constructor({ contentSources, selectionService, scheduler, eventSource, contextProvider, historyStore }) {
    validateEventSource(eventSource);
    validateScheduler(scheduler);
    validateContextProvider(contextProvider);

    this.#contentSources = contentSources;
    this.#selectionService = selectionService;
    this.#scheduler = scheduler;
    this.#contextProvider = contextProvider;
    this.#historyStore = historyStore;

    // Wire up events via ports
    eventSource.onMotionDetected((deviceId) => {
      this.#scheduler.resetTimer(deviceId);
    });

    eventSource.onManualAdvance((deviceId) => {
      // Will be called to advance to next item
    });

    eventSource.onContextTrigger((deviceId, triggerType) => {
      // Will be called on time boundary or calendar change
    });
  }

  /**
   * Get current art for a device
   * @param {string} deviceId
   * @param {string} householdId
   * @returns {Promise<Object>} Selected DisplayableItem
   */
  async getCurrent(deviceId, householdId) {
    // Get context
    const context = await this.#contextProvider.getContext(deviceId, householdId);

    // Fetch from all sources
    const allItems = await Promise.all(
      this.#contentSources.map(source => source.list(context.filters))
    );
    const pool = allItems.flat();

    // Filter by context
    const filtered = this.#selectionService.selectForContext(pool, context);

    // Get history and pick next
    const history = await this.#historyStore.getShownHistory(deviceId);
    const selected = this.#selectionService.pickNext(filtered, history, context.options);

    // Record in history
    if (selected) {
      await this.#historyStore.recordShown(deviceId, selected.id);
    }

    return selected;
  }

  /**
   * Start rotation for a device
   * @param {string} deviceId
   * @param {string} householdId
   */
  async startRotation(deviceId, householdId) {
    const context = await this.#contextProvider.getContext(deviceId, householdId);
    const intervalMs = (context.options.interval || 300) * 1000;

    this.#scheduler.scheduleRotation(deviceId, intervalMs, async () => {
      await this.getCurrent(deviceId, householdId);
    });
  }

  /**
   * Stop rotation for a device
   * @param {string} deviceId
   */
  stopRotation(deviceId) {
    this.#scheduler.cancelRotation(deviceId);
  }
}

export default CanvasService;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="flow/canvas/CanvasService.test" -v`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add backend/src/3_applications/canvas/services/CanvasService.mjs \
        tests/isolated/flow/canvas/CanvasService.test.mjs
git commit -m "feat(canvas): add CanvasService

Application layer orchestrator:
- getCurrent: fetch, filter, select art for device
- startRotation/stopRotation: timer management
- Event wiring via ports (motion, context, manual)"
```

---

## Task 5: FilesystemCanvasAdapter

**Files:**
- Create: `backend/src/1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs`
- Create: `backend/src/1_adapters/content/canvas/filesystem/index.mjs`
- Create: `tests/isolated/adapter/content/canvas/FilesystemCanvasAdapter.test.mjs`

**Step 1: Write the failing tests**

```javascript
// tests/isolated/adapter/content/canvas/FilesystemCanvasAdapter.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { FilesystemCanvasAdapter } from '../../../../../backend/src/1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs';

describe('FilesystemCanvasAdapter', () => {
  let adapter;
  let mockFs;
  let mockExifReader;

  beforeEach(() => {
    mockFs = {
      readdirSync: jest.fn(),
      statSync: jest.fn(),
      existsSync: jest.fn().mockReturnValue(true),
      readFileSync: jest.fn(),
    };

    mockExifReader = {
      load: jest.fn().mockReturnValue({
        Artist: { value: 'Test Artist' },
        DateTimeOriginal: { value: '2020:01:15 10:30:00' },
        ImageDescription: { value: 'Test description' },
      }),
    };

    adapter = new FilesystemCanvasAdapter({
      basePath: '/media/art',
      proxyPath: '/api/v1/canvas/image',
    }, {
      fs: mockFs,
      exifReader: mockExifReader,
    });
  });

  describe('source and prefixes', () => {
    it('has correct source name', () => {
      expect(adapter.source).toBe('canvas-filesystem');
    });

    it('has canvas prefix', () => {
      expect(adapter.prefixes).toContainEqual({ prefix: 'canvas' });
    });
  });

  describe('list', () => {
    it('scans category folders', async () => {
      mockFs.readdirSync.mockImplementation((path) => {
        if (path === '/media/art') return ['landscapes', 'abstract'];
        if (path === '/media/art/landscapes') return ['sunset.jpg', 'mountain.png'];
        if (path === '/media/art/abstract') return ['shapes.jpg'];
        return [];
      });
      mockFs.statSync.mockImplementation((path) => ({
        isDirectory: () => !path.includes('.'),
        isFile: () => path.includes('.'),
      }));

      const items = await adapter.list();

      expect(items).toHaveLength(3);
      expect(items[0].category).toBe('landscapes');
      expect(items[2].category).toBe('abstract');
    });

    it('extracts EXIF metadata', async () => {
      mockFs.readdirSync.mockImplementation((path) => {
        if (path === '/media/art') return ['landscapes'];
        if (path === '/media/art/landscapes') return ['test.jpg'];
        return [];
      });
      mockFs.statSync.mockReturnValue({
        isDirectory: () => false,
        isFile: () => true,
      });

      const items = await adapter.list();

      expect(items[0].artist).toBe('Test Artist');
      expect(items[0].year).toBe(2020);
    });

    it('filters by category when provided', async () => {
      mockFs.readdirSync.mockImplementation((path) => {
        if (path === '/media/art') return ['landscapes', 'abstract'];
        if (path === '/media/art/landscapes') return ['test.jpg'];
        if (path === '/media/art/abstract') return ['shapes.jpg'];
        return [];
      });
      mockFs.statSync.mockReturnValue({
        isDirectory: () => false,
        isFile: () => true,
      });

      const items = await adapter.list({ categories: ['landscapes'] });

      expect(items).toHaveLength(1);
      expect(items[0].category).toBe('landscapes');
    });
  });

  describe('getItem', () => {
    it('returns DisplayableItem for valid path', async () => {
      mockFs.existsSync.mockReturnValue(true);

      const item = await adapter.getItem('canvas:landscapes/sunset.jpg');

      expect(item.id).toBe('canvas:landscapes/sunset.jpg');
      expect(item.category).toBe('landscapes');
      expect(item.imageUrl).toBe('/api/v1/canvas/image/landscapes/sunset.jpg');
    });

    it('returns null for missing file', async () => {
      mockFs.existsSync.mockReturnValue(false);

      const item = await adapter.getItem('canvas:missing.jpg');

      expect(item).toBeNull();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="FilesystemCanvasAdapter.test" -v`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/1_adapters/content/canvas/filesystem/FilesystemCanvasAdapter.mjs
import { DisplayableItem } from '#domains/content/capabilities/Displayable.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

/**
 * Adapter for filesystem-based canvas art.
 * Scans category folders, extracts EXIF metadata.
 */
export class FilesystemCanvasAdapter {
  #basePath;
  #proxyPath;
  #fs;
  #exifReader;

  /**
   * @param {Object} config
   * @param {string} config.basePath - Base path to art folders
   * @param {string} config.proxyPath - Proxy URL path for images
   * @param {Object} deps
   * @param {Object} deps.fs - File system module (for testing)
   * @param {Object} deps.exifReader - EXIF reader module (for testing)
   */
  constructor(config, deps = {}) {
    if (!config.basePath) {
      throw new InfrastructureError('FilesystemCanvasAdapter requires basePath', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'basePath',
      });
    }

    this.#basePath = config.basePath;
    this.#proxyPath = config.proxyPath || '/api/v1/canvas/image';
    this.#fs = deps.fs || require('fs');
    this.#exifReader = deps.exifReader || null;
  }

  get source() {
    return 'canvas-filesystem';
  }

  get prefixes() {
    return [{ prefix: 'canvas' }];
  }

  /**
   * List all art items, optionally filtered
   * @param {Object} filters - { categories?: string[] }
   * @returns {Promise<DisplayableItem[]>}
   */
  async list(filters = {}) {
    const items = [];
    const categories = this.#listCategories();

    for (const category of categories) {
      if (filters.categories?.length > 0 && !filters.categories.includes(category)) {
        continue;
      }

      const categoryPath = `${this.#basePath}/${category}`;
      const files = this.#listImageFiles(categoryPath);

      for (const file of files) {
        const item = await this.#buildItem(category, file);
        if (item) items.push(item);
      }
    }

    return items;
  }

  /**
   * Get single item by ID
   * @param {string} id - Compound ID (canvas:category/file.jpg)
   * @returns {Promise<DisplayableItem|null>}
   */
  async getItem(id) {
    const localPath = id.replace(/^canvas:/, '');
    const fullPath = `${this.#basePath}/${localPath}`;

    if (!this.#fs.existsSync(fullPath)) {
      return null;
    }

    const parts = localPath.split('/');
    const category = parts[0];
    const filename = parts.slice(1).join('/');

    return this.#buildItem(category, filename);
  }

  #listCategories() {
    if (!this.#fs.existsSync(this.#basePath)) return [];

    return this.#fs.readdirSync(this.#basePath)
      .filter(name => {
        const stat = this.#fs.statSync(`${this.#basePath}/${name}`);
        return stat.isDirectory() && !name.startsWith('.');
      });
  }

  #listImageFiles(categoryPath) {
    if (!this.#fs.existsSync(categoryPath)) return [];

    return this.#fs.readdirSync(categoryPath)
      .filter(name => {
        const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
        return IMAGE_EXTENSIONS.includes(ext);
      });
  }

  async #buildItem(category, filename) {
    const localPath = `${category}/${filename}`;
    const fullPath = `${this.#basePath}/${localPath}`;
    const exif = await this.#readExif(fullPath);

    return new DisplayableItem({
      id: `canvas:${localPath}`,
      source: this.source,
      title: this.#titleFromFilename(filename),
      imageUrl: `${this.#proxyPath}/${localPath}`,
      category,
      artist: exif.artist,
      year: exif.year,
      tags: exif.tags || [],
      frameStyle: 'classic',
    });
  }

  async #readExif(filePath) {
    if (!this.#exifReader) {
      return { artist: null, year: null, tags: [] };
    }

    try {
      const data = this.#exifReader.load(this.#fs.readFileSync(filePath));
      return {
        artist: data.Artist?.value || null,
        year: this.#parseYear(data.DateTimeOriginal?.value),
        tags: this.#parseTags(data.ImageDescription?.value),
      };
    } catch {
      return { artist: null, year: null, tags: [] };
    }
  }

  #parseYear(dateString) {
    if (!dateString) return null;
    const match = dateString.match(/^(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
  }

  #parseTags(description) {
    if (!description) return [];
    // Tags in format: "Description. Tags: morning, calm, bright"
    const match = description.match(/Tags:\s*(.+)/i);
    return match ? match[1].split(',').map(t => t.trim()) : [];
  }

  #titleFromFilename(filename) {
    return filename
      .replace(/\.[^.]+$/, '')  // Remove extension
      .replace(/[-_]/g, ' ')     // Replace dashes/underscores with spaces
      .replace(/\b\w/g, c => c.toUpperCase()); // Title case
  }
}

export default FilesystemCanvasAdapter;
```

```javascript
// backend/src/1_adapters/content/canvas/filesystem/index.mjs
export { FilesystemCanvasAdapter } from './FilesystemCanvasAdapter.mjs';
export default FilesystemCanvasAdapter;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="FilesystemCanvasAdapter.test" -v`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/canvas/filesystem/*.mjs \
        tests/isolated/adapter/content/canvas/FilesystemCanvasAdapter.test.mjs
git commit -m "feat(canvas): add FilesystemCanvasAdapter

Filesystem adapter for local art folders:
- Scans category subfolders (/art/landscapes/, etc.)
- Extracts EXIF metadata (artist, year, tags)
- Returns DisplayableItem for each image"
```

---

## Task 6: ImmichCanvasAdapter

**Files:**
- Create: `backend/src/1_adapters/content/canvas/immich/ImmichCanvasAdapter.mjs`
- Create: `backend/src/1_adapters/content/canvas/immich/index.mjs`
- Create: `tests/isolated/adapter/content/canvas/ImmichCanvasAdapter.test.mjs`

**Step 1: Write the failing tests**

```javascript
// tests/isolated/adapter/content/canvas/ImmichCanvasAdapter.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { ImmichCanvasAdapter } from '../../../../../backend/src/1_adapters/content/canvas/immich/ImmichCanvasAdapter.mjs';

describe('ImmichCanvasAdapter', () => {
  let adapter;
  let mockClient;

  beforeEach(() => {
    mockClient = {
      getAlbums: jest.fn().mockResolvedValue([
        { id: 'album-1', albumName: 'Landscapes', assetCount: 5 },
        { id: 'album-2', albumName: 'Abstract', assetCount: 3 },
      ]),
      getAlbum: jest.fn().mockResolvedValue({
        id: 'album-1',
        albumName: 'Landscapes',
        assets: [
          { id: 'asset-1', originalFileName: 'sunset.jpg', type: 'IMAGE', exifInfo: { Artist: 'Monet' } },
          { id: 'asset-2', originalFileName: 'mountain.jpg', type: 'IMAGE', exifInfo: {} },
        ],
      }),
      getAsset: jest.fn().mockResolvedValue({
        id: 'asset-1',
        originalFileName: 'sunset.jpg',
        type: 'IMAGE',
        exifInfo: { Artist: 'Monet', DateTimeOriginal: '2020-01-15' },
      }),
    };

    adapter = new ImmichCanvasAdapter({
      library: 'art',
      proxyPath: '/api/v1/proxy/immich-canvas',
    }, {
      client: mockClient,
    });
  });

  describe('source and prefixes', () => {
    it('has correct source name', () => {
      expect(adapter.source).toBe('canvas-immich');
    });

    it('has canvas-immich prefix', () => {
      expect(adapter.prefixes).toContainEqual({ prefix: 'canvas-immich' });
    });
  });

  describe('list', () => {
    it('fetches albums from art library', async () => {
      const items = await adapter.list();

      expect(mockClient.getAlbums).toHaveBeenCalled();
      expect(items.length).toBeGreaterThan(0);
    });

    it('fetches album contents when album specified', async () => {
      const items = await adapter.list({ albumId: 'album-1' });

      expect(mockClient.getAlbum).toHaveBeenCalledWith('album-1');
      expect(items).toHaveLength(2);
    });

    it('maps albums to categories', async () => {
      const items = await adapter.list({ albumId: 'album-1' });

      expect(items[0].category).toBe('Landscapes');
    });

    it('extracts artist from EXIF', async () => {
      const items = await adapter.list({ albumId: 'album-1' });

      expect(items[0].artist).toBe('Monet');
    });
  });

  describe('getItem', () => {
    it('returns DisplayableItem for asset ID', async () => {
      const item = await adapter.getItem('canvas-immich:asset-1');

      expect(mockClient.getAsset).toHaveBeenCalledWith('asset-1');
      expect(item.id).toBe('canvas-immich:asset-1');
      expect(item.artist).toBe('Monet');
    });

    it('builds correct proxy URL', async () => {
      const item = await adapter.getItem('canvas-immich:asset-1');

      expect(item.imageUrl).toBe('/api/v1/proxy/immich-canvas/assets/asset-1/original');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="ImmichCanvasAdapter.test" -v`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/1_adapters/content/canvas/immich/ImmichCanvasAdapter.mjs
import { DisplayableItem } from '#domains/content/capabilities/Displayable.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Adapter for Immich-based canvas art.
 * Uses a dedicated art library within Immich.
 */
export class ImmichCanvasAdapter {
  #client;
  #library;
  #proxyPath;

  /**
   * @param {Object} config
   * @param {string} config.library - Immich library name for art
   * @param {string} [config.proxyPath] - Proxy URL path
   * @param {Object} deps
   * @param {Object} deps.client - ImmichClient instance
   */
  constructor(config, deps = {}) {
    if (!deps.client) {
      throw new InfrastructureError('ImmichCanvasAdapter requires client', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'client',
      });
    }

    this.#client = deps.client;
    this.#library = config.library || 'art';
    this.#proxyPath = config.proxyPath || '/api/v1/proxy/immich-canvas';
  }

  get source() {
    return 'canvas-immich';
  }

  get prefixes() {
    return [{ prefix: 'canvas-immich' }];
  }

  /**
   * List art items
   * @param {Object} filters - { albumId?: string, categories?: string[] }
   * @returns {Promise<DisplayableItem[]>}
   */
  async list(filters = {}) {
    // If album specified, get its contents
    if (filters.albumId) {
      const album = await this.#client.getAlbum(filters.albumId);
      return this.#albumToItems(album);
    }

    // Otherwise list all albums and their contents
    const albums = await this.#client.getAlbums();
    const items = [];

    for (const album of albums) {
      if (filters.categories?.length > 0 && !filters.categories.includes(album.albumName)) {
        continue;
      }

      const fullAlbum = await this.#client.getAlbum(album.id);
      items.push(...this.#albumToItems(fullAlbum));
    }

    return items;
  }

  /**
   * Get single item by ID
   * @param {string} id - Compound ID (canvas-immich:asset-id)
   * @returns {Promise<DisplayableItem|null>}
   */
  async getItem(id) {
    const assetId = id.replace(/^canvas-immich:/, '');

    try {
      const asset = await this.#client.getAsset(assetId);
      if (!asset) return null;

      return this.#assetToItem(asset, null);
    } catch {
      return null;
    }
  }

  #albumToItems(album) {
    return (album.assets || [])
      .filter(asset => asset.type === 'IMAGE')
      .map(asset => this.#assetToItem(asset, album.albumName));
  }

  #assetToItem(asset, category) {
    const exif = asset.exifInfo || {};

    return new DisplayableItem({
      id: `canvas-immich:${asset.id}`,
      source: this.source,
      title: this.#titleFromFilename(asset.originalFileName),
      imageUrl: `${this.#proxyPath}/assets/${asset.id}/original`,
      thumbnail: `${this.#proxyPath}/assets/${asset.id}/thumbnail`,
      category,
      artist: exif.Artist || null,
      year: this.#parseYear(exif.DateTimeOriginal),
      tags: [],
      frameStyle: 'classic',
      width: asset.width,
      height: asset.height,
    });
  }

  #parseYear(dateString) {
    if (!dateString) return null;
    const match = String(dateString).match(/^(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
  }

  #titleFromFilename(filename) {
    if (!filename) return 'Untitled';
    return filename
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
}

export default ImmichCanvasAdapter;
```

```javascript
// backend/src/1_adapters/content/canvas/immich/index.mjs
export { ImmichCanvasAdapter } from './ImmichCanvasAdapter.mjs';
export default ImmichCanvasAdapter;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="ImmichCanvasAdapter.test" -v`
Expected: PASS (8 tests)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/canvas/immich/*.mjs \
        tests/isolated/adapter/content/canvas/ImmichCanvasAdapter.test.mjs
git commit -m "feat(canvas): add ImmichCanvasAdapter

Immich adapter for art library:
- Queries dedicated art library/albums
- Extracts EXIF metadata (artist, year)
- Maps albums to categories
- Proxies images through backend"
```

---

## Task 7: Canvas API Router

**Files:**
- Create: `backend/src/4_api/v1/routers/canvas.mjs`
- Modify: `backend/src/4_api/v1/index.mjs` (add router)
- Create: `tests/isolated/api/canvas.test.mjs`

**Step 1: Write the failing tests**

```javascript
// tests/isolated/api/canvas.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createCanvasRouter } from '../../../../backend/src/4_api/v1/routers/canvas.mjs';

describe('Canvas API', () => {
  let app;
  let mockCanvasService;

  beforeEach(() => {
    mockCanvasService = {
      getCurrent: jest.fn().mockResolvedValue({
        id: 'canvas:test',
        title: 'Test Art',
        imageUrl: '/api/v1/canvas/image/test',
        category: 'landscapes',
        frameStyle: 'classic',
      }),
      startRotation: jest.fn().mockResolvedValue(undefined),
      stopRotation: jest.fn(),
    };

    const router = createCanvasRouter({ canvasService: mockCanvasService });
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.householdId = 'test-household';
      next();
    });
    app.use('/api/v1/canvas', router);
  });

  describe('GET /current', () => {
    it('returns current art for device', async () => {
      const res = await request(app)
        .get('/api/v1/canvas/current')
        .query({ deviceId: 'living-room-tv' });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('canvas:test');
      expect(mockCanvasService.getCurrent).toHaveBeenCalledWith('living-room-tv', 'test-household');
    });

    it('requires deviceId', async () => {
      const res = await request(app).get('/api/v1/canvas/current');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/deviceId/);
    });
  });

  describe('POST /next', () => {
    it('advances to next art', async () => {
      const res = await request(app)
        .post('/api/v1/canvas/next')
        .send({ deviceId: 'living-room-tv' });

      expect(res.status).toBe(200);
      expect(mockCanvasService.getCurrent).toHaveBeenCalled();
    });
  });

  describe('POST /rotation/start', () => {
    it('starts rotation for device', async () => {
      const res = await request(app)
        .post('/api/v1/canvas/rotation/start')
        .send({ deviceId: 'living-room-tv' });

      expect(res.status).toBe(200);
      expect(mockCanvasService.startRotation).toHaveBeenCalledWith('living-room-tv', 'test-household');
    });
  });

  describe('POST /rotation/stop', () => {
    it('stops rotation for device', async () => {
      const res = await request(app)
        .post('/api/v1/canvas/rotation/stop')
        .send({ deviceId: 'living-room-tv' });

      expect(res.status).toBe(200);
      expect(mockCanvasService.stopRotation).toHaveBeenCalledWith('living-room-tv');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="api/canvas.test" -v`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// backend/src/4_api/v1/routers/canvas.mjs
import { Router } from 'express';

/**
 * Create canvas API router
 * @param {Object} deps
 * @param {Object} deps.canvasService - CanvasService instance
 * @returns {Router}
 */
export function createCanvasRouter({ canvasService }) {
  const router = Router();

  /**
   * GET /current - Get current art for device
   */
  router.get('/current', async (req, res, next) => {
    try {
      const { deviceId } = req.query;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      const householdId = req.householdId;
      const item = await canvasService.getCurrent(deviceId, householdId);

      if (!item) {
        return res.status(404).json({ error: 'No art available' });
      }

      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /next - Advance to next art
   */
  router.post('/next', async (req, res, next) => {
    try {
      const { deviceId } = req.body;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      const householdId = req.householdId;
      const item = await canvasService.getCurrent(deviceId, householdId);

      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /rotation/start - Start rotation for device
   */
  router.post('/rotation/start', async (req, res, next) => {
    try {
      const { deviceId } = req.body;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      const householdId = req.householdId;
      await canvasService.startRotation(deviceId, householdId);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /rotation/stop - Stop rotation for device
   */
  router.post('/rotation/stop', async (req, res, next) => {
    try {
      const { deviceId } = req.body;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      canvasService.stopRotation(deviceId);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createCanvasRouter;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="api/canvas.test" -v`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/canvas.mjs \
        tests/isolated/api/canvas.test.mjs
git commit -m "feat(canvas): add Canvas API router

API endpoints:
- GET /current: get current art for device
- POST /next: advance to next art
- POST /rotation/start: start auto-rotation
- POST /rotation/stop: stop auto-rotation"
```

---

## Task 8: Frontend Art Component Enhancement

**Files:**
- Modify: `frontend/src/modules/AppContainer/Apps/Art/Art.jsx`
- Modify: `frontend/src/modules/AppContainer/Apps/Art/Art.scss`

**Step 1: Review current component**

Read current Art.jsx and Art.scss to understand existing structure.

**Step 2: Update Art.jsx**

```jsx
// frontend/src/modules/AppContainer/Apps/Art/Art.jsx
import { useState, useEffect, useCallback } from "react";
import "./Art.scss";
import { DaylightAPI } from "../../../../lib/api.mjs";

export default function ArtApp({ deviceId }) {
  const [current, setCurrent] = useState(null);
  const [next, setNext] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [error, setError] = useState(null);

  // Fetch current art
  const fetchCurrent = useCallback(async () => {
    try {
      const response = await DaylightAPI(`/canvas/current?deviceId=${deviceId}`);
      if (response.ok) {
        const data = await response.json();
        if (current && data.id !== current.id) {
          // Transition to new art
          setNext(data);
          setTransitioning(true);
          setTimeout(() => {
            setCurrent(data);
            setNext(null);
            setTransitioning(false);
          }, 1000);
        } else if (!current) {
          setCurrent(data);
        }
      }
    } catch (err) {
      setError(err.message);
    }
  }, [deviceId, current]);

  // Initial fetch and polling
  useEffect(() => {
    fetchCurrent();
    const interval = setInterval(fetchCurrent, 30000);
    return () => clearInterval(interval);
  }, [fetchCurrent]);

  // Preload next image
  useEffect(() => {
    if (next?.imageUrl) {
      const img = new Image();
      img.src = next.imageUrl;
    }
  }, [next]);

  // Handle overlay toggle
  const toggleOverlay = useCallback(() => {
    setShowOverlay(prev => !prev);
  }, []);

  if (error) {
    return <div className="art-app art-error">{error}</div>;
  }

  if (!current) {
    return <div className="art-app art-loading">Loading...</div>;
  }

  const frameClass = `art-frame art-frame--${current.frameStyle || 'classic'}`;

  return (
    <div className="art-app" onClick={toggleOverlay}>
      <div className={frameClass}>
        <div className="art-matte">
          <div className="art-inner-frame">
            <img
              src={current.imageUrl}
              alt={current.title}
              className={transitioning ? 'fading-out' : ''}
            />
            {next && transitioning && (
              <img
                src={next.imageUrl}
                alt={next.title}
                className="fading-in"
              />
            )}
          </div>
        </div>
      </div>

      {showOverlay && (
        <div className="art-overlay">
          <h2 className="art-overlay__title">{current.title}</h2>
          {current.artist && (
            <p className="art-overlay__artist">{current.artist}</p>
          )}
          {current.year && (
            <span className="art-overlay__year">{current.year}</span>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 3: Update Art.scss**

```scss
// frontend/src/modules/AppContainer/Apps/Art/Art.scss

.art-app {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1a1a1a;
  box-sizing: border-box;
  position: relative;
  cursor: pointer;
}

.art-loading,
.art-error {
  color: #666;
  font-size: 1.5rem;
}

// ─── Frame Variants ─────────────────────────────────────────

.art-frame {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

// Classic frame (default)
.art-frame--classic {
  background: linear-gradient(145deg, #3d3225, #2a2218);
  box-shadow:
    inset 2px 2px 4px rgba(255, 255, 255, 0.15),
    inset -2px -2px 4px rgba(0, 0, 0, 0.3);
  padding: 1%;

  .art-matte {
    background:
      url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E"),
      linear-gradient(165deg, #a89c84 0%, #998c74 50%, #8d7a6b 100%);
    background-blend-mode: soft-light, normal;
    box-shadow:
      inset 3px 3px 6px rgba(0, 0, 0, 0.15),
      inset -1px -1px 3px rgba(255, 255, 255, 0.8);
    padding: 5%;
  }

  .art-inner-frame {
    background: linear-gradient(145deg, #4a4035, #2d261f);
    padding: 0.4%;
    box-shadow:
      inset 1px 1px 2px rgba(255, 255, 255, 0.1),
      inset -1px -1px 2px rgba(0, 0, 0, 0.3),
      2px 2px 8px rgba(0, 0, 0, 0.2);
  }
}

// Minimal frame
.art-frame--minimal {
  background: #000;
  padding: 0.5%;

  .art-matte {
    background: #000;
    padding: 0;
  }

  .art-inner-frame {
    background: transparent;
    padding: 0;
    box-shadow: none;
  }
}

// Ornate frame
.art-frame--ornate {
  background: linear-gradient(145deg, #8b7355, #5c4a37);
  box-shadow:
    inset 3px 3px 6px rgba(255, 215, 0, 0.2),
    inset -3px -3px 6px rgba(0, 0, 0, 0.4),
    0 0 20px rgba(0, 0, 0, 0.5);
  padding: 2%;
  border: 4px solid #6b5344;

  .art-matte {
    background: linear-gradient(165deg, #f5f0e6 0%, #e8e0d0 100%);
    box-shadow:
      inset 4px 4px 8px rgba(0, 0, 0, 0.1),
      inset -2px -2px 4px rgba(255, 255, 255, 0.9);
    padding: 6%;
  }

  .art-inner-frame {
    background: linear-gradient(145deg, #8b7355, #5c4a37);
    padding: 0.5%;
    box-shadow:
      inset 2px 2px 4px rgba(255, 215, 0, 0.15),
      inset -2px -2px 4px rgba(0, 0, 0, 0.3);
  }
}

// No frame
.art-frame--none {
  background: transparent;
  padding: 0;

  .art-matte {
    background: transparent;
    padding: 0;
    box-shadow: none;
  }

  .art-inner-frame {
    background: transparent;
    padding: 0;
    box-shadow: none;
  }
}

// ─── Common Elements ────────────────────────────────────────

.art-matte {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.art-inner-frame {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.art-app img {
  height: 100%;
  width: auto;
  object-fit: contain;
  display: block;
  background: #2a2218;
}

// ─── Transitions ────────────────────────────────────────────

.fading-out {
  animation: fadeOut 1s ease-in-out forwards;
}

.fading-in {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  animation: fadeIn 1s ease-in-out forwards;
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

// ─── Info Overlay ───────────────────────────────────────────

.art-overlay {
  position: absolute;
  bottom: 10%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  padding: 1rem 2rem;
  border-radius: 8px;
  text-align: center;
  animation: overlayFadeIn 0.3s ease-out;

  &__title {
    margin: 0;
    font-size: 1.5rem;
    color: #fff;
    font-weight: 300;
  }

  &__artist {
    margin: 0.5rem 0 0;
    font-size: 1rem;
    color: #ccc;
    font-style: italic;
  }

  &__year {
    display: inline-block;
    margin-top: 0.25rem;
    font-size: 0.875rem;
    color: #999;
  }
}

@keyframes overlayFadeIn {
  from { opacity: 0; transform: translateX(-50%) translateY(10px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
```

**Step 4: Verify manually**

Start dev server and verify Art component displays correctly with different frame styles.

**Step 5: Commit**

```bash
git add frontend/src/modules/AppContainer/Apps/Art/Art.jsx \
        frontend/src/modules/AppContainer/Apps/Art/Art.scss
git commit -m "feat(canvas): enhance Art frontend component

- Fetch art from canvas API
- Crossfade transitions between images
- Info overlay on click (title, artist, year)
- Frame style variants (minimal, classic, ornate, none)
- Poll for updates every 30s"
```

---

## Task 9: Integration Wiring (Bootstrap)

**Files:**
- Modify: `backend/src/0_system/registries/IntegrationLoader.mjs`
- Create: `backend/src/1_adapters/content/canvas/index.mjs`

**Step 1: Create canvas adapter index**

```javascript
// backend/src/1_adapters/content/canvas/index.mjs
export { FilesystemCanvasAdapter } from './filesystem/FilesystemCanvasAdapter.mjs';
export { ImmichCanvasAdapter } from './immich/ImmichCanvasAdapter.mjs';
```

**Step 2: Update IntegrationLoader**

Add canvas integration loading (follow existing pattern for gallery/media).

**Step 3: Commit**

```bash
git add backend/src/1_adapters/content/canvas/index.mjs \
        backend/src/0_system/registries/IntegrationLoader.mjs
git commit -m "feat(canvas): wire canvas adapters to integration loader

Register canvas-filesystem and canvas-immich adapters
when household has canvas integration configured"
```

---

## Task 10: Sample Config & Documentation

**Files:**
- Create: `data/household/apps/canvas/config.yml.example`
- Update: `docs/plans/2026-01-31-canvas-art-provider-design.md` (mark complete)

**Step 1: Create example config**

```yaml
# data/household/apps/canvas/config.yml.example
# Canvas Art Display Configuration

defaults:
  rotation:
    interval: 300          # seconds between art changes
    mode: random           # random | sequential
    avoidRepeats: true
  frame:
    style: classic         # minimal | classic | ornate | none
  transitions:
    type: crossfade
    duration: 1000         # ms
  overlay:
    enabled: false
    showOnInteract: true

contexts:
  time:
    morning:
      tags: [bright, warm]
      categories: [landscapes, nature]
    evening:
      tags: [calm, warm]
    night:
      tags: [dark, minimal]
      frame:
        style: none

  calendar:
    christmas:
      dateRange: [12-01, 12-31]
      tags: [holiday, winter]

  devices:
    living-room-tv:
      categories: [landscapes, classical]
      frame:
        style: ornate
    bedroom-display:
      rotation:
        interval: 600
      tags: [calm]
```

**Step 2: Update integration config**

```yaml
# Add to household/config/integrations.yml
canvas:
  - provider: immich
    library: art
  - provider: filesystem
    path: /media/art
```

**Step 3: Commit**

```bash
git add data/household/apps/canvas/config.yml.example
git commit -m "docs(canvas): add example configuration

Sample config showing:
- Rotation settings
- Frame style defaults
- Time/calendar/device contexts
- Integration with immich and filesystem"
```

---

## Summary

| Task | Component | Tests |
|------|-----------|-------|
| 1 | DisplayableItem capability | 5 |
| 2 | CanvasSelectionService | 10 |
| 3 | Application ports | 3 |
| 4 | CanvasService | 7 |
| 5 | FilesystemCanvasAdapter | 7 |
| 6 | ImmichCanvasAdapter | 8 |
| 7 | Canvas API router | 5 |
| 8 | Frontend Art component | manual |
| 9 | Bootstrap wiring | integration |
| 10 | Config & docs | - |

**Total new tests:** ~45

**Estimated commits:** 10
