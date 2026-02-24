# Governance Challenge Failure Audit

**Date**: 2026-02-23
**Scope**: Challenge failure lock enforcement, phase transition correctness, session `20260223185457`
**Reference**: `docs/reference/fitness/governance-engine.md`, `governance-system-architecture.md`, `governance-history.md`
**Log source**: `logs/prod-session-20260223185457-full.log`

---

## Summary

Audit of a live fitness session against the governance engine reference documentation reveals a **critical phase-transition bug** where failed challenges impose no meaningful penalty. A challenge requiring all 4 participants at "hot" zone failed (alan was at warm), but the video re-unlocked in 21ms because the base requirement (`active: all`) was still satisfied. The challenge failure penalty is effectively cosmetic — a single-frame flash that no one sees.

Additionally, the audit uncovered **6 secondary issues** including a race condition in the media start event, stale governance phase in render thrashing logs, and severe render thrashing sustained for 6+ minutes.

---

## Session Context

| Field | Value |
|-------|-------|
| Session ID | `20260223185457` |
| Date | 2026-02-23, 18:54–19:17 PST (22 min) |
| Media | Mario Kart 8 (mediaId `606442`, labels: kidsfun, resumable, sequential) |
| Policy | `default` — base requirement: `active: all` |
| Grace period | 30 seconds |
| Participants | felix, milo, alan, kckern (primary/superuser) |
| Exempted | soren (per governance config) |

---

## Critical Issue

### Challenge Failure Lock Immediately Overridden by Base Requirement Satisfaction

**Severity**: Critical
**Location**: `frontend/src/hooks/fitness/GovernanceEngine.js:1462`

#### What happened

Challenge 3 ("all hot", requiredCount: 4, 90s limit) failed because alan was at warm (HR 159, hot threshold 160). The video locked for 21ms and immediately re-unlocked:

```
Log evidence (lines 7378-7381):

03:03:16.472Z  governance.challenge.failed
               id: default_challenge_0_1771902106466
               zone: hot, requiredCount: 4, actualCount: 3
               missingUsers: ["alan"]

03:03:16.472Z  governance.phase_change
               from: "unlocked" → to: "locked"
               reason: challenge_failed
               firstRequirement: {zone: "active", satisfied: true}  ← base still met
               videoLocked: true

03:03:16.493Z  governance.phase_change
               from: "locked" → to: "unlocked"      ← 21ms later!
               firstRequirement: {zone: "active", satisfied: true}
               videoLocked: false
               evaluatePath: "snapshot"
```

Participant states at failure:

| Participant | Zone | HR | Hot threshold | Met? |
|-------------|------|----|---------------|------|
| felix | hot | 166 | 160 | Yes |
| milo | hot | 172 | 160 | Yes |
| kckern | hot | 144 | 140 | Yes |
| alan | **warm** | **159** | 160 | **No** |
| soren | active | 125 | — | Exempted |

#### Root cause

Two competing code paths determine the phase after a challenge failure:

**Path A — Challenge failure handler** (line 2085-2095):
```javascript
// GovernanceEngine.js:2085-2095
// When challenge timer expires — direct unconditional lock
challenge.status = 'failed';
this.challengeState.videoLocked = true;
this._setPhase('locked', evalContext);
this._schedulePulse(500);
return;
```

**Path B — Regular phase evaluation** (line 1462-1473):
```javascript
// GovernanceEngine.js:1462-1473
const challengeForcesRed = this.challengeState.activeChallenge
  && this.challengeState.activeChallenge.status === 'failed';

if (challengeForcesRed && !allSatisfied) {        // ← BUG: && !allSatisfied
  this._setPhase('locked', evalContext);
} else if (allSatisfied) {                         // ← overrides the lock
  this.meta.satisfiedOnce = true;
  this._setPhase('unlocked', evalContext);
}
```

