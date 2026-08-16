# Observability Remediation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the next incident of this class diagnosable from our own logs, within minutes, without reading Plex's server log — and make the kiosk say so itself instead of waiting for a child to complain.

**Architecture:** Four tiers, ordered so each is verifiable once the previous lands. Tier 0 makes evidence survive (nothing else is checkable without it). Tier 1 instruments the two junctions that were entirely dark. Tier 2 threads one identity end-to-end so frontend, backend and Plex logs can be joined. Tier 3 turns existing-but-unread signals into a detection and an alert. Tier 4 removes fields that render defaults as if they were measurements.

**Findings source:** `docs/_wip/audits/2026-08-16-observability-sweep.md`. Every file:line below came from that sweep; re-verify before editing, since the fix branch is moving.

**Tech Stack:** React 18 + vitest/jsdom (frontend), Node ESM + vitest (backend), DDD layering per `docs/reference/core/layers-of-abstraction/`.

---

## Status — 2026-08-16

Executed end to end the same day the audit was written. Every tier shipped; nothing was left shelved.

| Tier | State | Landed as |
|---|---|---|
| **0** — evidence survives | ✅ | kiosk tagged `piano-kiosk`, 14-day retention pruned on a timer, 200 MB general sink at `media/logs/backend.log`, silent-drop counters |
| **1** — dark junctions | ✅ | `media-element.generation`, `plex.stream.mint`, `playback.player-key-changed` / `dash-element-rekeyed` with `changedComponent`, stream-URL succeeded/failed/skipped, global request logging on `finish`+`close` |
| **2** — identity joins up | ✅ | session id threaded frontend→backend→Plex, `X-Daylight-Device`, `trust proxy` |
| **3** — notice and tell a human | ✅ | `PlaybackStallDetector`, default recipient resolution for `system` notifications, `autoReport`, feedback arrival notification |
| **4** — honest fields | ✅ | seven fabricated overlay fields removed, one `waitKey` meaning, dash-absence disambiguation, cleanup + ledger instrumentation, dead `DEBUG_MEDIA` logging replaced |

**Still unverified in the field.** All of it is proven in unit tests and jsdom only. The kiosk verification below has NOT been run, because no deploy was authorised. That check — `start.mpd` down from 73–93/min to ≤3 per session, one transcode session UUID in the audio segment requests, `el:t=` advancing past 0, and `media/logs/piano-kiosk/*.jsonl` surviving a container restart — remains the real gate.

**Known consequence of Tier 3.** `resolveDefaultRecipient` also repairs the ESP relay watchdog, which has been returning `delivered: false` since it was written. If the kitchen board is currently dead, the first 30-minute tick after a deploy will send a Telegram message that looks new but is years overdue.

**Follow-ups that outlived the plan:**
- `63 MB/day at `info`` is the highest-value remaining item — trimming one chatty component buys log retention for free rather than by spending disk.
- `Logger.js`'s `.aggregated` roll-up **sums numeric fields**, so `requestSeq`, `msSinceLastRequest` and the backend's `startOffset` are meaningless in an aggregate line. Same class of defect this programme was written to correct.
- `poses/` and `camera-archive/` have no retention policy from anyone; they are now protected from the log pruner, which means nothing prunes them.
- Two `logging.yml` files exist; only the repo-root one is read.
- The 60s stall threshold is untuned against field data.

---

---

## Scope decision — 2026-08-16

**Execution order is Tier 0 → Tier 1 → Tier 3 → Task 4.2. Tier 2 and the rest of Tier 4 are shelved.**

The tiers below are written 0-1-2-3-4, but **Tier 3 runs before Tier 2**. The incident was not slow to diagnose for lack of correlation ids; it was 17 minutes of a child in front of a broken screen because *nothing noticed*. Tier 2 makes diagnosis faster. Tier 3 makes the house notice at minute one, and it is cheaper than it looks: the device heartbeat already ships `state` and `position` every 5s, the alert path is one missing field from working, and the auto-report needs no backend change at all.

**Doing (13 tasks):** Tier 0 (0.1–0.4), Tier 1 (1.1–1.4), Tier 3 (3.1–3.5), and **Task 4.2**.

Task 4.2 is promoted out of Tier 4 because it is not hygiene. `startup:armed attempts=0 timeout=n/a` and `playheadPosition: null` are hardcoded defaults that render as measurements — they misled the 2026-08-16 investigation directly. **Removing a field that lies is worth more than adding one that tells the truth.**

