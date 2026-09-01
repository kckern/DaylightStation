# Story time: second book sat at 0:00 for 47 s, then a stale remount timer restarted it after it had already begun

**Date:** 2026-09-01
**Found by:** field observation — a learner scanned two books back-to-back in one reading session; a grown-up asked "what happened?" and the answer came from the log store
**Status:** Incident B **fixed** on `fix/sept1-incident-remediation` (`8c31c3640`, `65699f3e5`, `39280d071`, `a1a7be1fc`), awaiting merge and deploy. Incident A **instrumented, not fixed** (`2bba98bb8`) — and the instrumentation work turned up evidence that changes which candidate cause is favoured; see the revised Incident A below.
**Severity:** low for the outcome, medium for what it reveals. Nothing was lost — the learner waited ~47 s on a blank "Starting…" screen and then heard the first 1.2 s of the story twice. But the remount-after-success race is a general Player defect that will hit any stalled start, not just story time.
**Reference:** `docs/reference/school/reading-sessions.md`, `docs/reference/player/` (resilience), `docs/_wip/bugs/2026-07-10-player-resilience-soak-findings.md`

---

## What the learner did, and what the system did

All times UTC on 2026-09-01. Log store query used:
`context.module:school-reading OR context.component:school-reading OR context.module:trigger-learner OR _msg:school.* OR _msg:trigger.*` over `_time:40m`, then a targeted pull of the living-room TV's frontend events for the stall window.

| Time | Event | Verdict |
|---|---|---|
| 16:36:45 | School card tapped at the study reader → `nfc.tap.school_card` → agenda printed | ✅ |
| 16:37:16 | Card tapped in the living room → `school.reading.session-open` `rs_mtiw49xt_4` (revision 9) | ✅ |
| 16:37:24 | TV woke (`wakeMs=8677`), page hydrated, `delivery-acknowledged` attempt 1 | ✅ |
| 16:37:49 | **Book 1 tag scanned** → `trigger.content.claimed by=reading-session contentId=plex:620707` (*The Three Little Pigs*, a Plex **track**) | ✅ |
| 16:37:54 | Countdown expired, `pick_mtiw4zgi_1` attributable; audio attached; `playback-started` at 16:37:55 | ✅ |
| 16:47:34 | `playback-completed` at 579.4 / 579.7 s (`playback.at-duration-stuck` warn fired first, then completion) | ✅ |
| 16:47:35 | `school.story-time.read-recorded learnerId=user_5 studyDay=2026-09-01 title=The Three Little Pigs` → portal toast "Story read!" | ✅ credited |
| 16:49:17 | **Book 2 tag scanned** → `trigger.content.claimed contentId=plex:620561` (*Counting Fun*, a Plex **album** with one track, `plex:620562`) | ✅ album→track resolution worked |
| 16:49:22 | Countdown expired, `pick_mtiwjqna_2` attributable; `fetch-media-succeeded` in 150 ms; `AudioPlayer mounted mediaKey=plex:620562` | ✅ |
| **16:49:26** | `playback.playback-health event=media-stalled currentTime=0` | ⚠ stall at 0:00 |
| 16:49:37 | `resilience-recovery attempt=1 reason=startup-deadline-exceeded` → immediate remount (nonce 0→1); `stall_threshold_exceeded duration=15180` | recovery working as designed |
| 16:49:53 | `resilience-recovery attempt=2` → remount after 1000 ms backoff (nonce 1→2) | " |
| 16:50:08.85 | Two queued `fetch-media-succeeded` (requestSeq 3 and 4) land at once, 15–16 s after being sent | backend released |
| 16:50:08.99 | `resilience-recovery attempt=3` → **`player-remount-scheduled backoffMs=1500`** | ← the timer that bites below |
| **16:50:09.01** | **`playback.started currentTime=0.005`** — audio is playing (generation 2, 46.2 s after generation 1) | ✅ recovered |
| 16:50:09.29 | `recovery-ledger.session-released releasedBy=success count=3 urlRefreshCount=3` | ledger closed |
| 16:50:09.62 | Backend logs the Shield's `GET /library/parts/658736/…/file.mp3` completing: **`durationMs=45650`**, status 206 | the whole stall, in one number |
| **16:50:10.49** | **`player-remount attempt=3 backoffMs=1500 … pendingSeekSeconds=6`** fires → `AudioPlayer unmounted` (instance `b86cy3c8`) | ✗ stale timer tore down a playing player |
| 16:50:10.57 | `media-detached reason=swap` / `media-attached`; new `AudioPlayer mounted` (instance `x7anaygu`); `start-time-decision lastPosByKey=1.225623 … effectiveStart=0` | 1.2 s of story replayed |
| 16:50:10.69 | `playback.started currentTime=0.014` (generation 3, `msSincePreviousSwap=1733`) | playing again |
| 16:51:02 → 16:52:13 | `play.log.updated` climbs steadily: 8.5 % → 20.3 % | ✅ story continues |