Path A correctly locks on challenge failure. But 21ms later, a WebSocket HR update triggers `evaluate()`, which enters Path B. Because the base requirement (`active: all`) is still met, `allSatisfied` is `true`. The condition `challengeForcesRed && !allSatisfied` evaluates to `false`, and the `else if (allSatisfied)` branch fires, setting the phase to `unlocked`.

#### Why this is wrong

The reference documentation explicitly states the intended behavior:

**`governance-engine.md:112-114` (Phase Transition Logic)**:
```javascript
if (challengeForcesRed) {
  phase = 'locked';           // Failed challenge locks immediately
}
```

No `&& !allSatisfied` guard. Challenge failure is supposed to lock regardless of base requirement satisfaction.

The base requirement is the **floor** — the minimum bar to keep the video playing during normal operation. Challenges impose requirements **in excess** of the base. A failed challenge means participants did not meet the elevated requirement. Allowing base satisfaction to clear a challenge failure defeats the purpose of the challenge system entirely.

#### Recovery path exists but is unreachable

The engine already contains the correct recovery logic at lines 2120-2125:

```javascript
// GovernanceEngine.js:2120-2125
if (challenge.status === 'failed') {
  if (challenge.summary?.satisfied) {       // ← checks CHALLENGE requirement
    challenge.status = 'success';
    challenge.completedAt = now;
    this.challengeState.videoLocked = false;
    // ... logs governance.challenge.recovered
```

This path correctly checks whether the **challenge** requirement (e.g., all 4 at hot) is now met before clearing the lock. But it never executes because the phase evaluation at line 1468 already set the phase to `unlocked` based on base requirements alone.

#### Historical context

The `&& !allSatisfied` condition was introduced during Era 9 Day 1 (Feb 14) as commit `0cb7cb96`:

> **governance-history.md line 228**: "Challenge failure bypassing warning grace period (1-line fix: `if (challengeForcesRed && !allSatisfied)`)"

The original intent was to prevent challenge failure from bypassing the warning → locked grace period flow. But the fix was too broad — it now allows base-requirement satisfaction to override challenge failure entirely, making the challenge system consequence-free.

The architecture doc also codifies this incorrect behavior as current truth:

> **governance-system-architecture.md line 545**: `challengeFailed && !baseSatisfied -> locked`

Both the code and the architecture doc contradict the API reference doc (`governance-engine.md`), which describes the originally intended behavior.

#### Recommended fix

Line 1462 should be:
```javascript
if (challengeForcesRed) {
  // Failed challenge locks regardless of base requirements.
  // Recovery only happens via challenge satisfaction check
  // in _evaluateChallenges() (line 2121).
  this._setPhase('locked', evalContext);
}
```

After fixing, update `governance-system-architecture.md` line 545 from:
```
challengeFailed && !baseSatisfied -> locked
```
to:
```
challengeFailed -> locked (recovery requires challenge requirements met)
```

---

## Secondary Issues

### 1. `governed: false` Recorded in Session History

**Severity**: Medium
**Location**: Session YAML line 68 / Log lines 3517-3518

The session history records `governed: false` for the media despite the governance engine being active for the entire session. Root cause is a race condition at media start:

```
Log evidence (same timestamp, lines 3517-3518):

02:57:11.826Z  governance.phase_change
               from: null → to: "pending"
               mediaId: "606442"
               requirementCount: 1
               videoLocked: true

02:57:11.826Z  fitness.media_start.autoplay
               mediaId: "606442"
               isGoverned: false          ← stale pre-evaluation state
               governancePhase: "idle"    ← stale
```

The autoplay event captures governance state before `evaluate()` completes on the newly loaded media. Per **governance-system-architecture.md Sequence 2** (lines 148-153), `setMedia()` does not trigger `evaluate()`, creating a brief window where the governance state is stale. The autoplay event fires in this window.

**Impact**: Any downstream logic relying on the `governed` field in session history would incorrectly classify this session as ungoverned.

