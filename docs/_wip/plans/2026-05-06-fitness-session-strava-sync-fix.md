# Fitness Session ↔ Strava Sync Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the auto-merge resume check (broken since deploy), add a sport/distance guard to Strava webhook matching, add an aging policy to the webhook job store, and clean up the data damage already on disk.

**Architecture:** Three independent code regressions are documented in `docs/_wip/audits/2026-05-06-fitness-session-strava-sync-fragmentation-audit.md`. Each gets its own phase. Phase 1 restores resume/auto-merge by normalizing contentId at three points (frontend `_getCurrentContentId`, frontend `setPendingContentId` wiring, backend `findResumable` defensive normalization) plus pushing a real `contentId` field on play-queue items. Phase 2 adds a plausibility guard to `_findMatchingSession` so a 37-min outdoor GPS run can't bind to a 7-min indoor treasureBox session. Phase 3 caps total attempts on webhook jobs and adds an `abandoned` terminal state. Phase 4 runs one-shot data fixups for the three known-bad days. Phase 5 verifies in production logs.

**Tech Stack:** Node.js / ES modules backend, React frontend, Vitest tests (frontend `*.test.js` and `tests/isolated/**/*.test.mjs`), js-yaml for session storage, moment-timezone for time math.

**Key invariants we must preserve:**
- Plain bare numeric IDs (e.g. `'664042'`) sent to the resumable endpoint must keep working — even after fixes ship, older clients in the wild may still send them. Backend normalization must be defensive.
- `summary.media[0].contentId` on disk is always a prefixed `source:localId` string (e.g. `'plex:664042'`). Don't change the storage format.
- Tests in `tests/isolated/**` use mocks; we don't run a real backend.

---

## Pre-flight

**Before starting any task in this plan, run these to confirm the workspace is clean and tests are green:**

```bash
# Confirm no uncommitted work
git status

# Confirm baseline tests pass (resumable + contentId tests)
npx vitest run frontend/src/hooks/fitness/FitnessSession.contentId.test.js frontend/src/hooks/fitness/FitnessSession.resumable.test.js
npx vitest run tests/isolated/application/fitness/SessionService.test.mjs
```

Expected: all green. If any are red, stop and surface the failure before continuing.

---

## Phase 1 — Restore the resume check (Fix A)

This is the highest-value fix: a single 8-character bug is wiping out every auto-merge in production.

### Task 1.1: Backend defensive contentId normalization in `findResumable`

**Why first:** ships protection immediately — even if the frontend keeps sending bare ids forever (e.g. cached browser app, alternate client), the backend recovers. Any later frontend fix is gravy.

**Files:**
- Modify: `backend/src/3_applications/fitness/services/SessionService.mjs:320-356`
- Test: `tests/isolated/application/fitness/SessionService.test.mjs` (extend existing `describe('findResumable — finalized guard')` block, or add a new sibling `describe`)

**Step 1: Write the failing test**

Add this `describe` block to `tests/isolated/application/fitness/SessionService.test.mjs`, immediately after the existing `describe('findResumable — finalized guard', …)` block (around line 473):

```javascript
describe('findResumable — bare contentId tolerance', () => {
  test('matches when caller sends bare plex localId but storage has prefixed contentId', async () => {
    const now = Date.now();
    const stored = {
      sessionId: '20260506125238',
      startTime: now - 600_000,
      endTime: now - 13_000,           // 13 seconds ago
      durationMs: 587_000,
      finalized: false,
      media: { primary: { contentId: 'plex:664042' } },
      timeline: { series: {}, events: [] }
    };
    mockStore.findByDate.mockResolvedValue([stored]);
    mockStore.findById.mockResolvedValue(stored);

    // Caller sends bare id (current production frontend behavior)
    const result = await service.findResumable('664042', 'test-hid');

    expect(result.resumable).toBe(true);
    expect(result.session?.sessionId).toBe('20260506125238');
  });

  test('matches when caller sends prefixed contentId (canonical path)', async () => {
    const now = Date.now();
    const stored = {
      sessionId: '20260506125238',
      startTime: now - 600_000,
      endTime: now - 13_000,
      durationMs: 587_000,
      finalized: false,
      media: { primary: { contentId: 'plex:664042' } },
      timeline: { series: {}, events: [] }
    };
    mockStore.findByDate.mockResolvedValue([stored]);
    mockStore.findById.mockResolvedValue(stored);

    const result = await service.findResumable('plex:664042', 'test-hid');
    expect(result.resumable).toBe(true);
  });

  test('does not falsely match when bare id maps to a different source', async () => {
    // Bare '664042' must only normalize to 'plex:664042' — never collide with
    // 'youtube:664042' or any other source.
    const now = Date.now();
    mockStore.findByDate.mockResolvedValue([
      {
        sessionId: '20260506125238',
        startTime: now - 600_000,
        endTime: now - 13_000,
        durationMs: 587_000,
        finalized: false,
        media: { primary: { contentId: 'youtube:664042' } },
        timeline: { series: {}, events: [] }
      }
    ]);

    const result = await service.findResumable('664042', 'test-hid');
    expect(result.resumable).toBe(false);
  });
});
```