**Shelved (8 tasks):** all of Tier 2 (2.1 session threading, 2.2 device identity, and the global tracing middleware inside 1.4 — mount the request logger, skip tracing for now), and Tier 4 tasks 4.1, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8. All are real; none are urgent once detection works. Revisit after the new telemetry has caught something in the field.

**Deploy policy for this work:** merge to `main` and push. **No deploy** — no homeserver rebuild, no container restart. The kiosk verification in the Verification section below therefore cannot run yet; it stays pending until a deploy is separately authorised.

---

## Ground rules for every task

- **Never raw `console.*` in `frontend/src/`** — use `frontend/src/lib/logging/`. A repo hook enforces this.
- **Backend logging goes through the injected logger**, never `console`. Respect layer boundaries: HTTP concerns in `4_api`, adapter concerns in `1_adapters`.
- **New log events must be greppable and self-describing.** Prefer one event with rich fields over several thin ones.
- **Any field that can be absent must say which absence it is.** The whole point of this plan: `n/a` that means "not measured", "not applicable" and "measured as null" is worse than no field.
- **Do not add a log inside a render path without a rate limit.** `logger.sampled(event, data, { maxPerMinute, aggregate: true })` exists on both sides (`Logger.js:154`, `logger.mjs:93`).
- Commit after each task. Run `node scripts/gate-vitest.mjs` before the final commit of each tier.

---

# TIER 0 — Make the evidence survive

Without this tier nothing else in the plan is verifiable, because the events will not be there tomorrow.

## Task 0.1: Tag the piano kiosk so its events are durable

**The finding:** `sessionFile.mjs:59-60` drops any event lacking `context.app` **and** `context.sessionLog`. `PianoApp.jsx` never calls `configure`, so every kiosk event — the whole incident — went to stdout only. The three files in `media/logs/piano/` belong to `PianoVisualizer`, a different surface (`builtins.js:26`).

**Files:**
- Modify: `frontend/src/Apps/PianoApp.jsx`
- Create: `frontend/src/Apps/PianoApp.logging.test.jsx`

**Step 1: Read the precedent.** `frontend/src/Apps/FitnessApp.jsx:102` already does this correctly. Match it.

**Step 2: Write the failing test** — assert that mounting `PianoApp` configures the logger with an `app` and `sessionLog: true`, mirroring the assertion style in `Composer.test.jsx:57-69` (which already tests exactly this contract for the composer).

**Step 3: Run it, verify it fails.**

**Step 4: Implement.** Add the `configure({ context: { app: 'piano-kiosk', sessionLog: true } })` call at mount. Use `piano-kiosk`, **not** `piano` — `piano` is taken by `PianoVisualizer` and reusing it would interleave two unrelated surfaces in one file. Add a comment saying so.

**Step 5: Verify** the test passes and the Piano suite is green.

**Step 6: Confirm the shape reaches disk.** State in your report which log events will now be persisted that were not before (expect: all `piano.*`, all `playback.*` from the kiosk, `perf.diagnostics`).

**Step 7: Commit** — `feat(piano): give the kiosk a durable log`

---

## Task 0.2: Retention that means what it says

**The finding:** `maxAgeDays: 3` (`backend/index.js:122`), and `pruneOldFiles` runs **only inside `initSessionFileTransport`** (`sessionFile.mjs:29`) — at boot. Retention is really "3 days as of the last container restart". Measured cost of all `.jsonl` on prod today: 68 MB.

**Files:**
- Modify: `backend/src/0_system/logging/transports/sessionFile.mjs`
- Modify: `backend/index.js`
- Modify: `backend/src/0_system/logging/transports/sessionFile.test.mjs` (or the isolated test at `tests/isolated/assembly/infrastructure/logging/sessionFile.test.mjs` — use whichever already covers pruning)

**Step 1: Write the failing test** — that pruning runs on a schedule, not only at init. Use fake timers; assert a file older than `maxAgeDays` is removed after the interval elapses without re-calling `init`.

**Step 2: Run it, verify it fails.**

**Step 3: Implement** a daily prune timer inside the transport, cleared by `resetSessionFileTransport`. Use `unref()` so it never holds the process open.