Two separate things happened. They are analysed separately below.

---

## Incident A — every request from the TV hung for ~45 s (still unexplained; a backend event-loop stall is now the favoured hypothesis)

The audio stalled because the MP3 byte-range request took 45.6 s to return. That request goes Shield → app backend → Plex. The natural suspicion is Plex, but the backend's own `http.response` rows for the window say otherwise. All of these completed in the same 200 ms burst at 16:50:09.6–09.8:

| Path | Client | durationMs |
|---|---|---|
| `GET /library/parts/658736/…/file.mp3` (Plex proxy) | living-room TV | 45 650 |
| `GET /plex:620561` (content resolve) | living-room TV (`browser:968748…`) | 30 860 |
| `GET /plex:620561` | same | 14 835 |
| `POST /log` ×6 (frontend log shipping — no upstream, no I/O beyond the store) | living-room TV (`browser:13097…`) | 8 062 – 42 943 |

Six `POST /log` calls that should take single-digit milliseconds took 8–43 s and all released at the same instant as the media request. Whatever stalled was between the Shield and the backend's request handling, not inside Plex.

Concurrently, the yellow-room piano tablet (a different device, different WebView) saw its Hoffman Academy DASH transcode fragments take 20.0 s, 7.1 s and 9.4 s (16:49:44 – 16:50:01), with `dash.buffer-stalled`, `playback.stalled stallDurationMs=1602`, and a successful `nudge` recovery. So two kiosks on two Wi-Fi radios degraded in the same ~45 s window.

**Candidate causes.** Hypothesis 1 is now **favoured** on the evidence below; none is confirmed.

1. **Backend event-loop stall — favoured.** Would explain instant release of every queued request at once, including the `POST /log` ones. Originally argued against on the grounds that the backend kept emitting its own events through the window (`eventbus.broadcast`, `device.setScreen`, `piano.history.write` at 16:51 — though nothing is logged *inside* 16:49:26–16:50:08 that proves liveness either way). See **New evidence** below: this process really does stall for 10+ s, repeatedly, and the one datum that looked like an alibi is not one. Still worth checking: whether a synchronous, long-running task runs around a `story-time.read-recorded` (16:47:35) or a second `trigger.content.claimed` (16:49:17). The `read-recorded` → ledger write → (anything that walks 400 days of ledger?) path is a suspect only because of proximity.
2. **Wi-Fi / LAN hiccup.** Would explain two devices at once. Against it: the piano tablet's fragments were *slow*, not *dead* — a link drop usually looks like ECONNRESET, and the earlier `screenOn` calls to the tablet at 16:36:37 and 16:48:23 did ECONNRESET, but those are the tablet's own FKB REST endpoint, a known-flaky path (`piano-midi-wake.rejected`) and not the same window.
3. **Plex under transcode load** starving the proxy. Does not explain `POST /log`.

### New evidence (2026-09-01, from Task 9's groundwork)

The existing 5-minute `server.memory` watchdog is itself a crude lag probe: the overshoot of each of its gaps beyond 300 s samples how late the loop was. Over **2026-09-01 12:08–20:04 UTC**, comparing only consecutive fires from the **same container** (three container restarts in the window otherwise fake large gaps), **90 intervals**:

