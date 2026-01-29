# v3 Session Payload Adapter Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the backend Session entity to correctly handle v3 payloads from the frontend, restoring session data persistence (HR series, roster, timeline events).

**Architecture:** Add a v3-to-v1 normalization adapter in SessionService.saveSession() that transforms v3 nested fields (`session.id`, `session.start`, `participants`, `timeline.participants`) back to v1 flat structure (`sessionId`, `startTime`, `roster`, `timeline.series`) before passing to Session.fromJSON().

**Tech Stack:** Node.js ES modules, Jest testing

---

## Background

The frontend PersistenceManager builds v3 payloads with:
- `session.id` instead of root `sessionId`
- `session.start` instead of root `startTime`
- `participants` object instead of `roster` array
- `timeline.participants` instead of `timeline.series`

The backend Session entity expects v1 flat structure with root-level fields. This mismatch causes all v3 data to be dropped.

---

## Task 1: Add v3 Payload Normalization Tests

**Files:**
- Modify: `tests/unit/suite/domains/fitness/services/SessionService.test.mjs`

**Step 1: Write the failing test for v3 sessionId extraction**

Add a new test block after the existing `saveSession` tests:

```javascript
describe('saveSession v3 payload normalization', () => {
  test('extracts sessionId from v3 session.id', async () => {
    mockStore.findById.mockResolvedValue(null);

    const session = await service.saveSession({
      version: 3,
      session: {
        id: '20260129063322',
        date: '2026-01-29',
        start: '2026-01-29 06:33:22',
        end: '2026-01-29 07:00:00',
        duration_seconds: 1598
      },
      timeline: { series: {}, events: [] }
    }, 'test-hid');

    expect(session.sessionId.toString()).toBe('20260129063322');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/domains/fitness/services/SessionService.test.mjs --testNamePattern="extracts sessionId from v3" -v`

Expected: PASS (sessionId extraction already works via `sessionData.session?.id` fallback)

**Step 3: Write failing test for v3 startTime extraction**

Add to the same `describe` block:

```javascript
  test('extracts startTime from v3 session.start', async () => {
    mockStore.findById.mockResolvedValue(null);

    const session = await service.saveSession({
      version: 3,
      session: {
        id: '20260129063322',
        start: '2026-01-29 06:33:22',
        end: '2026-01-29 07:00:00',
        duration_seconds: 1598
      },
      participants: {},
      timeline: {
        interval_seconds: 5,
        tick_count: 320,
        series: {}
      }
    }, 'test-hid');

    expect(session.startTime).toBeTruthy();
    expect(typeof session.startTime).toBe('number');
  });
```