**Step 4: Raise retention** to `maxAgeDays: 14` at `backend/index.js:122`. Note the disk estimate in the commit body (68 MB for the current mix ⇒ roughly 300 MB at 14 days).

**Step 5: Verify** tests pass.

**Step 6: Commit** — `fix(logging): prune on a timer, not once at boot`

---

## Task 0.3: A durable general sink in Docker

**The finding:** `backend/index.js:98` guards `createFileTransport` behind `if (!isDocker)`, and Loggly is unconfigured in prod (verified: no token in the container env). So in production the dispatcher's only general transport is stdout — the log Docker later truncated.

**Files:**
- Modify: `backend/index.js`

**Step 1:** Remove the `!isDocker` guard so the file transport is always registered, pointing at `join(mediaDir, 'logs', 'backend.log')`.

**Step 2:** Confirm `file.mjs` already does size rotation and re-opens through the new inode (it does — see the comment at `file.mjs:47-73`). Set an explicit `maxSize` and `maxFiles` rather than relying on defaults; state the chosen values and the resulting ceiling in your report.

**Step 3:** Verify locally that the file appears and rotates. Do not deploy.

**Step 4: Commit** — `fix(logging): give production a durable general sink`

---

## Task 0.4: Count every silent drop

**The finding:** four places discard events with no counter. During a storm, the drop *is* the signal.

| Site | Drop | Today |
|---|---|---|
| `sessionFile.mjs:60` | untagged event | silent |
| `index.js:194` | WS ring full — discards the **oldest**, i.e. the start of the incident | silent |
| `errorHandlers.js:78-80` | >3 fetch failures per 2s window | silent |
| `dispatcher.mjs:80-89` | below level | counted into `metrics.dropped`, which `getMetrics()` exposes and **zero callers read** |

**Files:**
- Modify: `backend/src/0_system/logging/transports/sessionFile.mjs`
- Modify: `frontend/src/lib/logging/index.js`
- Modify: `frontend/src/lib/logging/errorHandlers.js`
- Modify: whichever health/status route is the right home for dispatcher metrics (find it; `4_api/v1/routers/api.mjs` has a status route)
- Tests alongside each

**Step 1-4 per site, TDD:**

- **sessionFile:** count skips per app; expose via the transport's status. Emit a **once-per-process** warn naming the first app that gets dropped — that one line would have made Task 0.1 obvious months ago.
- **WS ring:** on overflow, increment a counter and inject a synthetic `logging.transport.overflow` event carrying the drop count, so the gap is visible *in the stream itself*.
- **errorHandlers:** keep suppressing the bodies, but emit one `errors.suppressed` roll-up per window with the count and the representative message.
- **dispatcher metrics:** expose `getMetrics()` on the status route. It already exists; it just needs a reader.

**Step 5: Commit** — `feat(logging): count what we throw away`

---

# TIER 1 — Instrument the dark junctions

## Task 1.1: Log every media-element generation

**The finding — the single cheapest instrument for this failure.** `usePlaybackHealth.js:225-229` is the one place in the codebase that observes a `<video>` swap:

```js
if (el !== attachedElRef.current) {
  attachedElRef.current = el;
  advanceSampleRef.current = null;
  setElementGeneration((gen) => gen + 1);
}
```