```
p50 = +0.030 s    p90 = +0.310 s    max = +15.13 s
late by >1 s: 5      >5 s: 2      >10 s: 2
```

**This process really does stall for 10+ seconds, repeatedly.** And a 300 s timer only notices a stall that happens to span its due instant — roughly `D/300` of stalls of duration `D`, about 3% of a 10 s stall — so the true rate is far higher. Extrapolated, two observed >10 s stalls in 90 intervals puts the process on the order of **2% of its life with the loop blocked >10 s**. Treat that last figure as an **order-of-magnitude estimate, not a measurement**: it rests on 8 hours and two container lifetimes.

**The trap.** The watchdog fired at **16:53:46 only +0.03 s late**, spanning this incident, which reads like an alibi for the event loop. It is not one. The stall **ended at 16:50:09**, three and a half minutes *before* that timer was due — so an on-time fire at 16:53:46 is exactly what a 45 s stall ending at 16:50:09 would also produce. The datum is silent on the question, not exculpatory.

### What the new monitor can and cannot do

`backend/src/0_system/runtime/eventLoopLag.mjs` samples `perf_hooks.monitorEventLoopDelay` and emits `system.event-loop.lag` once per 60 s window with `maxMs` / `p99Ms` / `p50Ms` / `windowMs`, at info, escalating to warn at/above `thresholdMs` (1 s). `windowMs` is a second witness that does not use the histogram at all — the monitor's own timer runs late by however long the loop was blocked.

- **It separates backend-stall from network-stall cleanly.** A loop stall writes one row near the release with `maxMs ≈ 45000` and `windowMs ≈ 105000`; a network stall writes an ordinary row (`maxMs` in the tens of ms, `windowMs ≈ 60000`) while the `http.response` durations still read 45 s. Verified against a deliberate 900 ms block: `maxMs=916, p50Ms=21, windowMs=1052` on a nominal 300 ms window, reported by a `sample()` that ran 2 ms *after* the block ended. The histogram is a libuv-level timer, so **a stall is always reported in the window it finishes in, never lost**.
- **It cannot attribute.** It says the loop was blocked, not by what — it cannot separate our JS blocking from GC pausing us from the OS descheduling us. All three are the process failing to run, which is enough to settle backend-vs-network and nothing finer. Correlation with request rows is by timestamp only; nothing request-scoped is visible at this layer.
- **Read the floor correctly.** Every figure bottoms out at the histogram resolution (20 ms), so a healthy row reads `maxMs`/`p99Ms`/`p50Ms` ≈ 21, **not 0**. Quiet windows are logged deliberately, so a gap in these rows means the process was down or not shipping — itself an answer.

`eventbus.client_stale misses=3` warnings fired at 16:38:41, 16:39:11, 16:39:41, 16:42:11 and 16:45:42 — the living-room TV's event-bus client missing heartbeats every few minutes throughout the session, *before* the stall. That is either the same underlying flakiness at low amplitude, or unrelated noise; it is the only breadcrumb pointing earlier than 16:49:26.

**What to look at next:**
- **Read `system.event-loop.lag` once this branch is deployed.** One week of info rows gives this box's baseline and lets `thresholdMs` be retuned from data rather than a guess; the next occurrence of this symptom then settles backend-vs-network on its own.
- `docker logs` for the container across 16:49:20–16:50:10 for anything the shipper never saw (a GC pause, a blocking `fs` call, a warning from the HTTP server about a saturated pool).
- Whether `http.response` rows exist for *any* client in that 42 s gap. If none — backend-side stall. If other clients were served — network-side.
- Wi-Fi AP client logs for the Shield and the tablet in that minute, if the router keeps them.
- The monitor detects; it does not attribute. If the rows say "blocked", the next step is a CPU profile or a `--cpu-prof` window, not more log reading.

---

## Incident B — a pending remount timer fires after playback has already succeeded (defect, located)

### Symptom