**Step 2: Run the test to confirm it fails for the right reason**

```bash
npx vitest run tests/isolated/application/fitness/SessionService.test.mjs -t "bare contentId tolerance"
```

Expected: First two tests FAIL with `expected true to be false` or similar (because `'664042' !== 'plex:664042'`). Third test PASSES (because no normalization is happening yet, both sides mismatch by chance). After the fix, all three should pass.

**Step 3: Implement the minimal fix**

Edit `backend/src/3_applications/fitness/services/SessionService.mjs`. In the `findResumable` method, immediately after the `if (!contentId) return { resumable: false };` guard at line 321, add:

```javascript
  async findResumable(contentId, householdId, { maxGapMs = 30 * 60 * 1000 } = {}) {
    if (!contentId) return { resumable: false };

    // Defensive normalization: callers (especially the frontend pre-2026-05-06)
    // may send a bare local id like '664042' instead of 'plex:664042'. The
    // session YAML always stores the prefixed form, so a bare id would never
    // match. Prefix bare numeric/string ids with 'plex:' as the fitness app
    // default.
    const normalizedContentId = String(contentId).includes(':')
      ? String(contentId)
      : `plex:${contentId}`;

    const hid = this.resolveHouseholdId(householdId);
    // … rest unchanged, but use normalizedContentId everywhere `contentId`
    //   was used below this point.
```

Replace every subsequent reference to the parameter `contentId` inside this method body with `normalizedContentId`. Specifically:
- Line 328: the `logger.info` call's `contentId` field
- Line 348: the `if (mediaId !== contentId)` comparison
- Lines 358-369: every log call
- Line 386: the matched-log `contentId` field

**Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/isolated/application/fitness/SessionService.test.mjs -t "findResumable"
```

Expected: All `findResumable` tests pass (the new three plus the pre-existing two).

**Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/services/SessionService.mjs tests/isolated/application/fitness/SessionService.test.mjs
git commit -m "fix(fitness): defensive contentId normalization in findResumable

Frontend has been sending bare plex localIds ('664042') to the resumable
endpoint, but the YAML stores the prefixed form ('plex:664042'). Strict
equality dropped every candidate, so no auto-merge has ever fired in prod.
Normalize at the entry point so older clients keep working.

See docs/_wip/audits/2026-05-06-fitness-session-strava-sync-fragmentation-audit.md"
```

---

### Task 1.2: Frontend prefix fallback in `_getCurrentContentId`

**Why:** restore the prefixed form at the source so logs are honest and any future server that doesn't normalize still works.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1551-1559`
- Test: `frontend/src/hooks/fitness/FitnessSession.contentId.test.js`

**Step 1: Write the failing test**

Add these tests to `frontend/src/hooks/fitness/FitnessSession.contentId.test.js`, in the existing `describe('FitnessSession._getCurrentContentId pre-session fallback', …)` block:

```javascript
  it('prefixes a bare snapshot id with plex: when no contentId field is set', () => {
    const session = new FitnessSession();
    // Real play-queue items currently only have .id (bare plex id), no .contentId
    session.snapshot.mediaPlaylists.video = [{ id: '664042' }];
    expect(session._getCurrentContentId()).toBe('plex:664042');
  });

  it('passes through an already-prefixed snapshot id unchanged', () => {
    const session = new FitnessSession();
    session.snapshot.mediaPlaylists.video = [{ id: 'plex:664042' }];
    expect(session._getCurrentContentId()).toBe('plex:664042');
  });

  it('prefixes a bare pending content id with plex:', () => {
    const session = new FitnessSession();
    session.setPendingContentId('664042');
    expect(session._getCurrentContentId()).toBe('plex:664042');
  });

  it('passes through an already-prefixed pending content id unchanged', () => {
    const session = new FitnessSession();
    session.setPendingContentId('plex:664042');
    expect(session._getCurrentContentId()).toBe('plex:664042');
  });
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run frontend/src/hooks/fitness/FitnessSession.contentId.test.js
```

Expected: the four new tests FAIL (the bare-id ones return `'664042'`, not `'plex:664042'`).

**Step 3: Implement the fix**

