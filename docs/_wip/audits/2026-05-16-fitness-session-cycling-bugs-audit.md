# Fitness Session Audit — 2026-05-16 Cycling Session

**Session under test:** `fs_20260516191925`
**Date/time:** 2026-05-16 19:19:25 – 20:22:36 PDT (63 min)
**Participants:** User_3, User_1, User_4, User_2
**Primary content (intended):** Wave Race 64 (Game Cycling, 50 min)
**Primary content (recorded):** Kiedler Forest, England (Induro, 16.7 min)

**Evidence sources:**
- History YAML: `data/household/history/fitness/2026-05-16/20260516191925.yml`
- Structured log: `/usr/src/app/media/logs/fitness/2026-05-16T23-49-29.jsonl` (25,263 lines, 10.7 MB)
- Sister session: `data/household/history/fitness/2026-05-16/20260516171431.yml` (17:14–17:53 PDT)

**Audit scope:** six items the user surfaced (RPM freeze; wrong primary media; cycling challenge anomalies; X-out reload; exit destination; voice-memo sync), plus a general scan of log warnings/errors.

---

## Summary table

| # | Issue | Severity | Root cause confirmed? | Where to fix |
|---|---|---|---|---|
| 1 | Wrong primary media (Induro picked over Wave Race) | **High** — corrupts session record | Yes (two compounding bugs) | `FitnessSession._pendingEvents` flush + `selectPrimaryMedia` tier-1 rule |
| 2 | Live RPM freezes when pedaling stops | **High** — UX deception | Likely | `FullscreenVitalsOverlay`/`FitnessUsers` read `device.cadence` raw; `DeviceManager.pruneStaleDevices` skips reset when value already ≤0 |
| 3 | Cycling challenge anomalies (zone downgrades, infeasible skips, base-req pauses) | **Medium** — gameplay tuning | Partial — symptoms observable, design intent unclear | `governance.challenge.*` pipeline + zone-feasibility check |
| 4 | X-out sometimes "refreshes" instead of redirecting | **Medium** — intermittent | No direct evidence in any recent log | Add telemetry; review possible races in `executeClose` |
| 5 | Exit destination should be home screen with pre-selected session | **Medium** — design change | N/A — feature gap | `resolvePostEpisodeRedirect` + `home` screen `fitness:sessions` widget |
| 6 | Voice memo saved post-redirect not visible | **Medium** — async data | Yes — `fitness:sessions` widget polls every 300s | Same widget needs invalidation on `voice_memo_added` |
| 7 | **2,198 `fitness.persistence.validation_failed`** warnings | **High** — log spam, hides real failures | Yes | Persistence layer retries every tick before session matures |
| 8 | `fitness.render_thrashing` on `FitnessChart` (186 events, 13-14 renders/sec sustained) | **High** — perf regression | Yes — see prior chart-thrash audit | FitnessChart memoization |
| 9 | `fitness.circuit_breaker.tripped` (1×) and `video_fps_degraded` (10.8 fps) | Medium | Yes | Update rate-limiting + GPU pressure |
| 10 | `fitness.music.stuck_loading` (5×) | Low | Symptom only | Music init/retry logic |

---

## Issue 1 — Wrong primary media: Induro picked instead of Wave Race

### Symptom
Session 2 ran from 19:19 to 20:22 PDT. The actual workout was **Wave Race 64** (50 minutes of pedaling). The voice memo even says *"We finished Wave Race, which was the final course."* But the saved summary says:

```yaml
media:
  - contentId: plex:600770
    title: Kiedler Forest, England
    showTitle: Induro
    durationMs: 1000517      # 16.7 min
    primary: true            # ← wrong
  - contentId: plex:674283
    title: Wave Race 64
    showTitle: Game Cycling
    durationMs: 3008547      # 50.1 min  ← actual workout
    labels: [kidsfun, resumable, sequential]
  - contentId: plex:674284
    title: Diddy Kong Racing
    durationMs: 236101       # 3.94 min
    labels: [kidsfun, resumable, sequential]
```

### Root cause — two compounding bugs

**Bug A — `_pendingEvents` buffer flushes pre-session events without an age cutoff**

`frontend/src/hooks/fitness/FitnessSession.js`:

