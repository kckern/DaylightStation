# Fitness Primary Media Selection Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the fitness session summary from picking the wrong primary media item (e.g. a stale 16-minute "Induro" video over the actual 50-minute "Wave Race" workout).

**Architecture:** Two compounding bugs, fixed independently:
1. `FitnessSession._pendingEvents` flushes pre-session media events with no age cutoff — drop events older than `session.startTime - GRACE_MS`.
2. `selectPrimaryMedia` Tier 1 filter unconditionally excludes "KidsFun" content. Replace label-based exclusion with a duration-ratio gate: a KidsFun item still beats a non-KidsFun item if it is materially longer.

Both fixes are in pure functions / pure methods with existing test coverage. Each fix alone would have produced the right result for the 2026-05-16 session; together they harden the path.

**Tech Stack:** Vanilla JS, vitest (co-located `*.test.js`) + jest (`tests/unit/suite/**/*.test.mjs`). Logger: `getLogger()` from `frontend/src/lib/logging/Logger.js`.

---

## File Structure

| File | Role |
|------|------|
| `frontend/src/hooks/fitness/FitnessSession.js` | Modify `start()` flush loop (~L1659–1667) to drop stale pending events |
| `frontend/src/hooks/fitness/selectPrimaryMedia.js` | Modify Tier 1 to use duration-ratio gate instead of unconditional KidsFun exclusion |
| `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs` | Parallel backend impl — mirror the same Tier 1 change |
| `frontend/src/hooks/fitness/selectPrimaryMedia.test.js` | vitest — extend with duration-ratio cases |
| `tests/unit/suite/fitness/selectPrimaryMedia.test.mjs` | jest — extend with duration-ratio cases (backend parallel) |
| `frontend/src/hooks/fitness/FitnessSession.flushPending.test.js` | NEW — vitest unit test for the age cutoff |

---

### Task 1: Add a flush-age cutoff to `FitnessSession.start()`

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1658-1667`

**Why:** Media events that fire between sessions (e.g. user previewed a workout video before pressing Start) are queued into `_pendingEvents`. When the next session starts the flush loop drains all of them into the new session's timeline — including events with timestamps from 2 hours ago. Cap them at `session.startTime - GRACE_MS`.

- [ ] **Step 1: Write the failing test** at `frontend/src/hooks/fitness/FitnessSession.flushPending.test.js`

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn() }));

const { FitnessSession } = await import('./FitnessSession.js');

describe('FitnessSession._pendingEvents flush age cutoff', () => {
  let session;

  beforeEach(() => {
    session = new FitnessSession();
    // Enable kiosk so ensureSessionStarted is not blocked
    session._kioskMode = true;
    session._bufferThresholdMet = true;
  });

  it('drops pending events older than (startTime - GRACE_MS) at flush time', () => {
    const now = Date.now();
    const STALE_GRACE_MS = 60_000;
    // Queue three events: one ancient (2h ago), one within grace (10s ago), one "now"
    session.logEvent('media_start', { contentId: 'plex:old' }, now - 7_200_000);
    session.logEvent('media_end',   { contentId: 'plex:old' }, now - 10_000);
    session.logEvent('media_start', { contentId: 'plex:fresh' }, now);
    expect(session._pendingEvents.length).toBe(3);

    // Start session — flush loop runs
    vi.setSystemTime(now);
    const started = session.ensureSessionStarted('test');
    expect(started).toBe(true);

    // Only the within-grace and now events should land on the timeline
    const events = session.timeline.events.filter(e =>
      e.type === 'media_start' || e.type === 'media_end'
    );
    expect(events.map(e => e.data.contentId)).toEqual(['plex:old', 'plex:fresh']);
    // The ancient media_start (2h old) was dropped
  });

  it('logs a structured drop count when stale events are pruned', () => {
    const now = Date.now();
    const Logger = await import('../../lib/logging/Logger.js');
    const infoSpy = vi.spyOn(Logger.default(), 'info');

    session.logEvent('media_start', { contentId: 'old' }, now - 7_200_000);
    session.logEvent('media_start', { contentId: 'fresh' }, now);
    vi.setSystemTime(now);
    session.ensureSessionStarted('test');

    expect(infoSpy).toHaveBeenCalledWith(
      'fitness.session.flush_pending_events',
      expect.objectContaining({ count: 1, droppedStale: 1 })
    );
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /opt/Code/DaylightStation
npx vitest run frontend/src/hooks/fitness/FitnessSession.flushPending.test.js
```

