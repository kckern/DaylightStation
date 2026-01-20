# Content Domain Parity Completion Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring content domain and adapters to full parity with legacy implementation, addressing all P0/P1 gaps identified in the 2026-01-13 audit.

**Architecture:** Four-phase approach: (1) Extend domain capabilities with missing fields, (2) Complete QueueService with priority/filtering logic, (3) Add PlexAdapter metadata APIs, (4) Complete FilesystemAdapter with ID3/household/image support. Each phase is independently testable and deployable.

**Tech Stack:** Node.js/ESM, js-yaml, music-metadata (for ID3), Jest for testing

---

## Phase 1: Domain Capabilities Enhancement

### Task 1.1: Add Action Properties to Item Base

**Files:**
- Modify: `backend/src/1_domains/content/entities/Item.mjs`
- Test: `tests/unit/content/entities/Item.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/content/entities/Item.test.mjs
describe('action properties', () => {
  it('should support play action', () => {
    const item = new Item({
      id: 'plex:123',
      source: 'plex',
      title: 'Test',
      actions: { play: { plex: '123' } }
    });
    expect(item.actions.play).toEqual({ plex: '123' });
  });

  it('should support queue action', () => {
    const item = new Item({
      id: 'folder:tvapp',
      source: 'folder',
      title: 'TV App',
      actions: { queue: { playlist: 'tvapp' } }
    });
    expect(item.actions.queue).toEqual({ playlist: 'tvapp' });
  });

  it('should support list action', () => {
    const item = new Item({
      id: 'plex:456',
      source: 'plex',
      title: 'Shows',
      actions: { list: { plex: '456' } }
    });
    expect(item.actions.list).toEqual({ plex: '456' });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="Item.test" -t "action properties"`
Expected: FAIL - actions property not handled

**Step 3: Write minimal implementation**

```javascript
// In Item.mjs constructor, add after metadata assignment:
this.actions = data.actions || null;
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="Item.test" -t "action properties"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/entities/Item.mjs tests/unit/content/entities/Item.test.mjs
git commit -m "feat(entities): add action properties to Item base class"
```

---

### Task 1.2: Add Media Identifiers to Item

**Files:**
- Modify: `backend/src/1_domains/content/entities/Item.mjs`
- Test: `tests/unit/content/entities/Item.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/content/entities/Item.test.mjs
describe('media identifiers', () => {
  it('should extract plex key from compound ID', () => {
    const item = new Item({
      id: 'plex:12345',
      source: 'plex',
      title: 'Test'
    });
    expect(item.plex).toBe('12345');
    expect(item.media_key).toBe('plex:12345');
  });

  it('should extract filesystem path from compound ID', () => {
    const item = new Item({
      id: 'filesystem:audio/music/song.mp3',
      source: 'filesystem',
      title: 'Song'
    });
    expect(item.media_key).toBe('filesystem:audio/music/song.mp3');
  });

  it('should allow explicit media_key override', () => {
    const item = new Item({
      id: 'plex:123',
      source: 'plex',
      title: 'Test',
      media_key: 'custom-key'
    });
    expect(item.media_key).toBe('custom-key');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="Item.test" -t "media identifiers"`
Expected: FAIL - plex and media_key properties undefined

**Step 3: Write minimal implementation**

```javascript
// In Item.mjs, add getters after constructor:

/**
 * Get the plex rating key (for plex items)
 * @returns {string|null}
 */
get plex() {
  if (this.source === 'plex') {
    return this.getLocalId();
  }
  return this.metadata?.plex || null;
}

/**
 * Get the media key for logging/requests
 * @returns {string}
 */
get media_key() {
  return this._media_key || this.id;
}

// In constructor, add:
this._media_key = data.media_key || null;
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="Item.test" -t "media identifiers"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/entities/Item.mjs tests/unit/content/entities/Item.test.mjs
git commit -m "feat(entities): add plex and media_key identifiers to Item"
```

---

### Task 1.3: Add Label Alias to Item

**Files:**
- Modify: `backend/src/1_domains/content/entities/Item.mjs`
- Test: `tests/unit/content/entities/Item.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/content/entities/Item.test.mjs
describe('label property', () => {
  it('should return explicit label if provided', () => {
    const item = new Item({
      id: 'test:1',
      source: 'test',
      title: 'Full Title',
      label: 'Short'
    });
    expect(item.label).toBe('Short');
  });

  it('should fall back to title if no label', () => {
    const item = new Item({
      id: 'test:1',
      source: 'test',
      title: 'Full Title'
    });
    expect(item.label).toBe('Full Title');
  });

  it('should check metadata.label as fallback', () => {
    const item = new Item({
      id: 'test:1',
      source: 'test',
      title: 'Full Title',
      metadata: { label: 'Meta Label' }
    });
    expect(item.label).toBe('Meta Label');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="Item.test" -t "label property"`
Expected: FAIL - label property undefined

**Step 3: Write minimal implementation**

```javascript
// In Item.mjs, add getter:

/**
 * Get display label (falls back to title)
 * @returns {string}
 */
get label() {
  return this._label || this.metadata?.label || this.title;
}

// In constructor, add:
this._label = data.label || null;
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="Item.test" -t "label property"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/entities/Item.mjs tests/unit/content/entities/Item.test.mjs
git commit -m "feat(entities): add label property with title fallback"
```

---

### Task 1.4: Add Watch State Fields to PlayableItem