It logs nothing. `elementGeneration` is private state used only as an effect dep. This poll already runs on every player at 400ms; it would have counted ~300 swaps directly.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/usePlaybackHealth.js`
- Modify/create the colocated test

**Step 1: Write the failing test** — swapping the element emits one event carrying at least `{ generation, mediaKey, waitKey, elTag, elSource, msSincePreviousSwap }`.

**Step 2: Run, verify it fails.**

**Step 3: Implement.** Rate-limit it with `logger.sampled(..., { maxPerMinute: 30, aggregate: true })` — in a storm the aggregate count is the diagnosis and must not itself be drowned.

`elSource` matters: see Task 4.1. If that task has not landed, emit `elTag` (the tagName) at minimum, so a `<dash-video>` wrapper is distinguishable from a real `<video>`.

**Step 4: Verify. Step 5: Commit** — `feat(player): log every media element generation`

---

## Task 1.2: Count stream-URL mints on both sides

**The finding:** 495 successful mints produced zero log lines. Frontend `lib/api.js:68-69` logs only failure; backend `proxy.mjs:262-280` is 19 lines with zero log calls.

**Files:**
- Modify: `frontend/src/modules/Player/lib/api.js`
- Modify: `backend/src/4_api/v1/routers/proxy.mjs`
- Tests alongside

**Step 1 (frontend):** add a module-monotonic `requestSeq` and log success with `{ contentId, session, requestSeq, msSinceLastRequest, resume }`. Copy the shape of `playback.stream-url-refreshed` (`VideoPlayer.jsx:339-344`) — the only observable mint in the codebase today, and it has matching `-failed`/`-skipped` variants so absence is unambiguous. Do the same here.

**Step 2 (backend):** at `proxy.mjs:270`, add

```js
logger.sampled('plex.stream.mint', { ratingKey, startOffset, session }, { maxPerMinute: 20 });
```

`logger.sampled` already exists (`logger.mjs:93-126`) with aggregation and is used **zero times in the backend**. This one call would have printed the entire diagnosis:

```
plex.stream.mint.aggregated {sampledCount: 20, skippedCount: 475, aggregated: {ratingKey: {"694719": 495}}}
```

**Step 3:** Verify by driving a local playback and grepping for both events.

**Step 4: Commit** — `feat(player,api): make transcode mints countable`

---

## Task 1.3: Log the key changes that cause remounts

**The finding:** the remount path that actually fired — a React `key` change — emits nothing, at three sites: `Player.jsx:574-581` (`singlePlayerKey`), `VideoPlayer.jsx:766` (composite `<dash-video>` key), `useCommonMediaController.js:437` (`setElementKey`, whose only record is a `console.log` behind `const DEBUG_MEDIA = false`).

**Files:**
- Modify: `frontend/src/modules/Player/Player.jsx`
- Modify: `frontend/src/modules/Player/renderers/VideoPlayer.jsx`
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js`

**Step 1:** Emit on change with `{ from, to, changedComponent }` where `changedComponent` names **which input moved** — `guid` / `mediaUrl` / `bitrate` / `elementKey`. A composite key diff without that field tells you nothing about why.

**Step 2:** Delete the `DEBUG_MEDIA` raw `console.log` at `useCommonMediaController.js:447` and replace it with a real log event. It violates the project logging rule and is unreachable.

**Step 3:** Rate-limit all three.

**Step 4: Commit** — `feat(player): say which input re-keyed the player`

---

## Task 1.4: Global HTTP request logging that survives redirects and pipes

**The finding:** no global request logging exists. `requestLogger.mjs` is mounted on one router (`nutribot.mjs:41`) — and would have missed this anyway, because it hooks `res.json` (`requestLogger.mjs:41`) while the hot paths end in `res.redirect` (`proxy.mjs:279`) and `proxyRes.pipe` (`ProxyService.mjs:207`).

**Files:**
- Modify: `backend/src/0_system/http/middleware/requestLogger.mjs`
- Modify: `backend/src/app.mjs`
- Tests alongside

**Step 1: Write the failing test** — a route ending in `res.redirect` and one ending in a pipe both produce an `http.response` log line.

**Step 2: Implement** by hooking `res.on('finish')` instead of wrapping `res.json`. Capture `{ method, path, status, durationMs, userAgent, deviceId }`.

**Step 3: Mount it globally** on `/api/v1` in `app.mjs`. **Sample it** — this is every request in the system; use `maxPerMinute` generously but not unbounded, and never log request bodies.

**Step 4: Also mount `tracingMiddleware` globally** (currently `nutribot.mjs:40` only), so `errorHandler.mjs:101`'s `req.traceId || 'unknown'` stops always taking the fallback.

**Step 5: Commit** — `feat(api): log every request, including redirects and proxies`

---

# TIER 2 — Make identity join up

## Task 2.1: Thread the session id frontend → backend → Plex