**Step 4: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/domains/fitness/services/SessionService.test.mjs --testNamePattern="extracts startTime from v3" -v`

Expected: FAIL with startTime being undefined

**Step 5: Commit test file**

```bash
git add tests/unit/suite/domains/fitness/services/SessionService.test.mjs
git commit -m "test(fitness): add failing tests for v3 session payload normalization"
```

---

## Task 2: Add v3 Roster/Participants Normalization Test

**Files:**
- Modify: `tests/unit/suite/domains/fitness/services/SessionService.test.mjs`

**Step 1: Write failing test for participants-to-roster conversion**

Add to the `saveSession v3 payload normalization` describe block:

```javascript
  test('converts v3 participants object to roster array', async () => {
    mockStore.findById.mockResolvedValue(null);

    const session = await service.saveSession({
      version: 3,
      session: {
        id: '20260129063322',
        start: '2026-01-29 06:33:22',
        end: '2026-01-29 07:00:00'
      },
      participants: {
        'kckern': {
          display_name: 'Kirk',
          is_primary: true,
          hr_device: 'device_40475'
        },
        'guest-1': {
          display_name: 'Guest',
          is_guest: true
        }
      },
      timeline: { series: {} }
    }, 'test-hid');

    expect(session.roster).toHaveLength(2);
    expect(session.roster.find(p => p.name === 'Kirk')).toBeTruthy();
    expect(session.roster.find(p => p.isPrimary)).toBeTruthy();
  });
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/domains/fitness/services/SessionService.test.mjs --testNamePattern="converts v3 participants" -v`

Expected: FAIL with roster being empty `[]`

**Step 3: Commit**

```bash
git add tests/unit/suite/domains/fitness/services/SessionService.test.mjs
git commit -m "test(fitness): add failing test for v3 participants-to-roster conversion"
```

---

## Task 3: Add v3 Timeline Series Normalization Test

**Files:**
- Modify: `tests/unit/suite/domains/fitness/services/SessionService.test.mjs`

**Step 1: Write failing test for timeline series key mapping**

Add to the `saveSession v3 payload normalization` describe block:

```javascript
  test('preserves timeline.series from v3 payload', async () => {
    mockStore.findById.mockResolvedValue(null);

    const session = await service.saveSession({
      version: 3,
      session: {
        id: '20260129063322',
        start: '2026-01-29 06:33:22',
        end: '2026-01-29 07:00:00'
      },
      participants: {},
      timeline: {
        interval_seconds: 5,
        tick_count: 3,
        encoding: 'rle',
        series: {
          'kckern:hr': '[[120,2],125]',
          'kckern:zone': '[["a",3]]'
        }
      }
    }, 'test-hid');

    expect(Object.keys(session.timeline.series).length).toBeGreaterThan(0);
  });
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/domains/fitness/services/SessionService.test.mjs --testNamePattern="preserves timeline.series" -v`

Expected: FAIL with series being empty `{}`

**Step 3: Commit**

```bash
git add tests/unit/suite/domains/fitness/services/SessionService.test.mjs
git commit -m "test(fitness): add failing test for v3 timeline series preservation"
```

---

## Task 4: Implement parseV3Timestamp Helper

**Files:**
- Modify: `backend/src/1_domains/fitness/services/SessionService.mjs`

**Step 1: Write the helper function**

Add after the imports, before the class definition:

```javascript
/**
 * Parse a v3 timestamp string into Unix milliseconds.
 * Accepts formats: 'YYYY-MM-DD HH:mm:ss' or 'YYYY-MM-DD H:mm:ss'
 * @param {string|number|null} timestamp
 * @returns {number|null}
 */
