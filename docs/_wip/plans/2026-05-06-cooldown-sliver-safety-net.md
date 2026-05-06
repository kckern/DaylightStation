# Cooldown-Sliver Safety Net Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make sliver absorption a safety net that runs across every code path that could create or encounter a Strava-only session — so a phantom HR sliver from an off-site workout cannot persist in the data, regardless of which path got us there or how the original webhook fared.

**Architecture:** Extract `_absorbOverlappingSlivers` (currently a private method on `FitnessActivityEnrichmentService`) into a shared module-level function `absorbOverlappingSlivers` under `backend/src/3_applications/fitness/`. Wire it in three places: (1) the existing webhook-time call inside `_createStravaOnlySession` (already done in `5a48108ce` — switch the call site to the new module), (2) `StravaReconciliationService.reconcile()` as a Pass 3 over Strava-only sessions encountered, and (3) the `cli/scripts/backfill-strava-enrichment.mjs` flow that retroactively creates Strava-only sessions for unmatched archives. Add observability (counts in the reconciliation summary log) so it's verifiable. The helper's existing conservative rules (no media, <15 min, time-overlap ±15 min, not source:strava itself) stay unchanged — this plan adds *coverage*, not *aggression*.

**Tech Stack:** Node.js / ES modules, existing service architecture (DDD layers), Vitest for tests. No new dependencies.

**Why now:** The 2026-05-06 audit identified the cooldown-sliver pattern (off-site Strava run + tail-end HR captured at home). Commit `5a48108ce` shipped the absorption logic for the *webhook-time* path, but two other code paths can encounter the same pattern and currently leave slivers untouched: the periodic reconciliation service and the historical backfill script. If a webhook fails or a backfill creates a Strava-only session for an old activity, the corresponding home sliver stays as a phantom. This plan closes the gap.

---

## Pre-flight

Run from `/Users/kckern/Documents/GitHub/DaylightStation`:

```bash
git status                              # confirm clean tree
npx vitest run tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs
```

Expected: clean tree, 13/13 tests pass (5 sport-guard + 3 aging + 5 sliver-absorption).

If tests are red, stop and surface before continuing.

---

## Phase 1 — Extract sliver absorption to a shared module

### Task 1.1: Create `sliverAbsorption.mjs` with the same behavior as the existing private method

**Why:** The current `_absorbOverlappingSlivers` is a private method on `FitnessActivityEnrichmentService`. To call it from `StravaReconciliationService` and from CLI scripts, it needs to be a module-level function. Extracting also lets us write narrower unit tests against the helper directly.

**Files:**
- Create: `backend/src/3_applications/fitness/sliverAbsorption.mjs`
- Test (new): `tests/isolated/application/fitness/sliverAbsorption.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/application/fitness/sliverAbsorption.test.mjs`:

```javascript
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYamlSafe: vi.fn(),
  listYamlFiles: vi.fn(),
  dirExists: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return { ...actual, unlinkSync: vi.fn() };
});

const { unlinkSync } = await import('fs');
const { absorbOverlappingSlivers } = await import('#apps/fitness/sliverAbsorption.mjs');
const { loadYamlSafe, listYamlFiles, dirExists } = await import('#system/utils/FileIO.mjs');

const buildActivity = (overrides = {}) => ({
  id: 1,
  type: 'Run',
  start_date: '2026-05-04T20:00:00Z',
  elapsed_time: 2400,
  moving_time: 2350,
  distance: 5000,
  ...overrides,
});

const buildSliver = (overrides = {}) => ({
  sessionId: 'sliver-1',
  timezone: 'America/Los_Angeles',
  session: {
    start: '2026-05-04 13:07:56',
    end: '2026-05-04 13:14:51',
    duration_seconds: 415,
  },
  participants: { 'test-user': {} },
  summary: { media: [] },
  ...overrides,
});

describe('absorbOverlappingSlivers', () => {
  let logger;

  beforeEach(() => {
    vi.resetAllMocks();
    dirExists.mockReturnValue(true);
    logger = { info: vi.fn(), warn: vi.fn() };
  });

  test('absorbs short HR-only sliver inside activity window', () => {
    listYamlFiles.mockReturnValue(['sliver-1', 'just-created']);
    loadYamlSafe.mockImplementation((p) => {
      if (p.includes('sliver-1')) return buildSliver();
      return {
        sessionId: 'just-created',
        timezone: 'America/Los_Angeles',
        session: {
          start: '2026-05-04 13:00:00',
          end: '2026-05-04 13:39:48',
          duration_seconds: 2388,
          source: 'strava',
        },
        participants: { 'test-user': {} },
        summary: { media: [] },
      };
    });

    const result = absorbOverlappingSlivers(buildActivity(), '/tmp/dir', {
      justCreatedSessionId: 'just-created',
      logger,
      tz: 'America/Los_Angeles',
    });

    expect(unlinkSync).toHaveBeenCalledTimes(1);
    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('sliver-1'));
    expect(result.absorbed).toEqual(['sliver-1']);
    expect(result.scanned).toBe(2);
  });

  test('does not absorb sessions with media', () => {
    listYamlFiles.mockReturnValue(['indoor']);
    loadYamlSafe.mockReturnValue(buildSliver({
      summary: { media: [{ contentId: 'plex:1', primary: true }] },
    }));

    const result = absorbOverlappingSlivers(buildActivity(), '/tmp/dir', { logger });
    expect(unlinkSync).not.toHaveBeenCalled();
    expect(result.absorbed).toEqual([]);
  });

  test('does not absorb long sessions (≥15 min) even with no media', () => {
    listYamlFiles.mockReturnValue(['long']);
    loadYamlSafe.mockReturnValue(buildSliver({
      session: {
        start: '2026-05-04 13:00:00',
        end: '2026-05-04 13:25:00',
        duration_seconds: 1500,  // exactly 25 min
      },
    }));
    expect(absorbOverlappingSlivers(buildActivity(), '/tmp/dir', { logger }).absorbed).toEqual([]);
  });

  test('does not absorb sessions outside the activity window ±15 min', () => {
    listYamlFiles.mockReturnValue(['far']);
    loadYamlSafe.mockReturnValue(buildSliver({
      session: {
        start: '2026-05-04 06:00:00',  // 7 hours earlier
        end: '2026-05-04 06:10:00',
        duration_seconds: 600,
      },
    }));
    expect(absorbOverlappingSlivers(buildActivity(), '/tmp/dir', { logger }).absorbed).toEqual([]);
  });

  test('does not absorb the just-created Strava-only session', () => {
    listYamlFiles.mockReturnValue(['just-created']);
    loadYamlSafe.mockReturnValue({
      sessionId: 'just-created',
      timezone: 'America/Los_Angeles',
      session: {
        start: '2026-05-04 13:00:00',
        end: '2026-05-04 13:39:48',
        duration_seconds: 2388,
        source: 'strava',
      },
      participants: {},
      summary: { media: [] },
    });
    const result = absorbOverlappingSlivers(buildActivity(), '/tmp/dir', {
      justCreatedSessionId: 'just-created',
      logger,
    });
    expect(unlinkSync).not.toHaveBeenCalled();
    expect(result.absorbed).toEqual([]);
  });

  test('returns absorbed/scanned counts and logs each absorption', () => {
    listYamlFiles.mockReturnValue(['s1', 's2']);
    loadYamlSafe.mockReturnValue(buildSliver());
    const result = absorbOverlappingSlivers(buildActivity(), '/tmp/dir', { logger });
    expect(result.scanned).toBe(2);
    expect(result.absorbed).toHaveLength(2);
    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      'strava.enrichment.sliver_absorbed',
      expect.objectContaining({ activityId: 1, sliverDurationSec: 415 })
    );
  });

  test('returns gracefully when sessionDir does not exist', () => {
    dirExists.mockReturnValue(false);
    const result = absorbOverlappingSlivers(buildActivity(), '/missing', { logger });
    expect(result).toEqual({ scanned: 0, absorbed: [] });
    expect(unlinkSync).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run the test to confirm it fails**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npx vitest run tests/isolated/application/fitness/sliverAbsorption.test.mjs
```

Expected: FAIL — `absorbOverlappingSlivers` module doesn't exist yet.

**Step 3: Create the module**

Create `backend/src/3_applications/fitness/sliverAbsorption.mjs` by extracting the existing logic. Read the current implementation in `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs:631-687` first, then write:

```javascript
/**
 * sliverAbsorption — pure-by-input function that deletes short HR-only home
 * sessions overlapping a Strava activity's window.
 *
 * Such "slivers" are typically cooldown / passing-through HR captures (e.g.
 * the user walked into the home receiver's range while finishing an outdoor
 * activity). They are never real workouts; the Strava activity has the
 * actual data. This helper is invoked from:
 *   1. FitnessActivityEnrichmentService._createStravaOnlySession (webhook path)
 *   2. StravaReconciliationService.reconcile (periodic + post-webhook)
 *   3. cli/scripts/backfill-strava-enrichment.mjs (historical backfill)
 *
 * Conservative absorption rules — a session is deleted only if ALL hold:
 *   - It is not a Strava-only session (`session.source !== 'strava'`)
 *   - It is not the just-created session (skip via `justCreatedSessionId`)
 *   - It has no media (`!summary.media || summary.media.length === 0`)
 *   - It is short (`session.duration_seconds < 15 * 60`)
 *   - Its time window overlaps the activity ±15 min buffer
 *
 * @module applications/fitness/sliverAbsorption
 */

import path from 'path';
import { unlinkSync } from 'fs';
import moment from 'moment-timezone';
import { loadYamlSafe, listYamlFiles, dirExists } from '#system/utils/FileIO.mjs';

export const SLIVER_MAX_DURATION_SEC = 15 * 60;
export const SLIVER_OVERLAP_BUFFER_MS = 15 * 60 * 1000;

/**
 * Delete short HR-only home-session slivers that overlap a Strava activity.
 *
 * @param {Object} activity - Strava activity (must have id, start_date, elapsed_time | moving_time)
 * @param {string} sessionDir - Date directory absolute path
 * @param {Object} [options]
 * @param {string} [options.justCreatedSessionId] - Skip this id (e.g. the strava-only session we just wrote)
 * @param {string} [options.tz='America/Los_Angeles'] - Default timezone for activity start parsing
 * @param {Object} [options.logger] - Logger with info/warn methods
 * @returns {{ scanned: number, absorbed: string[] }}
 */
export function absorbOverlappingSlivers(activity, sessionDir, options = {}) {
  const {
    justCreatedSessionId = null,
    tz = 'America/Los_Angeles',
    logger = console,
  } = options;

  if (!dirExists(sessionDir)) {
    return { scanned: 0, absorbed: [] };
  }

  const actStart = moment(activity.start_date).tz(tz);
  const actEnd = actStart.clone().add(
    activity.elapsed_time || activity.moving_time || 0,
    'seconds'
  );
  const bufStart = actStart.clone().subtract(SLIVER_OVERLAP_BUFFER_MS, 'ms');
  const bufEnd = actEnd.clone().add(SLIVER_OVERLAP_BUFFER_MS, 'ms');

  const files = listYamlFiles(sessionDir);
  const absorbed = [];

  for (const filename of files) {
    if (filename === justCreatedSessionId) continue;

    const filePath = path.join(sessionDir, `${filename}.yml`);
    const data = loadYamlSafe(filePath);
    if (!data) continue;
    if (data.session?.source === 'strava') continue;
    if (Array.isArray(data.summary?.media) && data.summary.media.length > 0) continue;

    const durSec = data.session?.duration_seconds || 0;
    if (durSec === 0 || durSec >= SLIVER_MAX_DURATION_SEC) continue;

    const sessTz = data.timezone || tz;
    const sessStart = data.session?.start ? moment.tz(data.session.start, sessTz) : null;
    const sessEnd = data.session?.end
      ? moment.tz(data.session.end, sessTz)
      : (sessStart ? sessStart.clone().add(durSec, 'seconds') : null);
    if (!sessStart || !sessEnd) continue;
    if (sessEnd.isBefore(bufStart) || sessStart.isAfter(bufEnd)) continue;

    try {
      unlinkSync(filePath);
      absorbed.push(filename);
      logger.info?.('strava.enrichment.sliver_absorbed', {
        activityId: activity.id,
        sliverFile: filename,
        sliverDurationSec: durSec,
        activityElapsedSec: activity.elapsed_time || activity.moving_time || 0,
      });
    } catch (err) {
      logger.warn?.('strava.enrichment.sliver_absorb_failed', {
        activityId: activity.id,
        sliverFile: filename,
        error: err?.message,
      });
    }
  }

  return { scanned: files.length, absorbed };
}
```

**Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/isolated/application/fitness/sliverAbsorption.test.mjs
```

Expected: 7/7 tests pass.

**Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/sliverAbsorption.mjs \
        tests/isolated/application/fitness/sliverAbsorption.test.mjs
git commit -m "refactor(fitness): extract absorbOverlappingSlivers to shared module

Pulls the helper out of FitnessActivityEnrichmentService so both the
periodic reconciliation service and the historical backfill CLI can call
it. Behavior is preserved exactly; the existing private method on the
service still works for now (next task switches its body to call this
module). Adds 7 unit tests covering all the conservative rules."
```

---

### Task 1.2: Switch the existing call-site to use the shared module

**Why:** Now that `absorbOverlappingSlivers` exists as a module, the original private method should delegate to it (or be replaced entirely). This avoids duplicate logic and keeps a single source of truth.

**Files:**
- Modify: `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs`
  - Remove: the `_absorbOverlappingSlivers` method body (lines ~631-687)
  - Modify: the call site inside `_createStravaOnlySession` (around line 609) to invoke the new module function directly
  - Remove: the local `SLIVER_MAX_DURATION_SEC` and `SLIVER_OVERLAP_BUFFER_MS` constants (lines 38-39) — they're exported from the new module
  - Remove: the `import { unlinkSync } from 'fs';` (no longer needed in the service)