---

### 2. `timeSinceWarningMs: null` on Grace Period Lock

**Severity**: Low
**Location**: Log line 12884

When the grace period expired and the phase transitioned `warning → locked`, the `lock_triggered` event reports `timeSinceWarningMs: null`:

```
Log evidence (lines 12812, 12884):

03:13:38.533Z  governance.phase_change
               from: "unlocked" → to: "warning"
               deadline: 1771902848533         ← grace period started

03:14:08.533Z  governance.lock_triggered
               reason: "requirements_not_met"
               timeSinceWarningMs: null         ← should be ~30000
```

The warning started at 03:13:38 with a 30s grace period. The lock at 03:14:08 is 30 seconds later. This field should report the elapsed grace period duration for observability. Per **governance-history.md Era 10** (lines 281-307), diagnostic enrichment was a major focus, and this gap contradicts that intent.

---

### 3. Stale Governance Phase in Render Thrashing Logs

**Severity**: Medium
**Location**: Multiple log lines (e.g., 7375-7376)

Different components report different governance phases at the same time, and most report the wrong phase:

```
Log evidence (lines 7375-7376, same second):

03:03:14.828Z  fitness.render_thrashing
               component: "FitnessPlayerOverlay"
               governancePhase: "pending"        ← WRONG (actual: unlocked)

03:03:14.845Z  fitness.render_thrashing
               component: "FitnessPlayer"
               governancePhase: "unlocked"       ← CORRECT
```

FitnessChart consistently reports `governancePhase: "pending"` throughout the entire session, even while the engine has been `unlocked` for minutes. This matches **governance-engine.md Gotcha #5** (Overlay vs Phase Discrepancy, lines 273-291). Components hold stale phase state, likely from different subscriptions to governance state.

Per **governance-system-architecture.md SSoT Boundaries** (line 308): governance phase authority belongs to `GovernanceEngine.phase`. Components reading from any other source violate SSoT.

---

### 4. Video Stayed Paused After Challenge Failure Re-Unlock

**Severity**: High (user-facing)
**Location**: Log lines 7379-7382

After Challenge 3 failed and the phase cycled `unlocked → locked → unlocked` in 21ms, the video paused but never resumed:

```
Log evidence (lines 7379-7382):

03:03:16.472Z  governance.phase_change → locked     (challenge failed)
03:03:16.493Z  governance.phase_change → unlocked   (base req met)
03:03:16.494Z  playback.paused                       ← 1ms AFTER re-unlock
               currentTime: 8286.85
```

The pause was triggered in response to the momentary `locked` state but executed after the state had already returned to `unlocked`. No subsequent `playback.resumed` event appears. The video appears to have stayed paused for the remainder of the session.

This is directly related to the critical issue above — if challenge failure maintained the lock until challenge requirements were met, there would be no race between pause and re-unlock.

Per **governance-history.md Era 8** (lines 210-213): `videoLocked` was extended to cover `pending` and `locked` phases, and pause was added alongside mute on governance lock (`933b94c2`). But the unlock path may not trigger a corresponding resume when the lock duration is sub-frame.

---

### 5. Extreme Render Thrashing (176 renders/sec sustained 6+ minutes)

**Severity**: High (performance)
**Location**: Multiple log lines throughout session

FitnessChart reached **176 renders/sec** sustained for 364+ seconds. By session end, `forceUpdateCount` reached 1706. Video dropped frames at 8.4%:

```
Log evidence (line 6491):

02:58:46.368Z  fitness.render_thrashing
               component: "FitnessChart"
               rendersInWindow: 827
               renderRate: 165.4 renders/sec
               sustainedMs: 94127  (94 seconds)

Log evidence (line 13236, end of session):

03:17:10.338Z  fitness-profile
               forceUpdateCount: 1706
               renderCount: 1706
               videoDroppedFrames: 258
               videoDropRate: 8.4
```