At 16:50:08.99 the startup deadline expired for the third time and `scheduleSinglePlayerRemount` armed a 1 500 ms timer. **Twenty milliseconds later** the backend's 45 s hang released, the audio element got its bytes, and `playback.started` fired at 16:50:09.01. The recovery ledger correctly observed forward progress and released the session (`releasedBy=success`) at 16:50:09.29. The timer did not care. At 16:50:10.49 it fired `forceSinglePlayerRemount`, unmounted the playing `AudioPlayer`, and mounted a new one from `effectiveStart=0`. The learner heard "Counting Fun … " start, cut, and start again.

Cost this time: 1.2 s replayed (`lastPosByKey=1.225623`), one extra `fetch-media` round-trip, one extra media-element generation. Cost in the worst case: a remount on a **video** with a fresh Plex transcode session — the start-over cost is seconds of black, and on the piano kiosk that's the difference between a lesson continuing and a stall-recovery cascade.

### Root cause

`frontend/src/modules/Player/Player.jsx`

- `clearRemountTimer` (`Player.jsx:301`) is invoked from exactly three places:
  1. the `currentMediaGuid` change effect (`Player.jsx:325`) — a *different item* started;
  2. the top of `scheduleSinglePlayerRemount` itself (`Player.jsx:660`) — replacing one pending timer with the next;
  3. component unmount (`Player.jsx:1311`).
- **Nothing clears it when playback succeeds.** The success signal lives entirely inside `useMediaResilience` (`hooks/useMediaResilience.js:339-360`): on a `progressToken` bump it sets status `playing`, clears its *own* `startupDeadlineRef`, and calls `getRecoveryLedger().recordSuccess(...)` when the playhead advanced. It has no channel back to `Player.jsx` to say "cancel any remount you have queued on my behalf". `Player.jsx` wires `onStateChange`, `onReload`, `onExhausted` into the hook (`Player.jsx:1007-1029`) — there is no `onRecovered`.
- The timer's callback (`Player.jsx:677-680`) calls `forceSinglePlayerRemount` unconditionally. `forceSinglePlayerRemount` does read live state through `playbackMetricsRef` (it carries `wasPaused`, `playbackSeconds`, `isSeeking` into the diagnostics — see the comment at `Player.jsx:~615`), so it *knows* playback is under way (`playbackSeconds` would be ~1.2 here) but it does not act on that knowledge.

The race window is exactly the backoff: 0 ms on attempt 1, 1 000 ms on attempt 2, 1 500 ms on attempt 3, growing with `computeRemountDelayMs`. The longer recovery goes on, the wider the window in which a late-arriving success gets clobbered. That is the inverse of what backoff is for.

### Why it hasn't been noticed

A remount that lands right after success on a **track starting from 0** is nearly invisible: the new element seeks to 0, plays, and the only tell is a repeated first second. The soak-findings doc (`2026-07-10-player-resilience-soak-findings.md`) hunted for remount *storms* and stuck-at-duration; this is a single, quiet, extra remount. It only stands out in the log because story-time's `media-detached reason=swap` / `media-attached` pair fires twice within 1.7 s of a `playback-started`.

### Fix (proposed, not implemented)

Two layers; either alone closes this case, both together are cheap.

1. **Cancel on success.** Give `useMediaResilience` an `onRecovered` callback (or reuse `onStateChange` with the `playing` transition, which `compositeAwareOnState` already receives) and have `Player.jsx` call `clearRemountTimer()` there. This is the principled fix: the thing that armed the timer is told the reason for it no longer exists.
2. **Guard at fire time.** In the `setTimeout` body at `Player.jsx:677`, before calling `forceSinglePlayerRemount`, check `playbackMetricsRef.current` — if `seconds` has advanced past the position the timer was armed at and the element is not stalled, log a `player-remount-skipped reason=playback-resumed` and return. This is defence in depth for any other path that arms the timer, and it produces a log line that would have made this incident self-explanatory.

Add a unit test in the Player resilience suite: arm attempt N with backoff > 0, emit a progress event before the timer fires, assert no `player-remount` and one `player-remount-skipped`.

