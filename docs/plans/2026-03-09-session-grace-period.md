# 30-Minute Session Grace Period Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the fitness session inactivity timeout from 3 minutes to 30 minutes so brief breaks (bathroom, water, equipment switch) don't split one workout into multiple sessions. Add a force-break command to explicitly end a session when a clean boundary is intended.

**Architecture:** The `remove` timeout in `FITNESS_TIMEOUTS` controls how long a session stays alive after the last device activity. Bumping this from 180000ms (3 min) to 1800000ms (30 min) keeps the session alive during breaks. During the idle gap, timeline ticks continue to fire and record `null` values for all series — this is already how the system works when a device is idle, so the gap is naturally represented as a flat/null region in the timeline. A new `force_break` WS action triggers `endSession('force_break')` to give users an explicit session boundary. The `removeThresholdTicks` in `ActivityMonitor` is already derived from the `remove` timeout, so it updates automatically.

**Tech Stack:** JavaScript (frontend), Vitest (tests), WebSocket (force-break command)

---

### Task 1: Bump the default `remove` timeout and add config support

**Context:** The `remove` timeout at `FitnessSession.js:29` is currently `180000` (3 min). The `FitnessContext.jsx:584-586` reads `ant_devices.timeout.inactive` and `ant_devices.timeout.remove` from the fitness config and calls `setFitnessTimeouts()`. The fitness config is passed as a prop (`fitnessConfiguration`) to `FitnessProvider` — it comes from the screen config YAML on the backend.

The `ActivityMonitor` derives its `removeThresholdTicks` from this same `remove` value at `FitnessSession.js:1330`:
```javascript
removeThresholdTicks: Math.ceil((this._getTimeouts().remove || 180000) / this.timebase.intervalMs)
```
So changing the default cascades to `ActivityMonitor` automatically.

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:27-31`

**Step 1: Change the default `remove` timeout**

In `frontend/src/hooks/fitness/FitnessSession.js`, change line 29:

```javascript
// Before:
const FITNESS_TIMEOUTS = {
  inactive: 60000,
  remove: 180000,
  rpmZero: 3000,
  emptySession: 60000
};

// After:
const FITNESS_TIMEOUTS = {
  inactive: 60000,
  remove: 1800000,     // 30 minutes — keeps session alive during breaks
  rpmZero: 3000,
  emptySession: 60000
};
```

**Step 2: Verify the `emptySession` timeout is unchanged**

The `emptySession` timeout (60s) is a separate guard that ends the session when the roster is completely empty (no devices at all). This is correct — if all HR monitors are physically off, we don't want to hold the session open for 30 minutes. The 30-min grace period applies only when devices are known but idle (no data flowing).

Verify in `_checkEmptyRosterTimeout()` at line 1910 that it uses `emptySession` (not `remove`). It does — no changes needed.

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js
git commit -m "feat(fitness): extend session inactivity timeout from 3 to 30 minutes

Brief breaks (water, bathroom, equipment switch) no longer split a single
workout into multiple sessions. The empty-roster timeout (60s) still ends
sessions promptly when all devices disconnect."
```

---

### Task 2: Add `force_break` WebSocket action to end session explicitly

**Context:** The fitness screen communicates via WebSocket. The `FitnessContext.jsx` handles WS messages. Currently there's no way to explicitly end a session — it only ends via inactivity or empty roster. We need a `force_break` action that calls `session.endSession('force_break')`.

We also need a way to trigger this. The fitness screen has a numpad input. We'll add a WS action handler so that any client (numpad, API, admin UI) can send `{ action: 'force_break' }` to the fitness topic to end the current session.

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

**Step 1: Find the WS message handler**

Read `frontend/src/context/FitnessContext.jsx` and find where WS messages for the fitness topic are handled. Look for `onMessage`, `handleMessage`, `subscribe`, or similar patterns that process incoming WS payloads.

**Step 2: Add `force_break` action handler**

In the WS message handler, add a case for `action: 'force_break'`:

```javascript
if (msg?.action === 'force_break') {
  if (session?.sessionId) {
    logger.info('fitness.session.force_break', { sessionId: session.sessionId });
    session.endSession('force_break');
  }
  return;
}
```

**Step 3: Test manually**

Send a WS message to the fitness topic:
```json
{ "action": "force_break" }
```

Verify the session ends immediately with reason `force_break`.

**Step 4: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "feat(fitness): add force_break WS action for explicit session end

