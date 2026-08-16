# Observability Sweep — 2026-08-16

**Trigger:** the piano video remount storm (see `docs/_wip/plans/2026-08-16-piano-video-remount-storm.md`). Four read-only audits: frontend player pipeline, log transport/durability, backend media-resolution boundary, kiosk lifecycle/health.

**One-sentence verdict:** we diagnosed this incident by luck and by reading Plex's server log — our own telemetry could not have told us what happened, could not have told us it was happening, and did not keep the evidence.

---

## The three failures, stated plainly

### 1. The evidence did not survive

Docker truncated its log when the container restarted at 12:07 PDT, ~30 minutes after the incident:

```
docker inspect daylight-station → LogConfig: {"Type":"json-file","Config":{}}   # no max-size, no max-file
docker logs daylight-station | grep -c "18:3[2-6]"  →  0
```

The durable per-app log never had it either. `initSessionFileTransport` **is** wired (`backend/index.js:120-123`) — my earlier guess that it was dead was wrong. The gate is:

```js
// backend/src/0_system/logging/transports/sessionFile.mjs:59-60
const app = event?.context?.app;
if (!app || !event?.context?.sessionLog) return;
```

**The piano kiosk never sets either field.** `PianoApp.jsx` never calls `configure`; every logger under `PianoKiosk/modes/Videos/` is `getLogger().child({ component: '…' })`. So every kiosk event fails the gate and returns, uncounted.

The three files in `media/logs/piano/` are not the kiosk's. They come from `PianoVisualizer` — a screen-framework wall-screen widget (`builtins.js:26`), the only thing in the repo setting `app: 'piano', sessionLog: true` (`PianoVisualizer.jsx:48`). Their contents are `circle.render` / `chord.identify`.

In Docker the dispatcher has exactly one general transport: **stdout**. The file transport is excluded by `if (!isDocker)` (`backend/index.js:98`); Loggly is unconfigured (verified: no token in the prod container env).

### 2. We were blind at the boundary that was being hammered

The storm crossed four backend hops. Every one is instrumented for errors only:

| Hop | Code | On success |
|---|---|---|
| `GET /proxy/plex/stream/:ratingKey` | `proxy.mjs:262-280` | nothing — 19 lines, 0 log calls |
| `PlexAdapter.getMediaUrl` | `PlexAdapter.mjs:1743` | nothing |
| `PlexClient.request` | `PlexClient.mjs:54` | `debug` only; prod runs at `info` (`config.mjs:79`) |
| `/proxy/plex/*` passthrough | `ProxyService.mjs:102-209` | nothing |

There is **no global HTTP request logging**. `requestLogger.mjs` exists and the layer guidelines name it as standard — it is mounted on one router (`nutribot.mjs:41`). And it would have missed this anyway: it hooks `res.json` (`requestLogger.mjs:41`), while both hot paths end in `res.redirect` or `proxyRes.pipe`.

No rate limiting exists anywhere: zero limiter imports, zero `429`s. The only attempt cap is client-side (`recoveryLedger.js:25`), inside the process doing the hammering.

**`logger.sampled()` already exists** (`logger.mjs:93-126`), with per-minute budgets and aggregation, and is used **zero times in the backend**. One call at `proxy.mjs:270` would have emitted:

```
plex.stream.mint.aggregated {sampledCount: 20, skippedCount: 475, aggregated: {ratingKey: {"694719": 495}}}
```

### 3. Nothing noticed, and nothing could have told anyone

Three detectors were in scope. All three were blind, each for a different reason:

- **APK watchdog saw a healthy device.** `KioskWatchdog.classify` returns HEALTHY at `fps >= minFps` (default 12); we were at 37.4 fps with beats arriving every second, for 17 minutes.
- **In-page watchdog is off by design.** `useRenderWatchdog.js:80` — `SELF_HEAL_RESTART = false`, with a documented rationale (a restart provably didn't recover fps on this hardware). Its only input is fps anyway.
- **The correct signal dead-ends in a cache.** `useSessionStatePublisher.js:13` publishes `state` and `position` every 5 s (`SessionSource.js:160-167`). `DeviceLivenessService` only asks *"did a beat arrive?"* (`:27`). Nothing compares consecutive `position` values.

Every health check we own measures **frame rate** or **beat arrival**. The failure was semantic: media requested, media never advanced. *"Stuck" is not a concept anywhere in the health layer.*

And there is **no path at all** from "a kiosk is unhealthy" to a human. The only automated device alert is the ESP relay watchdog (`app.mjs:4142-4180`), scoped by explicit decision to `kitchen-relay` and `food-scale-relay`. Worse, it likely cannot deliver: it sends `category:'system'` with no `metadata.username`, and `TelegramNotificationAdapter.mjs:40-43` returns `{delivered:false}` without a chat id.

---

## Signals that actively misled

These are worse than missing logs — they cost investigation time.

### Fabricated fields: values that were never measured

The overlay line I read for three minutes contains **four fields that no caller ever supplies**. They render their defaults, which look exactly like measurements.

```
[008c56a342] vis:141830ms/0ms | status:Loading… | countdown:n/a | seek:0:00 | el:t=0 r=n/a n=n/a p=false | startup:armed attempts=0 timeout=n/a
                                          ^^^^^                    ^^^^^^^^^^^^^^^^          ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
```

- **`startup:armed attempts=0 timeout=n/a`** — `startupWatchdogState` is not in `overlayProps` (`useMediaResilience.js:717-756`) and no caller sets it. `PlayerOverlayLoading.jsx:318-320` renders `?.state || 'armed'`, `?.attempts ?? 0`, `?.timeoutMs ?? 'n/a'`. **Every startup-phase log in the system has read `armed attempts=0 timeout=n/a` since this line was written.** I took it as evidence the watchdog was armed and had not retried.
- **`countdown:n/a`** — same, `countdownSeconds` is never passed (`:310-313`).
- **`hasElement: true` is a literal, not a check** (`useMediaResilience.js:747-748`). The overlay branches on it to choose `el:…` over `el:none` (`PlayerOverlayLoading.jsx:315-317`). The `el:` prefix asserted an element existed; nothing verified that.
- **The structured payload is dead code.** `PlayerOverlayLoading.jsx:363-374` prefers `sessionInstance.logEvent('overlay-summary', payload)` — commented *"Issue #4 fix … ensures overlay events reach remote transport"* — but **`sessionInstance` is never passed**. The rich object at `:343-362` is built once per second and discarded; the fallback string is what ships. Consequently `playback.stall_threshold_exceeded` always reports `playheadPosition: null, videoFps: null, lastGoodPosition: null`. I read those nulls as "the player had no position to report." They are simply never wired.

**`waitKey` is logged under one field name in two incompatible encodings.** `Player.jsx:512` logs it raw (`IIni70e01E:0` — identity plus nonce ordinal); `useMediaResilience.js:242` and `usePlaybackHealth.js:125` log an FNV-1a hash of it (`008c56a342`). The hash is one-way, so a log line cannot be mapped back to an item, and the `:N` ordinal — the single field that would have made a nonce climb self-evident — is destroyed. `waitKeyLabel.js:16-18` also returns `'0000000000'` for `null`, `undefined`, and `''` alike, collapsing every keyless player into one apparent identity.

**`player-remount` is emitted when no remount happens.** `Player.jsx:740-751` logs that event name on the path that deliberately *skips* the remount (`source: 'hard-reset-accepted'`), and nests its fields under `payload` while the real emitter at `:511` is flat. Counting `playback.player-remount` yields a number that means neither one thing nor the other.

### Other misleading signals

| Signal | Problem | Where |
|---|---|---|
| `el:t=0 r=n/a n=n/a` | Three distinct causes, one output: no element at effect time; the effect not yet re-run; or `getMediaEl` **silently falling back to the container** when `container.shadowRoot` is absent (`useCommonMediaController.js:214-223`), i.e. the `<dash-video>` wrapper, whose `readyState` is not a number. Nothing records which object was read | `PlayerOverlayLoading.jsx:316` |
| `dash.manifest-loaded` etc. never appear | Subscription races the emitter (100 ms poll for `el.api`, then `.on(...)`). "Never fired" and "already fired" are indistinguishable. **This led me to conclude no manifest ever loaded — Plex's log proved otherwise** | `VideoPlayer.jsx:474-500` |
| `playback.player-remount` × 3 | ~300 actual remounts. The path that fired was a React `key` change, which nothing logs | `Player.jsx` `singlePlayerKey` |
| `piano.video.mount-timeout` | Cannot fire here at all: latches only if an element *never* appeared (`if (!current && !everResolved)`). Post-resolve element churn can never trip it | `useResolvedMediaEl.js` |
| One shared source IP | All clients arrive as `172.18.0.53`; `trust proxy` is never set. My first pass conflated the garage fitness kiosk with the piano tablet because both filter to the same IP | `app.mjs` middleware stack |

**Correction from the audit:** the 17.5-hour-old page (`elapsedSec: 63181`) was the **garage fitness kiosk**, not the piano tablet. `fitness-profile` has exactly one emitter (`FitnessApp.jsx:285`); the piano emits `perf.diagnostics`, which carries no uptime field. So there are two aged-page problems — the piano's is unmeasured, the fitness kiosk's is measured and unread.

---

## Feeds back into the fix plan: three mechanisms defeat the retry cap, not one

The remount-storm plan assumed the backoff never escalated because guid churn resets `remountState.nonce` to 0 (`Player.jsx:289`). The audit found **two more, each independently sufficient**:

1. **Ledger session deletion.** The recovery ledger is keyed on `itemSessionKey` = `player-item:${currentMediaGuid}` (`Player.jsx:323-326`). On every guid change `useMediaResilience.js:108-115` calls `releaseSession(prev)`, and `recoveryLedger.js:117` does `sessions.delete(sessionKey)` — **erasing the entire attempt record**, restoring the 5-attempt cap to zero each iteration. Task 2 (stable content-derived guid) fixes this as a side effect.
2. **`advanced: true` on first observation.** `playheadProgress.js:27` returns `{ advanced: true }` when there is no baseline. After every remount the baseline is null, so the first tick of each generation reports forward progress, which at `useMediaResilience.js:334-336` calls `recordSuccess(...)` and zeroes the count. **A remount loop can look like continuous successful recovery.** Task 2 does not touch this; it needs its own fix.

Both are silent — `releaseSession` logs nothing, and a fabricated first-tick advance is indistinguishable from a real one. This is why `resilience-recovery attempt=1` repeated forever, and why "the cap keeps resetting" was not distinguishable from "the cap was never reached."

**Action:** add `playheadProgress.js:27` to the fix plan as a separate task, and log the ledger teardown.

Independently, the audit reached the same conclusion as the fix plan's Task 4 about `VideoPlayer.jsx:409-412` — the `[]`-dep cleanup captures the first element and never cleans later generations. Two separate readings agreeing raises confidence that one is real.

---

## Remediation, tiered by "would this have caught it"

### Tier 0 — Make the evidence survive

Without this, every other tier is unverifiable.

1. **Tag the kiosk.** `configure({ context: { app: 'piano-kiosk', sessionLog: true } })` in `PianoApp.jsx`, mirroring `FitnessApp.jsx:102`. One line; makes `perf.diagnostics`, all player events, and all `piano.*` events durable for free.
2. **Fix retention semantics.** `maxAgeDays: 3` → 14, and run the pruner on a daily timer. Today it prunes **only inside `initSessionFileTransport`**, i.e. at boot, so retention is really "3 days as of the last restart". Measured cost of all `.jsonl` on prod today: 68 MB.
3. **Give Docker a durable general sink.** Drop the `!isDocker` guard at `backend/index.js:98`, pointing at `media/logs/backend.log` with size rotation.
4. **Count every silent drop.** The `sessionLog` gate (`sessionFile.mjs:60`), the 500-event WS ring that discards the *oldest* (`index.js:194`), and the error-storm suppressor that deletes >3 fetch failures per 2 s (`errorHandlers.js:78-80`) — a remount storm *is* a fetch-failure storm. `LogDispatcher.getMetrics()` exists (`dispatcher.mjs:133`) and has zero callers; expose it.

### Tier 1 — Make the expensive boundary visible

5. **`logger.sampled('plex.stream.mint', { ratingKey, offset }, { maxPerMinute: 20 })`** at `proxy.mjs:270`. Highest value-per-character change in this document.
6. **Global request logging on `res.on('finish')`** (not `res.json`), mounted on `/api/v1`.
7. **Log media-element lifecycle.** Every `<dash-video>` generation created and destroyed, with a stable id — the event class that was entirely absent.

### Tier 2 — Make identity join up

8. **Thread the session id.** `req.query.session` → `play.mjs` → `mediaUrl` → `proxy.mjs:270` → `getMediaUrl(ratingKey, { startOffset, session })`. Today `PlexAdapter._generateSessionIds(null)` falls back to a fresh random per request (`:1376-1385`), so **Plex saw 495 distinct clients, not one client retrying**. Confirmed empirically: running that generator 20,000 times reproduces the exact length distribution (22 chars = modal, 51%) and alphabet of the id Plex logged.
9. **`X-Daylight-Device` header** in `frontend/src/lib/api.mjs`, stamped into `req.deviceId` alongside `req.householdId`, plus `trust proxy`. Note `<video>`/dash segment fetches can't carry custom headers — those need a query param.
10. **Mount `tracingMiddleware` globally.** `traceId` is `'unknown'` on every logged error today.

### Tier 3 — Notice, and tell a human

11. **Publish `lastProgressAt`** in the 5 s device-state snapshot. `usePlaybackHealth` already computes it (`usePlaybackHealth.js:425,437`); it just never leaves the component tree.
12. **Assert on it backend-side.** ~10 lines in `DeviceLivenessService`: `state === 'playing' && position unchanged for 60s` → unhealthy. Would have fired at minute one.
13. **Add a `STUCK` verdict** to the APK watchdog, fed by playback progress rather than fps, entering the ladder at L2. Preserve `escalatesPastL1` (`KioskWatchdog.java:146`) — it encodes the 2026-07-15 outage as policy and is exactly right for the problem it was written for.
14. **Fix notification delivery** — default `metadata.username` to the head of household for `category:'system'`, then wire the stall detector to it. `DEFAULT_PREFERENCES.system.high` (`notifications.mjs:29`) was written for precisely this case and needs a caller, not a redesign.

### Tier 4 — Repair the misleading signals

15. Overlay reads the inner `<video>` through the shadow DOM, not the wrapper — kills `r=n/a n=n/a` and gives the startup watchdog a real input.
16. At dash subscribe time, read current state as well as subscribing, so absence is unambiguous.
17. Make `piano.video.mount-timeout` progress-based rather than first-resolve-based.

---

## The pattern to propagate

**In-app feedback capture is the best-designed thing in the system, and it is the only mechanism that produced a complete, durable record of this incident.**

- `Logger.js:88` — an always-on 300-event ring, independent of every transport, gate, level filter, and pruner.
- `feedbackApi.js:35` — ships the last 150 with the report.
- `FeedbackService.mjs:74` — stores them verbatim, indefinitely, at `data/household/feedback/{app}/*.yml`.

It worked *because* it depends on none of the broken machinery above. Two facts make it generalizable at near-zero cost:

- **Audio is optional.** `hasAudio = !!(audioBuffer && audioBuffer.length)` (`FeedbackService.mjs:51`), and everything downstream is null-safe. A machine-generated *"I noticed I was stuck"* report can use this exact pipeline **today, with zero backend work** — same POST, same YAML, same 150-event ring, `audio: null`, `context: { reason: 'stall-detector' }`.
- **New apps self-register.** `create()` does `mkdirSync(..., {recursive:true})` and `_allApps()` discovers dirs by `readdirSync`. `FeedbackOverlay` already takes `app` as a prop.

Currently wired: piano and fitness. Dark: Portal, Player/Shield, School, Admin, Emulator, Auto.

**One gap:** nothing reads the inbox. The API is complete (list/get/audio/PATCH/DELETE) but the only consumer is `curl` from a skill, and arrival triggers no notification beyond `logger.info('feedback.created')`.

---

## Also worth preserving

- **`schoolLedger.mjs`** — its header states this exact failure mode (*"a redeploy is the normal response to a School bug, which means the act of responding to a problem destroyed the evidence for it"*) and fixes it with 400-day date-bucketed files and a fail-soft `usable` flag. This is the pattern the piano kiosk needs.
- **`ReolinkCameraAdapter.mjs:104`** — `camera.snapshot.ok {id, durationMs, sizeBytes}`. Success + item + latency + size. Best-instrumented external call in the codebase; make it the adapter standard. (Only 3 of ~20 adapters measure latency at all.)
- **`HaActionGuard.mjs:7-63`** — throttle + dedup-by-key + failure circuit with backoff, written and tested, wired to exactly one consumer. Generalizing it to guard Plex mints is reuse, not a build.
- **`ingestion.mjs:74-80`** — the session-file write sits *outside* the dispatcher's level filter, so a tagged `debug` event still reaches disk. Correct call; keep it.
- **`inputTelemetryGate.js:23`** — mode-scoped opt-in with the exact bug it prevents documented inline.

---

## Kiosk surface coverage

| Surface | Heartbeat | Self-heal | Page age | Crash log | Alerts a human |
|---|---|---|---|---|---|
| Piano kiosk | 1 Hz to localhost only, + 5 s device-state | APK ladder L1–L4, fps/beat-triggered; in-page disabled | sent, never read | yes (on-device) | **no** |
| Shield TV / FKB | 5 s device-state | reactive `/device/:id/recover` only | no | no | only TV-wake, gated off when `notify_service` unset — and none exists |
| Garage fitness Firefox | **none** | **none** — manual Reload button | measured, unread | no | **no** |
| Portal tablet | BT presence | **none** | no | in-memory ring | **no** — its documented single point of failure has no detector |
| Playback-hub | 10 s bridge | none | no | no | **no** |
| eink-panel | on wake | n/a | no | reset reason | **no** |

Every surface invented a private health story; none reach a decision-maker.