**Files:**
- Modify: `backend/src/1_domains/content/capabilities/Playable.mjs`
- Test: `tests/unit/content/capabilities/Playable.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/content/capabilities/Playable.test.mjs
describe('watch state fields', () => {
  it('should include watch progress percentage', () => {
    const item = new PlayableItem({
      id: 'plex:123',
      source: 'plex',
      title: 'Movie',
      mediaType: 'video',
      mediaUrl: '/stream/123',
      duration: 7200,
      resumePosition: 3600,
      watchProgress: 50
    });
    expect(item.watchProgress).toBe(50);
  });

  it('should calculate watchProgress from resumePosition/duration', () => {
    const item = new PlayableItem({
      id: 'plex:123',
      source: 'plex',
      title: 'Movie',
      mediaType: 'video',
      mediaUrl: '/stream/123',
      duration: 7200,
      resumePosition: 3600
    });
    expect(item.watchProgress).toBe(50);
  });

  it('should include watchSeconds alias for resumePosition', () => {
    const item = new PlayableItem({
      id: 'plex:123',
      source: 'plex',
      title: 'Movie',
      mediaType: 'video',
      mediaUrl: '/stream/123',
      resumePosition: 3600
    });
    expect(item.watchSeconds).toBe(3600);
  });

  it('should include lastPlayed timestamp', () => {
    const item = new PlayableItem({
      id: 'plex:123',
      source: 'plex',
      title: 'Movie',
      mediaType: 'video',
      mediaUrl: '/stream/123',
      lastPlayed: '2026-01-13T14:30:00Z'
    });
    expect(item.lastPlayed).toBe('2026-01-13T14:30:00Z');
  });

  it('should include playCount', () => {
    const item = new PlayableItem({
      id: 'plex:123',
      source: 'plex',
      title: 'Movie',
      mediaType: 'video',
      mediaUrl: '/stream/123',
      playCount: 3
    });
    expect(item.playCount).toBe(3);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="Playable.test" -t "watch state fields"`
Expected: FAIL - properties undefined

**Step 3: Write minimal implementation**

```javascript
// In Playable.mjs PlayableItem constructor, add after existing assignments:
this.lastPlayed = data.lastPlayed || null;
this.playCount = data.playCount || 0;
this._watchProgress = data.watchProgress ?? null;

// Add getters:

/**
 * Get watch progress percentage (0-100)
 * @returns {number|null}
 */
get watchProgress() {
  if (this._watchProgress !== null) return this._watchProgress;
  if (this.resumePosition && this.duration) {
    return Math.round((this.resumePosition / this.duration) * 100);
  }
  return null;
}

/**
 * Alias for resumePosition (legacy compatibility)
 * @returns {number|null}
 */
get watchSeconds() {
  return this.resumePosition;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="Playable.test" -t "watch state fields"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/capabilities/Playable.mjs tests/unit/content/capabilities/Playable.test.mjs
git commit -m "feat(capabilities): add watch state fields to PlayableItem"
```

---

### Task 1.5: Add Behavior Flags to PlayableItem

**Files:**
- Modify: `backend/src/1_domains/content/capabilities/Playable.mjs`
- Test: `tests/unit/content/capabilities/Playable.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/content/capabilities/Playable.test.mjs
describe('behavior flags', () => {
  it('should support shuffle flag', () => {
    const item = new PlayableItem({
      id: 'folder:music',
      source: 'folder',
      title: 'Music',
      mediaType: 'audio',
      mediaUrl: '/stream/music',
      shuffle: true
    });
    expect(item.shuffle).toBe(true);
  });

  it('should support continuous flag', () => {
    const item = new PlayableItem({
      id: 'folder:ambient',
      source: 'folder',
      title: 'Ambient',
      mediaType: 'audio',
      mediaUrl: '/stream/ambient',
      continuous: true
    });
    expect(item.continuous).toBe(true);
  });

  it('should support resume flag', () => {
    const item = new PlayableItem({
      id: 'plex:123',
      source: 'plex',
      title: 'Movie',
      mediaType: 'video',
      mediaUrl: '/stream/123',
      resume: true
    });
    expect(item.resume).toBe(true);
  });

  it('should support active flag for queue filtering', () => {
    const item = new PlayableItem({
      id: 'plex:123',
      source: 'plex',
      title: 'Movie',
      mediaType: 'video',
      mediaUrl: '/stream/123',
      active: false
    });
    expect(item.active).toBe(false);
  });

  it('should default active to true', () => {
    const item = new PlayableItem({
      id: 'plex:123',
      source: 'plex',
      title: 'Movie',
      mediaType: 'video',
      mediaUrl: '/stream/123'
    });
    expect(item.active).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="Playable.test" -t "behavior flags"`
Expected: FAIL - properties undefined

**Step 3: Write minimal implementation**

```javascript
// In Playable.mjs PlayableItem constructor, add:
this.shuffle = data.shuffle || false;
this.continuous = data.continuous || false;
this.resume = data.resume || false;
this.active = data.active !== false; // defaults to true
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="Playable.test" -t "behavior flags"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/capabilities/Playable.mjs tests/unit/content/capabilities/Playable.test.mjs
git commit -m "feat(capabilities): add behavior flags to PlayableItem"
```

---

## Phase 2: QueueService Completion

### Task 2.1: Add Priority Ordering