In `frontend/src/hooks/fitness/FitnessSession.js`, replace `_getCurrentContentId` (around line 1551). Also add a helper at the top of the same file (just above the class definition or near other helpers — pick the spot that matches the file's existing structure):

```javascript
/**
 * Normalize a content id to the canonical "source:localId" form. Bare
 * numeric/string ids are prefixed with "plex:" (fitness app default).
 * Already-prefixed ids pass through unchanged. Returns null for empty input.
 */
function normalizeContentId(id) {
  if (id == null || id === '') return null;
  const s = String(id);
  return s.includes(':') ? s : `plex:${s}`;
}
```

Then replace `_getCurrentContentId`:

```javascript
  /**
   * Get the current primary content ID from active media.
   * Falls back to the pending content-id hint when the snapshot has no
   * media yet (e.g. before the session starts). Bare local ids on
   * play-queue items are normalized to "plex:<id>" before returning.
   * @returns {string|null}
   */
  _getCurrentContentId() {
    const playlist = this.snapshot?.mediaPlaylists?.video;
    if (Array.isArray(playlist) && playlist.length > 0) {
      const head = playlist[0];
      const id = head?.contentId || head?.id;
      const normalized = normalizeContentId(id);
      if (normalized) return normalized;
    }
    return normalizeContentId(this._pendingContentId);
  }
```

(`setPendingContentId` itself does not need to change — the normalization happens on read.)

**Step 4: Run test to verify it passes**

```bash
npx vitest run frontend/src/hooks/fitness/FitnessSession.contentId.test.js
```

Expected: all 8 tests pass (the original 4 + the new 4).

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/FitnessSession.contentId.test.js
git commit -m "fix(fitness): prefix bare plex ids in _getCurrentContentId

Play-queue items only carry head.id (bare plex localId); they have no
contentId field. The resumable check was sending '664042' instead of
'plex:664042', so it never matched anything in storage. Normalize on
read."
```

---

### Task 1.3: Frontend prefix fallback in `setPendingContentId` wiring

**Why:** make the structured logs (`fitness.session.resume_check.start`) emit the prefixed form so future debugging is sane. Also belts-and-suspenders for any path that reads `_pendingContentId` directly.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx:2116-2122`

**Step 1: Write a failing assertion**

Open `frontend/src/hooks/fitness/FitnessSession.contentId.test.js`. Inside the existing `describe`, add:

```javascript
  it('setPendingContentId stores the value normalized when caller passes a bare id', () => {
    const session = new FitnessSession();
    session.setPendingContentId('664042');
    // Read via _getCurrentContentId (which we already test) to confirm the
    // stored form is the prefixed one.
    expect(session._getCurrentContentId()).toBe('plex:664042');
  });
```

Run:
```bash
npx vitest run frontend/src/hooks/fitness/FitnessSession.contentId.test.js
```

Expected: PASS already, because Task 1.2 normalizes on read. Good — this asserts the contract works end-to-end. If it fails, the previous task wasn't applied correctly.

**Step 2: Update the FitnessContext call site so the value going IN is also prefixed (for log honesty)**

Edit `frontend/src/context/FitnessContext.jsx` around lines 2116-2122. Change:

```javascript
useEffect(() => {
  const session = fitnessSessionRef.current;
  if (!session || typeof session.setPendingContentId !== 'function') return;
  const head = Array.isArray(fitnessPlayQueue) ? fitnessPlayQueue[0] : null;
  const id = head?.contentId || head?.id || null;
  session.setPendingContentId(id);
}, [fitnessPlayQueue]);
```

to:

```javascript
useEffect(() => {
  const session = fitnessSessionRef.current;
  if (!session || typeof session.setPendingContentId !== 'function') return;
  const head = Array.isArray(fitnessPlayQueue) ? fitnessPlayQueue[0] : null;
  const rawId = head?.contentId || head?.id || null;
  // Normalize at write so structured logs and any direct reads get the
  // canonical "source:localId" form. Bare plex localIds → "plex:<id>".
  const id = rawId == null
    ? null
    : (String(rawId).includes(':') ? String(rawId) : `plex:${rawId}`);
  session.setPendingContentId(id);
}, [fitnessPlayQueue]);
```

**Step 3: Re-run the contentId tests**

```bash
npx vitest run frontend/src/hooks/fitness/FitnessSession.contentId.test.js
```

Expected: still all green (this change is symmetric with Task 1.2's normalization).

**Step 4: Manual smoke test (optional but recommended)**

If the dev server is running locally, open the fitness page in a browser, start a workout (just enough HR to trip `buffer_threshold_met`), and confirm the structured log shows the prefixed contentId:

```bash
# Tail the latest fitness log
ls -t /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/logs/fitness/*.jsonl | head -1 | xargs tail -f | grep "resume_check"
```

Expected: `"contentId":"plex:664042"` (with prefix), no longer the bare `"contentId":"664042"`.

**Step 5: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "fix(fitness): prefix pending contentId so resume_check logs are canonical"
```

---

### Task 1.4: Add `contentId` field to play-queue items (canonical fix)

**Why:** fixes the *real* shape of the data instead of papering over it. Future contributors won't trip over the same mismatch.

**Files (all push/replace into `setFitnessPlayQueue`):**
- Modify: `frontend/src/modules/Fitness/nav/FitnessMenu.jsx:311-323` (push to queue from menu)
- Modify: `frontend/src/modules/Fitness/player/FitnessShow.jsx:632-640` (replace queue with single show)
- Modify: `frontend/src/modules/Fitness/player/FitnessShow.jsx:1085-1095` (push episode to queue)
- Modify: `frontend/src/Apps/FitnessApp.jsx:640-755` (3 setFitnessPlayQueue call sites)

**Step 1: Read each call site to confirm field availability**

Run `Read` on each file at the line numbers above. For each, find the value used as `id`. If the source has both a `play.plex` (bare numeric) and either `id` or `plexId`, the new field should be:

```javascript
contentId: plexId ? `plex:${plexId}` : null
```

(or whatever the local variable holding the bare plex id is named at that call site).

If a call site has *no* plex id at all (e.g. a fallback for non-plex items), set `contentId: null` and let the resumable check no-op.

**Step 2: Update FitnessMenu.jsx**

Replace lines 311-323 in `frontend/src/modules/Fitness/nav/FitnessMenu.jsx`:

```javascript
    if (setFitnessPlayQueue) {
      const resumeMeta = normalizeResumeMeta(show);
      const plexId = getPlexId(show);
      setFitnessPlayQueue(prevQueue => [...prevQueue, {
        id: getItemKey(show),
        contentId: plexId ? `plex:${plexId}` : null,
        title: show.label,
        videoUrl: show.url || show.videoUrl,
        duration: show.duration,
        thumbId: show.thumbId,
        image: show.image,
        labels: show.labels,
        type: show.type || null,
        ...resumeMeta
      }]);
    }
```

**Step 3: Update FitnessShow.jsx — both queueItem creation sites**

Around line 632 (single-show replace) and line 1085 (episode push), find each `const queueItem = { ... }` block. Each currently has:

```javascript
const queueItem = {
  id: plexId || episode.id || `episode-${Date.now()}`,
  plex: plexId,
  // ...
};
```

Add a `contentId` field right after `id`:

```javascript
const queueItem = {
  id: plexId || episode.id || `episode-${Date.now()}`,
  contentId: plexId ? `plex:${plexId}` : null,
  plex: plexId,
  // ...
};
```

**Step 4: Update FitnessApp.jsx**

For each of the three `setFitnessPlayQueue` calls in `frontend/src/Apps/FitnessApp.jsx` around lines 643, 716, 753 — locate the item being pushed/set, identify its plex id source, and add a `contentId` field with the same `plexId ? \`plex:${plexId}\` : null` pattern.

If the item value is being passed through from another source rather than constructed inline (e.g. a callback receives `item`), and the upstream source is unclear, normalize at that boundary instead:

```javascript
const normalized = item.contentId
  ? item
  : { ...item, contentId: item.plex ? `plex:${item.plex}` : (item.id && /^[0-9]+$/.test(String(item.id)) ? `plex:${item.id}` : null) };
setFitnessPlayQueue(prev => [...prev, normalized]);
```

**Step 5: Add a regression test that the play-queue item has contentId**

Create `frontend/src/modules/Fitness/nav/__tests__/FitnessMenu.queueShape.test.jsx` (or place alongside existing fitness UI tests if a folder convention exists — check sibling files first):

```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import FitnessMenu from '../FitnessMenu.jsx';

// FitnessMenu currently fetches its own data; we want a unit test that
// asserts the SHAPE of items pushed to setFitnessPlayQueue. The cleanest
// approach: extract a pure helper from handleAddToQueue.
//
// If the helper extraction isn't done, mock fetch and the rendered output
// to drive handleAddToQueue, then assert the spy.

describe('FitnessMenu — play-queue item shape', () => {
  it.todo('every queued item has a prefixed contentId or null — never a bare numeric id');
});
```

If extracting a helper is too much scope for this task, mark the test `it.todo` for now and write a focused unit test on the next pass. The contract is asserted in the contentId.test.js already (Task 1.2). Don't over-engineer.

**Step 6: Run the full fitness frontend test suite**

```bash
npx vitest run frontend/src/hooks/fitness/ frontend/src/modules/Fitness/ frontend/src/context/
```

Expected: all green. If any test was relying on items lacking a `contentId` field, fix the test to match the new shape.

**Step 7: Commit**

```bash
git add frontend/src/modules/Fitness/nav/FitnessMenu.jsx \
        frontend/src/modules/Fitness/player/FitnessShow.jsx \
        frontend/src/Apps/FitnessApp.jsx \
        frontend/src/modules/Fitness/nav/__tests__/FitnessMenu.queueShape.test.jsx
git commit -m "feat(fitness): play-queue items carry canonical contentId (plex: prefixed)

Eliminates the bare-vs-prefixed id ambiguity that broke the resumable
check. Bare ids still work via defensive normalization on read and on
the backend, but the canonical shape is now stored at the source."
```

---

## Phase 2 — Strava webhook match safety (Fix B)

### Task 2.1: Sport/distance compatibility guard in `_findMatchingSession`

**Why:** prevent a 37-min outdoor GPS run from binding to a 7-min indoor zero-distance session just because their windows overlap by a few minutes.

**Files:**
- Modify: `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs:285-377`
- Test: create `tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs` if it doesn't exist; otherwise extend it

**Step 1: Confirm test file**

```bash
ls tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs 2>/dev/null \
  || echo "MISSING — needs to be created"
```

If missing, the service has no isolated tests today. Create a minimal scaffold patterned on the existing `tests/isolated/application/fitness/SessionService.test.mjs` — same imports (`describe`, `test`, `expect`, `vi`), same mock-store + mock-config-service style. The service constructor takes `{ stravaClient, jobStore, authStore, configService, fitnessHistoryDir, reconciliationService, logger }`.

**Step 2: Write the failing test**

Add a `describe('_findMatchingSession — sport guard', …)` block:

```javascript
describe('FitnessActivityEnrichmentService._findMatchingSession sport guard', () => {
  // Build a service with mock deps that lets us call _findMatchingSession
  // (private, but accessible because there's no privateAccess shielding —
  // call via service['_findMatchingSession'](activity)). If that proves
  // awkward in the codebase's idiom, extract _findMatchingSession into a
  // pure function in a sibling module and unit-test the function directly.

  test('rejects an outdoor GPS Run match against a zero-distance no-media session', async () => {
    // Set up: activity is a 37-min Run, 3.25 mi (5230 m). Session is a 7-min
    // indoor session with summary.media: [] and no distance. The current
    // code matches by overlap; the fix should reject on plausibility.
    // Assert: _findMatchingSession returns null.
    // (Implementation detail: stub fitnessHistoryDir + dirExists +
    // listYamlFiles + loadYamlSafe with vi.mock or a fake adapter.)
  });

  test('still matches an indoor Ride against an indoor session with the same media', async () => {
    // Verify the guard is narrow — it must not block normal matches.
  });

  test('still matches when activity has no GPS distance (treadmill run, etc.)', async () => {
    // Indoor Run with distance=0 should match an indoor session — the guard
    // is about GPS-distance vs no-media-no-distance, not Run vs anything.
  });
});
```

**Step 3: Run the test to confirm it fails**

```bash
npx vitest run tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs
```

Expected: FAIL — the new test for outdoor-Run-vs-indoor-no-media currently passes by being matched (which is the bug).

**Step 4: Implement the guard**

In `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs`, inside `_findMatchingSession` (around line 285-377), after loading each session's `data` from disk and before computing `overlapMs`, add:

```javascript
        // Plausibility guard: an activity with real GPS distance should not
        // be matched to a session that has zero distance AND no media. That
        // is almost always a coincidental overlap (user came home from a run
        // wearing the HR strap and triggered a treasureBox session).
        const activityHasGpsDistance = (activity.distance || 0) > 100; // > 100 m
        const sessionIsZeroDistanceNoMedia =
          ((data.strava?.distance ?? 0) === 0)
          && (!Array.isArray(data.summary?.media) || data.summary.media.length === 0);
        if (activityHasGpsDistance && sessionIsZeroDistanceNoMedia) {
          this.#logger.info?.('strava.enrichment.session_scan.rejected_by_sport_guard', {
            activityId,
            file: filename,
            reason: 'outdoor-gps-vs-indoor-empty',
            activityDistanceMeters: activity.distance,
          });
          continue;
        }
```

(Place this immediately before the `// Time-based matching` comment block.)

**Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs
```

Expected: all three guard tests pass. Other tests in the file (if any) still pass.

**Step 6: Commit**

```bash
git add backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs \
        tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs
git commit -m "fix(fitness): sport-guard for Strava webhook matching

Reject GPS-distance activities that would otherwise bind to a zero-distance
no-media indoor session. Caused 2026-05-05 Lunch Run to silently inherit a
7-minute treasureBox session."
```

---

### Task 2.2: Minimum overlap fraction guard

**Why:** even with the sport guard, a 37-min activity that overlaps a 5-min session by 2 minutes is not really a "match." Require the overlap to be at least 50% of the activity's elapsed_time before it counts.

**Files:**
- Modify: `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs:285-377`
- Test: same file as Task 2.1

**Step 1: Add a failing test**

In the same `describe` block from Task 2.1:

```javascript
  test('rejects a 7-minute session match against a 37-minute activity (overlap < 50% of activity)', async () => {
    // Activity: 37 min, session: 7 min, overlap: 5 min. 5/37 = 14% — below
    // the 50% threshold. Expect null.
  });

  test('accepts a 30-minute session match against a 37-minute activity', async () => {
    // Overlap ~25 min / activity 37 min = 67% — above threshold.
  });
```

Run:
```bash
npx vitest run tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs
```

Expected: the under-50% test FAILs (current code accepts any overlap).

**Step 2: Implement the threshold**

After computing `overlapMs` and confirming `overlapMs > 0`, add:

```javascript
        const activityElapsedMs = (activity.elapsed_time || activity.moving_time || 0) * 1000;
        const overlapFraction = activityElapsedMs > 0 ? overlapMs / activityElapsedMs : 0;
        if (overlapFraction < 0.5) {
          this.#logger.info?.('strava.enrichment.session_scan.rejected_by_overlap_fraction', {
            activityId,
            file: filename,
            overlapFraction,
            overlapMs,
            activityElapsedMs,
          });
          continue;
        }
