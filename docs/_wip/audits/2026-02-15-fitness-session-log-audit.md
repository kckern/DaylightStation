# Fitness Session Log Audit — 2026-02-15

**Date:** 2026-02-15 (session activity ~7:02–7:22 PM MST / 03:02–03:22 UTC)
**Source:** `docker logs daylight-station --since '2026-02-15T00:00:00'`
**Reference:** `docs/reference/fitness/fitness-system-architecture.md`

---

## Session Context

Backend restart at 19:02 MST triggered WebSocket reconnection across all clients. Two frontend clients were active simultaneously: **Firefox on garage TV** (Linux x86_64) and **Chrome on MacBook**. A single ANT+ HR monitor (device 28688) was broadcasting. The session was a casual workout — not a high-intensity multi-participant scenario.

---

## Finding 1: Tick Timer Runaway (Category 1 — REGRESSED)

**Expected behavior (arch doc, Sequence 2–3):** Tick timer fires every 5s. `_startTickTimer()` must be idempotent (`if (this._timer) return`).

**Observed:** Aggregated log entries show accelerating timer starts on the Firefox/TV client for session `fs_20260215190302`:

| Window (UTC) | Skipped Starts | Rate |
|---|---|---|
| 03:02:58 | 171 | ~3/sec |
| 03:04:02 | 247 | ~4/sec |
| 03:05:02 | 1,198 | **~20/sec** |

Individual (sampled) timer starts show intervals of ~250ms, not 5000ms. This is the identical failure mode documented in the Feb 16 postmortem — the idempotency guard is either bypassed or reset during session churn.

---

## Finding 2: Render Thrashing (Category 1 — STILL ACTIVE)

**Expected behavior (arch doc, Render Update Model):** `batchedForceUpdate()` coalesces multiple WebSocket messages per frame via `requestAnimationFrame`. Governance callbacks noted as "currently use direct forceUpdate() — potential render amplification issue."

**Observed:** All four major UI components thrashing simultaneously:

| Component | Peak Rate | Sustained Duration | Client |
|---|---|---|---|
| FitnessChart | **605.6/sec** | 20s | Chrome |
| FitnessPlayerOverlay | 338.4/sec | 19s | Firefox |
| FitnessPlayer | 291.2/sec | **87s** | Firefox |
| FitnessSidebar | 291.2/sec | 87s | Firefox |

All thrashing events report `governancePhase: "pending"`, confirming the governance → forceUpdate → render → timer restart feedback loop. The render thrashing detector (`fitness.render_thrashing`) fires warnings but does **not** circuit-break — it logs the problem while allowing it to continue indefinitely.

---

## Finding 3: Session Churn — 14 Sessions in 10 Minutes (Category 6 — NEW)

**Expected behavior (arch doc, Sequence 2):** 3 valid HR samples from distinct devices trigger `ensureStarted()`. Empty roster timeout (60s) triggers `endSession()`. One stable session per workout.

**Observed:** 14 distinct session IDs created between 03:02 and 03:12:

```
03:01:46  fs_20260215190146  → ended 60s (empty_roster)
03:02:58  fs_20260215190258  → ended 60s (empty_roster)
03:03:02  fs_20260215190302  → saved (ticks=0, series=6)
03:03:58  fs_20260215190358  → ended 60s (empty_roster)
03:04:59  fs_20260215190459  → ended 60s (empty_roster)
03:05:51  fs_20260215190551  → saved (ticks=0, series=19)
03:06:00  fs_20260215190600
03:07:00  fs_20260215190700
03:07:16  fs_20260215190716
03:08:00  fs_20260215190800
03:08:19  fs_20260215190819  → saved (ticks=0, series=28)
03:09:01  fs_20260215190901
03:09:51  fs_20260215190951
03:10:21  fs_20260215191021
03:12:50  fs_20260215191250  → ended 561s (empty_roster), saved (ticks=0, series=4)
```

**Root cause:** The pre-session buffer threshold log shows `firstIds: [28688, 28688, 28688]` — three samples from the **same** device, not from distinct devices. The arch doc says "3 valid HR samples from distinct devices" but the code counts total samples regardless of source.

The churn cycle: HR arrives → threshold met (same device x3) → session starts → device detected but user never appears on roster → 60s empty roster timeout → session ends → HR still arriving → threshold met again → repeat.

---

## Finding 5: Governance Phase Thrashing (Category 5 — STILL ACTIVE)