**Step 1: Read the current call site and method**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
grep -n "_absorbOverlappingSlivers\|SLIVER_MAX\|SLIVER_OVERLAP\|from 'fs'" backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs
```

Note the exact line numbers — they may have shifted from the plan's hints.

**Step 2: Add the import at the top of FitnessActivityEnrichmentService.mjs**

Near the existing imports (around line 25-30), add:

```javascript
import { absorbOverlappingSlivers } from './sliverAbsorption.mjs';
```

**Step 3: Replace the call site**

In `_createStravaOnlySession`, find the line `this._absorbOverlappingSlivers(activity, sessionDir, sessionId);` (around line 609) and replace with:

```javascript
    absorbOverlappingSlivers(activity, sessionDir, {
      justCreatedSessionId: sessionId,
      tz,
      logger: this.#logger,
    });
```

`tz` is already in scope at this call site (line 437 in `_createStravaOnlySession`).

**Step 4: Delete the private method**

Remove the entire `_absorbOverlappingSlivers(activity, sessionDir, justCreatedSessionId) { ... }` method body (around lines 631-687).

**Step 5: Delete the now-unused constants and import**

- Remove `const SLIVER_MAX_DURATION_SEC = 15 * 60;` and `const SLIVER_OVERLAP_BUFFER_MS = 15 * 60 * 1000;` (lines 38-39).
- Remove `import { unlinkSync } from 'fs';` if it's no longer used elsewhere (verify with grep first).

**Step 6: Run all FitnessActivityEnrichmentService tests**

```bash
npx vitest run tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs
```

Expected: 13/13 still pass. The existing 5 sliver-absorption tests in this file should still work because they test behavior through `_createStravaOnlySession` (which still calls the same logic, just via the new module).

**Important:** the existing tests reference `service._absorbOverlappingSlivers(...)` directly as a callable. Since we deleted that method, those tests will fail. There are two ways to fix:

1. Keep them and switch them to call `absorbOverlappingSlivers` (the new module function).
2. Delete them since the new sliverAbsorption.test.mjs (Task 1.1) covers the same behavior.

Choose option **2** — those tests are now redundant with the dedicated module-level tests. The remaining tests in the file (sport-guard, overlap-fraction, aging) still cover the service-level integration.

So: in `tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs`, delete the entire `describe('FitnessActivityEnrichmentService._absorbOverlappingSlivers', …)` block. The file should still have 8 tests after (5 sport-guard/overlap + 3 aging).

**Step 7: Run all fitness-isolated tests**

```bash
npx vitest run tests/isolated/application/fitness/
```

Expected: all green except the pre-existing `playlistSorter.test.mjs` import failure (unrelated).

**Step 8: Commit**

```bash
git add backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs \
        tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs
git commit -m "refactor(fitness): switch enrichment service to shared sliver helper

Removes the duplicate private _absorbOverlappingSlivers method and its
local constants — they now live in sliverAbsorption.mjs. Behavior at the
webhook-time call site is unchanged. Service-level tests for sliver
absorption are now redundant with the dedicated module tests; deleting
them keeps the test suite focused."
```

---

## Phase 2 — Wire reconciliation to absorb slivers

### Task 2.1: Add Pass 3 to `StravaReconciliationService.reconcile()`

**Why:** Today, `reconcile()` walks every session in the lookback window and runs Pass 1 (session→strava re-enrichment) and Pass 2 (strava→session note pull). It does NOT clean up slivers. So if a webhook fires, the enrichment service creates a Strava-only session AND absorbs slivers — but if a webhook *failed* (or fired before the absorption logic shipped), the slivers persist forever. Periodic reconciliation should catch them.

**Approach:** For each session whose `session.source === 'strava'`, run sliver absorption against its date dir. The activity object is already fetched at line 82 of `StravaReconciliationService.mjs` (`await this.#stravaClient.getActivity(activityId)`).

**Files:**
- Modify: `backend/src/3_applications/fitness/StravaReconciliationService.mjs`
- Test (new): `tests/isolated/application/fitness/StravaReconciliationService.test.mjs`

**Step 1: Write the failing test**

Create `tests/isolated/application/fitness/StravaReconciliationService.test.mjs`:

```javascript
import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYamlSafe: vi.fn(),
  listYamlFiles: vi.fn(),
  dirExists: vi.fn(),
  saveYaml: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return { ...actual, unlinkSync: vi.fn() };
});

const { unlinkSync } = await import('fs');
const { StravaReconciliationService } = await import('#apps/fitness/StravaReconciliationService.mjs');
const { loadYamlSafe, listYamlFiles, dirExists } = await import('#system/utils/FileIO.mjs');

describe('StravaReconciliationService — Pass 3: sliver absorption', () => {
  let service;
  let stravaClient;
  let configService;
  let logger;

  beforeEach(() => {
    vi.resetAllMocks();
    dirExists.mockReturnValue(true);
    logger = { info: vi.fn(), warn: vi.fn() };
    stravaClient = {
      getActivity: vi.fn().mockResolvedValue({
        id: 18390552794,
        type: 'Run',
        start_date: '2026-05-05T19:30:00Z',
        elapsed_time: 2388,
        moving_time: 2342,
        distance: 5230,
      }),
      updateActivity: vi.fn(),
    };
    configService = {
      getAppConfig: () => ({}),
      getTimezone: () => 'America/Los_Angeles',
    };
    service = new StravaReconciliationService({
      stravaClient,
      configService,
      fitnessHistoryDir: '/tmp/fake-history',
      logger,
    });
  });

  test('absorbs orphan slivers next to a Strava-only session during reconcile', async () => {
    // listYamlFiles returns:
    //   - the Strava-only session ('strava-only-id')
    //   - a phantom sliver in the same date dir
    listYamlFiles.mockReturnValue(['strava-only-id', 'phantom-sliver']);
    loadYamlSafe.mockImplementation((p) => {
      if (p.includes('strava-only-id')) {
        return {
          sessionId: 'strava-only-id',
          timezone: 'America/Los_Angeles',
          session: {
            start: '2026-05-05 12:30:00',
            end: '2026-05-05 13:09:48',
            duration_seconds: 2388,
            source: 'strava',
          },
          participants: {
            'test-user': { strava: { activityId: 18390552794 } },
          },
          summary: { media: [] },
          strava: { activityId: 18390552794 },
        };
      }
      if (p.includes('phantom-sliver')) {
        return {
          sessionId: 'phantom-sliver',
          timezone: 'America/Los_Angeles',
          session: {
            start: '2026-05-05 13:07:56',
            end: '2026-05-05 13:14:51',
            duration_seconds: 415,
          },
          participants: { 'test-user': {} },
          summary: { media: [] },
        };
      }
      return null;
    });

    await service.reconcile();

    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining('phantom-sliver'));
    expect(unlinkSync).not.toHaveBeenCalledWith(expect.stringContaining('strava-only-id'));
  });

  test('reconcile summary log includes slivers_absorbed count', async () => {
    listYamlFiles.mockReturnValue(['strava-only-id', 'phantom-sliver']);
    loadYamlSafe.mockImplementation((p) => {
      if (p.includes('strava-only-id')) {
        return {
          sessionId: 'strava-only-id',
          timezone: 'America/Los_Angeles',
          session: {
            start: '2026-05-05 12:30:00',
            end: '2026-05-05 13:09:48',
            duration_seconds: 2388,
            source: 'strava',
          },
          participants: { 'test-user': { strava: { activityId: 18390552794 } } },
          summary: { media: [] },
          strava: { activityId: 18390552794 },
        };
      }
      return {
        sessionId: 'phantom-sliver',
        timezone: 'America/Los_Angeles',
        session: {
          start: '2026-05-05 13:07:56',
          end: '2026-05-05 13:14:51',
          duration_seconds: 415,
        },
        participants: { 'test-user': {} },
        summary: { media: [] },
      };
    });

    await service.reconcile();

    expect(logger.info).toHaveBeenCalledWith(
      'strava.reconciliation.complete',
      expect.objectContaining({ sliversAbsorbed: expect.any(Number) })
    );
    const completeCall = logger.info.mock.calls.find(c => c[0] === 'strava.reconciliation.complete');
    expect(completeCall[1].sliversAbsorbed).toBe(1);
  });

  test('does NOT absorb slivers when iterating a non-Strava-only session', async () => {
    // The session being reconciled is an enriched home session (has activityId
    // in participants, but not source: strava). Pass 3 should skip absorption
    // since this isn't a Strava-only session — the home session may be the
    // legitimate match for the activity.
    listYamlFiles.mockReturnValue(['enriched-home', 'maybe-sliver']);
    loadYamlSafe.mockImplementation((p) => {
      if (p.includes('enriched-home')) {
        return {
          sessionId: 'enriched-home',
          timezone: 'America/Los_Angeles',
          session: {
            start: '2026-05-04 19:16:00',
            end: '2026-05-04 20:05:00',
            duration_seconds: 2940,
            // NOTE: no source: 'strava' — this is an indoor session that
            // happened to be enriched with strava data via the writeback path.
          },
          participants: {
            'test-user': { strava: { activityId: 18380161567 } },
          },
          summary: { media: [{ contentId: 'plex:606446', primary: true }] },
        };
      }
      return {
        sessionId: 'maybe-sliver',
        timezone: 'America/Los_Angeles',
        session: {
          start: '2026-05-04 19:30:00',
          end: '2026-05-04 19:35:00',
          duration_seconds: 300,
        },
        participants: { 'test-user': {} },
        summary: { media: [] },
      };
    });

    await service.reconcile();

    // The maybe-sliver might or might not be a sliver, but Pass 3 only fires
    // for Strava-only sessions. The enriched home session is the matched
    // session, so absorption is intentionally skipped here.
    expect(unlinkSync).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run the tests to confirm they fail**

```bash
npx vitest run tests/isolated/application/fitness/StravaReconciliationService.test.mjs
```

Expected: FAIL — Pass 3 doesn't exist yet.

**Step 3: Add Pass 3 to `StravaReconciliationService.reconcile()`**

Edit `backend/src/3_applications/fitness/StravaReconciliationService.mjs`:

3a. Add the import near the top (after the existing imports around line 17):

```javascript
import { absorbOverlappingSlivers } from './sliverAbsorption.mjs';
```

3b. In the `reconcile()` method (line 46), add a new local counter near the existing `let sessionsProcessed = 0; let enriched = 0; let notesPulled = 0;` (around line 56):

```javascript
    let sliversAbsorbed = 0;