```

(Place inside the `if (overlapMs > 0 && overlapMs > bestOverlap)` block — i.e. only consider candidates whose overlap is both non-zero AND ≥ 50% of the activity.)

**Step 3: Run tests**

```bash
npx vitest run tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs
```

Expected: all green.

**Step 4: Commit**

```bash
git add backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs \
        tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs
git commit -m "fix(fitness): require ≥50% overlap fraction in Strava match"
```

---

## Phase 3 — Webhook job aging (Fix C)

### Task 3.1: Cap total attempts and add `abandoned` terminal state

**Why:** activity `17831319049` has 485 retries since March 23 because there's no terminal-failure shelf.

**Files:**
- Modify: `backend/src/1_adapters/strava/StravaWebhookJobStore.mjs`
- Modify: `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs:131-272`
- Test: create `tests/isolated/application/fitness/StravaWebhookJobStore.test.mjs` (or extend if exists) and an enrichment-aging case in the enrichment test file

**Step 1: Read the current store**

```bash
# Check what statuses exist and how findActionable filters
grep -n "status\|findActionable" backend/src/1_adapters/strava/StravaWebhookJobStore.mjs
```

Document the current status set (likely `pending`, `completed`, `unmatched`). The fix will:
- Add a new terminal status `abandoned`.
- Cap total attempts at `MAX_TOTAL_ATTEMPTS = 10` in the enrichment service.
- Have `findActionable` exclude both `completed` and `abandoned` (it likely already excludes `completed`).

**Step 2: Write the failing test for the store filter**

Add to (or create) `tests/isolated/application/fitness/StravaWebhookJobStore.test.mjs`:

```javascript
describe('StravaWebhookJobStore.findActionable', () => {
  test('excludes jobs in abandoned status', async () => {
    // Seed a job with status: 'abandoned' via store.update.
    // Assert findActionable() does not return it.
  });

  test('still includes jobs in unmatched status (they retry)', async () => {
    // Confirm we don't break existing behavior.
  });
});
```

**Step 3: Implement store filter change**

In `StravaWebhookJobStore.mjs`, locate `findActionable()`. If it currently filters `status !== 'completed'`, change to:

```javascript
findActionable() {
  return this.findAll().filter(job =>
    job.status !== 'completed' && job.status !== 'abandoned'
  );
}
```

**Step 4: Write the failing test for the attempt cap**

Add to `tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs`:

```javascript
describe('FitnessActivityEnrichmentService — terminal-failure aging', () => {
  test('marks a job abandoned after MAX_TOTAL_ATTEMPTS attempts', async () => {
    // Stub jobStore.findById to return a job with attempts: 9.
    // Stub stravaClient.getActivity to throw or return null.
    // Call _attemptEnrichment. Expect jobStore.update with status:'abandoned'.
  });

  test('does not retry an abandoned job', async () => {
    // jobStore.findById returns a job with status:'abandoned'.
    // _attemptEnrichment should early-return without calling getActivity.
  });
});
```

**Step 5: Implement the cap**

In `FitnessActivityEnrichmentService.mjs`, near the top of the class file:

```javascript
const MAX_RETRIES = 3;
const MAX_TOTAL_ATTEMPTS = 10;            // hard cap before abandoning
const RETRY_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
```

In `_attemptEnrichment`, immediately after `if (job.status === 'completed') return;` (around line 137), add:

```javascript
    if (job.status === 'abandoned') return;
    if ((job.attempts || 0) >= MAX_TOTAL_ATTEMPTS) {
      this.#logger.warn?.('strava.enrichment.abandoned', {
        activityId,
        attempts: job.attempts,
      });
      this.#jobStore.update(activityId, {
        status: 'abandoned',
        abandonedAt: new Date().toISOString(),
      });
      return;
    }
