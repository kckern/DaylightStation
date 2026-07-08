# End-Session Fix + Session 20260620191341 Split Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Make the fitness "End Session" button reliably end the *live* in-browser session so it is never ignored, and (2) backfill-split the already-recorded session `20260620191341` into its two real parts (cycling/kids-shows vs. Mario Kart) at the Mario-Kart boundary, recomputing every cumulative metric.

**Architecture:**
- **Part A (code fix):** The bug is that `End Session` only POSTs to a *server* endpoint (`/sessions/:id/end`) that finalizes the persisted YAML but never tells the live `FitnessSession` instance (the SSoT for the active recording) to stop. The live session keeps autosaving, clobbers the server's `finalized` flag on the next ~15s cycle, and only dies later via the `empty_roster` timeout. Fix: end the live instance directly from the kiosk (it is the same browser), and stop the manual end from arming the 10-minute auto-start cooldown so a deliberate split can immediately begin a fresh session.
- **Part B (backfill):** A pure domain module decodes the v3 RLE series, splits every series at the Mario-Kart tick, re-zeroes the cumulative series (`beats`/`coins`/`rotations`/`impacts`) for part 2, and recomputes per-participant + treasure-box + bucket summaries for each part. A one-shot CLI driver reads the YAML, runs the split with a dry-run report + hard reconciliation invariants, then writes part 1 (truncated, original id) and part 2 (new id) and regenerates both time-lapse recaps.

**Tech Stack:** Node ESM (`.mjs`), js-yaml, existing `TimelineService` (RLE codec) + `SessionStatsService` (participant stats), React context (frontend), Vitest (frontend tests), `node --test` (backend domain tests). Runs on `kckern-server` (this host *is* prod; build/deploy/garage-reload allowed per `CLAUDE.local.md`).

---

## Key Facts (verified against the live data — do not re-derive)

- **Bug evidence:** session `fs_20260620191341` ran one unbroken ~50 min, JSONL has 1266 `fitness.session.autosave` + exactly one `fitness.session.started` + **zero** manual/force_break end events; it ended via `🛑 SESSION_END … reason="empty_roster"` after `3036777ms`. The button never reached the live session.
- **Code seam (client → server only):** `frontend/src/modules/Fitness/player/FitnessSidebar.jsx:55` `handleEndSession` → `buildEndSessionRequest` (`endSessionRequest.js`) → `POST api/v1/fitness/sessions/:id/end` (`backend/src/4_api/v1/routers/fitness.mjs:516`). No WebSocket broadcast. The only live-end path is `FitnessContext.jsx:1279` `data.action === 'force_break'` → `session.endSession('force_break')`, and **no backend code ever broadcasts `force_break`** (orphaned consumer).
- **Cooldown gate:** `frontend/src/hooks/fitness/FitnessSession.js:1244-1255` — `_maybeStartSessionFromBuffer` refuses to auto-start for `FITNESS_TIMEOUTS.sessionEndCooldown` (600000 ms) after `_lastSessionEndTimestamp`, which `endSession()` sets unconditionally at line 2270. `endSession()` already computes `_finalized = (reason === 'manual' || reason === 'user_initiated')` at line 2226.
- **Split point:** Mario Kart `media_start` event `timestamp: 1782009019590` (`contentId: plex:675678`, "Mario Kart Arcade GP 2"). Everything at `timestamp >= 1782009019590` belongs to part 2. Confirmation: the only voice memo ("The Yoshi Cup and the Mario Cup.") is at `1782010890040` → part 2.
- **Session timebase:** `session.start = '2026-06-20 19:13:41.386'` America/Los_Angeles (PDT = UTC-7 in June), `intervalMs = treasureBox.coinTimeUnitMs = 5000`, `tick_count = 610`. Expected split tick ≈ **233** (part 1 = ticks 0..232, part 2 = ticks 233..609). Expected part-2 new id ≈ `20260620193305`/`20260620193306`.
- **Series keys (verified):** per-user `<slug>:hr`, `<slug>:zone`, `<slug>:beats`, `<slug>:coins` for slugs `user_1,user_3,user_2,user_4,user_5`; `bike:<id>:rpm`, `bike:<id>:rotations`; `device:<id>:heart-rate`; `vib:<name>:active|impacts|intensity`; `global:coins`.
  - **Cumulative (re-zero in part 2):** key suffix in `{beats, coins, rotations, impacts}` (plus `global:coins`).
  - **Instantaneous (slice only):** `hr, zone, rpm, heart-rate, active, intensity`.
- **Zone→coin-color map:** `cool→blue, active→green, warm→yellow, hot→orange, fire→red` (verified: original buckets `blue:0, green:1060, yellow:1578, orange:435, red:30`, total 3103; cool earns 0 → blue 0).
- **Data file:** container path `data/household/history/fitness/2026-06-20/20260620191341.yml` (22431 lines, `version: 3`). `claude` can read it via host mount but **must write via `sudo docker exec daylight-station sh -c '…'`** (root inside container) and then `chown node:node`.
- **`TimelineService` codec is NOT timezone-aware** (`parseToUnixMs`/`formatTimestamp` ignore the tz arg). Compute `startAbsMs` with `moment-timezone`, not `parseToUnixMs`.

---

## File Structure