**Files:**
- Modify: `backend/src/1_domains/content/services/QueueService.mjs`
- Test: `tests/unit/content/services/QueueService.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/content/services/QueueService.test.mjs
describe('priority ordering', () => {
  it('should order in_progress items first', () => {
    const items = [
      { id: '1', title: 'Unwatched', percent: 0, priority: 'medium' },
      { id: '2', title: 'In Progress', percent: 45, priority: 'in_progress' },
      { id: '3', title: 'Also Unwatched', percent: 0, priority: 'medium' }
    ];
    const sorted = QueueService.sortByPriority(items);
    expect(sorted[0].id).toBe('2');
  });

  it('should order urgent items after in_progress', () => {
    const items = [
      { id: '1', title: 'Normal', percent: 0, priority: 'medium' },
      { id: '2', title: 'Urgent', percent: 0, priority: 'urgent' },
      { id: '3', title: 'In Progress', percent: 50, priority: 'in_progress' }
    ];
    const sorted = QueueService.sortByPriority(items);
    expect(sorted[0].id).toBe('3'); // in_progress first
    expect(sorted[1].id).toBe('2'); // urgent second
  });

  it('should sort in_progress items by percent descending', () => {
    const items = [
      { id: '1', title: 'Low Progress', percent: 20, priority: 'in_progress' },
      { id: '2', title: 'High Progress', percent: 80, priority: 'in_progress' },
      { id: '3', title: 'Mid Progress', percent: 50, priority: 'in_progress' }
    ];
    const sorted = QueueService.sortByPriority(items);
    expect(sorted[0].id).toBe('2'); // 80%
    expect(sorted[1].id).toBe('3'); // 50%
    expect(sorted[2].id).toBe('1'); // 20%
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="QueueService.test" -t "priority ordering"`
Expected: FAIL - sortByPriority not defined

**Step 3: Write minimal implementation**

```javascript
// In QueueService.mjs, add static method:

const PRIORITY_ORDER = {
  'in_progress': 0,
  'urgent': 1,
  'high': 2,
  'medium': 3,
  'low': 4
};

/**
 * Sort items by priority
 * @param {Array} items - Items with priority field
 * @returns {Array} Sorted items
 */
static sortByPriority(items) {
  return [...items].sort((a, b) => {
    const priorityA = PRIORITY_ORDER[a.priority] ?? 3;
    const priorityB = PRIORITY_ORDER[b.priority] ?? 3;

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    // For in_progress items, sort by percent descending
    if (a.priority === 'in_progress' && b.priority === 'in_progress') {
      return (b.percent || 0) - (a.percent || 0);
    }

    return 0;
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="QueueService.test" -t "priority ordering"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/services/QueueService.mjs tests/unit/content/services/QueueService.test.mjs
git commit -m "feat(services): add priority ordering to QueueService"
```

---

### Task 2.2: Add Date Filtering (skip_after)

**Files:**
- Modify: `backend/src/1_domains/content/services/QueueService.mjs`
- Test: `tests/unit/content/services/QueueService.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/content/services/QueueService.test.mjs
describe('skip_after filtering', () => {
  it('should skip items past their skip_after date', () => {
    const items = [
      { id: '1', title: 'Current', skip_after: '2026-12-31' },
      { id: '2', title: 'Expired', skip_after: '2025-01-01' },
      { id: '3', title: 'No Deadline', skip_after: null }
    ];
    const filtered = QueueService.filterBySkipAfter(items);
    expect(filtered.map(i => i.id)).toEqual(['1', '3']);
  });

  it('should mark items as urgent if skip_after within 8 days', () => {
    const now = new Date('2026-01-13');
    const items = [
      { id: '1', title: 'Urgent', skip_after: '2026-01-20', priority: 'medium' }, // 7 days
      { id: '2', title: 'Not Urgent', skip_after: '2026-01-25', priority: 'medium' } // 12 days
    ];
    const enriched = QueueService.applyUrgency(items, now);
    expect(enriched[0].priority).toBe('urgent');
    expect(enriched[1].priority).toBe('medium');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="QueueService.test" -t "skip_after filtering"`
Expected: FAIL - methods not defined

**Step 3: Write minimal implementation**

```javascript
// In QueueService.mjs, add:

const URGENCY_DAYS = 8;

/**
 * Filter items that are past their skip_after deadline
 * @param {Array} items
 * @param {Date} [now] - Current date for testing
 * @returns {Array}
 */
static filterBySkipAfter(items, now = new Date()) {
  return items.filter(item => {
    if (!item.skip_after) return true;
    const deadline = new Date(item.skip_after);
    return deadline >= now;
  });
}

/**
 * Mark items as urgent if skip_after is within URGENCY_DAYS
 * @param {Array} items
 * @param {Date} [now] - Current date for testing
 * @returns {Array}
 */
static applyUrgency(items, now = new Date()) {
  const urgencyThreshold = new Date(now);
  urgencyThreshold.setDate(urgencyThreshold.getDate() + URGENCY_DAYS);

  return items.map(item => {
    if (!item.skip_after) return item;
    const deadline = new Date(item.skip_after);
    if (deadline <= urgencyThreshold && item.priority !== 'in_progress') {
      return { ...item, priority: 'urgent' };
    }
    return item;
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="QueueService.test" -t "skip_after filtering"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/services/QueueService.mjs tests/unit/content/services/QueueService.test.mjs
git commit -m "feat(services): add skip_after filtering and urgency to QueueService"
```

---

### Task 2.3: Add Date Filtering (wait_until)

**Files:**
- Modify: `backend/src/1_domains/content/services/QueueService.mjs`
- Test: `tests/unit/content/services/QueueService.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/content/services/QueueService.test.mjs
describe('wait_until filtering', () => {
  it('should skip items with wait_until more than 2 days in future', () => {
    const now = new Date('2026-01-13');
    const items = [
      { id: '1', title: 'Available Now', wait_until: '2026-01-12' },
      { id: '2', title: 'Soon Available', wait_until: '2026-01-15' }, // 2 days
      { id: '3', title: 'Not Yet', wait_until: '2026-01-20' }, // 7 days
      { id: '4', title: 'No Wait', wait_until: null }
    ];
    const filtered = QueueService.filterByWaitUntil(items, now);
    expect(filtered.map(i => i.id)).toEqual(['1', '2', '4']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="QueueService.test" -t "wait_until filtering"`