function parseV3Timestamp(timestamp) {
  if (timestamp == null) return null;
  if (typeof timestamp === 'number') return timestamp;
  if (typeof timestamp !== 'string') return null;

  // Try parsing as ISO-ish format: "2026-01-29 06:33:22"
  const normalized = timestamp.replace(' ', 'T');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
```

**Step 2: Run tests to verify no regression**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/domains/fitness/services/SessionService.test.mjs -v`

Expected: Existing tests PASS, new v3 tests still FAIL

**Step 3: Commit**

```bash
git add backend/src/1_domains/fitness/services/SessionService.mjs
git commit -m "feat(fitness): add parseV3Timestamp helper for v3 payload normalization"
```

---

## Task 5: Implement normalizeV3Payload Function

**Files:**
- Modify: `backend/src/1_domains/fitness/services/SessionService.mjs`

**Step 1: Write the normalization function**

Add after `parseV3Timestamp`:

```javascript
/**
 * Convert v3 participants object to v1 roster array.
 * @param {Object} participants - { participantId: { display_name, is_primary, hr_device, ... } }
 * @returns {Array} - [{ name, isPrimary, hrDeviceId, ... }]
 */
function convertParticipantsToRoster(participants) {
  if (!participants || typeof participants !== 'object') return [];

  return Object.entries(participants).map(([id, meta]) => ({
    name: meta.display_name || id,
    profileId: id,
    isPrimary: meta.is_primary === true,
    isGuest: meta.is_guest === true,
    ...(meta.hr_device ? { hrDeviceId: meta.hr_device } : {})
  }));
}

/**
 * Normalize a v3 payload to v1 structure for Session.fromJSON().
 *
 * v3 format:
 *   - session.id, session.start, session.end, session.duration_seconds
 *   - participants: { id: { display_name, is_primary, hr_device, ... } }
 *   - timeline.series at root level (already flat in v3 persistence payload)
 *
 * v1 format:
 *   - sessionId, startTime, endTime, durationMs at root
 *   - roster: [{ name, isPrimary, hrDeviceId, ... }]
 *   - timeline.series (unchanged)
 *
 * @param {Object} data - Raw session payload (v2 or v3)
 * @returns {Object} - Normalized v1-compatible payload
 */
function normalizeV3Payload(data) {
  // Detect v3 format: has session.id but no root sessionId/startTime
  const isV3 = data.session && typeof data.session === 'object' && !data.startTime;

  if (!isV3) {
    return data;
  }

  const session = data.session;

  return {
    ...data,
    // Extract sessionId from nested session block
    sessionId: session.id || data.sessionId,
    // Parse timestamp strings to Unix ms
    startTime: parseV3Timestamp(session.start) || data.startTime,
    endTime: parseV3Timestamp(session.end) || data.endTime,
    durationMs: session.duration_seconds != null
      ? session.duration_seconds * 1000
      : data.durationMs,
    // Convert participants object to roster array
    roster: convertParticipantsToRoster(data.participants) || data.roster || [],
    // Timeline series should be preserved as-is (already at timeline.series)
    timeline: data.timeline || { series: {}, events: [] }
  };
}
```

**Step 2: Run tests to verify no regression**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/domains/fitness/services/SessionService.test.mjs -v`

Expected: Existing tests PASS, new v3 tests still FAIL (normalization not yet called)

**Step 3: Commit**

```bash
git add backend/src/1_domains/fitness/services/SessionService.mjs
git commit -m "feat(fitness): add normalizeV3Payload function for v3-to-v1 conversion"
```

---

## Task 6: Wire normalizeV3Payload into saveSession

**Files:**
- Modify: `backend/src/1_domains/fitness/services/SessionService.mjs`

**Step 1: Call normalizeV3Payload in saveSession**

In the `saveSession` method (around line 123-140), update to normalize before creating the Session:

```javascript
  async saveSession(sessionData, householdId) {
    const hid = this.resolveHouseholdId(householdId);

    // Normalize v3 payload to v1 structure
    const normalized = normalizeV3Payload(sessionData);

    // Handle both sessionId and legacy formats
    const rawSessionId = normalized.sessionId || normalized.session?.id;
    const sanitizedId = Session.sanitizeSessionId(rawSessionId);
    if (!sanitizedId) {
      throw new ValidationError('Valid sessionId is required', {
        code: 'INVALID_SESSION_ID',
        field: 'sessionId'
      });
    }

    // Normalize to Session entity
    const session = Session.fromJSON({
      ...normalized,
      sessionId: sanitizedId
    });

    // Encode timeline series for storage
    session.timeline = prepareTimelineForStorage(session.timeline);

    // Merge with existing file to preserve snapshots
    const existing = await this.sessionStore.findById(sanitizedId, hid);
    if (existing?.snapshots) {
      session.snapshots = existing.snapshots;
    }

    await this.sessionStore.save(session, hid);
    return session;
  }
```

**Step 2: Run tests to verify they pass**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/domains/fitness/services/SessionService.test.mjs -v`

Expected: All tests PASS including the new v3 normalization tests

**Step 3: Commit**

```bash
git add backend/src/1_domains/fitness/services/SessionService.mjs
git commit -m "fix(fitness): wire v3 payload normalization into saveSession

Fixes critical bug where v3 session payloads from frontend were being
dropped by backend Session entity. Now properly extracts:
- sessionId from session.id
- startTime/endTime from session.start/end
- roster from participants object
- timeline.series preserved as-is"
```

---

## Task 7: Add Integration Test for Full v3 Round-Trip

**Files:**
- Modify: `tests/unit/suite/domains/fitness/services/SessionService.test.mjs`

**Step 1: Write comprehensive integration test**

Add a new describe block:

```javascript
describe('saveSession v3 full round-trip', () => {
  test('saves complete v3 payload and retrieves with all data', async () => {
    const v3Payload = {
      version: 3,
      timezone: 'America/Los_Angeles',
      session: {
        id: '20260129063322',
        date: '2026-01-29',
        start: '2026-01-29 06:33:22',
        end: '2026-01-29 07:00:00',
        duration_seconds: 1598
      },
      participants: {
        'kckern': {
          display_name: 'Kirk',
          is_primary: true,
          hr_device: 'device_40475'
        }
      },
      timeline: {
        interval_seconds: 5,
        tick_count: 320,
        encoding: 'rle',
        series: {
          'kckern:hr': '[[120,100],[125,100],[130,120]]',
          'kckern:zone': '[["a",200],["w",120]]'
        }
      },
      events: [
        { at: '2026-01-29 06:35:00', type: 'media_start', data: { title: 'Workout Mix' } }
      ]
    };

    mockStore.findById.mockResolvedValue(null);

    const session = await service.saveSession(v3Payload, 'test-hid');

    // Verify core fields
    expect(session.sessionId.toString()).toBe('20260129063322');
    expect(session.startTime).toBeTruthy();
    expect(session.timezone).toBe('America/Los_Angeles');

    // Verify roster
    expect(session.roster).toHaveLength(1);
    expect(session.roster[0].name).toBe('Kirk');
    expect(session.roster[0].isPrimary).toBe(true);
    expect(session.roster[0].hrDeviceId).toBe('device_40475');

    // Verify timeline series were preserved (and encoded for storage)
    expect(Object.keys(session.timeline.series)).toContain('kckern:hr');
    expect(typeof session.timeline.series['kckern:hr']).toBe('string');
  });
});
```

**Step 2: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/domains/fitness/services/SessionService.test.mjs --testNamePattern="full round-trip" -v`

Expected: PASS

**Step 3: Commit**

```bash
git add tests/unit/suite/domains/fitness/services/SessionService.test.mjs
git commit -m "test(fitness): add v3 full round-trip integration test"
```

---

## Task 8: Run Full Test Suite and Verify

**Files:**
- None (verification only)

**Step 1: Run full fitness domain test suite**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/domains/fitness/ -v`

Expected: All tests PASS

**Step 2: Run broader backend tests to check for regressions**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/domains/ -v`

Expected: All tests PASS

**Step 3: No commit needed (verification only)**

---

## Task 9: Update Bug Report with Resolution

**Files:**
- Modify: `docs/_wip/2026-01-29-fitness-session-v3-persistence-bug-report.md`

**Step 1: Add resolution section**

Add at the end of the bug report file:

```markdown
---

## Resolution

**Fixed:** 2026-01-29

**Implementation:** Added `normalizeV3Payload()` function in `SessionService.mjs` that:
1. Detects v3 payloads by checking for `session` object without root `startTime`
2. Extracts `sessionId`, `startTime`, `endTime`, `durationMs` from nested `session` block
3. Converts `participants` object to `roster` array with proper field mapping
4. Preserves `timeline.series` as-is (already in correct format)

**Files Changed:**
- `backend/src/1_domains/fitness/services/SessionService.mjs` - Added normalization layer
- `tests/unit/suite/domains/fitness/services/SessionService.test.mjs` - Added v3 tests

**Verification:**
- [ ] Deploy to production
- [ ] Start a new fitness session with HR device
- [ ] Exercise for 1+ minute
- [ ] Check session file has populated `startTime`, `timeline.series`, `roster`
- [ ] Verify fitness dashboard shows session data
```

**Step 2: Commit**

```bash
git add docs/_wip/2026-01-29-fitness-session-v3-persistence-bug-report.md
git commit -m "docs: mark v3 session persistence bug as resolved"
```

---

## Task 10: Final Commit and Summary

**Files:**
- None (summary only)

**Step 1: Review all changes**

Run: `git log --oneline -10`

Expected output should show commits:
- `docs: mark v3 session persistence bug as resolved`
- `test(fitness): add v3 full round-trip integration test`
- `fix(fitness): wire v3 payload normalization into saveSession`
- `feat(fitness): add normalizeV3Payload function for v3-to-v1 conversion`
- `feat(fitness): add parseV3Timestamp helper for v3 payload normalization`
- `test(fitness): add failing test for v3 timeline series preservation`
- `test(fitness): add failing test for v3 participants-to-roster conversion`
- `test(fitness): add failing tests for v3 session payload normalization`

**Step 2: Summary of changes**

The fix adds a normalization adapter layer in `SessionService.saveSession()` that:
- Parses v3 timestamp strings (`"2026-01-29 06:33:22"`) to Unix milliseconds
- Extracts nested `session.*` fields to root level
- Converts `participants` object to `roster` array
- Preserves timeline series unchanged

This maintains backward compatibility (v1/v2 payloads pass through unchanged) while correctly handling the v3 format the frontend now sends.