**Expected behavior (arch doc, Sequence 4 + Zone Hysteresis):** Zone hysteresis prevents jitter — 3s continuous in new zone before committing, 5s cooldown. Governance confirmation delay: "Requirements MET for 500ms → phase: 'unlocked'."

**Observed:** Between 03:08:22 and 03:09:20, governance oscillates on mediaId `606441`:

```
03:08:22.621  null     → pending
03:08:24.773  pending  → unlocked   (2.1s in pending)
03:08:29.900  unlocked → pending    (5.1s unlocked)
03:08:29.900  pending  → unlocked   (0ms! — same millisecond)
03:08:34.901  unlocked → pending    (5.0s unlocked)
03:08:34.902  pending  → unlocked   (1ms)
03:08:44.899  unlocked → pending
03:08:44.900  pending  → unlocked   (1ms)
03:08:49.899  unlocked → pending
03:08:49.900  pending  → unlocked   (1ms)
03:08:54.900  unlocked → pending
03:08:54.900  pending  → unlocked   (0ms)
03:08:59.904  unlocked → pending
03:08:59.905  pending  → unlocked   (1ms)
...continuing through 03:09:20
```

24 total `pending↔unlocked` transitions in 60s. The 500ms confirmation delay is clearly not being enforced — transitions happen within 0–1ms of entering pending. Each state change triggers `onStateChange` → `forceUpdate()`, which feeds Finding 2.

Additionally, on the Chrome client, governance cycles `null → pending → null` on every session restart (8 occurrences), matching the Jan 31 audit's "governance resets on each reload" pattern — but here triggered by session churn rather than page reloads.

---

## Finding 6: Phantom Session Saves (Category 4 — STILL ACTIVE)

**Expected behavior (arch doc, Sequence 5):** Validation requires duration >= 60s, has participants, has timeline data. Failed validation skips save.

**Observed:** Sessions with **zero ticks** pass validation and persist to disk:

```
SESSION_SAVE: 20260215190302, ticks=0, series=6   → SAVED ✅
SESSION_SAVE: 20260215190551, ticks=0, series=19  → save attempted
SESSION_SAVE: 20260215190819, ticks=0, series=28  → save attempted
SESSION_SAVE: 20260215191250, ticks=0, series=4   → SAVED ✅
```

Early autosave attempts correctly fail validation (`reason="session-too-short"`, durationMs=1), but subsequent autosaves for the same session pass despite ticks=0 — likely because enough wall-clock time has elapsed (>60s) even though no meaningful data was recorded.

This pollutes the session history directory with empty YAML files.

---

## Finding 7: Chart and Governance Noise (Category 1 + 5)

**Expected behavior:** Components should be quiescent when there's no active session data.

**Observed event counts for the day:**

| Event | Count | Impact |
|---|---|---|
| `fitness_chart.no_series_data` | 4,003 | Chart re-renders, finds zero data for all 5 users, every cycle |
| `governance.evaluate.no_media_or_rules` | 2,258 | Governance evaluates without media — pure waste |
| `governance.evaluate.no_participants` | 84 | Governance evaluates with no participants |

These 6,345 events are pure computation waste. Each `no_media_or_rules` evaluation still calls the full governance pipeline and triggers state updates. Each chart render with no data still calculates layout. Both feed the render thrashing loop.

---

## Finding 8: WebSocket Reconnection Cascade (Category 6)

Multiple `[WebSocketService] Error: {isTrusted: true}` events across all clients at 03:02:46–49 UTC, coinciding with the backend restart. The reconnection triggers:

```
WS reconnect → re-subscribe(['fitness', 'vibration'])
  → HR data arrives → buffer threshold met → session starts
    → governance evaluates (no media) → state change → forceUpdate
      → render → chart/sidebar/overlay all re-render
        → tick timer restarts → more renders → feedback loop
```

No exponential backoff or degraded-mode logic is in effect despite the arch doc recommending a "reload counter/backoff" and "crash flag in sessionStorage."

---

## Event Count Summary

```
                              Count   Impact
                              ─────   ──────
console.warn                  13,679  Noise floor
fitness_chart.no_series_data   4,003  Render waste
playback.overlay-summary       3,701  Normal telemetry
governance.evaluate.no_media   2,258  Wasted governance evals
fitness.tick_timer.started       254  Timer churn (1,600+ actual w/ aggregation)
fitness.tick_timer.stopped       166  Imbalance: 88 more starts than stops
fitness.session.started           23  14 distinct sessions
fitness.render_thrashing          44  Sustained thrashing events
governance.phase_change           75  24 real transitions + 51 null↔pending noise
```