**The finding:** the frontend already mints `plexClientSession` (`Player.jsx:1136`) and puts it on the wire as `?session=` (`lib/api.js:55`). **`req.query.session` is never read anywhere in the backend.** So `PlexAdapter._generateSessionIds(null)` takes its fallback branch (`:1376-1385`) and mints a fresh random per request — which is what Plex logged. Consequence: **Plex saw 495 distinct clients, not one client retrying.**

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs`
- Modify: `backend/src/3_applications/.../PlayResponseService.mjs`
- Modify: `backend/src/1_adapters/content/media/plex/PlexAdapter.mjs`
- Modify: `backend/src/4_api/v1/routers/proxy.mjs`
- Modify: `frontend/src/modules/Player/lib/playbackLogger.js`
- Tests alongside

**Step 1:** Read `req.query.session` in the play route and thread it into the returned `mediaUrl` as a query param (the `<video>`/dash element cannot send custom headers, so a param is required — note this in a comment).

**Step 2:** Read it at `proxy.mjs:270` into `getMediaUrl(ratingKey, { startOffset, session })`.

**Step 3:** Return the resulting `sessionIdentifier` in the play response and push it into `setPlaybackLoggerContext` (`playbackLogger.js:431`), so every subsequent frontend playback line carries the same key Plex logs.

**Step 4: Delete the dead duplicate.** `_generateSessionIds` is **defined twice on the same class** (`PlexAdapter.mjs:901` and `:1374`); the later silently wins. Remove the dead one — it is the exact function this incident turns on.

**Step 5: Verify** by playing something locally and confirming the same identifier appears in a frontend log line, a backend log line, and the Plex request URL.

**Step 6: Commit** — `feat(plex): one session id across frontend, backend and Plex`

---

## Task 2.2: Per-device identity in backend logs

**The finding:** `trust proxy` is never set, so `req.ip` is the docker peer — every client is `172.18.0.53`. Backend log context is `{source, app, host}` where `host` is the *server*. Frontend events get `ip`/`userAgent` injected at ingestion (`ingestion.mjs:156-157`); backend requests get nothing. *This conflated the garage fitness kiosk with the piano tablet during the investigation.*

**Files:**
- Modify: `frontend/src/lib/api.mjs`
- Modify: `backend/src/app.mjs` (a middleware beside `householdResolver`)
- Modify: `backend/src/0_system/http/middleware/requestLogger.mjs`

**Step 1:** Send `X-Daylight-Device` from `frontend/src/lib/api.mjs:24-30` (it currently sends only `Content-Type` + `Authorization`).

**Step 2:** Stamp `req.deviceId` in a middleware mounted alongside `householdResolver.mjs:16`, and set `trust proxy`.

**Step 3:** Include `deviceId` in the request logger's context, and fall back to `req.headers['user-agent']` when the header is absent — UA alone already separates Shield WebView / tablet Chromium / garage Firefox with zero frontend work.

**Step 4:** Note in your report that `<video>`/dash segment fetches cannot carry the header and rely on Task 2.1's query param instead.

**Step 5: Commit** — `feat(api): know which device is calling`

---

# TIER 3 — Notice, and tell a human

## Task 3.1: Publish playback progress in the device heartbeat

**The finding:** `useSessionStatePublisher.js:13` already publishes `state` and `position` every 5s. `usePlaybackHealth` already computes `lastProgressAt` and `isAdvancing` (`:425`, `:437`) — but that never leaves the component tree.

**Files:**
- Modify: `frontend/src/screen-framework/publishers/SessionSource.js` (the snapshot at `:160-167`)
- Modify: `frontend/src/modules/Player/hooks/usePlaybackHealth.js` if the value needs exposing
- Tests alongside

Add `lastProgressAt` and `isAdvancing` to the published snapshot. Commit — `feat(fleet): publish playback progress, not just position`

---

## Task 3.2: Detect "stuck" backend-side

**The finding:** every detector asks *is it alive?* or *is it smooth?* Nothing asks *is it making progress?* The APK watchdog returned HEALTHY for 17 minutes at 37.4 fps. `DeviceLivenessService.mjs:27` only checks beat arrival.

**Files:**
- Modify: `backend/src/.../DeviceLivenessService.mjs`
- Tests alongside

**Step 1: Write the failing test** — a device reporting `state === 'playing'` with an unchanged `position` across 60s of heartbeats is classified unhealthy; one that is paused, or advancing, or idle, is not.

**Step 2: Implement.** Roughly 10 lines. Be careful with the legitimate cases: paused, buffering a long seek, a live stream, and a device that just started.

**Step 3: Commit** — `feat(fleet): a player that never advances is not healthy`

---

## Task 3.3: Make the alert deliverable, then send it

**The finding:** the only automated device alert (`app.mjs:4142-4180`, scoped to two ESP relays) sends `category:'system'` with **no `metadata.username`**, and `TelegramNotificationAdapter.mjs:40-43` returns `{delivered:false}` without a chat id. The alert designed for exactly this class of problem cannot be delivered.

**Files:**
- Modify: `backend/src/.../NotificationService.mjs` or the Telegram adapter
- Modify: wherever Task 3.2's detector lives
- Tests alongside

**Step 1: Write the failing test** — a `category:'system'` intent with no `metadata.username` still resolves a recipient.

**Step 2: Implement** by defaulting to the head of household for system-category notifications.

**Step 3: Wire Task 3.2's detector** to it. `DEFAULT_PREFERENCES.system.high` (`notifications.mjs:29`) was written for this case — *"something the house depends on has stopped and nobody would otherwise notice"* — and needs a caller, not a redesign.

**Step 4: Verify** an end-to-end delivery to a test recipient. **Do not send to real household recipients during testing.**

**Step 5: Commit** — `fix(notifications): a system alert with no recipient is not an alert`

---

## Task 3.4: Let the kiosk file its own report

**The finding — the highest-leverage item in the plan.** Feedback capture produced the only complete durable record of this incident, and it is **audio-optional**: `hasAudio = !!(audioBuffer && audioBuffer.length)` (`FeedbackService.mjs:51`), with everything downstream null-safe. New apps self-register (`create()` does a recursive mkdir; `_allApps()` discovers by readdir).

So a machine-generated report can use the exact same pipeline **with zero backend changes**: same POST, same YAML, same 150-event ring buffer, `audio: null`, `context: { reason: 'stall-detector' }`.

**Files:**
- Create: `frontend/src/modules/Feedback/autoReport.js`
- Modify: the error boundary, the watchdog, and Task 3.2's client-side counterpart to call it
- Tests alongside

**Step 1: Write the failing test** — `autoReport({ app, reason, detail })` POSTs a feedback submission with `audio: null` and `logs.recent` populated from `getRecentEvents(150)`.

**Step 2: Implement** as a thin wrapper over the existing `submitFeedback` (`feedbackApi.js`).

**Step 3: Add triggers** — error-boundary crash, watchdog self-heal, and a sustained playback stall. **De-duplicate aggressively**: one report per incident, not one per tick. A storm that files 495 reports is a second incident.

**Step 4: Commit** — `feat(feedback): let a broken kiosk file its own report`

---

## Task 3.5: Someone has to read the inbox

**The finding:** the feedback API is complete (list/get/audio/PATCH/DELETE) and its only consumer is `curl` from a skill. Arrival triggers nothing beyond `logger.info('feedback.created')`.

Add a notification on arrival, routed through Task 3.3's now-deliverable path. Auto-reports (Task 3.4) and human reports should be distinguishable in the notification.

Commit — `feat(feedback): notify on arrival`

---

# TIER 4 — Stop rendering defaults as measurements

## Task 4.1: `getMediaEl` must say what it returned

**The finding:** `useCommonMediaController.js:214-223` silently returns the **container** when `container.shadowRoot` is absent — i.e. the `<dash-video>` wrapper, whose `readyState` is not a number. That is one of three causes producing an identical `r=n/a` (`PlayerOverlayLoading.jsx:316`), and nothing records which.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js`
- Modify: `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx`
- Tests alongside