```

This intercepts before any work happens. Existing retries still run up to `MAX_TOTAL_ATTEMPTS` (much higher than the per-step `MAX_RETRIES = 3`), giving slow Strava lookups room while still capping forever-loops.

**Step 6: Run tests**

```bash
npx vitest run tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs \
                tests/isolated/application/fitness/StravaWebhookJobStore.test.mjs
```

Expected: all green.

**Step 7: Commit**

```bash
git add backend/src/1_adapters/strava/StravaWebhookJobStore.mjs \
        backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs \
        tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs \
        tests/isolated/application/fitness/StravaWebhookJobStore.test.mjs
git commit -m "fix(fitness): cap webhook retries and add abandoned terminal state

Activity 17831319049 has retried 485 times since 2026-03-23. Cap total
attempts at 10 and add a terminal 'abandoned' status that findActionable
filters out."
```

---

### Task 3.2: Manual abandonment of the long-stuck job

**Why:** the cap only stops *future* loops. The existing 485-attempt job needs to be marked abandoned by hand.

**Step 1: Inspect the job**

```bash
cat /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/household/common/strava/strava-webhooks/17831319049.yml
```

**Step 2: Mark abandoned via SSH on prod (per CLAUDE.md mount-permission note)**

(Replace the placeholder with actual prod host from `.claude/settings.local.json`. **Confirm with the user before running** — this writes to shared production state.)

```bash
ssh {env.prod_host} 'cat > /usr/src/app/data/household/common/strava/strava-webhooks/17831319049.yml' <<'YAML'
activityId: 17831319049
ownerId: 14872916
eventTime: 1774292370
receivedAt: '2026-03-23T18:59:31.190Z'
status: abandoned
attempts: 485
lastAttemptAt: '2026-05-06T19:25:51.371Z'
abandonedAt: '2026-05-06T20:00:00.000Z'
matchedSessionId: null
note: 'Manually abandoned per docs/_wip/audits/2026-05-06-fitness-session-strava-sync-fragmentation-audit.md'
YAML
```

No commit needed — this is data, not code.

---

## Phase 4 — Data cleanup (one-shot, from prod)

These all run inside the daylight-station container because the host can't write to the data volume cleanly (per CLAUDE.md). Each step is reversible because we're keeping merged-source files until verified.

**Pause checkpoint:** before any of Phase 4, confirm with the user that the code from Phases 1-3 has been deployed to prod. Cleanup must run AGAINST the new behavior, not the old one (otherwise the bad-match guard won't apply when we re-enrich).

### Task 4.1: Merge 2026-05-01 evening Daytona USA fragments

**Files affected on disk:**
- Source: `data/household/history/fitness/2026-05-01/20260501190411.yml`
- Target: `data/household/history/fitness/2026-05-01/20260501193558.yml`

**Step 1: Confirm both files have the same `summary.media[0].contentId`**

```bash
ssh {env.prod_host} 'docker exec {env.docker_container} sh -c "
  grep -A1 \"^  media:\" /usr/src/app/data/household/history/fitness/2026-05-01/20260501190411.yml | head -3
  echo ---
  grep -A1 \"^  media:\" /usr/src/app/data/household/history/fitness/2026-05-01/20260501193558.yml | head -3