---

## Severity Matrix

| # | Finding | Arch Doc Category | Status vs Prior Fixes |
|---|---------|------------------|----------------------|
| 1 | Tick timer runaway (1198 starts/min) | Cat 1 (CRITICAL) | **Regressed** from Feb 16 fix |
| 2 | Render thrashing (605/sec peak, 87s sustained) | Cat 1 (CRITICAL) | **Unchanged** — detector only, no breaker |
| 3 | Session churn (14 in 10 min) | Cat 6 (MEDIUM) | **New** — buffer threshold doesn't check distinct devices |
| 4 | Multi-client split-brain | Not documented | **New** — no client coordination mechanism |
| 5 | Governance phase thrashing (24 transitions/min) | Cat 5 (HIGH) | **Unchanged** — hysteresis not applied to governance |
| 6 | Phantom session saves (ticks=0) | Cat 4 (HIGH) | **Unchanged** — duration-only validation insufficient |
| 7 | Chart/governance noise (6.3K wasted evals) | Cat 1 + 5 | **New** — amplification source not previously identified |
| 8 | WebSocket cascade (no backoff) | Cat 6 (MEDIUM) | **Unchanged** — no degraded mode |

---

## Proposed Remediation Design

### R1: Tick Timer Circuit Breaker (Findings 1, 2)

**Problem:** `_startTickTimer()` is called from `updateSnapshot()` on every render. Even with an `if (this._timer) return` guard, the timer gets cleared and restarted during session transitions, and the guard doesn't survive the rapid start/stop cycle during churn.

**Design:** Replace the idempotency guard with a **monotonic generation counter** and a **rate limiter**.

```
SessionLifecycle:
  _timerGeneration: 0

  startTickTimer():
    gen = ++this._timerGeneration
    if this._timer:
      return                          // existing guard
    if Date.now() - this._lastTimerStart < 4000:
      return                          // rate limit: no restart within 4s of last start
    this._lastTimerStart = Date.now()
    this._timer = setInterval(() => {
      if this._timerGeneration !== gen:
        clearInterval(this._timer)    // stale timer from old generation
        return
      this._onTick()
    }, 5000)

  stopTickTimer():
    ++this._timerGeneration           // invalidate any in-flight timer
    clearInterval(this._timer)
    this._timer = null
```

Additionally, the render thrashing detector should become a **circuit breaker**: when `renderRate > 100/sec` sustained for `> 5s`, pause WebSocket message processing and tick timers for 2 seconds. Re-enable and check again.

### R2: Buffer Threshold — Require Distinct Devices (Finding 3)

**Problem:** `_maybeStartSessionFromBuffer()` starts a session after 3 HR samples regardless of source. A single device broadcasting at 1Hz triggers session start in 3 seconds.

**Design:** Track distinct device IDs in the buffer. Only trigger when `distinctDeviceCount >= 1` AND `totalSamples >= 3` (at least one device with sustained readings). Add a **debounce of 5 seconds** after session end before allowing a new session to start.

```
_maybeStartSessionFromBuffer():
  distinctDevices = new Set(buffer.map(s => s.deviceId))
  if distinctDevices.size < 1: return
  if buffer.length < 3: return
  if Date.now() - this._lastSessionEndTime < 5000: return   // debounce
  ensureStarted()
```

### R3: Multi-Client Session Coordination (Finding 4)

**Problem:** Multiple browser tabs/devices each run independent FitnessSession instances against the same WebSocket stream. They create conflicting sessions, duplicate saves, and double governance evaluations.

**Design:** Implement a **session leader election** via the WebSocket server.

1. When a client starts a fitness session, it sends `{ type: 'fitness_claim', clientId }` to the server.
2. The server grants leadership to the first claimer and broadcasts `{ type: 'fitness_leader', clientId }` to all subscribers.
3. Non-leader clients enter **observer mode**: they display data but do not run tick timers, autosave, or evaluate governance. They render from the leader's broadcast state.
4. If the leader disconnects, the server broadcasts `{ type: 'fitness_leader_lost' }` and the next client can claim.

**Simpler alternative (lower effort):** Use `BroadcastChannel` API for same-origin tabs. One tab claims a `fitness-leader` lock; others defer. This doesn't solve cross-device (TV vs laptop) but handles the duplicate-tab problem seen in today's Chrome logs.