Per **governance-history.md Era 4** (lines 109-133) and **governance-system-architecture.md Pattern 1** (lines 383-397), this is the known `batchedForceUpdate()` / version counter pattern. Each WebSocket HR update increments `version`, triggering full re-render cascades across all fitness components. The profiler logs also show `fitness-profile-excessive-renders` warnings throughout.

---

### 6. Challenge 2 Auto-Succeeded in 18ms

**Severity**: Low (UX)
**Location**: Log lines 6903-6904

Challenge 2 (warm, requiredCount: 2) was already satisfied when issued:

```
Log evidence (lines 6903-6904):

03:00:42.272Z  governance.challenge.started
               zone: "warm", requiredCount: 2
               selectionLabel: "some warm"

03:00:42.289Z  governance.challenge.completed     ← 17ms later
               participants: [
                 felix: hot, milo: hot,
                 alan: active, kckern: hot,
                 soren: active
               ]
```

Three participants were already at hot (above warm threshold). The challenge resolved before users could have seen the challenge UI. Per **governance-system-architecture.md Sequence 4** (lines 216-257), challenges check current state on each pulse. The selection algorithm could pre-check current zone state and skip challenges that are trivially satisfied.

---

## Phase Transition Timeline

Full phase history reconstructed from `governance.phase_change` log events:

| Time (UTC) | From | To | Trigger | Log Line | Correct? |
|---|---|---|---|---|---|
| 02:54:35 | pending | null | No media loaded | 1315 | Yes |
| 02:57:11 | null | pending | Media loaded, 3 participants below active | 3517 | Yes |
| 02:58:08 | pending | unlocked | All 4 at active, kckern reaches HR 100 | 4459 | Yes |
| 03:03:16 | unlocked | locked | Challenge 3 failed (alan at warm, not hot) | 7379 | Yes |
| 03:03:16 | locked | unlocked | Base req still met — **should stay locked** | 7381 | **No** |
| 03:13:38 | unlocked | warning | kckern drops to cool (HR 94), sole participant | 12812 | Yes |
| 03:14:08 | warning | locked | Grace period expired, kckern still cool (HR 91) | 12883 | Yes |
| 03:17:12 | locked | pending | No participants remaining | 13240 | Yes |

---

## Participant Dropout Timeline

All non-primary participants disconnected during the session, reconstructed from zone series null runs:

| Participant | Disconnect (approx) | Null ticks | Notes |
|---|---|---|---|
| soren | 19:08:37 | 104 ticks (520s) | Exempted; first to leave |
| milo | 19:11:52 | 65 ticks (325s) | |
| felix | 19:12:17 | 60 ticks (300s) | Voice memo: "Felix's maybe got broken again" |
| alan | 19:12:27 | 58 ticks (290s) | |
| kckern | 19:17:12 | 3 ticks (15s) | Last remaining; triggered warning → lock |

Chart logs show repeated `Status corrected: {name} (removed → idle)` warnings as participants dropped.

---

## Documentation Discrepancies

The critical bug is reflected as conflicting guidance across reference docs:

| Document | What it says | Correct? |
|---|---|---|
| `governance-engine.md:112-114` | `if (challengeForcesRed) { phase = 'locked' }` | **Yes** — intended behavior |
| `governance-system-architecture.md:545` | `challengeFailed && !baseSatisfied -> locked` | **No** — documents the bug |
| `governance-history.md:228` | Era 9 Day 1: "1-line fix: `if (challengeForcesRed && !allSatisfied)`" | Explains origin — fix was overbroad |
| `GovernanceEngine.js:1462` | `if (challengeForcesRed && !allSatisfied)` | **No** — implements the bug |

After the code fix, `governance-system-architecture.md` lines 545-546 must be updated to match `governance-engine.md`.

---

## Severity Summary