```

3c. Inside the per-session loop (line 60-114 region), AFTER the existing `if (didEnrich || didPull || !lastReconciled) { saveYaml(...); }` block and BEFORE `sessionsProcessed++`, add Pass 3:

```javascript
          // Pass 3: Sliver absorption (only for Strava-only sessions).
          // If this session was the result of _createStravaOnlySession (or
          // an equivalent backfill), look for adjacent HR-only home slivers
          // in the same date dir and delete them. Catches the cases where
          // the original webhook either failed to absorb or never fired.
          if (session.session?.source === 'strava') {
            const result = absorbOverlappingSlivers(activity, dateDir, {
              justCreatedSessionId: session.sessionId || session.session?.id,
              tz,
              logger: this.#logger,
            });
            sliversAbsorbed += result.absorbed.length;
          }
```

(`activity` is in scope from line 82; `dateDir` from line 61; `tz` from line 50.)

3d. Update the summary log at the end of `reconcile()` (around line 117) to include the new count:

```javascript
    this.#logger.info?.('strava.reconciliation.complete', {
      sessionsProcessed,
      enriched,
      notesPulled,
      sliversAbsorbed,
    });
```

**Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/isolated/application/fitness/StravaReconciliationService.test.mjs
```

Expected: 3/3 pass.

Then run the full fitness-isolated suite:

```bash
npx vitest run tests/isolated/application/fitness/
```

Expected: all green except pre-existing `playlistSorter` failure.

**Step 5: Commit**

```bash
git add backend/src/3_applications/fitness/StravaReconciliationService.mjs \
        tests/isolated/application/fitness/StravaReconciliationService.test.mjs
git commit -m "feat(fitness): reconciliation Pass 3 — absorb cooldown slivers

When reconcile() walks each session, any session whose source is 'strava'
gets a sliver-absorption pass over its date dir. Catches phantom HR
slivers left behind when the original webhook failed, was retried with
older code, or otherwise didn't run absorb-overlapping-slivers at
creation time. Adds sliversAbsorbed to the reconciliation summary log."
```

---

## Phase 3 — Wire backfill script to absorb slivers

### Task 3.1: Update `cli/scripts/backfill-strava-enrichment.mjs` to call sliver absorption when it creates Strava-only sessions

**Why:** This CLI scans Strava archives and creates Strava-only sessions for activities that have no matching home session. It's the third path that writes Strava-only sessions — and currently it doesn't absorb slivers. Without this, running the backfill on historical data would leave any cooldown slivers untouched.

**Files:**
- Modify: `cli/scripts/backfill-strava-enrichment.mjs`

**Step 1: Read the current CLI to find the create-Strava-only-session site**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
grep -n "saveYaml\|create.*strava.*session\|sessionData\|_createStravaOnlySession" cli/scripts/backfill-strava-enrichment.mjs | head -10
```

The CLI likely has its own copy of the session-construction logic (this was historical, predating webhook-time consolidation). Find the line that writes the Strava-only session via `saveYaml`.

**Step 2: Add the import at the top of the CLI file**

Near the existing imports (around line 27-46):

```javascript
const { absorbOverlappingSlivers } = await import('#apps/fitness/sliverAbsorption.mjs');
```

(Keep it as a dynamic `await import` since the CLI uses that pattern for the rest of its imports.)

**Step 3: Call sliver absorption after each Strava-only session creation**

After the line that calls `saveYaml(...)` for a newly-created Strava-only session AND only when the CLI's `--write` mode is active, add:

```javascript
        if (writeMode) {
          // Absorb any HR-only home slivers in the same date dir that
          // overlap this activity. Mirrors what the webhook flow does.
          absorbOverlappingSlivers(activity, sessionDir, {
            justCreatedSessionId: sessionId,
            tz: TIMEZONE,
            logger: console,
          });
        }