Add a sibling accessor returning `{ el, source: 'shadow' | 'container' }`, and log `elTag`/`elSource` alongside every `readyState`. Keep `getMediaEl`'s existing signature so callers are unaffected.

Commit — `fix(player): record which element we measured`

---

## Task 4.2: Delete the fabricated overlay fields

**The finding:** four fields render defaults that read as data.

- `startupWatchdogState` is not in `overlayProps` and no caller sets it — **every startup log ever written reads `startup:armed attempts=0 timeout=n/a`** (`PlayerOverlayLoading.jsx:318-320`).
- `countdownSeconds` is never passed (`:310-313`).
- `hasElement: true` is a hardcoded literal (`useMediaResilience.js:747-748`), and the overlay branches on it.
- `sessionInstance` is never passed, so the structured payload at `:343-362` — built once per second — is discarded and the fallback string ships. This is why `playback.stall_threshold_exceeded` always reported `playheadPosition: null, videoFps: null, lastGoodPosition: null`.

**For each: either wire it or delete it. Do not leave a third option.** Prefer wiring `hasElement` (a real check) and `sessionInstance` (the payload is already built); prefer deleting `startupWatchdogState` and `countdownSeconds` unless a caller genuinely has the data.

Add a test asserting the summary contains no field whose value is a hardcoded default.