### As built

Both layers shipped, plus two corrections review forced:

- **Cancel on success** (`65699f3e5`): `compositeAwareOnState` clears the pending timer on the hook's transition to `RESILIENCE_STATUS.playing` (compared against the constant, not a string literal) and logs `player-remount-cancelled` carrying the pending `attempt`/`backoffMs`, so the line joins to the `player-remount-scheduled` it cancelled.
- **Fire-time guard** (`8c31c3640`, `39280d071`): `lib/scheduledRemountGuard.js` (renamed from `remountGuard.js` — too close to `remountStormGuard.js`, its neighbour in the same import block) compares the playhead against the position captured at arm time. It takes **`isSeeking`** as well as `stalled`: a forward seek past the transcoder's head jumps `currentTime` instantly and wedges with `el.seeking` true — the one stall class that *advances* the clock — so reading it as progress would have made this fix cause a stall. `player-remount-skipped` carries `armedAtSeconds` + `playbackSeconds`. Both `stalled` and `isSeeking` are best-effort: only `SinglePlayer` forwards them, and it coerces `isSeeking` with `?? false`, so that field never latches there; `RemuxPlayer` and `ImageFrame` omit both.
- **Consent comes from the hook, not from `forceRemount`** (`a1a7be1fc`, correcting `39280d071`). The intermediate cut derived the brake bypass as `userInitiated: Boolean(forceRemount)`, on the claim that `forceRemount` reaches Player only from the user-retry path. **That is false**: it has three sources — `retryFromExhausted` (a human), the **automatic** stall-jolt ladder rung 1 (`stallJolt.js:33`, ~9.5 s into any mid-playback stall), and `requestRecovery` (host app, unknown). Flagging the automatic ladder as consent would have bypassed both brakes on exactly the path where this bug is most likely, since the ladder arms on the mid-playback stalls where a stream releases mid-backoff. `useMediaResilience.js:326` now sends an explicit `userInitiated: true` from `retryFromExhausted` only; `Player.jsx` reads it and never infers it. `forceRemount` stays what it always was — a statement about *mechanism* ("an in-place `hardReset` won't do"), honoured at the `hardReset` short-circuit.

Both brakes are deliberately bypassed for a user-initiated retry: the exhaustion nonce makes the backoff window they act inside up to 45 s, so either could otherwise have swallowed an explicit retry — and the `seekToIntentMs` position with it.

**Not taken (see the plan's follow-ups):** scaling the progress threshold to the backoff (M1) — after a 45 s backoff it would demand ~22 s of playback before a skip; and resetting the nonce ladder on recovery (M4) — `nonce` feeds `singlePlayerKey`, so a naive reset triggers the very remount it is meant to avoid.

### Blast radius

Any `Player` mount: story time, fitness video, piano lessons, office program, screen queue. Every one of them reaches remount through the same `scheduleSinglePlayerRemount`. The trigger condition — success arriving during a non-zero backoff — is a slow-start that finally resolves, which is exactly the condition a flaky link produces.

---

## Non-findings, so nobody re-chases them

- **Album vs. track.** Book 1's tag mapped to a track id, book 2's to an album id. Both resolved; the album's single child track was chosen (`playback.cover-loaded mediaKey=plex:620562` within 12 ms of `fetch-media-succeeded contentId=plex:620561`). Not a bug.
- **`playback.at-duration-stuck` at 16:47:34.475.** Fired 0.3 s before `playback-completed` at 579.41 / 579.72 s. The completion watchdog then finished the story. Cosmetic.
- **`remote.keymap-fetch-failed keyboardId=tvremote` 404 at session open.** Pre-existing; unrelated to reading.
- **`fkb.screenOff.unavailable bridge=absent` at 16:41:26.** The TV page tried to dim between books via a bridge it doesn't have on this device. Unrelated to the stall.
- **`audio-shader.dimensions hasGap=true` warnings.** Fire in pairs on every audio mount (sub-pixel `-0.25` offset). Noise; a candidate for demotion to `debug`.