```

(`sessionDir`, `sessionId`, `activity`, `TIMEZONE` are all already in scope at the create site. Verify by reading the surrounding code.)

**Step 4: Add a `--dry-run`-respecting log line**

In dry-run mode, the CLI should *report* what would be absorbed without doing it. Add a small block above the call:

```javascript
        // Pre-scan for sliver absorption (always reports; only acts under --write)
        // Note: absorbOverlappingSlivers actually deletes; in dry-run we just
        // log what's there. Keep the absorb call gated by writeMode above.
```

Skip this if it complicates the code — the CLI is a maintenance tool, not a polished UX. The summary at the end can simply note `slivers_absorbed: <n>` from accumulating the return values.

**Step 5: Run the CLI in dry-run mode against recent data**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
DAYLIGHT_BASE_PATH="/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation" \
  node cli/scripts/backfill-strava-enrichment.mjs 14
```

Expected: dry-run output should NOT delete anything; should report any sliver candidates it sees. If no candidates, output is empty for slivers (because Tasks 5-8 from the prior plan already cleaned up the recent ones).

**Step 6: Commit**

```bash
git add cli/scripts/backfill-strava-enrichment.mjs
git commit -m "feat(fitness): backfill CLI absorbs slivers on Strava-only creation

When backfill creates a Strava-only session in --write mode, it now also
runs sliver absorption against the same date dir. Closes the third
remaining path that could leave a phantom sliver behind."
```

---

## Phase 4 — Tooling for explicit safety-net runs

### Task 4.1: Add `--auto-fix` to `cli/scan-fitness-history.mjs` for batch sliver cleanup

**Why:** Lets you run a one-shot cleanup without invoking the full reconciliation pipeline. Useful for cron-style maintenance, post-deploy verification, or after restoring from a backup.

**Files:**
- Modify: `cli/scan-fitness-history.mjs`

**Step 1: Read the current scanner**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
head -50 cli/scan-fitness-history.mjs
```

**Step 2: Add `--auto-fix` flag handling near the top**

After the existing `const DATA_BASE = ...;` block, add:

```javascript
const args = process.argv.slice(2);
const AUTO_FIX = args.includes('--auto-fix');
```

**Step 3: When `--auto-fix` is set, after the report prints, run sliver absorption for each Strava-only session detected**

At the end of the scanner script (after the four `console.log` summary blocks), add:

```javascript
if (AUTO_FIX) {
  console.log('\n=== AUTO-FIX: running sliver absorption for each Strava-only session ===');
  const { absorbOverlappingSlivers } = await import(
    '/Users/kckern/Documents/GitHub/DaylightStation/backend/src/3_applications/fitness/sliverAbsorption.mjs'
  );
  // (Path import works because we're running from the project root via Node.)

  const stravaOnlySessions = sessions.filter(s => s.source === 'strava');
  let totalAbsorbed = 0;

  for (const s of stravaOnlySessions) {
    const dateDir = path.join(HISTORY_DIR, s.date);
    // We need the original activity object. The scanner doesn't fetch from
    // the Strava API; instead it reconstructs the minimal fields needed by
    // absorbOverlappingSlivers from the session's stored strava block.
    if (!s.stravaActivityId) continue;
    const activityShim = {
      id: s.stravaActivityId,
      start_date: new Date(s.startMs).toISOString(),
      elapsed_time: Math.round((s.endMs - s.startMs) / 1000),
      moving_time: Math.round((s.endMs - s.startMs) / 1000),
    };
    const result = absorbOverlappingSlivers(activityShim, dateDir, {
      justCreatedSessionId: s.sessionId,
      tz: 'America/Los_Angeles',
      logger: console,
    });
    if (result.absorbed.length > 0) {
      console.log(`  ${s.date}: absorbed ${result.absorbed.length} sliver(s) for ${s.stravaName || s.stravaActivityId}`);
      totalAbsorbed += result.absorbed.length;
    }
  }

  console.log(`\nAUTO-FIX complete: ${totalAbsorbed} slivers absorbed across ${stravaOnlySessions.length} Strava-only sessions.`);
}
```

**Step 4: Update the help/usage banner at the top of the file**

Edit the existing JSDoc/comment at the top to mention the new flag:

```javascript
 * Usage:
 *   node cli/scan-fitness-history.mjs              (read-only diagnostic)
 *   node cli/scan-fitness-history.mjs --auto-fix   (delete absorbable slivers)