"'
```

Expected: both show `contentId: plex:606446`.

**Step 2: Run the existing merge CLI**

```bash
ssh {env.prod_host} 'docker exec {env.docker_container} \
  node /usr/src/app/cli/merge-fitness-sessions.cli.mjs 2026-05-01 \
  20260501190411 20260501193558'
```

Expected output: a single merged YAML at `20260501193558.yml` with start `19:04:11`, end `20:06:49`, ~62 minutes.

**Step 3: Sanity-check the merged file**

```bash
ssh {env.prod_host} 'docker exec {env.docker_container} sh -c "
  ls -la /usr/src/app/data/household/history/fitness/2026-05-01/
  head -10 /usr/src/app/data/household/history/fitness/2026-05-01/20260501193558.yml
"'
```

Expected: only two files remain (`20260501061820.yml` and `20260501193558.yml`); merged file's `session.start` is `2026-05-01 19:04:11.*` and `session.end` is `2026-05-01 20:06:49.*`.

### Task 4.2: Merge 2026-05-06 morning Chest & Back fragments

```bash
ssh {env.prod_host} 'docker exec {env.docker_container} \
  node /usr/src/app/cli/merge-fitness-sessions.cli.mjs 2026-05-06 \
  20260506125238 20260506130106'
```

Expected: single merged session at `20260506130106.yml` with start `12:52:38`, end `13:46:16`, ~54 minutes, same `plex:664042` Chest & Back content.

### Task 4.3: Detach 2026-05-05 Lunch Run from the wrong session and create a Strava-only session

This one needs a small bespoke CLI because there's no existing tool. Two steps:

**Step 1: Reset the webhook job**

```bash
ssh {env.prod_host} 'cat > /usr/src/app/data/household/common/strava/strava-webhooks/18390552794.yml' <<'YAML'
activityId: 18390552794
ownerId: 14872916
eventTime: 1778011746
receivedAt: '2026-05-05T20:09:07.267Z'
status: pending
attempts: 0
matchedSessionId: null
YAML
```

**Step 2: Wipe the bad strava attribution from the home session**

The home session `20260505130756.yml` has a `participants.kckern.strava` block written by the webhook writeback path. We need to remove it (and any root-level `strava:` block) so the session looks pristine.

Open the file via SSH:

```bash
ssh {env.prod_host} 'docker exec {env.docker_container} cat /usr/src/app/data/household/history/fitness/2026-05-05/20260505130756.yml'
```

If a `participants.kckern.strava:` or root `strava:` block exists, remove it manually:

```bash
ssh {env.prod_host} 'docker exec {env.docker_container} sh -c "
  cd /usr/src/app
  node -e \"
    const fs = require('fs');
    const yaml = require('js-yaml');
    const path = '/usr/src/app/data/household/history/fitness/2026-05-05/20260505130756.yml';
    const data = yaml.load(fs.readFileSync(path, 'utf8'));
    if (data.participants?.kckern?.strava) delete data.participants.kckern.strava;
    if (data.strava) delete data.strava;
    fs.writeFileSync(path, yaml.dump(data));
    console.log('cleaned');
  \"