### R4: Governance Hysteresis Enforcement (Finding 5)

**Problem:** GovernanceEngine evaluates on every pulse tick and flips `pending↔unlocked` within 0–1ms when HR hovers near the zone boundary. The zone hysteresis in ZoneProfileStore prevents the zone from flickering, but governance re-derives zone state independently and doesn't benefit from it.

**Design:** Add **governance-level transition hold** separate from zone hysteresis:

```
GovernanceEngine:
  _pendingToUnlockedHoldStart: null
  UNLOCK_HOLD_MS: 500                // already documented but not enforced
  RELOCK_GRACE_MS: 5000              // prevent immediate re-lock

  evaluate():
    requirementsMet = this._checkRequirements()

    if phase === 'pending' && requirementsMet:
      if !_pendingToUnlockedHoldStart:
        _pendingToUnlockedHoldStart = Date.now()
        return                        // don't transition yet
      if Date.now() - _pendingToUnlockedHoldStart < UNLOCK_HOLD_MS:
        return                        // still holding
      _pendingToUnlockedHoldStart = null
      transitionTo('unlocked')

    if phase === 'unlocked' && !requirementsMet:
      if Date.now() - _lastUnlockTime < RELOCK_GRACE_MS:
        return                        // grace period, don't re-lock
      transitionTo('warning')         // go to warning, not directly to pending

    if phase === 'pending' && !requirementsMet:
      _pendingToUnlockedHoldStart = null  // reset hold timer
```

Critically, the `onStateChange` callback MUST use `batchedForceUpdate()`, never direct `forceUpdate()`.

### R5: Session Save Validation — Require Meaningful Data (Finding 6)

**Problem:** Sessions with ticks=0 pass duration validation (wall-clock > 60s) despite having no timeline data.

**Design:** Add a **tick count minimum** to the validation:

```
PersistenceManager._validateSession():
  if durationMs < 60000: return { ok: false, reason: 'session-too-short' }
  if tickCount < 6: return { ok: false, reason: 'insufficient-ticks' }  // <30s of actual data
  if participantCount < 1: return { ok: false, reason: 'no-participants' }
  if totalSeriesPoints < 1: return { ok: false, reason: 'no-series-data' }
```

### R6: Guard Chart and Governance Evaluation (Finding 7)

**Problem:** `FitnessChart` renders 4,003 times finding zero series data. Governance evaluates 2,258 times with no media.

**Design:**

- **Chart:** Early-return in the render path if `totalSeriesPoints === 0`. Don't compute layout, don't log — just render a placeholder or nothing.
- **Governance:** Guard `evaluate()` with `if (!this._media && !this._rules) return` at the top, before any state derivation. Currently this logs but still processes.
- **Both:** These components should not re-render on version-counter changes when the session is inactive. Add a `sessionActive` check to the `useEffect([version])` gate.

### R7: WebSocket Reconnection Backoff (Finding 8)

**Problem:** After backend restart, all clients reconnect simultaneously, flooding the system with HR data that triggers the full cascade.

**Design:** Add a **crash/restart counter** in `sessionStorage`:

```
WebSocketService.onReconnect():
  key = 'fitness_reconnect_count'
  count = parseInt(sessionStorage.getItem(key) || '0')
  sessionStorage.setItem(key, count + 1)

  if count > 3:
    // Degraded mode: subscribe to WebSocket but delay fitness initialization by 10s
    setTimeout(() => this._initializeFitness(), 10000)
    return

  // Normal reconnect — reset counter after 60s of stability
  setTimeout(() => sessionStorage.setItem(key, '0'), 60000)
```

---

## Priority Order

| Priority | Remediation | Effort | Blast Radius |
|----------|-------------|--------|-------------|
| **P0** | R1: Timer circuit breaker | Small | Prevents the crash loop — everything else cascades from this |
| **P0** | R4: Governance hysteresis + batched forceUpdate | Medium | Eliminates the primary render amplification source |
| **P1** | R2: Distinct device buffer + session debounce | Small | Stops session churn |
| **P1** | R6: Guard chart/governance evaluation | Small | Reduces noise by ~6K events/session |
| **P1** | R5: Tick count validation | Trivial | Prevents garbage session files |
| **P2** | R3: Multi-client coordination | Large | Architectural — needed but can defer |
| **P2** | R7: Reconnection backoff | Medium | Defense-in-depth, not root cause |