Commit — `fix(player): stop reporting defaults as measurements`

**Follow-up done (2026-08-16, `a90fa15d6`).** Two remaining unwired props were
checked. `sessionInstance` needed nothing — it was already removed and the
structured payload now ships through `playbackLog` with the readable line as a
`summary` field. `getMediaEl` / `showDebugDiagnostics` gated a 1Hz
`buildMediaDiagnostics` poll that was **deleted, not wired**: its output went
into a `detailedDiagnostics` state that no JSX rendered and no log carried, the
on-screen strip it fed is gone from the markup, and its readings duplicate
`usePlaybackHealth`. Left orphaned by that deletion, and worth a later sweep:
`lib/mediaDiagnostics.js` (no consumers) and `.loading-debug-strip` in
`Player.scss` (no markup). `PlayerOverlayStateDebug.jsx:43` also returns `false`
unconditionally — the whole on-screen debug surface is off.

---

## Task 4.3: One encoding for `waitKey`

**The finding:** `Player.jsx:512` logs it raw (`IIni70e01E:0`); `useMediaResilience.js:242` and `usePlaybackHealth.js:125` log an FNV-1a hash (`008c56a342`). Same field name, incompatible values. The hash is one-way, so a line cannot be mapped back to an item, and the `:N` ordinal — the field that would have made a nonce climb self-evident — is destroyed. `waitKeyLabel.js:16-18` also collapses `null`, `undefined` and `''` to one identity.

Pick one encoding. Recommendation: log **both**, as distinct fields (`waitKey` raw, `waitKeyHash` for correlation), and make the empty case distinguishable from a real key.

Commit — `fix(player): one waitKey, one meaning`

**DONE (2026-08-16, `fc59314a7`).** Both encodings ship as distinct fields —
`waitKey` raw, `waitKeyHash` for correlation — from Player.jsx,
useMediaResilience, usePlaybackHealth and PlayerOverlayLoading. The three
absences that collapsed onto `0000000000` are now `(absent)` and `(empty)`.
Gotcha found on the way: `getLogWaitKey` is not only a log label — Player.jsx's
`ensureEntryGuid` uses it to MINT entry guids, so the digest for a non-empty
input had to stay byte-identical (it did; verified against the old
implementation, not copied from the new one).

---

## Task 4.4: `player-remount` must mean a remount happened

**The finding:** `Player.jsx:740-751` emits that event name on the path that deliberately **skips** the remount (`source: 'hard-reset-accepted'`), nested under `payload` while the real emitter at `:511` is flat. Counting the event yields a number that means neither thing.

Rename the non-remount case (e.g. `player-remount-skipped`) and flatten it to match. Commit — `fix(player): name the event after what happened`

---

## Task 4.5: Disambiguate dash event absence

**The finding — this actively misdirected the investigation.** `VideoPlayer.jsx:476-483` polls 100ms for `el.api`, then subscribes. Anything that fired before then is lost, so **absence of `dash.manifest-loaded` proves nothing**. The poll is also unbounded with no "api never appeared" emission, so a never-initialized dash.js and a raced subscription look identical.

At subscribe time, read and log current state — `api.isReady()`, `api.getActiveStream()?.getId()`, `api.time()`, `api.duration()`, `api.getSource()` — and stamp `msFromMountToApiReady`. Add a timeout that emits `dash.api-never-ready`. The precedent is already in-repo: `usePlaybackHealth.js:341-351` seeds from current state before relying on events.

Also raise `dash.error-recovery-budget-denied` (`VideoPlayer.jsx:623`) from `debug` to `warn` — at production level, a dash-error storm that has exhausted its budget is currently silent.

Commit — `fix(player): make dash event absence interpretable`

---

## Task 4.6: Instrument the dash cleanup

**The finding:** `dashCleanup.js` has four bare `catch (_) {}` and two silent early returns — including `:25`, where a failed shadow-DOM lookup means `removeAttribute('src')` and `load()` never run and the `<video>` keeps pulling. The file's own docstring names the scenario.

Log one outcome event with `{ hadApi, apiDestroyOk, componentDestroyOk, foundMediaEl, srcScheme, error }` plus `cleanupsAttempted`/`cleanupsFailed` counters. **A rising failure rate here is the leak.**

