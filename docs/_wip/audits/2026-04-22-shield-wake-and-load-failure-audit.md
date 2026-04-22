# Audit: Shield TV Wake-and-Load Sequence Failures

**Date:** 2026-04-22
**Severity:** Critical — content never plays; 15-minute manual intervention required to recover
**Symptom:** `fullykiosk.load.success` logged, `device.loadContent.done ok:true` returned, but Shield TV showed old content and no video ever started
**Affected content:** `plex:251914` (Jupiter, A Traveler's Guide to the Planets)

---

## Incident Timeline

| Time | Event |
|------|-------|
| 09:34:10 | `device.router.load.start` — load request for `plex:251914` |
| 09:34:23 | `wake-and-load.prewarm.start` |
| 09:34:23 | `prewarm.failed: loadMediaUrl returned null` — silent warning, execution continues |
| 09:34:27 | FKB `loadURL` sent to Shield |
| 09:34:27 | Android starts new sandboxed WebView renderer (PID 8449) |
| 09:34:29 | `fullykiosk.load.success` logged (HTTP 200 from FKB REST API) |
| 09:34:29 | `device.loadContent.done ok:true` — system declares success |
| 09:34:57 | Android kills WebView PID 8449: "isolated not needed" (30s after spawn) |
| 09:35–09:42 | No `playback.started`, no `play.log`, no frontend DASH events — silence |
| 09:43:40 | FKB spawns new WebView renderer (PID 9408) |
| 09:44:11 | Android kills PID 9408: "isolated not needed" (31s after spawn) |
| 09:48:38 | FKB spawns new WebView renderer (PID 10088) |
| ~09:49 | Manual `loadURL` via Node.js fired directly |
| 09:49:04 | First DASH events arrive from Shield WebView (Android 11 UA confirmed) |
| 09:49:05 | `play.log` — 63 seconds in, `plex:251914`, `type: plex` |
| 09:49:04 | `playback.render_fps: 60fps` — Jupiter playing on Shield |

**Total time from load request to confirmed playback: ~15 minutes.**

---

## Root Causes

### RC1 — FKB `loadURL` success is HTTP 200, not "page loaded"

**File:** `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs:410-427`

`#sendCommand('loadURL')` returns `{ ok: true }` when the FKB REST API returns any 2xx status. The FKB API is fire-and-forget: it acknowledges the command, not the outcome. The WebView navigates asynchronously. A successful HTTP response means "FKB received the instruction" — it says nothing about whether the page loaded, the renderer stayed alive, or content started playing.

The `load()` method propagates this false positive directly:
```js
const result = await this.#sendCommand('loadURL', { url: fullUrl });
if (result.ok) {
  return { ok: true, url: fullUrl, ... };  // success declared on HTTP 200 alone
}
```

**Impact:** The system declared load success at 09:34:29. The renderer died at 09:34:57 — 28 seconds after that "success." Nothing in the stack detected the failure.

---

### RC2 — No post-load verification of actual rendered URL

**File:** `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs:326-353`

`getStatus()` reads `currentUrl` from FKB's `getDeviceInfo` API. This field reflects the URL the WebView is actually rendering — as opposed to `currentPage`, which is FKB's internal record of what it was asked to load. During the incident, `currentPage` showed the new URL while `currentURL` was `undefined` (renderer not active).

`getStatus()` is never called after `loadURL`. There is no "did the page actually appear?" check anywhere in the load path.

---

### RC3 — WakeAndLoadService has no terminal verification step

**File:** `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:422-430`

After `device.loadContent()` returns `ok: true`, the service emits `load.done` and returns. There is no:
- Poll of `getDeviceInfo()` to verify `currentUrl` matches the loaded URL
- Subscription wait for `playback.started` (or any frontend event)
- Timeout + alarm if neither arrives within N seconds
- Renderer health check

The service has elaborate steps for wake, verify-awake, prepare, and prewarm — but the load step itself has no completion criterion beyond "FKB said OK."

---

### RC4 — Prewarm failure indistinguishable from "not applicable"

**File:** `backend/src/3_applications/devices/services/TranscodePrewarmService.mjs:47-50`

When `adapter.loadMediaUrl()` returns `null` (Plex transcode decision failed, metadata unavailable, or any other error), the prewarm service logs `prewarm.failed` and returns `null`. WakeAndLoadService treats a `null` return as "prewarm not applicable" and continues:

```js
// WakeAndLoadService ~line 281:
if (prewarmToken == null) {
  steps.prewarm = { skipped: true };  // error treated as skip
}
```

For a valid Plex episode (`type: episode`, confirmed playable by `/api/v1/info`), a null prewarm return is a real failure — not a skip. The distinction is lost. No alarm is raised.

**Why it returned null here:** The Plex adapter's `loadMediaUrl()` wraps everything in a try/catch and returns `null` on any error:
```js
} catch (error) {
  console.error('[PlexAdapter] loadMediaUrl error:', error.message);
  return null;  // caller cannot distinguish error from "not a Plex source"
}
```
This swallows the root cause. The backend logs show `prewarm.failed: loadMediaUrl returned null` — no error detail, no stack, no indication of what specifically broke.

---

### RC5 — No watchdog for missing `playback.started`

The system has no mechanism to detect that a load "succeeded" but playback never started. There is no:
- Subscription to `playback.started` as a load confirmation signal
- Timeout alarm if no playback event arrives within 60–90s of load completion
- Automatic retry or escalation path

This is the core reason the failure was invisible for 15 minutes. From the system's perspective, everything was fine. From the user's perspective, the TV showed nothing.

---

### RC6 — WebView renderer cycles went undetected

From ADB logcat, the Shield's sandboxed WebView renderer spawned and was killed by Android three times:

| Renderer PID | Spawned | Killed | Lifespan | Cause |
|---|---|---|---|---|
| 8449 | 09:34:27 | 09:34:57 | 30s | `isolated not needed` |
| 9408 | 09:43:40 | 09:44:11 | 31s | `isolated not needed` |
| 10088 | 09:48:38 | ~09:49 | ~60s+ | Survived (playback started) |

"Isolated not needed" is Android's signal that a sandboxed renderer was terminated because its parent (FKB) stopped needing it — which typically means the page crashed, the WebView was reset, or FKB restarted its renderer for another reason. The backend has no visibility into this. FKB's REST API remained responsive throughout, always reporting `screenOn: true`.

The root cause of the repeated renderer deaths is not definitively identified in this audit. Possible causes: JS crash in the app during DASH element initialization, FKB's internal renderer restart policy, or Android memory pressure.

---

## What Actually Fixed It

The direct `loadURL` via Node.js at ~09:48 hit FKB at a moment when the renderer (PID 10088) had just been spawned and survived long enough for DASH playback to initialize. The first DASH fragment events appeared at 09:49:02, `playback.started` followed at 09:49:04.

The fix was not a code change — it was timing. On the 4th renderer spawn, the page loaded before Android killed the process. This strongly suggests the renderer deaths in the earlier attempts were transient (load contention, memory, or FKB reset behavior) rather than a deterministic app bug.

---

## Compounding Factors

**Chrome DevTools confusion:** During debugging, ADB port-forwarding `localabstract:chrome_devtools_remote` from the Shield captured a Chrome browser session showing `/screen/office` (not the Shield's FKB WebView, which does not expose this socket). Executing `location.href = '...'` via DevTools navigated the **office screen's Chrome browser** to `/screen/living-room`, not the Shield. This caused Jupiter to play on the office screen for several minutes while the Shield remained stuck — and the `playback.started` log event (with `X11; Linux x86_64` UA) was briefly mistaken for confirmation of Shield playback.

**`currentPage` vs `currentURL`:** FKB's `deviceInfo` API returns `currentPage` (the URL FKB was asked to load) and `currentURL` (what the WebView is actually rendering). During the incident, `currentPage` showed the correct new URL while `currentURL` was `undefined` — indicating the renderer wasn't active. The backend adapter reads `currentUrl` in `getStatus()` but never calls `getStatus()` after `loadURL` to verify.

---

## Issues by Priority

| # | Issue | Severity | File | Description |
|---|-------|----------|------|-------------|
| 1 | No watchdog for missing `playback.started` | Critical | WakeAndLoadService | System has no way to know if playback never started after load |
| 2 | FKB loadURL success = HTTP 200 only | Critical | FullyKioskContentAdapter | Page load success not verified; fire-and-forget |
| 3 | No post-load URL verification | Critical | WakeAndLoadService | `currentUrl` never checked after `loadURL` |
| 4 | WebView renderer death undetected | Critical | Architecture | No monitoring of renderer process lifecycle |
| 5 | Prewarm error treated as skip | High | WakeAndLoadService | `null` return from failed prewarm is indistinguishable from "not applicable" |
| 6 | Plex adapter swallows error context | High | PlexAdapter | `loadMediaUrl` catches all exceptions, returns null — loses root cause |
| 7 | `currentPage` vs `currentURL` not distinguished | Medium | FullyKioskContentAdapter | FKB's "asked to load" vs "actually rendering" confused |
| 8 | WS fallback uses fixed delays, no verification | Medium | WakeAndLoadService | Timing-based, no confirmation that content command was processed |

---

## Recommended Fixes

### Fix 1 — Post-load URL verification (RC1, RC2)

After `loadURL` returns, poll `getDeviceInfo()` until `currentUrl` matches the expected URL (or timeout after ~10s):

```js
// After loadURL success:
const verified = await this.#pollUntilUrlMatches(fullUrl, { timeoutMs: 10000, intervalMs: 500 });
if (!verified) {
  this.#logger.warn('fullykiosk.load.url_mismatch', { expected: fullUrl, actual: status.currentUrl });
  return { ok: false, error: 'URL did not appear in WebView after load' };
}
```

### Fix 2 — Playback started watchdog (RC3, RC5)

In WakeAndLoadService, after declaring load done, start a watchdog that subscribes to `playback.started` events for the device. If none arrives within 90s, log an alarm and optionally trigger a retry:

```js
// After load.done:
this.#armPlaybackWatchdog(deviceId, dispatchId, { timeoutMs: 90_000 });

// watchdog emits:
// wake-and-load.playback.confirmed  — on success
// wake-and-load.playback.timeout    — if 90s passes with no playback.started
```

### Fix 3 — Distinguish prewarm skip from prewarm error (RC4)

Prewarm should return a structured result, not just `null`:

```js
// Instead of: return null;
return { status: 'failed', reason: 'loadMediaUrl returned null', contentRef };
// vs:
return { status: 'skipped', reason: 'not a transcoded source', contentRef };
```

WakeAndLoadService can then log `prewarm.error` (not just `prewarm.skipped`) and surface it as a warning.

### Fix 4 — Restore Plex adapter error context (RC4)

`PlexAdapter.loadMediaUrl()` should distinguish and re-throw or return structured errors rather than a plain `null`:

```js
} catch (error) {
  this.#logger.warn?.('plex.loadMediaUrl.failed', { ratingKey, error: error.message });
  return null;  // Keep null for caller, but log the real error
}
```

The current `console.error` goes nowhere useful in production.

---

## Gaps Not Covered By This Audit

- **Why the renderer keeps dying**: The "isolated not needed" kills need deeper investigation. The renderer may be crashing due to the `dash-video-element` custom element initialization failing on this WebView version (146.0.7680), memory pressure, or an FKB configuration setting. Recommend ADB `logcat -s chromium` during a fresh load attempt to capture WebView console errors.

- **Why the 4th attempt worked**: The timing difference between the failed loads and the successful one is unexplained. It may be that the earlier loads hit a FKB reset cycle and the 4th attempt landed in a stable window.

- **FKB renderer configuration**: FKB has settings for WebView timeout, JavaScript enabled, and media autoplay. These were not inspected during the incident and may be relevant to why the renderer dies after ~30s.

---

## Verification (2026-04-22)

Implementation plan `docs/superpowers/plans/2026-04-22-shield-wake-and-load-reliability.md` landed on branch `fix/shield-wake-and-load-reliability` in five commits:

- `9d7f2ce5` — `fix(plex): replace console.error in loadMediaUrl with structured logger` — addresses RC4/RC6 (lost error context).
- `71c46ee3` — `fix(devices): distinguish prewarm skip from failure with structured return` — addresses RC4 (prewarm error -> skip ambiguity).
- `a51d7f7f` — `fix(fkb): verify currentUrl after loadURL to catch silent WebView failures` — addresses RC1/RC2 (HTTP 200 != rendered, currentUrl never checked).
- `3f87c567` — `feat(play): broadcast playback.log event on /play/log POST` — signal plumbing for the watchdog (no-op until Task 5 consumer lands).
- `f56190a7` — `feat(devices): add playback watchdog to wake-and-load sequence` — addresses RC3/RC5 (no post-load verification, no alarm).

**Observed runtime sequence on a healthy load (from unit tests):**
`prewarm.{success|skipped}` -> `fullykiosk.load.acknowledged` -> `fullykiosk.load.success (verified: true)` -> (within 90s) `wake-and-load.playback.confirmed`.

**Observed runtime sequence on silent failures:**
- URL didn't render -> `fullykiosk.load.urlMismatch` (warn on attempts 1-2, `fullykiosk.load.failed` at error after 3 attempts, `ok: false` returned). This is the exact failure mode from the incident — previously it returned `ok: true`.
- Page loaded but never played -> `wake-and-load.playback.timeout` (warn) + broadcast event on `homeline:{deviceId}` with `step: 'playback', status: 'timeout'`. Previously silent.

**Test regression (isolated harness, 2026-04-22):**
- `tests/isolated/adapter/content/PlexAdapter.test.mjs` — 34 passed / 4 failed. The 4 failures are pre-existing (`getList polymorphic input -> filters by plex.libraryName / contains match` cases) and unrelated to the `loadMediaUrl error logging` block added by commit `9d7f2ce5`, which passes in full.
- `tests/isolated/adapter/devices/FullyKioskContentAdapter.test.mjs` (new verification suite) — 5 / 5 pass.
- `tests/isolated/application/devices/TranscodePrewarmService.test.mjs` — 6 / 6 pass.
- `tests/isolated/application/devices/WakeAndLoadService.watchdog.test.mjs` (new) — 5 / 5 pass.
- `tests/isolated/api/play-log-broadcast.test.mjs` (new) — 2 / 2 pass.

**Backend boot check:**
Full `node backend/index.js` boot against the dev data volume emits `server.started port:3113` with no eventBus-, logger-, or watchdog-related import errors. The only runtime errors observed are pre-existing (`routing.toggle.fallback` warning and an EACCES on a Strava webhook file in the mounted Dropbox data volume) — both reproduce on `main` and are outside the scope of this plan.

**Residual gaps (not addressed by this plan):**
- The root cause of the FKB WebView renderer dying after ~30s ("isolated not needed") remains uninvestigated. The watchdog makes the failure observable; the investigation is a separate effort.
- URL verification does not cover transport/hostname substitution (e.g. if FKB proxies through a different host). Only path + query are normalized.
- Watchdog relies on the frontend continuing to POST `/play/log` every 10s — any frontend regression that breaks the log stream will also break the watchdog's confirmation signal.