Expected: FAIL — either both events flush (no cutoff) or the log call shape mismatches (`droppedStale` field doesn't exist yet).

- [ ] **Step 3: Implement the cutoff** at `frontend/src/hooks/fitness/FitnessSession.js:1658-1667`

Replace the existing flush block:

```js
    // Flush any events that were queued before the timeline was ready
    if (this._pendingEvents.length > 0) {
      getLogger().info('fitness.session.flush_pending_events', {
        sessionId: this.sessionId, count: this._pendingEvents.length
      });
      for (const evt of this._pendingEvents) {
        this.timeline.logEvent(evt.type, evt.data, evt.timestamp);
      }
      this._pendingEvents = [];
    }
```

with:

```js
    // Flush any events that were queued before the timeline was ready.
    // Drop entries with timestamps older than (startTime - PENDING_FLUSH_GRACE_MS) —
    // those originated from a prior session's tail (e.g. preview playback between
    // sessions) and would corrupt this session's media attribution.
    if (this._pendingEvents.length > 0) {
      const PENDING_FLUSH_GRACE_MS = 60_000;
      const cutoff = this.startTime - PENDING_FLUSH_GRACE_MS;
      const fresh = [];
      let droppedStale = 0;
      for (const evt of this._pendingEvents) {
        if (Number.isFinite(evt.timestamp) && evt.timestamp < cutoff) {
          droppedStale += 1;
          continue;
        }
        fresh.push(evt);
      }
      getLogger().info('fitness.session.flush_pending_events', {
        sessionId: this.sessionId,
        count: fresh.length,
        droppedStale,
        cutoff
      });
      for (const evt of fresh) {
        this.timeline.logEvent(evt.type, evt.data, evt.timestamp);
      }
      this._pendingEvents = [];
    }
```

- [ ] **Step 4: Re-run the test**

```bash
npx vitest run frontend/src/hooks/fitness/FitnessSession.flushPending.test.js
```

Expected: PASS (both cases).

- [ ] **Step 5: Run the broader FitnessSession test suite to catch regressions**

```bash
npx vitest run frontend/src/hooks/fitness/FitnessSession.resumable.test.js frontend/src/hooks/fitness/FitnessSession.cadenceTs.test.js
```

Expected: PASS (no test should reference the flush log shape).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js \
        frontend/src/hooks/fitness/FitnessSession.flushPending.test.js
git commit -m "fix(fitness): drop stale pending events at flush time

Pending media events accumulated between sessions were being flushed
into the next session's timeline without age check, corrupting media
attribution (e.g. a previous-session video shown as the new session's
primary). Apply a 60s grace cutoff at flush time and log droppedStale
for observability.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Replace `selectPrimaryMedia` Tier 1 deprioritized exclusion with duration-ratio gate (frontend)

**Files:**
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.js:106-123`
- Modify: `frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

**Why:** Tier 1 currently filters out KidsFun videos via `!isDeprioritized(v)`. This breaks the moment any non-KidsFun video exists in the same session, because a tiny 16-minute non-KidsFun item beats a 50-minute KidsFun workout. The duration-ratio gate keeps the deprioritization preference but only honours it when the non-KidsFun candidate is comparable in length (`durationMs * MIN_DEPRIO_RATIO ≥ kidsfunMax.durationMs`).

- [ ] **Step 1: Write the failing tests** — append to `frontend/src/hooks/fitness/selectPrimaryMedia.test.js`

```js
describe('Tier 1 — duration-ratio gate replaces unconditional KidsFun exclusion', () => {
  it('picks the KidsFun video when the non-KidsFun candidate is shorter than ratio threshold', () => {
    // 2026-05-16 regression case: 16.7-min Induro vs 50-min Wave Race (kidsfun)
    const media = [
      { contentId: 'plex:induro',   mediaType: 'video', title: 'Kiedler Forest', durationMs: 16 * 60 * 1000 },
      { contentId: 'plex:waverace', mediaType: 'video', title: 'Wave Race 64',   durationMs: 50 * 60 * 1000, labels: ['kidsfun'] },
    ];
    const cfg = { deprioritized_labels: ['KidsFun'] };
    const pick = selectPrimaryMedia(media, cfg);
    expect(pick.contentId).toBe('plex:waverace');
  });

  it('still picks the non-KidsFun video when it is comparable in length', () => {
    const media = [
      { contentId: 'plex:induro',  mediaType: 'video', title: 'Induro long', durationMs: 45 * 60 * 1000 },
      { contentId: 'plex:kidsfun', mediaType: 'video', title: 'KF',          durationMs: 50 * 60 * 1000, labels: ['kidsfun'] },
    ];
    const cfg = { deprioritized_labels: ['KidsFun'] };
    const pick = selectPrimaryMedia(media, cfg);
    expect(pick.contentId).toBe('plex:induro'); // ratio: 50 / 45 = 1.11 < 2x threshold
  });

  it('falls back to non-KidsFun when only KidsFun is sub-floor (<5 min)', () => {
    const media = [
      { contentId: 'plex:induro',  mediaType: 'video', title: 'Induro', durationMs: 10 * 60 * 1000 },
      { contentId: 'plex:kidsfun', mediaType: 'video', title: 'KF',     durationMs: 3 * 60 * 1000, labels: ['kidsfun'] },
    ];
    const cfg = { deprioritized_labels: ['KidsFun'] };
    expect(selectPrimaryMedia(media, cfg).contentId).toBe('plex:induro');
  });

  it('picks longest KidsFun when no non-KidsFun candidates exist (T4 unchanged)', () => {
    const media = [
      { contentId: 'plex:a', mediaType: 'video', title: 'A', durationMs: 5 * 60 * 1000,  labels: ['kidsfun'] },
      { contentId: 'plex:b', mediaType: 'video', title: 'B', durationMs: 50 * 60 * 1000, labels: ['kidsfun'] },
    ];
    const cfg = { deprioritized_labels: ['KidsFun'] };
    expect(selectPrimaryMedia(media, cfg).contentId).toBe('plex:b');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npx vitest run frontend/src/hooks/fitness/selectPrimaryMedia.test.js
```

Expected: the first new test FAILs (picks `plex:induro` instead of `plex:waverace`); the existing T4 fallback test still PASSes.

- [ ] **Step 3: Implement the duration-ratio gate** — replace lines 105-123 of `frontend/src/hooks/fitness/selectPrimaryMedia.js`:

```js
  // Step 3: Constants for the cascade.
  const MIN_PRIMARY_MS = 5 * 60 * 1000;
  const MIN_T2_T3_MS = 3 * 60 * 1000;
  const TEN_MIN_MS = 10 * 60 * 1000;
  // A non-deprio video must be at least 1/MIN_DEPRIO_RATIO of the longest
  // deprio video's duration to outrank it in Tier 1. Picked so a 16-min Induro
  // can't outrank a 50-min KidsFun workout (50/16 = 3.1 > 2), while a 45-min
  // Induro can outrank a 50-min KidsFun (50/45 = 1.1 < 2).
  const MIN_DEPRIO_RATIO = 2;

  // Step 4: Tier 1 — Eligible real workouts.
  // Old rule: filter out deprioritized unconditionally. That breaks any session
  // where a tiny non-deprio item appears alongside a long deprio workout.
  // New rule: a deprio item still competes in Tier 1; it loses only if a
  // non-deprio item is comparable in length (>= longestDeprio / MIN_DEPRIO_RATIO).
  const eligibleAll = videos.filter(v => !isWarmup(v) && (v.durationMs || 0) >= MIN_PRIMARY_MS);
  if (eligibleAll.length > 0) {
    const nonDeprio = eligibleAll.filter(v => !isDeprioritized(v));
    const deprio    = eligibleAll.filter(v =>  isDeprioritized(v));
    const longestDeprio = deprio.reduce(
      (best, v) => (v.durationMs || 0) > (best?.durationMs || 0) ? v : best,
      null
    );

    // Apply the ratio gate: non-deprio must be within 1/MIN_DEPRIO_RATIO of the
    // longest deprio to remain eligible. If no deprio exists, every non-deprio passes.
    const deprioFloor = longestDeprio ? (longestDeprio.durationMs || 0) / MIN_DEPRIO_RATIO : 0;
    const competitive = nonDeprio.filter(v => (v.durationMs || 0) >= deprioFloor);

    const pool = competitive.length > 0 ? competitive : eligibleAll;
    const longSurvivors = pool.filter(v => (v.durationMs || 0) >= TEN_MIN_MS);
    if (longSurvivors.length >= 2) {
      return longSurvivors[longSurvivors.length - 1];
    }
    return pool.reduce((best, item) =>
      (item.durationMs || 0) > (best.durationMs || 0) ? item : best
    );
  }
```

Also delete `const realCandidates = ...` (was line 113) — it is replaced by `eligibleAll`. Update Tier 2 (now line ~125) to recompute from `videos`:

```js
  // Step 5: Tier 2 — real candidates ≥ MIN_T2_T3_MS (drops the T1 floor but keeps a sub-floor).
  const realCandidates = videos.filter(v => !isWarmup(v) && !isDeprioritized(v));
  const t2Candidates = realCandidates.filter(v => (v.durationMs || 0) >= MIN_T2_T3_MS);
```

- [ ] **Step 4: Re-run vitest**

```bash
npx vitest run frontend/src/hooks/fitness/selectPrimaryMedia.test.js
```

Expected: PASS, including the four new cases AND all pre-existing cases (positional bias, warmup filtering, cascading tiers).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/selectPrimaryMedia.js \
        frontend/src/hooks/fitness/selectPrimaryMedia.test.js
git commit -m "fix(fitness): duration-ratio gate replaces KidsFun T1 exclusion

Tier 1 unconditionally excluded deprioritized (KidsFun) videos, so a
brief non-KidsFun preview would beat a long KidsFun workout. Replace
with a 2x duration-ratio gate: deprio still loses to a comparable
non-deprio candidate, but a 50-min KidsFun workout now correctly
beats a 16-min Induro preview.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Mirror the duration-ratio gate in the backend `selectPrimaryMedia`

**Files:**
- Modify: `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs` (Tier 1 block — mirror frontend exactly)
- Modify: `tests/unit/suite/fitness/selectPrimaryMedia.test.mjs` (jest — add the same 4 cases)

**Why:** The backend has a parallel implementation used by post-session summary jobs. Both must agree or the persisted summary will drift from the in-app preview.

- [ ] **Step 1: Read both files for the exact current shape**

```bash
diff frontend/src/hooks/fitness/selectPrimaryMedia.js \
     backend/src/1_adapters/fitness/selectPrimaryMedia.mjs
```

Expected: tiers should match. Note any whitespace / import differences.

- [ ] **Step 2: Port the Tier 1 change verbatim to `backend/src/1_adapters/fitness/selectPrimaryMedia.mjs`**

Apply the same replacement made in Task 2 Step 3, preserving any backend-specific imports unchanged.

- [ ] **Step 3: Add the same 4 test cases to `tests/unit/suite/fitness/selectPrimaryMedia.test.mjs`**

Use the existing jest factory helpers (`vid(title, durationMs, overrides)`) in that file. Example for one case:

```js
describe('Tier 1 — duration-ratio gate (parity with frontend)', () => {
  it('picks long KidsFun workout over a short non-KidsFun preview', () => {
    const media = [
      vid('Kiedler Forest', 16 * 60 * 1000),
      vid('Wave Race 64',   50 * 60 * 1000, { labels: ['kidsfun'] }),
    ];
    const cfg = { deprioritized_labels: ['KidsFun'] };
    expect(selectPrimaryMedia(media, cfg).title).toBe('Wave Race 64');
  });

  // ...port the other 3 cases identically
});
```

- [ ] **Step 4: Run jest unit suite (which is what the harness runs)**

```bash
cd /opt/Code/DaylightStation
npm run test:unit -- --only=fitness --pattern=selectPrimaryMedia
```

Expected: PASS for all cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/fitness/selectPrimaryMedia.mjs \
        tests/unit/suite/fitness/selectPrimaryMedia.test.mjs
git commit -m "fix(fitness): backend selectPrimaryMedia parity for ratio gate

Mirror the frontend Tier 1 duration-ratio change in the backend
adapter so the persisted session summary matches the in-app preview.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add a "primary_selected" winners-log for future audits

**Files:**
- Modify: `frontend/src/hooks/fitness/buildSessionSummary.js` (or wherever `selectPrimaryMedia` is called for the live session) — emit `fitness.session.primary_selected` after the call.

**Why:** Today, post-hoc forensics required reading the YAML + grepping logs. Emit a structured event with `{contentId, tier, candidateCount, durationMs}` so the next audit takes seconds.

- [ ] **Step 1: Find the call site**

```bash
grep -rn "selectPrimaryMedia(" frontend/src/hooks/fitness/ frontend/src/modules/Fitness/
```

Use the call in `buildSessionSummary` (existing). Identify whether `selectPrimaryMedia` should return a `{ pick, tier, candidates }` shape (refactor) or whether we instrument at the call site (simpler).

- [ ] **Step 2: Refactor `selectPrimaryMedia` to return `{ pick, tier, deprioRatio }` and update call sites**

In `frontend/src/hooks/fitness/selectPrimaryMedia.js`, change the four `return X;` to `return { pick: X, tier: 1 };` etc. Then add a default-export adapter:

```js
export function selectPrimaryMedia(mediaItems, config) {
  const result = _selectPrimaryMediaInternal(mediaItems, config);
  return result?.pick ?? null;        // preserve backwards-compatible default return
}
export function selectPrimaryMediaWithDiagnostics(mediaItems, config) {
  return _selectPrimaryMediaInternal(mediaItems, config);
}
```

Rename the existing function body to `_selectPrimaryMediaInternal`. The new diagnostic export returns `{ pick, tier, candidateCount, deprioRatio? }`.

- [ ] **Step 3: Add a unit test for the diagnostic export**

Append to `selectPrimaryMedia.test.js`:

```js
import { selectPrimaryMediaWithDiagnostics } from './selectPrimaryMedia.js';

it('returns tier + diagnostics for the regression case', () => {
  const media = [
    { contentId: 'a', mediaType: 'video', title: 'Induro', durationMs: 16*60*1000 },
    { contentId: 'b', mediaType: 'video', title: 'Wave',   durationMs: 50*60*1000, labels: ['kidsfun'] },
  ];
  const diag = selectPrimaryMediaWithDiagnostics(media, { deprioritized_labels: ['KidsFun'] });
  expect(diag.pick.contentId).toBe('b');
  expect(diag.tier).toBe(1);
  expect(diag.deprioRatio).toBeGreaterThan(2);
});
```

- [ ] **Step 4: Emit the winners-log at the call site in `buildSessionSummary.js`**

Find the line that calls `selectPrimaryMedia(media, warmupConfig)`. Replace with:

```js
const primary = selectPrimaryMediaWithDiagnostics(media, warmupConfig);
if (primary?.pick) {
  getLogger().info('fitness.session.primary_selected', {
    sessionId: this?.sessionId ?? null,
    contentId: primary.pick.contentId,
    title: primary.pick.title,
    durationMs: primary.pick.durationMs,
    tier: primary.tier,
    candidateCount: media.length,
    deprioRatio: primary.deprioRatio ?? null,
  });
}
return primary?.pick ?? null;
```

(Adjust the variable name to whatever the existing code uses — `summary.primary` etc.)

- [ ] **Step 5: Mirror the diagnostic export in the backend `selectPrimaryMedia.mjs`**

Same change: add `selectPrimaryMediaWithDiagnostics` next to the default export. The backend call site (likely `buildSessionSummary.mjs`) also emits via its server-side logger if convenient — otherwise skip emission server-side and rely on the frontend's emit.

- [ ] **Step 6: Run both test suites**

```bash
npx vitest run frontend/src/hooks/fitness/selectPrimaryMedia.test.js \
                frontend/src/hooks/fitness/buildSessionSummary.test.js 2>/dev/null
npm run test:unit -- --only=fitness --pattern=selectPrimaryMedia
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/selectPrimaryMedia.js \
        frontend/src/hooks/fitness/selectPrimaryMedia.test.js \
        frontend/src/hooks/fitness/buildSessionSummary.js \
        backend/src/1_adapters/fitness/selectPrimaryMedia.mjs
git commit -m "feat(fitness): primary_selected winners-log + diagnostic API

selectPrimaryMediaWithDiagnostics exposes tier + ratio for forensic
visibility. buildSessionSummary now emits fitness.session.primary_selected
so future audits can spot regressions without log archaeology.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verify end-to-end against the 2026-05-16 fixture

**Files:**
- Read: `data/household/history/fitness/2026-05-16/20260516191925.yml` (the corrupted session)

**Why:** Both root-cause fixes should independently produce the correct primary on that session's media list. Synthesize a quick test fixture from the YAML to lock in the regression.

- [ ] **Step 1: Read the session's media list from the YAML**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/history/fitness/2026-05-16/20260516191925.yml' \
  | sed -n '/^media:/,/^[a-z]/p' | head -40
```

Expected output: 3 media items (Induro 1000517ms, Wave Race 3008547ms, Diddy Kong 236101ms).

- [ ] **Step 2: Add a regression test** in `frontend/src/hooks/fitness/selectPrimaryMedia.test.js`:

```js
describe('regression: 2026-05-16 cycling session', () => {
  it('picks Wave Race 64 as primary', () => {
    const media = [
      { contentId: 'plex:600770', mediaType: 'video', title: 'Kiedler Forest, England', showTitle: 'Induro',     durationMs: 1000517 },
      { contentId: 'plex:674283', mediaType: 'video', title: 'Wave Race 64',            showTitle: 'Game Cycling', durationMs: 3008547, labels: ['kidsfun', 'resumable', 'sequential'] },
      { contentId: 'plex:674284', mediaType: 'video', title: 'Diddy Kong Racing',       showTitle: 'Game Cycling', durationMs:  236101, labels: ['kidsfun', 'resumable', 'sequential'] },
    ];
    const cfg = { deprioritized_labels: ['KidsFun'] };
    expect(selectPrimaryMedia(media, cfg).contentId).toBe('plex:674283');
  });
});
```

- [ ] **Step 3: Run the test**

```bash
npx vitest run frontend/src/hooks/fitness/selectPrimaryMedia.test.js --reporter=verbose
```

Expected: PASS — and the regression line shows the fixture exercising the new ratio-gate path (50 min / 16 min = 3.1x ratio).

- [ ] **Step 4: Run the full isolated harness as a sanity check**

```bash
npm run test:isolated -- --only=fitness
```

Expected: no new failures introduced.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/selectPrimaryMedia.test.js
git commit -m "test(fitness): regression case from 2026-05-16 session fs_20260516191925

Locks in the duration-ratio fix against the original failure: a 16-min
Induro segment outranking a 50-min Wave Race workout.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