"'
```

**Step 3: Trigger re-enrichment**

The simplest path: restart the daylight-station container. On startup, `recoverPendingJobs()` re-queues `pending` jobs. With Phase 2 deployed, the sport guard rejects the bad match → falls through to `MAX_RETRIES` → `_createStravaOnlySession` writes a new YAML.

```bash
ssh {env.prod_host} 'docker restart {env.docker_container}'
```

Wait ~20 minutes (RETRY_INTERVAL_MS × 3 retries + safety margin), then verify:

```bash
ssh {env.prod_host} 'docker exec {env.docker_container} ls /usr/src/app/data/household/history/fitness/2026-05-05/'
```

Expected: a new file like `20260505123000.yml` (start time matching the run's `start_date_local`), with `source: strava` and the run's GPS polyline.

Verify the webhook job:

```bash
ssh {env.prod_host} 'docker exec {env.docker_container} cat /usr/src/app/data/household/common/strava/strava-webhooks/18390552794.yml'
```

Expected: `status: completed`, `note: created-strava-session`.

---

## Phase 5 — Verification

### Task 5.1: Confirm resume check works in production logs

After Phase 1-3 are deployed, manually exercise the path:

1. Open the fitness page in a browser.
2. Start a workout (let HR samples flow until `buffer_threshold_met` fires — usually ~5 sec).
3. Close the tab.
4. Re-open the page within 30 minutes; resume the same content.
5. Tail the latest log:

```bash
ls -t /Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/media/logs/fitness/*.jsonl | head -1 | xargs grep "resume_check\|fitness.resumable.check"
```

Expected:
- `fitness.session.resume_check.start` with `"contentId":"plex:<num>"` (with prefix).
- `fitness.session.resume_check.result` with `"resumable":true`.
- `fitness.session.resume_check.auto_resume` followed by `fitness.session.started` with `"reason":"resumed"`.

Backend logs (via `docker logs {env.docker_container}` or wherever they land):
- `fitness.resumable.check.match` with the matched session id.

If any of these are missing, the fix didn't take. Reopen the audit and re-investigate.

### Task 5.2: Confirm Strava match guard works

Wait for the next outdoor run and confirm it creates its own Strava-only session rather than binding to whatever indoor activity happens to be running. Check the webhook job for `note: created-strava-session`. Optionally, before that, you can manually trigger a re-enrichment of the May 5 run via Phase 4.3.

### Task 5.3: Confirm webhook job aging works

After a few days, scan the webhook directory for any job whose `attempts` exceeds 10 — there should be none. Stuck jobs should now read `status: abandoned` instead of `unmatched`.

---

## Phase 6 — Documentation closeout

### Task 6.1: Add a "Resolution" section to the audit

Edit `docs/_wip/audits/2026-05-06-fitness-session-strava-sync-fragmentation-audit.md` and append:

```markdown
---

## Resolution (2026-MM-DD)

Implemented per `docs/_wip/plans/2026-05-06-fitness-session-strava-sync-fix.md`.

- Fix A (resume check): commits {hash1}, {hash2}, {hash3}, {hash4}.
- Fix B (Strava match guard): commits {hash5}, {hash6}.
- Fix C (webhook aging): commit {hash7}; manual abandonment of 17831319049.
- Data cleanup: merged 2026-05-01 evening (62m), merged 2026-05-06 morning (54m),
  detached 2026-05-05 Lunch Run and recreated as Strava-only session.

Verified in production logs on 2026-MM-DD: `fitness.resumable.check.match`
fires for the first time since deploy; resume_check.result returns true.
```

### Task 6.2: Move the audit and plan to `_archive` once stable

After 2 weeks of clean operation (no fragmentation, all webhook jobs reaching terminal state), move:

```bash
git mv docs/_wip/audits/2026-05-06-fitness-session-strava-sync-fragmentation-audit.md docs/_archive/
git mv docs/_wip/plans/2026-05-06-fitness-session-strava-sync-fix.md docs/_archive/
git commit -m "docs(archive): move 2026-05-06 fitness sync audit and plan after verification"
```

---

## Out of scope (intentionally deferred)

These came up in the audit but should be tracked separately:

- **Multi-client session-id collision** (two browsers within the same second producing identical session IDs). Pre-existing concern from the 2026-04-28 audit; orthogonal to this fix.
- **Pre-session contentId race** (D in the audit). With Phase 1 fixed, the race only causes an extra fresh-start on cold reload — annoying but not the same disaster. A localStorage-based persistence pass would close it.
- **Refactoring `_findMatchingSession` into a pure function** for easier testing. Worth doing the next time someone touches the file; not blocking.
- **Abandoned-job admin endpoint** for human triage of `status: abandoned` jobs. Tracker only — no need before this fix is verified.

---

## Files referenced in this plan

### Code (modified)
- `backend/src/3_applications/fitness/services/SessionService.mjs` (Task 1.1)
- `frontend/src/hooks/fitness/FitnessSession.js` (Task 1.2)
- `frontend/src/context/FitnessContext.jsx` (Task 1.3)
- `frontend/src/modules/Fitness/nav/FitnessMenu.jsx` (Task 1.4)
- `frontend/src/modules/Fitness/player/FitnessShow.jsx` (Task 1.4)
- `frontend/src/Apps/FitnessApp.jsx` (Task 1.4)
- `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs` (Tasks 2.1, 2.2, 3.1)
- `backend/src/1_adapters/strava/StravaWebhookJobStore.mjs` (Task 3.1)

### Tests (modified or created)
- `tests/isolated/application/fitness/SessionService.test.mjs` (Task 1.1)
- `frontend/src/hooks/fitness/FitnessSession.contentId.test.js` (Tasks 1.2, 1.3)
- `frontend/src/modules/Fitness/nav/__tests__/FitnessMenu.queueShape.test.jsx` (Task 1.4 — new)
- `tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs` (Tasks 2.1, 2.2, 3.1 — likely new)
- `tests/isolated/application/fitness/StravaWebhookJobStore.test.mjs` (Task 3.1 — likely new)

### CLI (used, unchanged)
- `cli/merge-fitness-sessions.cli.mjs` (Tasks 4.1, 4.2)

### Docs
- `docs/_wip/audits/2026-05-06-fitness-session-strava-sync-fragmentation-audit.md` (this plan's source-of-truth)