```

**Step 5: Test in dry-run mode (default)**

```bash
node cli/scan-fitness-history.mjs
```

Expected: same as before — read-only report, no deletions.

**Step 6: Test with `--auto-fix` against current data**

```bash
node cli/scan-fitness-history.mjs --auto-fix
```

Expected: report + the AUTO-FIX section. Since prior cleanup already removed slivers, the count should be `0`. (If there are any new slivers introduced since the last cleanup, they'll be absorbed.)

**Step 7: Commit**

```bash
git add cli/scan-fitness-history.mjs
git commit -m "feat(tooling): scan-fitness-history --auto-fix for one-shot sliver cleanup

Lets the operator run a full safety-net pass on demand (cron-style or
post-deploy verification). Read-only by default; --auto-fix triggers the
absorption logic against every Strava-only session in the data."
```

---

## Phase 5 — Wrap-up

### Task 5.1: Update the audit doc with the new safety-net layers

**Files:**
- Modify: `docs/_wip/audits/2026-05-06-fitness-session-strava-sync-fragmentation-audit.md`

In the Resolution section, add a new sub-section near the bottom:

```markdown
### Safety-net layers (post-2026-05-06)

The webhook-time absorption from `5a48108ce` was extended to cover every
code path that can produce a Strava-only session:

| Path | Absorption fires | Commit |
|---|---|---|
| Webhook `_createStravaOnlySession` | After saveYaml | `5a48108ce` (initial) → switched to shared module in this plan |
| Periodic `StravaReconciliationService.reconcile()` Pass 3 | When iterating any `session.source === 'strava'` | this plan |
| Backfill `cli/scripts/backfill-strava-enrichment.mjs` | After creating Strava-only sessions in `--write` mode | this plan |
| On-demand `cli/scan-fitness-history.mjs --auto-fix` | When invoked manually | this plan |

The shared logic lives in `backend/src/3_applications/fitness/sliverAbsorption.mjs`. Conservative rules unchanged: no media, <15 min, time overlap ±15 min, not source:strava itself. The only thing that changed is *coverage*.

Reconciliation runs after every Strava webhook AND on the scheduled morning debrief (cf. existing scheduling). So even if a webhook drops or a service restart interrupts absorption, the next reconciliation pass within the lookback window catches it.
```

Commit:

```bash
git add docs/_wip/audits/2026-05-06-fitness-session-strava-sync-fragmentation-audit.md
git commit -m "docs(audit): record the cooldown-sliver safety-net layers"
```

---

## Verification

After all tasks ship, run the full test sweep one more time:

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npx vitest run tests/isolated/application/fitness/
npx vitest run frontend/src/hooks/fitness/ frontend/src/context/
```

Expected: green except the pre-existing `playlistSorter.test.mjs` failure.

Run the scanner:

```bash
node cli/scan-fitness-history.mjs
```

Expected: 0 fragments, 0 absorbable slivers (or the same 3 missing-session ghosts and 4 borderline fragments as before — those are out of scope here).

Run an explicit auto-fix:

```bash
node cli/scan-fitness-history.mjs --auto-fix
```

Expected: 0 slivers absorbed (everything already clean).

---

## Out of scope (intentionally deferred)

These came up in earlier conversations but are NOT in this plan:

- **Idle-detection heuristic for long captures (>15 min)** — a 60-min idle HR capture after a run won't be auto-absorbed. The conservative 15-min cap stays. If this becomes a real problem, build a separate "idle session" classifier — but only if the data shows the case is common.
- **Slivers with media** — sessions with any media block, even a 2-second false-start, are preserved. Manual cleanup only. Don't auto-delete media-bearing sessions.
- **Concern #1 from the audit (webhook never arrives → no Strava-only session ever created)** — already handled by the existing periodic backfill (`cli/scripts/backfill-strava-enrichment.mjs`). After this plan, that backfill also absorbs slivers. So the path is: backfill creates the missing Strava-only session → its absorption pass cleans up the corresponding home sliver.
- **Multi-client session-id collision** — pre-existing concern from the 2026-04-28 audit. Independent of cooldown-sliver pattern. Not addressed here.

---

## Files modified summary

### Code (new + modified)
- New: `backend/src/3_applications/fitness/sliverAbsorption.mjs`
- Modified: `backend/src/3_applications/fitness/FitnessActivityEnrichmentService.mjs` (delegate to module)
- Modified: `backend/src/3_applications/fitness/StravaReconciliationService.mjs` (Pass 3)
- Modified: `cli/scripts/backfill-strava-enrichment.mjs` (call absorption)
- Modified: `cli/scan-fitness-history.mjs` (--auto-fix)

### Tests (new + modified)
- New: `tests/isolated/application/fitness/sliverAbsorption.test.mjs`
- New: `tests/isolated/application/fitness/StravaReconciliationService.test.mjs`
- Modified: `tests/isolated/application/fitness/FitnessActivityEnrichmentService.test.mjs` (remove redundant tests)

### Docs
- Modified: `docs/_wip/audits/2026-05-06-fitness-session-strava-sync-fragmentation-audit.md`