> The stale-`el` capture at `VideoPlayer.jsx:409-412` is fixed by Task 4 of the remount-storm plan. Confirm that landed before starting; if not, coordinate rather than fixing it twice.

Commit — `feat(player): report whether cleanup actually cleaned`

---

## Task 4.7: Emit on recovery-ledger teardown

**The finding:** `recoveryLedger.js:117` (`sessions.delete`), `:112` (`userReset`) and `:104-107` (`recordSuccess` zeroing) are all silent. `snapshot()` requires you to already know the key and omits `mounts`; there is no `dumpAll()`. So `resilience-recovery attempt=1` repeated forever, and "the cap keeps resetting" was indistinguishable from "the cap was never reached."

Add a pre-delete snapshot `{ sessionKey, count, urlRefreshCount, mounts.size, ageMs, releasedBy }`, a module-level monotonic `sessionsCreated` that survives release, and a `dumpAll()`. **That counter is the transcode-session count.**

Commit — `feat(player): make the retry ledger auditable`

---

## Task 4.8: Count high-cardinality identity churn

**The finding:** 480 distinct `waitKey` values in 3 minutes was the clearest tell and nothing counted it.

Add a distinct-value counter on `waitKey`/`guid` per media item with a threshold warn (e.g. >10 distinct per item per minute). Note also that `utils/mediaIdentity.js:9` falls through to `meta.mediaUrl` as identity, so a `refreshUrl` recovery can **change an item's identity mid-recovery**, breaking correlation across the very operation it was performing — flag this in your report; fixing it may belong with the remount-storm plan's Task 2.

Commit — `feat(player): flag identity churn before it becomes a storm`

**DONE (2026-08-16, `9b796dfb5`).** `lib/identityChurn.js`, wired from an effect
in Player.jsx, warns `playback.identity-churn` at >10 distinct values per minute
— once per episode, not once per value. The bucket is the **Player instance**,
not the media item: per-guid buckets would have counted nothing here, since the
guid was itself what churned. The `refreshUrl` identity change noted above IS
counted, but cannot reach the threshold alone (the ledger caps a session at 5
attempts with 4s/12s/36s backoff); `samples.guid` is what tells the two apart.
`utils/mediaIdentity.js:9` is still unfixed — it belongs with the remount-storm
plan's Task 2.

---

# Verification

The unit tests prove each change in isolation. The plan is only done when the following hold against the real kiosk, after Tier 0–1 are deployed:

1. `media/logs/piano-kiosk/*.jsonl` exists and contains a lecture playback with `piano.video.open`, element-generation events, and `plex.stream.mint` counts.
2. A deliberately induced stall (block the Plex host at the firewall mid-playback) produces: a `plex.stream.mint.aggregated` line, a stall detection, a delivered notification, and an auto-filed feedback report with a populated 150-event ring.
3. Grep the same window in the Plex server log and confirm the session identifier in our log **matches** the one Plex recorded.
4. Restart the container and confirm the evidence is still on disk.

Item 4 is the one that failed on 2026-08-16.

---

## Out of scope, filed here so it is not lost

- `normalizeDuration` (`utils/mediaIdentity.js:43`) mis-scales any duration over 16m40s expressed in seconds via a `n > 1000 ? n/1000` heuristic. Used only by `FitnessPlayer.jsx:1473` and `FitnessMusicPlayer.jsx:315` — **a live hazard for Fitness**, not a contributor to this incident.
- `useEndOfContentWatchdog` rebinds on `sourceKey`, not element generation (`:75-88`), so after an `elementKey` swap with unchanged `mediaUrl` its listeners stay bound to the dead element — and `VideoPlayer.jsx:210-212` says it is the ONLY thing that advances the queue for zero-byte Plex tails.
- `registry.js:48` returning `null` for an unrecognized format makes `SinglePlayer.jsx:264-266` treat the item as a collection and issue **a second `fetchMediaInfo`**, silently doubling stream requests.
- `relayWatchdog`'s `seen` map starts empty (`relayWatchdog.mjs:16`), so a source already dead at server start is never alerted on.
- Kiosk surfaces with no health telemetry at all: garage fitness Firefox, Portal tablet, playback-hub, eink-panel. Portal's documented single point of failure (display off → WiFi drops → FKB, pkctl and ADB all die) has no detector.