Sending { action: 'force_break' } to the fitness WS topic immediately ends
the current session. Useful when a clean session boundary is needed despite
the 30-minute grace period."
```

---

### Task 3: Merge the three March 7 sessions into one corrected session

**Context:** The three sessions from 2026-03-07 at 19:20–19:56 should be one continuous session. They were split by the old 3-minute timeout.

| Session | Time | Duration |
|---------|------|----------|
| `20260307192045` | 19:20:45 – 19:29:35 | 530s |
| `20260307193405` | 19:34:05 – 19:40:05 | 360s |
| `20260307194019` | 19:40:19 – 19:56:54 | 995s |

The merged session should:
- Use the earliest sessionId: `20260307192045`
- Start at `19:20:45.648`, end at `19:56:54.494`
- Total duration: `2168s` (19:56:54 - 19:20:45 ≈ 36 min 9s)
- Combine all participant HR/zone/coin series with `null` fills in the gaps
- Merge all timeline events
- Union all participants from all three sessions

**Step 1: Read all three session files completely**

```bash
sudo docker exec daylight-station sh -c 'cat data/household/history/fitness/2026-03-07/20260307192045.yml'
sudo docker exec daylight-station sh -c 'cat data/household/history/fitness/2026-03-07/20260307193405.yml'
sudo docker exec daylight-station sh -c 'cat data/household/history/fitness/2026-03-07/20260307194019.yml'
```

**Step 2: Write a merge script**

Create a Node.js script (run in Docker) that:
1. Reads all three session YAMLs
2. Computes the merged time window (earliest start → latest end)
3. For each participant series, places values at the correct tick offsets and fills gaps with `null`
4. Merges events, adjusting `offsetMs`
5. Re-encodes all series as RLE
6. Unions participant lists, keeping the richest metadata per participant
7. Recalculates `treasureBox` totals by summing across all three
8. Writes the merged file as `20260307192045.yml`

**Step 3: Delete the two obsolete session files**

```bash
sudo docker exec daylight-station sh -c 'rm data/household/history/fitness/2026-03-07/20260307193405.yml'
sudo docker exec daylight-station sh -c 'rm data/household/history/fitness/2026-03-07/20260307194019.yml'
```

**Step 4: Verify the merged session via API**

```bash
curl -s https://daylightlocal.kckern.net/api/v1/fitness/sessions?since=2026-03-07&limit=5 | jq '.[] | select(.date == "2026-03-07")'
```

Confirm only two sessions on March 7: the Strava basketball (`20260307090118`) and the merged evening session (`20260307192045`).

---

### Task 4: Write tests for the grace period behavior

**Context:** The key behavioral change is that `maybeEnd()` now requires 30 minutes of inactivity instead of 3. We should test:
1. Session does NOT end after 3 minutes of inactivity (regression guard)
2. Session DOES end after 30 minutes of inactivity
3. `endSession('force_break')` ends the session immediately regardless of timeout
4. `ActivityMonitor.removeThresholdTicks` is correctly derived as 360 (30min / 5s)

**Files:**
- Create: `tests/isolated/hooks/fitness/session-grace-period.test.mjs`

**Step 1: Write the test file**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FitnessSession, getFitnessTimeouts } from '#hooks/fitness/FitnessSession.js';

describe('FitnessSession — 30-minute grace period', () => {
  let session;

  beforeEach(() => {
    session = new FitnessSession();
  });

  it('has a 30-minute default remove timeout', () => {
    const timeouts = getFitnessTimeouts();
    expect(timeouts.remove).toBe(1800000);
  });

  it('does NOT end session after 3 minutes of inactivity', () => {
    // Simulate session started 3 minutes ago
    session.sessionId = 'fs_test';
    session.startTime = Date.now() - 300000;
    session.lastActivityTime = Date.now() - 180000; // 3 min ago
    session.endTime = null;

    const ended = session.maybeEnd();
    expect(ended).toBe(false);
    expect(session.sessionId).toBe('fs_test');
  });

  it('DOES end session after 30 minutes of inactivity', () => {
    session.sessionId = 'fs_test';
    session.startTime = Date.now() - 2000000;
    session.lastActivityTime = Date.now() - 1800001; // just over 30 min
    session.endTime = null;

    const ended = session.maybeEnd();
    expect(ended).toBe(true);
  });

  it('force_break ends session immediately regardless of timeout', () => {
    session.sessionId = 'fs_test';
    session.startTime = Date.now() - 60000;
    session.lastActivityTime = Date.now() - 10000; // 10s ago — well within grace
    session.endTime = null;

    const ended = session.endSession('force_break');
    expect(ended).toBe(true);
    expect(session.sessionId).toBeNull(); // reset() was called
  });

  it('derives ActivityMonitor removeThresholdTicks as 360', () => {
    // 1800000ms / 5000ms = 360 ticks
    const remove = getFitnessTimeouts().remove;
    const ticks = Math.ceil(remove / 5000);
    expect(ticks).toBe(360);
  });
});
```

**Step 2: Run the tests**

```bash
npx vitest run tests/isolated/hooks/fitness/session-grace-period.test.mjs
```

**Step 3: Commit**

```bash
git add tests/isolated/hooks/fitness/session-grace-period.test.mjs
git commit -m "test(fitness): add grace period and force-break tests"
```