| # | Issue | Severity | Reference |
|---|---|---|---|
| Critical | Challenge failure lock overridden by base req | **Critical** | `governance-engine.md:112-114` vs `GovernanceEngine.js:1462` |
| 1 | `governed: false` in session history | Medium | `governance-system-architecture.md` Seq 2 |
| 2 | `timeSinceWarningMs: null` on grace lock | Low | `governance-history.md` Era 10 |
| 3 | Stale phase in render thrashing logs | Medium | `governance-engine.md` Gotcha #5 |
| 4 | Video stayed paused after re-unlock | High | `governance-history.md` Era 8 |
| 5 | Render thrashing 176/sec sustained | High | `governance-history.md` Era 4, `governance-system-architecture.md` Pattern 1 |
| 6 | Challenge auto-succeeded in 18ms | Low | `governance-system-architecture.md` Seq 4 |

---

## Session Persistence Data Review

**File**: `data/household/history/fitness/2026-02-23/20260223185457.yml`
**Write path**: `MetricsRecorder.js` → `PersistenceManager.js` → `POST /api/v1/fitness/save_session` → `YamlSessionDatastore.mjs`
**Read path**: `YamlSessionDatastore.mjs` → `SessionService.mjs` → `buildSessionSummary.js`

### Redundancy: `sessionId` duplicates `session.id`

```yaml
sessionId: '20260223185457'    # line 2
session:
  id: '20260223185457'         # line 4 — identical
```

Top-level `sessionId` and nested `session.id` are the same value. One should be removed.

---

### Redundancy: All-zero series persisted (7 series)

Six of seven `bike:*:rotations` series and one `bike:*:rpm` series contain only zeros and nulls — no actual data:

```yaml
bike:7153:rpm: '[[0,18],[null,250]]'                    # line 18
bike:7153:rotations: '[[0,18],[null,250]]'               # line 19
bike:28812:rotations: '[[0,212],[null,56]]'              # line 21
bike:28688:rotations: '[[null,19],[0,186],[null,63]]'    # line 27
bike:28676:rotations: '[[null,22],[0,192],[null,54]]'    # line 33
bike:40475:rotations: '[[null,30],[0,238]]'              # line 42
bike:29413:rotations: '[[null,40],[0,129],[null,99]]'    # line 47
```

Only `bike:49904:rotations` (line 40) and `bike:49904:rpm` (line 39) contain real data. The persist code in `PersistenceManager._runLengthEncode()` should skip series where every value is zero or null.

---

### Redundancy: Voice memo stored as two events

The same memo appears twice with overlapping data:

```yaml
# Event 1 (lines 123-133):
- timestamp: 1771902674866
  type: voice_memo_start
  data:
    memoId: memo_1771902674866_sy8p70my3
    elapsedSeconds: 977.392
    videoTimeSeconds: null
    durationSeconds: 25                          # camelCase
    author: null
    transcriptPreview: Everyone worked so hard...

# Event 2 (lines 134-139):
- timestamp: 1771902674833
  type: voice_memo
  data:
    memoId: memo_1771902674866_sy8p70my3
    duration_seconds: 25                          # snake_case
    transcript: Everyone worked so hard...
```

`transcriptPreview` and `transcript` are the same text. `durationSeconds` and `duration_seconds` are the same value with inconsistent casing. The `voice_memo_start` event has useful timing context (`offsetMs`, `tickIndex`, `elapsedSeconds`) that should be merged into a single consolidated event by `PersistenceManager._consolidateEvents()`.

---

### Structural: `participants` only lists the primary user

```yaml
participants:
  kckern:
    display_name: KC Kern
    hr_device: '40475'
    is_primary: true
    base_user: KC Kern
```

The series data contains 5 participants (felix, milo, alan, kckern, soren), but the `participants` block only lists kckern. This means the persisted session lacks display names, device mappings, and exemption/guest status for 4 of 5 participants. `PersistenceManager.js` builds participants from the session roster, but non-primary participants are being dropped during save.