Expected: FAIL - filterByWaitUntil not defined

**Step 3: Write minimal implementation**

```javascript
// In QueueService.mjs, add:

const WAIT_LOOKAHEAD_DAYS = 2;

/**
 * Filter items that have wait_until more than WAIT_LOOKAHEAD_DAYS in future
 * @param {Array} items
 * @param {Date} [now] - Current date for testing
 * @returns {Array}
 */
static filterByWaitUntil(items, now = new Date()) {
  const lookaheadDate = new Date(now);
  lookaheadDate.setDate(lookaheadDate.getDate() + WAIT_LOOKAHEAD_DAYS);

  return items.filter(item => {
    if (!item.wait_until) return true;
    const waitDate = new Date(item.wait_until);
    return waitDate <= lookaheadDate;
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="QueueService.test" -t "wait_until filtering"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/services/QueueService.mjs tests/unit/content/services/QueueService.test.mjs
git commit -m "feat(services): add wait_until filtering to QueueService"
```

---

### Task 2.4: Add Hold and Watched Filtering

**Files:**
- Modify: `backend/src/1_domains/content/services/QueueService.mjs`
- Test: `tests/unit/content/services/QueueService.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/content/services/QueueService.test.mjs
describe('hold and watched filtering', () => {
  it('should skip items on hold', () => {
    const items = [
      { id: '1', title: 'Active', hold: false },
      { id: '2', title: 'On Hold', hold: true },
      { id: '3', title: 'No Hold Field' }
    ];
    const filtered = QueueService.filterByHold(items);
    expect(filtered.map(i => i.id)).toEqual(['1', '3']);
  });

  it('should skip items marked as watched', () => {
    const items = [
      { id: '1', title: 'Unwatched', watched: false, percent: 0 },
      { id: '2', title: 'Watched Flag', watched: true, percent: 50 },
      { id: '3', title: 'Watched by Percent', watched: false, percent: 95 },
      { id: '4', title: 'In Progress', watched: false, percent: 50 }
    ];
    const filtered = QueueService.filterByWatched(items);
    expect(filtered.map(i => i.id)).toEqual(['1', '4']);
  });

  it('should use 90% threshold for watched detection', () => {
    const items = [
      { id: '1', percent: 89 },
      { id: '2', percent: 90 },
      { id: '3', percent: 91 }
    ];
    const filtered = QueueService.filterByWatched(items);
    expect(filtered.map(i => i.id)).toEqual(['1']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="QueueService.test" -t "hold and watched filtering"`
Expected: FAIL - methods not defined

**Step 3: Write minimal implementation**

```javascript
// In QueueService.mjs, add:

const WATCHED_THRESHOLD = 90;

/**
 * Filter out items that are on hold
 * @param {Array} items
 * @returns {Array}
 */
static filterByHold(items) {
  return items.filter(item => !item.hold);
}

/**
 * Filter out items that are watched (>= 90% or explicitly marked)
 * @param {Array} items
 * @returns {Array}
 */
static filterByWatched(items) {
  return items.filter(item => {
    if (item.watched) return false;
    if ((item.percent || 0) >= WATCHED_THRESHOLD) return false;
    return true;
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="QueueService.test" -t "hold and watched filtering"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/services/QueueService.mjs tests/unit/content/services/QueueService.test.mjs
git commit -m "feat(services): add hold and watched filtering to QueueService"
```

---

### Task 2.5: Add Day-of-Week Filtering

**Files:**
- Modify: `backend/src/1_domains/content/services/QueueService.mjs`
- Test: `tests/unit/content/services/QueueService.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/content/services/QueueService.test.mjs
describe('day-of-week filtering', () => {
  it('should filter by specific weekday', () => {
    // Monday = 1 in ISO
    const monday = new Date('2026-01-13'); // This is a Tuesday, let's use a Monday
    const items = [
      { id: '1', title: 'Monday Only', days: [1] },
      { id: '2', title: 'Tuesday Only', days: [2] },
      { id: '3', title: 'Any Day', days: null }
    ];
    const filtered = QueueService.filterByDayOfWeek(items, new Date('2026-01-13')); // Tuesday
    expect(filtered.map(i => i.id)).toEqual(['2', '3']);
  });

  it('should handle Weekdays preset', () => {
    const friday = new Date('2026-01-17'); // Friday
    const saturday = new Date('2026-01-18'); // Saturday
    const items = [
      { id: '1', title: 'Weekdays', days: 'Weekdays' }
    ];
    expect(QueueService.filterByDayOfWeek(items, friday).length).toBe(1);
    expect(QueueService.filterByDayOfWeek(items, saturday).length).toBe(0);
  });

  it('should handle Weekend preset', () => {
    const friday = new Date('2026-01-17');
    const saturday = new Date('2026-01-18');
    const items = [
      { id: '1', title: 'Weekend', days: 'Weekend' }
    ];
    expect(QueueService.filterByDayOfWeek(items, friday).length).toBe(0);
    expect(QueueService.filterByDayOfWeek(items, saturday).length).toBe(1);
  });

  it('should handle M•W•F preset', () => {
    const monday = new Date('2026-01-13'); // Actually Tuesday - need correct date
    const items = [
      { id: '1', title: 'MWF', days: 'M•W•F' }
    ];
    // Monday Jan 13 2026 - check ISO day
    const wed = new Date('2026-01-15'); // Wednesday
    expect(QueueService.filterByDayOfWeek(items, wed).length).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="QueueService.test" -t "day-of-week filtering"`