**Part A (code fix):**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js` — cooldown bypass on deliberate end.
- Create: `frontend/src/hooks/fitness/endLiveSession.js` — pure helper that ends the live instance.
- Modify: `frontend/src/context/FitnessContext.jsx` — `requestEndSession()` callback + expose on context value.
- Modify: `frontend/src/modules/Fitness/player/FitnessSidebar.jsx` — `handleEndSession` ends the live session first, then POSTs.
- Test: `frontend/src/hooks/fitness/FitnessSession.manualEndCooldown.test.js`, `frontend/src/hooks/fitness/endLiveSession.test.js`.

**Part B (backfill):**
- Create: `backend/src/2_domains/fitness/services/sessionSplit.mjs` — pure split/recompute logic.
- Test: `backend/src/2_domains/fitness/services/sessionSplit.test.mjs`.
- Create: `cli/fitness-split-session.mjs` — one-shot driver (dry-run + write).

---

# PART A — End Session never gets ignored

## Task A1: Manual/user end must not arm the auto-start cooldown

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:2270` (inside `endSession`)
- Test: `frontend/src/hooks/fitness/FitnessSession.manualEndCooldown.test.js` (create)

**Why:** A deliberate end is a clean split — the user wants a new session to start the moment genuine new activity arrives. The 3-sample pre-session buffer (`_preSessionThreshold`) still guards against ghost sessions, so dropping the cooldown for manual ends is safe. Auto/inactivity/empty_roster ends keep the cooldown (their purpose is to suppress leftover-HR duplicates).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/fitness/FitnessSession.manualEndCooldown.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));

const { FitnessSession } = await import('./FitnessSession.js');

// Build a valid HR sample the pre-session buffer accepts.
const hrSample = (deviceId, hr) => ({
  deviceId, type: 'heart_rate', profile: 'heart_rate', heartRate: hr,
  data: { heartRate: hr }, timestamp: Date.now()
});

// Push enough valid HR samples to cross the 3-sample threshold and start a session.
function startSession(session, deviceId = '1001') {
  session.setKioskMode(true);
  for (let i = 0; i < 4; i++) session.ingestData(hrSample(deviceId, 120));
  return session.sessionId;
}