- Line 2932-2943 — when `this.timeline` doesn't exist, `logEvent()` pushes the entry into `this._pendingEvents` unconditionally with its original timestamp.
- Line 1658-1667 — when the timeline finally exists, the flush loop drains every queued event into `this.timeline.logEvent(...)` **with no `event.timestamp >= session.start` guard**.

Log evidence (UTC):
- `00:14:31.158Z` — session 1 starts (`fs_20260516171431`).
- `00:56:01.153Z` — Induro `media_start` logged (during session 1).
- `01:12:41.670Z` — Induro `media_end` logged. Session 1 ends ~22 min later at `00:53:51 PDT` ≈ `00:53:51` UTC... actually session 1 ended at **00:53:51.696Z**, **before** Induro even started. So Induro's start/end were buffered because no timeline was active.
- `02:19:25.572Z` — session 2 starts (`fs_20260516191925`), immediately followed by `fitness.session.flush_pending_events count: 2`. Those two events are Induro's start + end.

Net effect: any media that plays in the gap between sessions is attributed to the next session, regardless of how stale.

**Bug B — `selectPrimaryMedia` Tier-1 filter rejects KidsFun-labeled content**

`frontend/src/hooks/fitness/selectPrimaryMedia.js` line 113:

```js
const realCandidates = videos.filter(v => !isWarmup(v) && !isDeprioritized(v));
```

`data/household/config/fitness.yml`:

```yaml
deprioritized_labels:
  - KidsFun
```

Wave Race and Diddy Kong both carry the `kidsfun` label, so they're excluded from Tier 1. Only Induro survives. It is ≥ 5 min, so Tier 1 picks it. Tier 2-4 never run.

The Tier 4 docstring acknowledges the failure mode (*"E.g. Game Cycling sessions where every video is kidsfun; returns F-Zero rather than nothing."*), but the Tier 1 design assumes a non-KidsFun item is always the "real" workout. That assumption breaks the moment **any** non-KidsFun item appears alongside KidsFun content.

In this session both bugs fired together. Either alone would have produced the wrong result:
- If Bug A is fixed (no pre-session Induro), Tier 1 finds no eligible candidate, falls to Tier 4, picks Wave Race ✓
- If Bug B is fixed (KidsFun no longer demoted from Tier 1), Tier 1 has two ≥10-min survivors (Induro 16.7 min, Wave Race 50 min); the rule at line 117 picks `longSurvivors[longSurvivors.length - 1]` which is Wave Race (chronologically later) ✓

### Direction (no code yet)
1. **Cap pending-events age at flush time.** Drop or down-grade events with `event.timestamp < session.start - graceMs`, where grace is e.g. 60s. Log the count of dropped events for observability.
2. **Reconsider the KidsFun "deprioritized" semantics.** Three options to brainstorm: (a) demote only when *all candidates* are KidsFun-free, (b) require a minimum duration ratio (Induro 16.7 min vs Wave Race 50 min → 33% — too low to outrank), (c) drop the deprio flag and govern via a separate "is real workout" signal (duration + governance involvement).
3. Add a "winners log" — emit `fitness.session.primary_selected` with `{contentId, reason, tier, candidates: [...]}` so future audits can spot regressions without forensic log archaeology.

---

## Issue 2 — Live RPM freezes when pedaling stops