---

### Structural: Incorrect media event metadata

```yaml
- type: media
  data:
    governed: false           # line 68 — wrong (session was governed)
    durationSeconds: 10       # line 69 — wrong (actual: 9735s)
    end: null                 # line 71 — never recorded
    grandparentTitle: Fitness  # line 59 — Plex folder, not content title
    parentTitle: Workout       # line 60 — Plex folder, not content title
```

Compared to playback log data (line 7382):
```json
{
  "grandparentTitle": "Game Cycling",
  "parentTitle": "Mario Kart",
  "duration": 9735.4609
}
```

Four fields are wrong or missing:

| Field | Stored | Actual | Cause |
|---|---|---|---|
| `governed` | `false` | `true` | Race condition: autoplay event fires before `evaluate()` (see Critical Issue above) |
| `durationSeconds` | `10` | `9735` | Captured at media start before Plex reports full duration |
| `end` | `null` | should be ~03:03:16 | Video paused by challenge failure race and never formally ended |
| `grandparentTitle` | `Fitness` | `Game Cycling` | Using Plex library folder name instead of resolved content hierarchy |

---

### Structural: Naming convention inconsistency

The events array mixes camelCase and snake_case within the same file:

| Field | Convention | Location |
|---|---|---|
| `durationSeconds` | camelCase | media event (line 69) |
| `duration_seconds` | snake_case | voice_memo event (line 138) |
| `contentType` | camelCase | media event (line 67) |
| `requiredCount` | camelCase | challenge event (line 79) |
| `display_name` | snake_case | participants block (line 12) |
| `is_primary` | snake_case | participants block (line 14) |
| `base_user` | snake_case | participants block (line 15) |
| `hr_device` | snake_case | participants block (line 13) |
| `metUsers` | camelCase | challenge event (line 83) |
| `missingUsers` | camelCase | challenge event (line 85) |
| `interval_seconds` | snake_case | timeline metadata (line 140) |
| `tick_count` | snake_case | timeline metadata (line 141) |

The participants block and timeline metadata use snake_case; events use camelCase. Should standardize on one.

---

### Recommended Fixes

**Persist-time filtering (no format change needed):**

1. Skip series that are entirely zero/null in `PersistenceManager` — check if all decoded values are `0`, `null`, or `undefined` before including in the payload
2. Consolidate `voice_memo_start` + `voice_memo` into a single event in `_consolidateEvents()`, merging timing context (`offsetMs`, `tickIndex`, `elapsedSeconds`) with content (`transcript`, `duration_seconds`)
3. Drop top-level `sessionId` key — `session.id` is sufficient

**Bug fixes:**

4. Fix `participants` to include all roster members, not just primary — check the filter logic in `PersistenceManager` that builds the participants block
5. Capture `governed` field **after** governance evaluation, not at media start
6. Capture `durationSeconds` from Plex-reported duration (available after first playback progress event), not at initial media load
7. Record media `end` timestamp when video stops playing or session ends
8. Resolve `grandparentTitle`/`parentTitle` from content metadata, not Plex library folder names

---

### Persistence Severity Summary

| # | Issue | Impact |
|---|---|---|
| P1 | All-zero series persisted | Bloat — 7 wasted series per session |
| P2 | Voice memo duplication | Bloat + naming inconsistency |
| P3 | `sessionId` duplication | Minor bloat |
| P4 | `participants` missing 4 of 5 users | **Data loss** — no device/name/role metadata for non-primary users |
| P5 | `governed: false` | **Incorrect data** — misclassifies governed sessions |
| P6 | `durationSeconds: 10` | **Incorrect data** — wrong video duration |
| P7 | `end: null` | **Missing data** — no video end timestamp |
| P8 | Wrong title hierarchy | **Incorrect data** — Plex folder names instead of content names |
| P9 | Mixed camelCase/snake_case | Inconsistency — complicates consumers |