Expected: FAIL - filterByDayOfWeek not defined

**Step 3: Write minimal implementation**

```javascript
// In QueueService.mjs, add:

const DAY_PRESETS = {
  'Weekdays': [1, 2, 3, 4, 5],
  'Weekend': [6, 7],
  'M•W•F': [1, 3, 5],
  'T•Th': [2, 4],
  'M•W': [1, 3]
};

/**
 * Filter items by day of week
 * @param {Array} items - Items with optional days field
 * @param {Date} [now] - Current date for testing
 * @returns {Array}
 */
static filterByDayOfWeek(items, now = new Date()) {
  // ISO weekday: 1=Monday, 7=Sunday
  const dayOfWeek = now.getDay() || 7; // Convert Sunday from 0 to 7

  return items.filter(item => {
    if (!item.days) return true;

    let allowedDays = item.days;
    if (typeof allowedDays === 'string') {
      allowedDays = DAY_PRESETS[allowedDays] || [];
    }

    return allowedDays.includes(dayOfWeek);
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="QueueService.test" -t "day-of-week filtering"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/services/QueueService.mjs tests/unit/content/services/QueueService.test.mjs
git commit -m "feat(services): add day-of-week filtering to QueueService"
```

---

### Task 2.6: Add Unified Filter Pipeline

**Files:**
- Modify: `backend/src/1_domains/content/services/QueueService.mjs`
- Test: `tests/unit/content/services/QueueService.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/content/services/QueueService.test.mjs
describe('filter pipeline', () => {
  it('should apply all filters in order', () => {
    const items = [
      { id: '1', title: 'Good', percent: 0, hold: false },
      { id: '2', title: 'On Hold', percent: 0, hold: true },
      { id: '3', title: 'Watched', percent: 95, hold: false },
      { id: '4', title: 'Expired', percent: 0, hold: false, skip_after: '2020-01-01' },
      { id: '5', title: 'In Progress', percent: 50, hold: false }
    ];
    const filtered = QueueService.applyFilters(items);
    expect(filtered.map(i => i.id)).toEqual(['1', '5']);
  });

  it('should support fallback cascade when empty', () => {
    const items = [
      { id: '1', title: 'Watched', percent: 95, hold: false }
    ];
    // First pass returns empty, fallback ignores watched status
    const filtered = QueueService.applyFilters(items, { allowFallback: true });
    expect(filtered.map(i => i.id)).toEqual(['1']);
  });

  it('should apply urgency before sorting', () => {
    const now = new Date('2026-01-13');
    const items = [
      { id: '1', title: 'Normal', percent: 0, priority: 'medium' },
      { id: '2', title: 'Deadline Soon', percent: 0, priority: 'medium', skip_after: '2026-01-18' }
    ];
    const result = QueueService.buildQueue(items, { now });
    expect(result[0].id).toBe('2'); // Urgent first
    expect(result[0].priority).toBe('urgent');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="QueueService.test" -t "filter pipeline"`
Expected: FAIL - applyFilters and buildQueue not defined

**Step 3: Write minimal implementation**

```javascript
// In QueueService.mjs, add:

/**
 * Apply all filters to items
 * @param {Array} items
 * @param {Object} options
 * @param {boolean} [options.ignoreSkips=false]
 * @param {boolean} [options.ignoreWatchStatus=false]
 * @param {boolean} [options.ignoreWait=false]
 * @param {boolean} [options.allowFallback=false]
 * @param {Date} [options.now]
 * @returns {Array}
 */
static applyFilters(items, options = {}) {
  const { ignoreSkips, ignoreWatchStatus, ignoreWait, allowFallback, now } = options;

  let result = [...items];

  // Apply filters based on ignore flags
  if (!ignoreSkips) {
    result = this.filterByHold(result);
    result = this.filterBySkipAfter(result, now);
  }

  if (!ignoreWatchStatus) {
    result = this.filterByWatched(result);
  }

  if (!ignoreWait) {
    result = this.filterByWaitUntil(result, now);
  }

  result = this.filterByDayOfWeek(result, now);

  // Fallback cascade if empty
  if (result.length === 0 && allowFallback) {
    if (!ignoreSkips) {
      return this.applyFilters(items, { ...options, ignoreSkips: true });
    }
    if (!ignoreWatchStatus) {
      return this.applyFilters(items, { ...options, ignoreSkips: true, ignoreWatchStatus: true });
    }
    if (!ignoreWait) {
      return this.applyFilters(items, { ...options, ignoreSkips: true, ignoreWatchStatus: true, ignoreWait: true });
    }
  }

  return result;
}

/**
 * Build a prioritized, filtered queue from items
 * @param {Array} items
 * @param {Object} options
 * @returns {Array}
 */
static buildQueue(items, options = {}) {
  const { now } = options;

  // Apply urgency based on deadlines
  let result = this.applyUrgency(items, now);

  // Apply filters with fallback
  result = this.applyFilters(result, { ...options, allowFallback: true });

  // Sort by priority
  result = this.sortByPriority(result);

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="QueueService.test" -t "filter pipeline"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_domains/content/services/QueueService.mjs tests/unit/content/services/QueueService.test.mjs
git commit -m "feat(services): add unified filter pipeline to QueueService"
```

---

## Phase 3: PlexAdapter Metadata APIs

### Task 3.1: Add getMetadata Method