### Symptom
While bike sensor is connected and recording, the live RPM number on screen stays frozen on the last value when the rider stops pedaling. HR correctly *holds* (HR doesn't decay to 0 just because the sensor stops sending, because zero-HR is meaningless and usually indicates transmission loss); but cadence/RPM **should** drop to 0, because a stopped pedal genuinely produces 0 RPM.

### Recorded data confirms zero IS being captured
From the YAML series for the bike:
```
bike:7153:rpm: '[85,[0,5],[null,36],0,148,…,[110,20],[0,6],[null,357],[0,19],…'
```
RLE-decoded: 85, then five zeros, then 36 nulls (no signal), then 0, then values, then 110×20, then 0×6, then null×357 ("device away"). So the **series-recording path** writes zeros correctly. The bug is in the **live-display path**.

### Code layout
`frontend/src/hooks/fitness/FitnessSession.js` line 1103 — `getEquipmentCadence(equipmentId)`:
- Returns `{rpm: device.cadence, connected: true, ts: device.lastSeen}` when fresh.
- Returns `{rpm: 0, connected: false}` when `Date.now() - lastActivity > FITNESS_TIMEOUTS.rpmZero` (3000 ms).
- This has staleness handling and the series-builder consumes this. ✓

`frontend/src/hooks/fitness/CadenceFilter.js` — EMA decay: `STALE_THRESHOLD_MS=1500`, `LOST_SIGNAL_MS=4000`. Filters values *for series*. ✓

The display widgets, however:

- `frontend/src/modules/Fitness/player/overlays/FullscreenVitalsOverlay.jsx` line 184:
  ```js
  const rpm = Math.max(0, Math.round(device.cadence || 0));
  ```
  Reads `device.cadence` **raw** — no staleness check.

- `frontend/src/modules/Fitness/player/panels/FitnessUsers.jsx` line 815-842 — maps over `rpmDevices` from `FitnessContext.allDevicesRaw`, passing `rpm={rpmValue}` straight from `rpmDevice.cadence`.

- `frontend/src/modules/Fitness/player/panels/RealtimeCards/RpmDeviceCard.jsx` — does check `isStale` and clears the display when stale, but threshold may be too long.

### The DeviceManager zero-out gap
`frontend/src/hooks/fitness/DeviceManager.js` line 258-265 in `pruneStaleDevices()`:

```js
const timeSinceSignificant = now - (device.lastSignificantActivity || device.lastSeen);
if (isCadence && timeSinceSignificant > timeouts.rpmZero) {  // 3000ms
  if (device.cadence > 0 || device.power > 0 || device.speed > 0) {
    device.resetMetrics();
  }
}
```

Two relevant scenarios when pedaling stops:

1. **Sensor stops emitting** (most ANT+ cadence sensors). `lastSeen` freezes. `timeSinceSignificant` grows past 3000 ms. `device.cadence > 0` (still 110 from last reading) → `resetMetrics()` zeros it ✓.
2. **Sensor emits `cadence: 0`** packets. `device.cadence` becomes 0 *via the update path*. `lastSeen` keeps advancing. `lastSignificantActivity` does **not** (it only advances when cadence > 0). `timeSinceSignificant` grows past 3000 ms, but the guard `device.cadence > 0` is FALSE → no `resetMetrics()`. Value is already 0 so this is fine.

So `DeviceManager` is consistent in eventually producing 0. The freezing is consistent with widget code reading raw `device.cadence` between the last non-zero emit and the next `pruneStaleDevices` tick (which runs every 3000 ms — so display can freeze for up to ~3 s after the last cadence packet, then jump to 0).

### Hypothesis
The user's "freeze" is the 0–3 second window where: (a) sensor stopped emitting, (b) `pruneStaleDevices` hasn't run yet, (c) the display widget reads `device.cadence` raw. For a fast-twitch UX expectation (rider stops mid-pedal, glances at screen), that ~3 s lag *feels* frozen.

### Direction
1. Route every live-RPM widget through `getEquipmentCadence()` or a hook that calls it, instead of reading `device.cadence` raw. That gives staleness handling at read time, not pruning time.
2. Consider tightening `FITNESS_TIMEOUTS.rpmZero` from 3000 ms to something like 1500-2000 ms for cycling specifically, since cadence is supposed to be continuous.
3. Or: in `DeviceManager` device.update, when cadence value transitions to 0, immediately update `lastSignificantActivity = now - rpmZero - 1` so the next prune zeros instantly.
4. Make the freeze observable: log a warn when a widget renders the same RPM value for >2 s while sensor is connected.

---

## Issue 3 — Cycling challenge anomalies

### Symptom
Challenges "worked better this time" but with rough edges. The user wants the logs audited.

### Log counts (session 2)
```
governance.challenge.started:        25
governance.challenge.completed:      22
governance.challenge.failed:          3
governance.challenge.recovered:       3
governance.challenge.zone_downgraded: 6
governance.challenge.skipped_infeasible: 1
governance.lock_triggered:            6
governance.cycle.state_transition:   22
governance.cycle.phase_advanced:      6
governance.cycle.started:             3
governance.cycle.recovered:           3
governance.cycle.paused_by_base_req:  3
governance.cycle.locked:              3
governance.cycle.resumed_after_base_req: 2
governance.cycle.completed:           2
governance.cycle.danger_started:      1
```
Summary YAML records `challenges: total: 28, succeeded: 25, failed: 3`. The discrepancy with log counts (25 started, 22 completed) suggests the YAML summary counts events differently than the live machine — worth reconciling.

### Notable observations
- **Six `zone_downgraded` to warm**, each citing *"hot not achievable, downgraded to warm."* Suggests the zone-feasibility predicate is consistently too aggressive — the system tried to issue a hot-zone challenge six times when participants weren't even close. Of those, only one became `skipped_infeasible` ("Only 0/3 within 20 BPM of hot"). The other five became warm-zone challenges. Question: was the user surprised when an apparently-cool group got a "warm" challenge that they then had to satisfy?
- **Three challenges failed and triggered locks**:
  - `02:43:43` — hot/required=1, actual=0, missingUsers=[user_3, user_1, user_4, user_2] (User_2 was already in `warm`; the other three were `active`).
  - `02:48:41` — warm/required=4, actual=2, missingUsers=[user_1, user_4].
  - `03:12:53` — warm/required=3, actual=1, missingUsers=[user_3, user_1].
- **Two `requirements_not_met` locks** at the very end (`03:16:08`, `03:19:28`) — `challengeActive: false`. These are cycle-end lockouts after the warning window elapsed without enough participants in the required zone. User_1 and User_3 had dropped to `cool` (likely winding down — Wave Race ended around then).
- **Three `cycle.paused_by_base_req`** events — base-requirements pause is firing. Need confirmation this matches user expectation (pause should be invisible; if it surfaces as a UI freeze, that's a separate UX issue).
- **One `challenge.skipped_infeasible`** at `03:11:07` — `"Only 0/3 within 20 BPM of hot"`. Good — the skip rule is firing when it should. Question: why only once, when zone_downgraded fired six times?

### Direction
1. Tighten the **zone-feasibility predicate** so hot-zone challenges aren't proposed when no participant is within striking distance, eliminating the constant downgrade-to-warm pattern. The threshold logic in the `skipped_infeasible` path (20 BPM of hot) is presumably the right reference — make it the primary gate, with downgrade as a secondary fallback only.
2. Audit `cycle.paused_by_base_req` — verify the UI shows nothing user-visible during these pauses.
3. Add a dedicated post-mortem dashboard for `governance.cycle.*` and `governance.challenge.*` events (succeed/fail by zone, downgrade rate, infeasible rate per session).
4. Confirm the YAML summary counter rule — does `succeeded: 25` count `completed` only, or `completed + recovered`? The math suggests the latter (22 + 3 = 25). Document the rule.

---

## Issue 4 — X-out sometimes "refreshes" instead of redirecting

### Symptom
User says the X button on the player occasionally triggers a page refresh rather than the expected redirect.

### Code path (no reload by design)
`frontend/src/modules/Fitness/player/FitnessPlayer.jsx`:
- `handleClose()` (line 929) — voice-memo guards, then calls `executeClose()` (line 903).
- `executeClose()` calls `onSessionEndRedirect(redirect)` and `setQueue([])` and `setCurrentItem(null)`.
- `onSessionEndRedirect` in `FitnessApp.jsx` (line 1349) updates state and calls `navigate('/fitness/users', {replace: true})` — React Router, **not** a hard reload.

The only `window.location.reload()` calls in the app are:
1. `FitnessApp.jsx` line 1195, 1205, 1215 — "Reload App" button on the **loading** screen.
2. `FitnessApp.jsx` line 1253 — "Retry" button on the **fetch error** screen.
3. `FitnessSidebarMenu.jsx` line 143 — `handleReloadPage()` — the manual reload control in the sidebar menu.

### Evidence — no unload in any recent log
```
=== 2026-05-12T23-34-48.jsonl === 0
=== 2026-05-13T09-58-48.jsonl === 0
=== 2026-05-15T00-14-16.jsonl === 0
=== 2026-05-16T03-45-59.jsonl === 0
=== 2026-05-16T05-20-30.jsonl === 0
=== 2026-05-16T23-49-00.jsonl === 0
=== 2026-05-16T23-49-29.jsonl === 0
```

Zero `page_unload_triggered` events across all recent session logs. The `beforeunload` handler is registered in `FitnessApp.jsx` line 89-102, so absence means either (a) no actual unload, or (b) the log entry didn't survive the unload (likely — the WS transport is async).

### Hypotheses for the user's perception
1. **View transition feels like a reload.** When `setQueue([])` runs, the player overlay (full-screen black div) unmounts, then `FitnessSessionApp` mounts. There's a moment of blank/black between mounts. On a slow TV, this looks like a page refresh.
2. **Accidental tap on the sidebar Reload Page button.** If the sidebar is visible during the close gesture, a stray touch in the wrong spot could fire `handleReloadPage`.
3. **Auto-reload path during an error.** If the close coincides with a fetch error (the loading screen has its own auto-reload button), the user might think they pressed X but actually saw the error screen briefly and clicked Retry.
4. **`executeClose` race with the voice-memo onComplete callback.** The useEffect at line 972 watches `voiceMemoOverlayState?.open` for true→false transitions and runs `executeClose()` when `pendingCloseRef.current` is set. The voice-memo capture path *also* passes `onComplete: executeClose` to `openVoiceMemoCapture` (line 961). So `executeClose` can run twice in some flows. Each run calls `setQueue([])`, `setCurrentItem(null)`, and `onSessionEndRedirect`. Two redirects in quick succession might cause the router to thrash.

### Direction
1. **Add telemetry to distinguish.** Emit `fitness.player.close.initiated` and `fitness.player.close.completed` from `handleClose`/`executeClose`. Then a reload, if it happens, can be correlated with the missing "completed" event.
2. **Deduplicate `executeClose`.** Guard with `pendingCloseRef.current = false` at the top of `executeClose`, and check it in the useEffect transition handler.
3. **Make the X-out transition visually obvious as a controlled motion** (e.g. crossfade) so it doesn't read as "refresh".

---

## Issue 5 — Exit destination: home with pre-selected session

### Current behavior
`resolvePostEpisodeRedirect` returns `{view: 'users', ...}`. `FitnessApp.jsx` line 1297 mounts `<FitnessModuleContainer moduleId="fitness_session" mode="standalone" />`, which is the live "fitness session" chart app the user calls "the chart."

### What the user wants
Exit → home screen (`/fitness/home`) with the just-ended session pre-selected in the `fitness:sessions` widget (the session-history sidebar). Both the home screen and the current "users" view show a chart, but the home screen also surfaces session history, coach, suggestions, etc., which is a better landing after a workout.

### Home screen layout (already supports session list)
`data/household/config/fitness.yml` → `screens.home`:
- `data.sessions`: `/api/v1/fitness/sessions?since=95d&limit=500` (refresh 300 s)
- Left area: `fitness:sessions` widget (80%), `fitness:calendar` widget (20%).
- Right area: `fitness:suggestions`, `fitness:longitudinal`, `fitness:coach`.

So the data is already there. We need: (a) re-route the redirect, (b) pass the sessionId, (c) widget acts on it.

### Direction
1. Change `resolvePostEpisodeRedirect` to return `{view: 'screen', screenId: 'home', sessionId: <id>, ...}`. Update the `FitnessApp.jsx` redirect handler to navigate to `/fitness/home?sessionId=<id>`.
2. Update `fitness:sessions` widget to read `sessionId` from URL (via context provided by ScreenProvider or the panel renderer) and:
   - Highlight that row in the session list, and
   - Auto-open the session-detail/chart pane for it.
3. Ensure the home screen has a session-detail pane (a chart that loads on selection). If today's home doesn't have one, the design should add one to the right-area before this change ships.
4. Keep `'users'` (FitnessSessionApp) reachable from the home screen for users who want the full-screen chart.

---

## Issue 6 — Voice memo not visible if synced asynchronously

### Symptom
Voice memo upload completes a few seconds after redirect; the home screen's session list doesn't show it until the next 5-minute poll.

### Current flow
- `playback.voice-memo` event `voice_memo_added` fires immediately in client (`memo_1778987693315_3kcrudnn1` at `2026-05-17T03:14:53.315Z`).
- The memo is appended to the in-progress session timeline.
- On session end, the YAML is written including `voiceMemos` (we see it in the saved file).
- The home screen widget `fitness:sessions` reads `/api/v1/fitness/sessions?since=95d&limit=500` with `refresh: 300` (5 min).
- If the page navigates to home *before* the YAML write+API cache invalidation completes, the displayed list may have the new session **without** the memo, or might miss it entirely (depending on ordering).

### Direction
1. **Invalidate-and-refetch on `voice_memo_added`.** When the home screen mounts after a redirect (or while the user is on home), subscribe to the `voice_memo_added` event and force a fresh fetch of `/api/v1/fitness/sessions?…` for the current session id (or just bust the cache).
2. **Optimistic update.** Pass the freshly-added memo's metadata (transcript, duration, timestamp) through the redirect payload so the widget can render it immediately, while the server-side write reconciles in the background.
3. **Backend awareness.** The session-end endpoint should *wait* for the memo write to land before returning, OR the GET endpoint should be coherent with in-flight writes. Pick one — current behavior is "first reader wins" which is unsafe.

---

## Issue 7 — `fitness.persistence.validation_failed` × 2,198 (log spam)

### Evidence
```
2198 fitness.persistence.validation_failed
```
Sample: `{reason: "session-too-short", rosterLength: 1, hasPriorSave: false}`. Every event is `level: warn`.

### Why this matters
A 2,198-event warn flood drowns out real warnings, blows up log file size (this single category contributes ~30% of the 10.7 MB log), and burns WebSocket bandwidth. Every ~1.7 s of a 63-minute session emits this warning. The persistence layer is clearly retrying-and-failing on every tick before the session is mature enough to save. Either the retry cadence is too aggressive, or the "session-too-short" rejection should be silent.

### Direction
- Demote `session-too-short` to `debug` and emit a one-shot `info` when persistence becomes possible.
- Cap the persistence retry at a backoff (e.g. 30 s while rejected) — the persistence service does not need a 1 Hz heartbeat.

---

## Issue 8 — `FitnessChart` render thrashing (186 events)

### Evidence
```
2026-05-17T00:14:38.727Z  rendersInWindow:67  renderRate:13.4  sustainedMs:2131
2026-05-17T00:15:08.759Z  rendersInWindow:67  renderRate:13.4  sustainedMs:32163
... (continues for hundreds of intervals, sustainedMs growing)
```

`FitnessChart` is sustaining 13-14 renders/sec for many sustainedMs windows. Each `fitness.render_thrashing` event represents a 5-second window where >50 renders happened. This is consistent with the prior audit `2026-03-13-fitness-chart-render-thrashing-and-midstream-stall.md` — the issue did not stay fixed, or regressed.

Also seen: `fitness.component_remount {component: FitnessChart, mountCount: 4, windowMs: 60000}` — chart remounted 4× in one minute.

### Direction
- Re-open the chart-thrashing audit. Verify the memoization or selector changes that were supposed to land did land.
- Add a render-thrash circuit-breaker that, when triggered, drops the chart update rate from per-tick to per-5-tick until the next session boundary.

---

## Issue 9 — Other anomalies worth a glance

| Event | Count | Note |
|---|---|---|
| `fitness.circuit_breaker.tripped` | 1 | `ratePerSec: 100`, dropping updates for 2000 ms. Fires once at `03:13:10`, recovers 2 s later. Worth confirming what tripped it (very high event rate suggests a `series.push` storm). |
| `fitness.video_fps_degraded` | 1 | `fps: 10.8`, `dropRate: 8.7%` at `02:44:13` (~25 min into Wave Race). Governance was `unlocked` (so not GPU-thrashed by lock UI). Suspect: chart re-renders + video decode contention. |
| `playback.recovery-strategy` / `dash.error` / `dash.buffer-stalled` × 7+ | A handful | Video playback recovery is firing — not catastrophic in this session, but worth keeping on the radar. |
| `fitness.music.stuck_loading` | 5 | Playlist 672596 hangs >15 s on initial load. Three of the five are `attempt:0`; one reaches `attempt:1`. Worth a retry-policy review. |
| `playback.overlay.paused-visibility` | 2 | Brief overlay visibility blips. |
| `participant.zone.lookup_failed` | 3 | A participant lookup failed three times — probably benign but indicates a transient ID mismatch. |

---

## Notes for the next implementation pass

- Bugs **1 + 6** (primary-media + voice-memo visibility) directly corrupt the durable session record / user-visible review surface. Highest user impact.
- Bug **2** (RPM freeze) is constant low-grade annoyance that erodes trust in the live display.
- Bug **7** (persistence log spam) should be a near-trivial fix and will materially clean up future audit signal.
- Bug **8** (chart re-render thrashing) is a known regression and a perf cliff — likely the underlying cause of the `video_fps_degraded` event.
- Bug **4** (X-out → refresh) is unverified. Recommend adding the telemetry described before attempting a fix; otherwise we'll be patching by guess.