describe('FitnessSession deliberate-end cooldown bypass', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it('does NOT arm the auto-start cooldown after a user_initiated end', () => {
    const session = new FitnessSession();
    const firstId = startSession(session);
    expect(firstId).toBeTruthy();

    session.endSession('user_initiated');
    expect(session.sessionId).toBeNull();

    // A fresh, genuine workout should be able to start immediately.
    const secondId = startSession(session, '1002');
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
  });

  it('STILL arms the cooldown after an inactivity/empty_roster end', () => {
    const session = new FitnessSession();
    startSession(session);
    session.endSession('empty_roster');
    expect(session.sessionId).toBeNull();

    // Cooldown active → genuine HR within the window must NOT start a session.
    const secondId = startSession(session, '1002');
    expect(secondId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/hooks/fitness/FitnessSession.manualEndCooldown.test.js --exclude '**/.claire/**'`
Expected: FAIL — first test fails because after `user_initiated` end the cooldown is armed, so the second session does not start (`secondId` is `null`).

- [ ] **Step 3: Implement the cooldown bypass**

In `frontend/src/hooks/fitness/FitnessSession.js`, replace the unconditional line 2270:

```javascript
    _lastSessionEndTimestamp = Date.now();
```

with:

```javascript
    // A deliberate end is a clean split: don't arm the auto-start cooldown, so a
    // genuinely new workout can begin immediately (still gated by the 3-sample
    // pre-session buffer). Auto/inactivity/empty_roster ends keep the cooldown to
    // suppress duplicate sessions from leftover HR.
    const deliberateEnd = reason === 'manual' || reason === 'user_initiated' || reason === 'force_break';
    _lastSessionEndTimestamp = deliberateEnd ? 0 : Date.now();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs frontend/src/hooks/fitness/FitnessSession.manualEndCooldown.test.js --exclude '**/.claire/**'`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/FitnessSession.manualEndCooldown.test.js
git commit -m "fix(fitness): deliberate session end bypasses auto-start cooldown

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A2: Wire the End Session button to the live session

**Files:**
- Create: `frontend/src/hooks/fitness/endLiveSession.js`
- Test: `frontend/src/hooks/fitness/endLiveSession.test.js` (create)
- Modify: `frontend/src/context/FitnessContext.jsx` (add `requestEndSession` callback near line 542 where `session` is defined; expose it in the value object near line 2460)
- Modify: `frontend/src/modules/Fitness/player/FitnessSidebar.jsx:55-70` (`handleEndSession`)

**Why:** The kiosk holding the live `FitnessSession` is the same browser as the button. Ending the live instance directly is reliable (no WS round-trip, works even if the socket is flapping). The existing server POST is kept as a finalize backstop (it also triggers the time-lapse recap render).

- [ ] **Step 1: Write the failing test for the pure helper**

Create `frontend/src/hooks/fitness/endLiveSession.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { endLiveSession } from './endLiveSession.js';

describe('endLiveSession', () => {
  it('returns false and is a no-op when there is no session', () => {
    expect(endLiveSession(null)).toBe(false);
    expect(endLiveSession({ sessionId: null })).toBe(false);
  });

  it('ends an active session with reason "user_initiated" and returns true', () => {
    const calls = [];
    const fake = {
      sessionId: 'fs_123',
      endSession(reason) { calls.push(reason); this.sessionId = null; return true; }
    };
    const result = endLiveSession(fake);
    expect(result).toBe(true);
    expect(calls).toEqual(['user_initiated']);
    expect(fake.sessionId).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --config vitest.config.mjs frontend/src/hooks/fitness/endLiveSession.test.js`
Expected: FAIL — "Failed to resolve import './endLiveSession.js'".

- [ ] **Step 3: Implement the pure helper**

Create `frontend/src/hooks/fitness/endLiveSession.js`:

```javascript
/**
 * End the live in-browser FitnessSession deliberately (user pressed "End Session").
 * Reason 'user_initiated' marks the session finalized and (via FitnessSession)
 * bypasses the auto-start cooldown so a subsequent workout can begin immediately.
 *
 * @param {{ sessionId: (string|null), endSession: (reason: string) => boolean } | null} session
 * @returns {boolean} true if a session was actually ended
 */
export function endLiveSession(session) {
  if (!session || !session.sessionId) return false;
  return session.endSession('user_initiated');
}

export default endLiveSession;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --config vitest.config.mjs frontend/src/hooks/fitness/endLiveSession.test.js`
Expected: PASS.

- [ ] **Step 5: Add `requestEndSession` to FitnessContext**

In `frontend/src/context/FitnessContext.jsx`, add the import near the other hook imports at the top of the file (after the existing `FitnessSession` import):

```javascript
import { endLiveSession } from '../hooks/fitness/endLiveSession.js';
```

Then add this callback immediately after `const session = fitnessSessionRef.current;` at line 542:

```javascript
  // Deliberate "End Session" from the kiosk UI. Ends the LIVE session instance
  // (the SSoT for the active recording) — the server POST alone never reaches it.
  const requestEndSession = React.useCallback(() => {
    const ok = endLiveSession(fitnessSessionRef.current);
    if (ok) {
      getLogger().info('fitness.session.user_end', { source: 'sidebar_button' });
      batchedForceUpdate();
    }
    return ok;
  }, [batchedForceUpdate]);
```

Then add `requestEndSession` to the context `value` object (near `fitnessSessionInstance: session,` at line 2460):

```javascript
    fitnessSessionInstance: session,
    requestEndSession,
```

- [ ] **Step 6: Wire the sidebar handler to end the live session first**

In `frontend/src/modules/Fitness/player/FitnessSidebar.jsx`, add `requestEndSession` to the destructured context (in the `const { … } = fitnessContext;` block around line 31-48):

```javascript
    musicPlayerRef,
    requestEndSession
```

Then change `handleEndSession` (lines 55-70) so it ends the live session before the server backstop POST:

```javascript
  const handleEndSession = React.useCallback(async (event) => {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    const req = buildEndSessionRequest(activeSessionId);
    if (!req) return;
    if (endingSession) return;
    setEndingSession(true);
    setEndSessionError(null);
    // End the LIVE session immediately (reliable, same-browser). The server POST
    // below is a finalize backstop that also triggers the time-lapse recap.
    try { requestEndSession?.(); } catch (_) { /* live-end best effort */ }
    try {
      await DaylightAPI(req.path, req.body, req.method);
    } catch (err) {
      setEndSessionError(err?.message || 'Failed to end session');
    } finally {
      setEndingSession(false);
    }
  }, [activeSessionId, endingSession, requestEndSession]);
```

- [ ] **Step 7: Run both Part-A test files to verify nothing regressed**

Run: `npx vitest run --config vitest.config.mjs frontend/src/hooks/fitness/endLiveSession.test.js frontend/src/hooks/fitness/FitnessSession.manualEndCooldown.test.js`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/hooks/fitness/endLiveSession.js frontend/src/hooks/fitness/endLiveSession.test.js frontend/src/context/FitnessContext.jsx frontend/src/modules/Fitness/player/FitnessSidebar.jsx
git commit -m "fix(fitness): End Session button ends the live session, not just the server record

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A3: Build, deploy, reload garage kiosk, verify

**Files:** none (operational).

- [ ] **Step 1: Confirm the garage is clear to deploy**

Run:
```bash
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```
Expected: no `videoState:"playing"`, `sessionActive:false`, `rosterSize:0`. If a session/video is active, STOP and wait (per `CLAUDE.local.md`).

- [ ] **Step 2: Build the image**

Run:
```bash
sudo docker build -f docker/Dockerfile -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" .
```
Expected: build completes (frontend `vite build` succeeds).

- [ ] **Step 3: Deploy**

Run:
```bash
sudo docker stop daylight-station && sudo docker rm daylight-station && sudo deploy-daylight
```
Expected: container recreated; `sudo docker ps` shows `daylight-station` up.

- [ ] **Step 4: Reload the garage kiosk Firefox**

Run:
```bash
ssh garage 'DISPLAY=:0 XAUTHORITY=/home/kckern/.Xauthority \
  xdotool search --onlyvisible --class firefox windowactivate --sync key ctrl+shift+r'
```
Expected: kiosk reloads (the `XGetWindowProperty[_NET_WM_DESKTOP] failed` warning is benign).

- [ ] **Step 5: Verify the fix in logs after a real End-Session press**

After the next workout where End Session is pressed (or a manual smoke test), confirm the live session actually ends on press:
```bash
sudo docker logs --since 10m daylight-station 2>&1 | grep -E 'fitness.session.user_end|SESSION_END.*user_initiated'
```
Expected: a `fitness.session.user_end` event AND a `SESSION_END … reason="user_initiated"` — NOT a later `empty_roster`. Per memory feedback: verify from logs, do not say "should be".

---

# PART B — Backfill: split session 20260620191341

## Task B1: Pure split + recompute module

**Files:**
- Create: `backend/src/2_domains/fitness/services/sessionSplit.mjs`
- Test: `backend/src/2_domains/fitness/services/sessionSplit.test.mjs`

**Why:** Keep the math pure and unit-tested (DRY/TDD); the CLI driver just does I/O. Reuses `decodeSeries`/`encodeSeries` (RLE codec) and `computeParticipantStats`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/2_domains/fitness/services/sessionSplit.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCumulativeKey, zoneToColor, splitDecodedSeries, computeSplitTick
} from './sessionSplit.mjs';

test('isCumulativeKey: cumulative suffixes only', () => {
  assert.equal(isCumulativeKey('user_3:beats'), true);
  assert.equal(isCumulativeKey('user_3:coins'), true);
  assert.equal(isCumulativeKey('bike:7138:rotations'), true);
  assert.equal(isCumulativeKey('vib:step-platform:impacts'), true);
  assert.equal(isCumulativeKey('global:coins'), true);
  assert.equal(isCumulativeKey('user_3:hr'), false);
  assert.equal(isCumulativeKey('user_3:zone'), false);
  assert.equal(isCumulativeKey('bike:7138:rpm'), false);
  assert.equal(isCumulativeKey('device:90001:heart-rate'), false);
});

test('zoneToColor: standard mapping', () => {
  assert.equal(zoneToColor('cool'), 'blue');
  assert.equal(zoneToColor('active'), 'green');
  assert.equal(zoneToColor('warm'), 'yellow');
  assert.equal(zoneToColor('hot'), 'orange');
  assert.equal(zoneToColor('fire'), 'red');
  assert.equal(zoneToColor('bogus'), null);
});

test('computeSplitTick rounds (splitTs - startAbs)/intervalMs', () => {
  assert.equal(computeSplitTick({ splitTs: 1000 + 233 * 5000, startAbsMs: 1000, intervalMs: 5000 }), 233);
});

test('splitDecodedSeries: instantaneous sliced, cumulative re-zeroed in part2', () => {
  const decoded = {
    'user_3:hr':    [100, 110, 120, 130, 140],   // instantaneous
    'user_3:coins': [10, 20, 30, 40, 50],         // cumulative
  };
  const { part1, part2 } = splitDecodedSeries(decoded, 2); // split at tick 2

  assert.deepEqual(part1['user_3:hr'], [100, 110]);
  assert.deepEqual(part2['user_3:hr'], [120, 130, 140]);

  assert.deepEqual(part1['user_3:coins'], [10, 20]);
  // baseline = part1 last = 20 → part2 re-zeroed
  assert.deepEqual(part2['user_3:coins'], [10, 20, 30]);
});

test('splitDecodedSeries: cumulative re-zero carries nulls forward for baseline', () => {
  const decoded = { 'x:beats': [5, null, 9, 12, 15] };
  const { part2 } = splitDecodedSeries(decoded, 3); // baseline = value at idx 2 = 9
  assert.deepEqual(part2['x:beats'], [3, 6]); // 12-9, 15-9
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test backend/src/2_domains/fitness/services/sessionSplit.test.mjs`
Expected: FAIL — "Cannot find module './sessionSplit.mjs'".

- [ ] **Step 3: Implement the module**

Create `backend/src/2_domains/fitness/services/sessionSplit.mjs`:

```javascript
/**
 * Pure logic to split one persisted v3 fitness session into two at a tick
 * boundary, re-zeroing cumulative series and recomputing summaries.
 *
 * @module 2_domains/fitness/services/sessionSplit
 */
import { computeParticipantStats } from './SessionStatsService.mjs';

const CUMULATIVE_SUFFIXES = ['beats', 'coins', 'rotations', 'impacts'];
const ZONE_COLOR = { cool: 'blue', active: 'green', warm: 'yellow', hot: 'orange', fire: 'red' };

/** A series whose values accumulate monotonically and must rebase to 0 in part 2. */
export function isCumulativeKey(key) {
  if (typeof key !== 'string') return false;
  const suffix = key.split(':').pop();
  return CUMULATIVE_SUFFIXES.includes(suffix);
}

export function zoneToColor(zone) {
  return ZONE_COLOR[zone] ?? null;
}

export function computeSplitTick({ splitTs, startAbsMs, intervalMs }) {
  return Math.round((splitTs - startAbsMs) / intervalMs);
}

/** Last non-null value at an index strictly less than splitTick (carry-forward). */
function baselineBefore(arr, splitTick) {
  for (let i = Math.min(splitTick, arr.length) - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return 0;
}

/**
 * Split a map of decoded (flat-array) series at splitTick.
 * Instantaneous series are sliced; cumulative series are sliced and part 2 is
 * rebased so it starts near 0 (value - baseline, floored at 0).
 *
 * @param {Record<string, Array<number|string|null>>} decoded
 * @param {number} splitTick
 * @returns {{ part1: Record<string, any[]>, part2: Record<string, any[]> }}
 */
export function splitDecodedSeries(decoded, splitTick) {
  const part1 = {};
  const part2 = {};
  for (const [key, arr] of Object.entries(decoded)) {
    const a = Array.isArray(arr) ? arr : [];
    part1[key] = a.slice(0, splitTick);
    const tail = a.slice(splitTick);
    if (isCumulativeKey(key)) {
      const baseline = baselineBefore(a, splitTick);
      part2[key] = tail.map(v => (v == null ? null : Math.max(0, v - baseline)));
    } else {
      part2[key] = tail;
    }
  }
  return { part1, part2 };
}

/**
 * Recompute the per-part summary + treasureBox from that part's decoded series
 * and that part's events. Returns { summary, treasureBox }.
 *
 * @param {Object} args
 * @param {Record<string, any[]>} args.series   - decoded series for THIS part (coins already re-zeroed)
 * @param {string[]} args.slugs                 - participant slugs
 * @param {Array} args.events                   - events belonging to THIS part
 * @param {number} args.intervalMs
 * @param {number} args.coinTimeUnitMs
 */
export function recomputeSummaryForPart({ series, slugs, events, intervalMs, coinTimeUnitMs }) {
  const intervalSeconds = intervalMs / 1000;
  const participants = {};
  const buckets = { blue: 0, green: 0, yellow: 0, orange: 0, red: 0 };
  let totalCoins = 0;

  for (const slug of slugs) {
    const hr = series[`${slug}:hr`] || [];
    const zones = series[`${slug}:zone`] || [];
    const coins = series[`${slug}:coins`] || [];
    const hrValid = hr.filter(v => v != null && v > 0);
    if (hrValid.length === 0) continue; // participant not active in this part

    const stats = computeParticipantStats({ hr, zones, coins, intervalSeconds, participant: {} });
    const zoneMinutes = {};
    for (const [z, secs] of Object.entries(stats.zoneSeconds)) {
      zoneMinutes[z] = Math.round((secs / 60) * 100) / 100;
    }
    participants[slug] = {
      coins: stats.totalCoins,
      hr_avg: stats.avgHr,
      hr_max: stats.peakHr,
      hr_min: Math.min(...hrValid),
      zone_minutes: zoneMinutes,
    };
    totalCoins += stats.totalCoins || 0;
    for (const [zone, coinDelta] of Object.entries(stats.zoneCoins)) {
      const color = zoneToColor(zone);
      if (color) buckets[color] += coinDelta;
    }
  }

  const challengeEvents = events.filter(e => e?.type === 'challenge');
  const succeeded = challengeEvents.filter(e => e?.data?.result === 'success').length;
  const failed = challengeEvents.filter(e => e?.data?.result === 'failed').length;

  const mediaEvents = events.filter(e => e?.type === 'media');

  return {
    summary: {
      participants,
      media: mediaEvents.map(e => ({
        contentId: e.data?.contentId,
        title: e.data?.title ?? null,
        mediaType: 'video',
        showTitle: e.data?.grandparentTitle ?? null,
        seasonTitle: e.data?.parentTitle ?? null,
        grandparentId: e.data?.grandparentId ?? null,
        parentId: e.data?.parentId ?? null,
        durationMs: (e.data?.start != null && e.data?.end != null) ? Math.max(0, e.data.end - e.data.start) : 0,
        ...(e.data?.description ? { description: e.data.description } : {}),
        ...(Array.isArray(e.data?.labels) && e.data.labels.length ? { labels: e.data.labels } : {}),
      })),
      coins: { total: totalCoins, buckets },
      challenges: { total: challengeEvents.length, succeeded, failed },
    },
    treasureBox: { coinTimeUnitMs, totalCoins, buckets },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test backend/src/2_domains/fitness/services/sessionSplit.test.mjs`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/fitness/services/sessionSplit.mjs backend/src/2_domains/fitness/services/sessionSplit.test.mjs
git commit -m "feat(fitness): pure sessionSplit domain module (split + re-zero + recompute)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B2: CLI driver with dry-run report + reconciliation invariants

**Files:**
- Create: `cli/fitness-split-session.mjs`

**Why:** One-shot orchestration: read YAML → decode → split → recompute → assemble two session objects → re-encode → (dry-run) print invariants OR (write) emit files. Hard invariants abort the write if anything fails to reconcile.

- [ ] **Step 1: Implement the driver**

Create `cli/fitness-split-session.mjs`:

```javascript
#!/usr/bin/env node
/**
 * One-shot: split a persisted v3 fitness session into two at a timestamp boundary.
 *
 * Usage (inside the container):
 *   node cli/fitness-split-session.mjs \
 *     --file data/household/history/fitness/2026-06-20/20260620191341.yml \
 *     --split-ts 1782009019590 \
 *     [--write]
 *
 * Without --write it is a DRY RUN: prints the split tick, the two new ids, and
 * all reconciliation invariants, and writes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import { decodeSeries, encodeSeries } from '../backend/src/2_domains/fitness/services/TimelineService.mjs';
import { splitDecodedSeries, computeSplitTick, recomputeSummaryForPart } from '../backend/src/2_domains/fitness/services/sessionSplit.mjs';

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return (v == null || v.startsWith('--')) ? true : v;
}

const FILE = arg('file');
const SPLIT_TS = Number(arg('split-ts'));
const WRITE = !!arg('write', false);
if (!FILE || !Number.isFinite(SPLIT_TS)) {
  console.error('Required: --file <path> --split-ts <epochMs>');
  process.exit(2);
}

const raw = fs.readFileSync(FILE, 'utf8');
const doc = yaml.load(raw);
const tz = doc.timezone || 'America/Los_Angeles';
const intervalMs = doc.treasureBox?.coinTimeUnitMs || 5000;

// TZ-aware start epoch (TimelineService.parseToUnixMs is NOT tz-aware — do not use it here).
const startAbsMs = moment.tz(doc.session.start, 'YYYY-MM-DD HH:mm:ss.SSS', tz).valueOf();
const endAbsMs = moment.tz(doc.session.end, 'YYYY-MM-DD HH:mm:ss.SSS', tz).valueOf();
const splitTick = computeSplitTick({ splitTs: SPLIT_TS, startAbsMs, intervalMs });

const slugs = Object.keys(doc.participants || {});
const decoded = decodeSeries(doc.timeline?.series || {});
const { part1: s1, part2: s2 } = splitDecodedSeries(decoded, splitTick);

const allEvents = Array.isArray(doc.timeline?.events) ? doc.timeline.events : [];
const ev1 = allEvents.filter(e => Number(e.timestamp) < SPLIT_TS);
const ev2 = allEvents.filter(e => Number(e.timestamp) >= SPLIT_TS);

const caps = doc.snapshots?.captures || [];
const cap1 = caps.filter(c => Number(c.timestamp) < SPLIT_TS);
const cap2 = caps.filter(c => Number(c.timestamp) >= SPLIT_TS);

const memos = doc.summary?.voiceMemos || [];
const memo1 = memos.filter(m => Number(m.timestamp) < SPLIT_TS);
const memo2 = memos.filter(m => Number(m.timestamp) >= SPLIT_TS);

const r1 = recomputeSummaryForPart({ series: s1, slugs, events: ev1, intervalMs, coinTimeUnitMs: intervalMs });
const r2 = recomputeSummaryForPart({ series: s2, slugs, events: ev2, intervalMs, coinTimeUnitMs: intervalMs });

const newDate = moment.tz(SPLIT_TS, tz).format('YYYY-MM-DD');
const part2Id = moment.tz(SPLIT_TS, tz).format('YYYYMMDDHHmmss');
const part1Id = doc.sessionId; // original id retained by part 1
const fmt = (ms) => moment.tz(ms, tz).format('YYYY-MM-DD HH:mm:ss.SSS');

// --- Reconciliation invariants ---
const tick1 = Math.max(0, ...Object.values(s1).map(a => a.length));
const tick2 = Math.max(0, ...Object.values(s2).map(a => a.length));
const checks = [];
const want = (label, cond) => checks.push({ label, ok: !!cond });

want(`tick_count reconciles: ${tick1} + ${tick2} == ${doc.timeline.tick_count}`, tick1 + tick2 === doc.timeline.tick_count);
want(`events reconcile: ${ev1.length} + ${ev2.length} == ${allEvents.length}`, ev1.length + ev2.length === allEvents.length);
want(`snapshots reconcile: ${cap1.length} + ${cap2.length} == ${caps.length}`, cap1.length + cap2.length === caps.length);
want(`coin total reconciles: ${r1.treasureBox.totalCoins} + ${r2.treasureBox.totalCoins} == ${doc.summary.coins.total}`,
  r1.treasureBox.totalCoins + r2.treasureBox.totalCoins === doc.summary.coins.total);
for (const color of ['blue', 'green', 'yellow', 'orange', 'red']) {
  const got = (r1.treasureBox.buckets[color] || 0) + (r2.treasureBox.buckets[color] || 0);
  const orig = doc.summary.coins.buckets?.[color] || 0;
  want(`bucket ${color} reconciles: ${got} == ${orig}`, got === orig);
}
// Per-user cumulative coins reconcile (part1 last + part2 last == original last)
for (const slug of slugs) {
  const o = decoded[`${slug}:coins`] || [];
  const a = s1[`${slug}:coins`] || [];
  const b = s2[`${slug}:coins`] || [];
  const last = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return 0; };
  if (o.length) want(`${slug}:coins reconciles: ${last(a)} + ${last(b)} == ${last(o)}`, last(a) + last(b) === last(o));
}

console.log('=== fitness-split-session DRY RUN ===');
console.log(`file:        ${FILE}`);
console.log(`timezone:    ${tz}   intervalMs: ${intervalMs}`);
console.log(`startAbsMs:  ${startAbsMs}  (${fmt(startAbsMs)})`);
console.log(`splitTs:     ${SPLIT_TS}  (${fmt(SPLIT_TS)})  -> splitTick ${splitTick}`);
console.log(`part1 id:    ${part1Id}   ticks 0..${splitTick - 1}  (${tick1})  events ${ev1.length}  caps ${cap1.length}  memos ${memo1.length}`);
console.log(`part2 id:    ${part2Id}   ticks ${splitTick}..  (${tick2})  events ${ev2.length}  caps ${cap2.length}  memos ${memo2.length}`);
console.log(`part2 date:  ${newDate}`);
console.log('--- invariants ---');
for (const c of checks) console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.label}`);
const allOk = checks.every(c => c.ok);
console.log(`--- ${allOk ? 'ALL INVARIANTS PASS' : 'INVARIANT FAILURE — refusing to write'} ---`);

// Build the two output documents.
function buildDoc({ id, date, startMs, endMs, series, events, summaryParts, treasureBox, captures, memos, keepStrava }) {
  const participants = {};
  for (const [slug, meta] of Object.entries(doc.participants)) {
    const copy = { ...meta };
    if (!keepStrava) delete copy.strava;
    participants[slug] = copy;
  }
  const summary = { ...summaryParts };
  if (memos.length) summary.voiceMemos = memos; // else omit
  return {
    version: 3,
    sessionId: id,
    session: {
      id,
      date,
      start: fmt(startMs),
      end: fmt(endMs),
      duration_seconds: Math.round((endMs - startMs) / 1000),
    },
    timezone: tz,
    participants,
    timeline: {
      series: encodeSeries(series),
      events,
      tick_count: Math.max(0, ...Object.values(series).map(a => a.length)),
    },
    treasureBox,
    summary,
    snapshots: { captures },
  };
}

if (WRITE) {
  if (!allOk) { console.error('Refusing to write: invariants failed.'); process.exit(1); }

  const dir = path.dirname(FILE);
  const backup = path.join(dir, `${part1Id}.PRE-SPLIT.bak.yml`);
  fs.writeFileSync(backup, raw, 'utf8');
  console.log(`backup written: ${backup}`);

  const doc1 = buildDoc({
    id: part1Id, date: doc.session.date, startMs: startAbsMs, endMs: SPLIT_TS,
    series: s1, events: ev1, summaryParts: r1.summary, treasureBox: r1.treasureBox,
    captures: cap1, memos: memo1, keepStrava: true, // the Strava Ride covers the cycling part
  });
  const doc2 = buildDoc({
    id: part2Id, date: newDate, startMs: SPLIT_TS, endMs: endAbsMs,
    series: s2, events: ev2, summaryParts: r2.summary, treasureBox: r2.treasureBox,
    captures: cap2, memos: memo2, keepStrava: false,
  });

  const file1 = FILE; // overwrite original (part 1 keeps the id)
  const file2 = path.join(path.dirname(path.dirname(FILE)), newDate, `${part2Id}.yml`);
  fs.mkdirSync(path.dirname(file2), { recursive: true });
  const dump = (d) => yaml.dump(d, { lineWidth: -1, noRefs: true });
  fs.writeFileSync(file1, dump(doc1), 'utf8');
  fs.writeFileSync(file2, dump(doc2), 'utf8');
  console.log(`WROTE part1: ${file1}`);
  console.log(`WROTE part2: ${file2}`);
} else {
  console.log('(dry run — pass --write to apply)');
}
```

- [ ] **Step 2: Commit (dry-run-only, not yet executed)**

```bash
git add cli/fitness-split-session.mjs
git commit -m "feat(fitness): one-shot CLI to split a recorded session (dry-run + invariants)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task B3: Run the dry-run against the real session and verify

**Files:** none (operational — reads only).

- [ ] **Step 1: Run the dry run inside the container**

Run:
```bash
sudo docker exec daylight-station sh -c 'cd /usr/src/app && node cli/fitness-split-session.mjs \
  --file data/household/history/fitness/2026-06-20/20260620191341.yml \
  --split-ts 1782009019590'
```

- [ ] **Step 2: Verify the output**

Expected:
- `splitTick` ≈ **233** (part1 ticks ≈ 233, part2 ≈ 377, sum **610**).
- `part2 id` ≈ `20260620193305`/`20260620193306`; `part2 date: 2026-06-20`.
- `part2 memos 1` (the "Yoshi Cup / Mario Cup" memo lands in part 2); `part1 memos 0`.
- `--- ALL INVARIANTS PASS ---` (tick_count, events, snapshots, coin total `3103`, every bucket, every per-user `:coins`).

If any invariant FAILs, STOP. Re-investigate (likely the zone→color map or a non-monotonic cumulative key) before proceeding. Per memory: skipping/forcing is not passing — a failed invariant means do not write.

---

## Task B4: Apply the split (write the two files)

**Files:**
- Overwrite: `data/household/history/fitness/2026-06-20/20260620191341.yml` (part 1, truncated)
- Create: `data/household/history/fitness/2026-06-20/<part2Id>.yml`
- Create backup: `data/household/history/fitness/2026-06-20/20260620191341.PRE-SPLIT.bak.yml`

**Note on screenshots:** Part 2's `snapshots.captures` keep their original `…/20260620191341/screenshots/…` paths (physical frames are NOT moved — non-destructive). The original frame folder stays in place as part 1's. After the recap re-render (B5), the source frames are no longer needed. The `index` field stays as-is. (Decision: leave Strava enrichment on part 1, the cycling Ride; part 2 has no Strava block.)

- [ ] **Step 1: Run with --write inside the container**

Run:
```bash
sudo docker exec daylight-station sh -c 'cd /usr/src/app && node cli/fitness-split-session.mjs \
  --file data/household/history/fitness/2026-06-20/20260620191341.yml \
  --split-ts 1782009019590 --write'
```
Expected: `ALL INVARIANTS PASS`, `backup written: …PRE-SPLIT.bak.yml`, `WROTE part1: …/20260620191341.yml`, `WROTE part2: …/<part2Id>.yml`.

- [ ] **Step 2: Fix ownership (docker exec writes as root)**

Run:
```bash
sudo docker exec daylight-station sh -c 'chown node:node data/household/history/fitness/2026-06-20/*.yml'
```
Expected: no output. (Per memory: files injected via `docker exec` are root-owned; the node app needs `node:node` to read/rewrite.)

- [ ] **Step 3: Verify both files parse and reconcile**

Run:
```bash
sudo docker exec daylight-station sh -c 'cd /usr/src/app && node -e "
const yaml=require(\"js-yaml\"), fs=require(\"fs\");
for (const f of process.argv.slice(1)) {
  const d=yaml.load(fs.readFileSync(f,\"utf8\"));
  console.log(f.split(\"/\").pop(), \"id=\"+d.sessionId, \"start=\"+d.session.start, \"dur=\"+d.session.duration_seconds, \"coins=\"+d.summary.coins.total, \"ticks=\"+d.timeline.tick_count);
}
" data/household/history/fitness/2026-06-20/20260620191341.yml data/household/history/fitness/2026-06-20/<part2Id>.yml'
```
(Substitute the real `<part2Id>` from B3.)
Expected: part 1 coins + part 2 coins == `3103`; part1 ticks + part2 ticks == `610`; part 1 `start` = `2026-06-20 19:13:41.386`, part 2 `start` ≈ `19:33:…`.

- [ ] **Step 4: Verify the sessions list endpoint shows two sessions**

Run:
```bash
curl -s "http://localhost:3111/api/v1/fitness/sessions?since=2d" | \
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((j.sessions||j).filter(x=>String(x.sessionId||x.id).startsWith("20260620")).map(x=>({id:x.sessionId||x.id,coins:x.coins,dur:x.durationSeconds||x.duration_seconds})))})'
```
Expected: two `20260620…` entries (the original `…191341` truncated + the new `…193305`-ish), not one.

---

## Task B5: Regenerate time-lapse recaps for both parts

**Files:** none (operational).

- [ ] **Step 1: Trigger recap render for part 1 (original id)**

Run:
```bash
curl -s -X POST http://localhost:3111/api/v1/fitness/sessions/20260620191341/timelapse | cat
```
Expected: `{"ok":true,"status":"processing",...}` (202).

- [ ] **Step 2: Trigger recap render for part 2 (new id)**

Run (substitute real `<part2Id>`):
```bash
curl -s -X POST http://localhost:3111/api/v1/fitness/sessions/<part2Id>/timelapse | cat
```
Expected: `{"ok":true,"status":"processing",...}`.

- [ ] **Step 3: Verify both recaps completed in logs**

Run:
```bash
sudo docker logs --since 5m daylight-station 2>&1 | grep -E 'fitness.timelapse.manual_(done|failed)'
```
Expected: a `manual_done` for each of the two session ids; no `manual_failed`. Per memory: verify from logs, do not assume.

- [ ] **Step 4: Final commit (mark the backfill executed)**

```bash
git add docs/superpowers/plans/2026-06-20-end-session-fix-and-session-split-backfill.md
git commit -m "docs(fitness): record session 20260620191341 split backfill execution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Clean up the backup once recaps look right**

After confirming both sessions render correctly in the fitness UI, remove the pre-split backup (it lives in the data volume; if `rm` is blocked, move to `_deleteme/`):
```bash
sudo docker exec daylight-station sh -c 'rm data/household/history/fitness/2026-06-20/20260620191341.PRE-SPLIT.bak.yml'
```

---

## Self-Review notes

- **Spec coverage:** "fix the code so end session never gets ignored" → Part A (A1 cooldown bypass, A2 live-end wiring, A3 deploy+verify). "backfill by splitting session 20260620191341 into its two parts (recalc all cumulative metrics too)" → Part B (B1 re-zero of every cumulative series `beats/coins/rotations/impacts` + `global:coins`; B2/B3 dry-run with hard coin/bucket/tick reconciliation; B4 write; B5 recaps).
- **Type/name consistency:** `endLiveSession` used in A2 helper, test, context, sidebar. `requestEndSession` defined in context, destructured in sidebar. `splitDecodedSeries`/`computeSplitTick`/`isCumulativeKey`/`zoneToColor`/`recomputeSummaryForPart` defined in B1, imported in B2. `--split-ts 1782009019590` consistent across B2/B3/B4.
- **Cumulative coverage:** re-zero applies to suffixes `beats, coins, rotations, impacts` — matches every cumulative key in the verified inventory; `global:coins` matches via the `coins` suffix.
- **Risk flags carried into the plan:** Strava stays on part 1 (decision noted in B4); screenshots not physically moved (noted in B4); invariant failure aborts the write (B2/B3).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-20-end-session-fix-and-session-split-backfill.md`. Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task with review between tasks; fast iteration.
2. **Inline Execution** — execute tasks in this session via executing-plans, with checkpoints for review.

Which approach?
</content>
</invoke>