**Files:**
- Modify: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs`
- Test: `tests/unit/adapters/content/PlexAdapter.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/adapters/content/PlexAdapter.test.mjs
describe('getMetadata', () => {
  it('should return raw Plex metadata for rating key', async () => {
    const adapter = new PlexAdapter({
      host: 'http://localhost:32400',
      token: 'test-token'
    });

    // Mock the client
    adapter.client = {
      getMetadata: jest.fn().mockResolvedValue({
        ratingKey: '12345',
        title: 'Test Movie',
        type: 'movie',
        year: 2024,
        duration: 7200000,
        summary: 'A test movie',
        thumb: '/library/metadata/12345/thumb',
        Media: [{ Part: [{ file: '/path/to/movie.mp4' }] }]
      })
    };

    const result = await adapter.getMetadata('12345');

    expect(result.ratingKey).toBe('12345');
    expect(result.title).toBe('Test Movie');
    expect(result.type).toBe('movie');
    expect(result.year).toBe(2024);
    expect(result.duration).toBe(7200000);
    expect(result.Media).toBeDefined();
  });

  it('should return null for non-existent item', async () => {
    const adapter = new PlexAdapter({
      host: 'http://localhost:32400',
      token: 'test-token'
    });

    adapter.client = {
      getMetadata: jest.fn().mockResolvedValue(null)
    };

    const result = await adapter.getMetadata('99999');
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="PlexAdapter.test" -t "getMetadata"`
Expected: FAIL - getMetadata method not defined

**Step 3: Write minimal implementation**

```javascript
// In PlexAdapter.mjs, add method:

/**
 * Get raw Plex metadata for a rating key
 * @param {string} ratingKey - Plex rating key
 * @returns {Promise<Object|null>} Raw Plex metadata
 */
async getMetadata(ratingKey) {
  try {
    const metadata = await this.client.getMetadata(ratingKey);
    return metadata || null;
  } catch (err) {
    console.error('[PlexAdapter] getMetadata error:', err.message);
    return null;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="PlexAdapter.test" -t "getMetadata"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/content/media/plex/PlexAdapter.mjs tests/unit/adapters/content/PlexAdapter.test.mjs
git commit -m "feat(adapters): add getMetadata method to PlexAdapter"
```

---

### Task 3.2: Add getContainerWithChildren Method

**Files:**
- Modify: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs`
- Test: `tests/unit/adapters/content/PlexAdapter.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/adapters/content/PlexAdapter.test.mjs
describe('getContainerWithChildren', () => {
  it('should return container info bundled with children', async () => {
    const adapter = new PlexAdapter({
      host: 'http://localhost:32400',
      token: 'test-token'
    });

    // Mock getContainerInfo and getList
    adapter.getContainerInfo = jest.fn().mockResolvedValue({
      title: 'Season 1',
      image: '/thumb/123',
      type: 'season',
      childCount: 10
    });

    adapter.getList = jest.fn().mockResolvedValue([
      { id: 'plex:1', title: 'Episode 1' },
      { id: 'plex:2', title: 'Episode 2' }
    ]);

    const result = await adapter.getContainerWithChildren('plex:123');

    expect(result.container.title).toBe('Season 1');
    expect(result.container.childCount).toBe(10);
    expect(result.children.length).toBe(2);
    expect(result.children[0].title).toBe('Episode 1');
  });

  it('should return null if container not found', async () => {
    const adapter = new PlexAdapter({
      host: 'http://localhost:32400',
      token: 'test-token'
    });

    adapter.getContainerInfo = jest.fn().mockResolvedValue(null);
    adapter.getList = jest.fn().mockResolvedValue([]);

    const result = await adapter.getContainerWithChildren('plex:99999');
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="PlexAdapter.test" -t "getContainerWithChildren"`
Expected: FAIL - getContainerWithChildren method not defined

**Step 3: Write minimal implementation**

```javascript
// In PlexAdapter.mjs, add method:

/**
 * Get container metadata bundled with its children
 * @param {string} id - Compound ID
 * @returns {Promise<{container: Object, children: Array}|null>}
 */
async getContainerWithChildren(id) {
  const [container, children] = await Promise.all([
    this.getContainerInfo(id),
    this.getList(id)
  ]);

  if (!container) return null;

  return {
    container,
    children: children || []
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="PlexAdapter.test" -t "getContainerWithChildren"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/content/media/plex/PlexAdapter.mjs tests/unit/adapters/content/PlexAdapter.test.mjs
git commit -m "feat(adapters): add getContainerWithChildren to PlexAdapter"
```

---

## Phase 4: FilesystemAdapter Completion

### Task 4.1: Add ID3 Tag Parsing

**Files:**
- Modify: `backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs`
- Modify: `package.json` (add music-metadata dependency)
- Test: `tests/unit/adapters/content/FilesystemAdapter.test.mjs`

**Step 1: Add dependency**

Run: `npm install music-metadata`

**Step 2: Write the failing test**

```javascript
// Add to tests/unit/adapters/content/FilesystemAdapter.test.mjs
describe('ID3 tag parsing', () => {
  it('should include artist from audio file metadata', async () => {
    const adapter = new FilesystemAdapter({
      mediaBasePath: '/test/media'
    });

    // Mock fs and music-metadata
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'statSync').mockReturnValue({
      isDirectory: () => false,
      size: 1024000
    });

    // We'll need to mock music-metadata
    const mockParseFile = jest.fn().mockResolvedValue({
      common: {
        title: 'Test Song',
        artist: 'Test Artist',
        album: 'Test Album',
        year: 2024,
        track: { no: 5 }
      }
    });

    // Inject mock
    adapter._parseFile = mockParseFile;

    const item = await adapter.getItem('audio/song.mp3');

    expect(item.metadata.artist).toBe('Test Artist');
    expect(item.metadata.album).toBe('Test Album');
    expect(item.metadata.year).toBe(2024);
    expect(item.metadata.track).toBe(5);
  });

  it('should handle files without ID3 tags gracefully', async () => {
    const adapter = new FilesystemAdapter({
      mediaBasePath: '/test/media'
    });

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'statSync').mockReturnValue({
      isDirectory: () => false,
      size: 1024000
    });

    adapter._parseFile = jest.fn().mockResolvedValue({ common: {} });

    const item = await adapter.getItem('audio/song.mp3');

    expect(item).not.toBeNull();
    expect(item.metadata.artist).toBeUndefined();
  });
});
```

**Step 3: Write minimal implementation**

```javascript
// In FilesystemAdapter.mjs, add import at top:
import { parseFile } from 'music-metadata';

// Add method:
/**
 * Parse ID3 tags from audio file
 * @param {string} filePath
 * @returns {Promise<Object>}
 * @private
 */
async _parseAudioMetadata(filePath) {
  try {
    const metadata = await (this._parseFile || parseFile)(filePath, { native: true });
    const common = metadata?.common || {};
    return {
      artist: common.artist,
      album: common.album,
      year: common.year,
      track: common.track?.no,
      genre: Array.isArray(common.genre) ? common.genre.join(', ') : common.genre
    };
  } catch (err) {
    // File doesn't have ID3 tags or can't be parsed
    return {};
  }
}

// Modify getItem() to call _parseAudioMetadata for audio files:
// After determining mediaType, add:
let audioMetadata = {};
if (mediaType === 'audio') {
  audioMetadata = await this._parseAudioMetadata(resolved.path);
}

// Include in metadata spread:
metadata: {
  ...audioMetadata,
  filePath: resolved.path,
  // ... rest of metadata
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="FilesystemAdapter.test" -t "ID3 tag parsing"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs tests/unit/adapters/content/FilesystemAdapter.test.mjs package.json package-lock.json
git commit -m "feat(adapters): add ID3 tag parsing to FilesystemAdapter"
```

---

### Task 4.2: Add Household-Scoped Watch State

**Files:**
- Modify: `backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs`
- Test: `tests/unit/adapters/content/FilesystemAdapter.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/adapters/content/FilesystemAdapter.test.mjs
describe('household-scoped watch state', () => {
  it('should load watch state from household directory if configured', () => {
    const adapter = new FilesystemAdapter({
      mediaBasePath: '/test/media',
      historyPath: '/test/history/media',
      householdId: 'test-household'
    });

    // Mock fs
    jest.spyOn(fs, 'existsSync').mockImplementation(p =>
      p.includes('test-household') || p === '/test/history/media/media.yml'
    );
    jest.spyOn(fs, 'readFileSync').mockReturnValue(`
song.mp3:
  playhead: 120
  percent: 50
`);

    const watchState = adapter._loadWatchState();
    expect(watchState['song.mp3'].playhead).toBe(120);
  });

  it('should try household path first, then fall back to global', () => {
    const adapter = new FilesystemAdapter({
      mediaBasePath: '/test/media',
      historyPath: '/test/history/media',
      householdId: 'test-household',
      householdsBasePath: '/test/households'
    });

    const existsCalls = [];
    jest.spyOn(fs, 'existsSync').mockImplementation(p => {
      existsCalls.push(p);
      return p === '/test/history/media/media.yml';
    });
    jest.spyOn(fs, 'readFileSync').mockReturnValue('{}');

    adapter._loadWatchState();

    // Should try household path first
    expect(existsCalls[0]).toContain('test-household');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="FilesystemAdapter.test" -t "household-scoped watch state"`
Expected: FAIL - householdId not handled

**Step 3: Write minimal implementation**

```javascript
// In FilesystemAdapter.mjs constructor, add:
this.householdId = config.householdId || null;
this.householdsBasePath = config.householdsBasePath || null;

// Modify _loadWatchState():
_loadWatchState() {
  if (!this.historyPath) return {};
  if (this._watchStateCache) return this._watchStateCache;

  try {
    // Try household-specific path first
    if (this.householdId && this.householdsBasePath) {
      const householdPath = path.join(
        this.householdsBasePath,
        this.householdId,
        'history/media_memory/media.yml'
      );
      if (fs.existsSync(householdPath)) {
        const content = fs.readFileSync(householdPath, 'utf8');
        this._watchStateCache = yaml.load(content) || {};
        return this._watchStateCache;
      }
    }

    // Fall back to global path
    const filePath = path.join(this.historyPath, 'media.yml');
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf8');
    this._watchStateCache = yaml.load(content) || {};
    return this._watchStateCache;
  } catch (err) {
    return {};
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="FilesystemAdapter.test" -t "household-scoped watch state"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs tests/unit/adapters/content/FilesystemAdapter.test.mjs
git commit -m "feat(adapters): add household-scoped watch state to FilesystemAdapter"
```

---

### Task 4.3: Add Image MIME Types

**Files:**
- Modify: `backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs`
- Test: `tests/unit/adapters/content/FilesystemAdapter.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/adapters/content/FilesystemAdapter.test.mjs
describe('image MIME types', () => {
  it('should detect SVG files', () => {
    const adapter = new FilesystemAdapter({ mediaBasePath: '/test' });
    expect(adapter.getMimeType('.svg')).toBe('image/svg+xml');
  });

  it('should detect GIF files', () => {
    const adapter = new FilesystemAdapter({ mediaBasePath: '/test' });
    expect(adapter.getMimeType('.gif')).toBe('image/gif');
  });

  it('should detect WebP files', () => {
    const adapter = new FilesystemAdapter({ mediaBasePath: '/test' });
    expect(adapter.getMimeType('.webp')).toBe('image/webp');
  });

  it('should include image type in getMediaType', () => {
    const adapter = new FilesystemAdapter({ mediaBasePath: '/test' });
    expect(adapter.getMediaType('.svg')).toBe('image');
    expect(adapter.getMediaType('.gif')).toBe('image');
    expect(adapter.getMediaType('.webp')).toBe('image');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="FilesystemAdapter.test" -t "image MIME types"`
Expected: FAIL - getMimeType not defined, missing types

**Step 3: Write minimal implementation**

```javascript
// In FilesystemAdapter.mjs, expand MIME_TYPES:
const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'];

// Add method:
/**
 * Get MIME type for extension
 * @param {string} ext - File extension including dot
 * @returns {string}
 */
getMimeType(ext) {
  return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream';
}

// Update getMediaType to include IMAGE_EXTS:
getMediaType(ext) {
  ext = ext.toLowerCase();
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  return 'unknown';
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="FilesystemAdapter.test" -t "image MIME types"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs tests/unit/adapters/content/FilesystemAdapter.test.mjs
git commit -m "feat(adapters): add image MIME types to FilesystemAdapter"
```

---

## Phase 5: Integration & Router Updates

### Task 5.1: Update list.mjs Router for New Fields

**Files:**
- Modify: `backend/src/4_api/routers/list.mjs`
- Test: `tests/unit/api/routers/list.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/api/routers/list.test.mjs
describe('field flattening', () => {
  it('should include action properties at top level', () => {
    const item = {
      id: 'plex:123',
      title: 'Test',
      actions: { play: { plex: '123' } }
    };
    const result = toListItem(item);
    expect(result.play).toEqual({ plex: '123' });
  });

  it('should include label property', () => {
    const item = {
      id: 'test:1',
      title: 'Full Title',
      label: 'Short'
    };
    const result = toListItem(item);
    expect(result.label).toBe('Short');
  });

  it('should include media_key and plex properties', () => {
    const item = {
      id: 'plex:123',
      title: 'Test',
      plex: '123',
      media_key: 'plex:123'
    };
    const result = toListItem(item);
    expect(result.plex).toBe('123');
    expect(result.media_key).toBe('plex:123');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:unit -- --testPathPattern="list.test" -t "field flattening"`
Expected: May pass if already implemented, or FAIL

**Step 3: Update toListItem function**

```javascript
// In list.mjs toListItem function, add:

// Action properties from Item
if (item.actions) {
  if (item.actions.play) base.play = item.actions.play;
  if (item.actions.queue) base.queue = item.actions.queue;
  if (item.actions.list) base.list = item.actions.list;
  if (item.actions.open) base.open = item.actions.open;
}

// Media identifiers from Item
if (item.plex !== undefined) base.plex = item.plex;
if (item.media_key !== undefined) base.media_key = item.media_key;
if (item.label !== undefined) base.label = item.label;

// Watch state from PlayableItem
if (item.watchProgress !== undefined) base.watchProgress = item.watchProgress;
if (item.watchSeconds !== undefined) base.watchSeconds = item.watchSeconds;
if (item.lastPlayed !== undefined) base.lastPlayed = item.lastPlayed;
if (item.playCount !== undefined) base.playCount = item.playCount;

// Behavior flags
if (item.shuffle !== undefined) base.shuffle = item.shuffle;
if (item.continuous !== undefined) base.continuous = item.continuous;
if (item.resume !== undefined) base.resume = item.resume;
if (item.active !== undefined) base.active = item.active;
```

**Step 4: Run test to verify it passes**

Run: `npm run test:unit -- --testPathPattern="list.test" -t "field flattening"`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/routers/list.mjs tests/unit/api/routers/list.test.mjs
git commit -m "feat(api): update list router for new Item fields"
```

---

### Task 5.2: Run Full Test Suite

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Fix any failing tests**

Review failures and fix as needed.

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: address test failures from parity implementation"
```

---

### Task 5.3: Update Audit Document

**Files:**
- Modify: `docs/_wip/audits/2026-01-13-content-domain-full-parity-audit.md`

**Step 1: Update executive summary**

Mark completed items as DONE in the priority tables.

**Step 2: Commit**

```bash
git add docs/_wip/audits/2026-01-13-content-domain-full-parity-audit.md
git commit -m "docs: update audit with completed parity items"
```

---

## Completion Checklist

- [ ] Phase 1: Domain Capabilities Enhancement
  - [ ] Task 1.1: Action properties
  - [ ] Task 1.2: Media identifiers
  - [ ] Task 1.3: Label alias
  - [ ] Task 1.4: Watch state fields
  - [ ] Task 1.5: Behavior flags
- [ ] Phase 2: QueueService Completion
  - [ ] Task 2.1: Priority ordering
  - [ ] Task 2.2: skip_after filtering
  - [ ] Task 2.3: wait_until filtering
  - [ ] Task 2.4: Hold and watched filtering
  - [ ] Task 2.5: Day-of-week filtering
  - [ ] Task 2.6: Unified filter pipeline
- [ ] Phase 3: PlexAdapter Metadata APIs
  - [ ] Task 3.1: getMetadata method
  - [ ] Task 3.2: getContainerWithChildren method
- [ ] Phase 4: FilesystemAdapter Completion
  - [ ] Task 4.1: ID3 tag parsing
  - [ ] Task 4.2: Household-scoped watch state
  - [ ] Task 4.3: Image MIME types
- [ ] Phase 5: Integration
  - [ ] Task 5.1: Update list router
  - [ ] Task 5.2: Run full test suite
  - [ ] Task 5.3: Update audit document
