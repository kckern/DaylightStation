# Wake-and-Load WS Fast-Path Permanently Disabled — Audit

**Date:** 2026-04-25
**Severity:** High (every NFC trigger pays an unnecessary 5–10 s penalty + disruptive UX flash)
**Status:** Root cause confirmed; one-line config fix proposed
**Production evidence:** dispatchId `043f577b-40db-450e-b927-2a77b4fd4c5b`, NFC tag `8d_6d_2a_07`, `livingroom-tv`, content `plex:620707` (The Three Little Pigs)

---

## 1. Executive Summary

The `wake-and-load` orchestrator has **two delivery paths** for content commands sent to an already-running screen:

1. **WS fast path** — broadcast a `command` envelope on `homeline:<deviceId>`, wait up to 4000 ms for a `device-ack` reply from the screen, then exit. Content swaps in place. No reload. Latency target: <100 ms.
2. **FKB URL fallback** — call FullyKioskBrowser's REST `loadURL` with a fresh URL `https://daylightlocal.kckern.net/screen/living-room?play=plex%3A620707`. The Shield WebView discards its in-memory state, reloads `/screen/living-room`, re-mounts the menu, parses `?play=…`, and only then plays. Latency: 5–10 s plus a visible menu flash before playback.

The fast path **was never activated in production**. The frontend ack publisher (`useCommandAckPublisher`) is gated by `websocket.publishState: true` in the screen YAML, and **no screen YAML sets that flag.** As a result, the backend's `waitForMessage` predicate never matches, the 4000 ms timeout always fires, and we always fall through to the URL reload.

The full page refresh + menu flash + content delay the user observed is the **default behavior on every trigger to every screen**, not an edge case.

**Fix:** add `publishState: true` to `data/household/screens/living-room.yml` and `office.yml` (one line each, plus container restart). The plumbing is already shipped — it's a config-only flip.

---

## 2. The User Observation

> "First there was some sort of response that probably came to the WebSocket, then it did a full page refresh, then it opened the menu, then it opened the content. That seems like a lot of unnecessary steps when it could have just hit it from the WebSocket from the beginning. The full page refresh really shouldn't happen if we already have a screen open and a WebSocket connected. The full page refresh is kind of a secondary fallback in case the quick WebSocket-based content loading function is not working."

The user's mental model is exactly right. The architecture matches what they described, but the "primary path" they expected has been silently disabled.

---

## 3. Production Trigger Sequence

All times in UTC. Backend logs publish without the `Z` suffix and are local time (UTC-7); they have been normalised below. dispatchId `043f577b-40db-450e-b927-2a77b4fd4c5b`.

| # | Time (UTC) | Source | Event | Notes |
|---|------------|--------|-------|-------|
| 1 | 22:49:44.744 | backend | `wake-and-load.power.start` | NFC tap → trigger module → wake-and-load (no `trigger.received` log; sequence implicit) |
| 2 | 22:49:44.744 | backend | `device.ha.powerOn` | HA `script.living_room_tv_on` |
| 3 | 22:49:44.750 | backend | `device.ha.powerOn.verified` | +6 ms (TV already on) |
| 4 | 22:49:44.751 | backend | `wake-and-load.volume.done` | level 15 |
| 5 | 22:49:44.755 | backend | `wake-and-load.prepare.start` | — |
| 6 | 22:49:52.436 | backend | `wake-and-load.prepare.done` | **+7681 ms** (preparing kiosk — the largest single cost) |
| 7 | 22:49:52.436 | backend | `wake-and-load.load.start` | `query={play:"plex:620707"}` |
| 8 | 22:49:52.436 | backend | `wake-and-load.load.ws-check` | **`subscriberCount: 2` — fast path is viable** |
| 9 | 22:49:52.436 | backend | `eventbus.broadcast` | `topic=homeline:livingroom-tv`, `command=queue`, `commandId=043f577b…`, `params={op:"play-now", contentId:"plex:620707"}` |
| 10 | 22:49:52.161 | frontend | `commands.queue` | **Frontend received the envelope** (`useScreenCommands` → `bus.emit('media:queue-op', …)`); minor clock skew explains negative delta |
| — | — | frontend | **(no `ack-sent` log; ack publisher not mounted)** | This is the failure point |
| 11 | 22:49:56.438 | backend | `wake-and-load.load.ws-failed` | `error: "waitForMessage timed out after 4000ms"` |
| 12 | 22:49:56.439 | backend | `device.loadContent.start` | Fallback engaged |
| 13 | 22:49:56.439 | backend | `fullykiosk.load.builtUrl` | `https://daylightlocal.kckern.net/screen/living-room?play=plex%3A620707` |
| 14 | 22:49:56.955 | backend | `fullykiosk.load.acknowledged` | FKB REST returned 200 in 516 ms |
| 15 | 22:49:57.438 | frontend | `screen-autoplay.parsed` | New page loaded; `ScreenAutoplay` parsing `?play=…` |
| 16 | 22:49:57.745 | backend | `list.response` | TVApp watchlist (the menu is loading first) |
| 17 | 22:49:59.913 | backend | `queue.resolve` | `plex:620707` resolved, 1 track, 579 s |
| 18 | 22:49:59.907 | frontend | `playback.started` | "The Three Little Pigs" begins **15.2 s after NFC tap** |
| 19 | 22:50:07.024 | backend | `fullykiosk.load.unverified` ⚠️ | `currentUrl never populated` after 10.5 s — non-fatal but an open instrumentation bug |
| 20 | 22:50:07.025 | backend | `wake-and-load.complete` | `totalElapsedMs: 22282` |
| 21 | 22:50:07.025 | backend | `trigger.fired` | The only "trigger" log; emitted **at the end of dispatch**, not on receipt |

### What the user sees on screen

```
NFC tap → screen briefly stays on menu (4 s)
       → menu jumps/refreshes (page reload)
       → menu re-renders (≈1 s)
       → content overlay appears (≈3 s later)
       → playback begins
```

Total visible latency: ~15 seconds.

### What the user *should* see, with fast path working

```
NFC tap → 7.7 s prepare (unchanged — separate concern)
       → ~50 ms WS round-trip
       → content overlay appears in place over the menu
       → playback begins
```

Total visible latency: ~8 seconds (~half), with no menu flash.

---

## 4. Architecture Overview

### 4.1 Wake-and-load orchestration (the six steps)

`backend/src/3_applications/devices/services/WakeAndLoadService.mjs` (lines 33–632) sequences:

1. **power** — HA script + binary_sensor verify (line ~150)
2. **verify** — skipped when power_on_verified
3. **volume** — `setVolume` via HA media_player
4. **prepare** — currently the long pole; ~7.7 s in this trace
5. **prewarm** — content metadata pre-fetch
6. **load** — the step where the fast path vs fallback decision happens (lines 326–523)

Each step broadcasts `wake-progress` on `homeline:<deviceId>` so any UI overlay can render progress.

### 4.2 The fast-path decision (lines 384–443)

```javascript
// WakeAndLoadService.mjs:384
const warmPrepare = !coldWake && hasContentQuery && !!this.#eventBus;
const subscriberCount = warmPrepare
  ? this.#eventBus.getTopicSubscriberCount(topic)
  : 0;
let wsDelivered = false;

if (warmPrepare) {
  this.#logger.info?.('wake-and-load.load.ws-check',
    { deviceId, dispatchId, topic, subscriberCount });

  if (subscriberCount > 0) {
    try {
      const envelope = buildCommandEnvelope({
        targetDevice: deviceId,
        command: 'queue',
        commandId: dispatchId,
        params: { ...opts, op: 'play-now', contentId: resolvedContentId },
      });
      this.#broadcast({ topic, ...envelope });

      // line 422
      await this.#eventBus.waitForMessage(
        (msg) =>
          msg?.topic === 'device-ack' &&
          msg?.deviceId === deviceId &&
          msg?.commandId === dispatchId,
        4000
      );

      this.#logger.info?.('wake-and-load.load.ws-ack',
        { deviceId, dispatchId, ackMs });
      wsDelivered = true;
    } catch (err) {
      this.#logger.warn?.('wake-and-load.load.ws-failed',
        { deviceId, dispatchId, error: err.message });
      // Falls through to FKB loadURL
    }
  }
}

// FKB fallback (lines 445–523)
if (!wsDelivered) {
  const loadResult = await device.loadContent(screenPath, contentQuery);
  // …
}
```

The predicate is exact: `topic === 'device-ack'` AND `deviceId === deviceId` AND `commandId === dispatchId`. Any of three things going wrong on the frontend results in the timeout.

### 4.3 The ack contract (frontend side)

Three layers must all be wired for the ack to fire:

**Layer A — `useScreenCommands`** (`frontend/src/screen-framework/commands/useScreenCommands.js:103-107`)
Receives the `command` envelope on the WebSocket subscription, validates, and re-emits on the in-process ActionBus:

```javascript
if (command === 'queue') {
  logger().info('commands.queue', { commandId, params });
  bus.emit('media:queue-op', { ...params, commandId });
  return;
}
```

This is what produced the `commands.queue` log we saw at 22:49:52.161. **This layer worked.**

**Layer B — `useCommandAckPublisher`** (`frontend/src/screen-framework/publishers/useCommandAckPublisher.js:52-136`)
Subscribes to nine ActionBus events including `media:queue-op`, dedupes per `commandId` with a 60 s window, and publishes a `device-ack` message via `wsService.send()`:

```javascript
const ack = buildCommandAck({
  deviceId: deviceIdRef.current,
  commandId,
  ok: true,
  // …
});
wsService.send(ack);
logger().debug('ack-sent', { commandId, ok: true });
```

This is what *should* produce an `ack-sent` log followed by a backend `ws-ack`. **This layer never ran.**

**Layer C — `SessionPublishers` mount gate** (`frontend/src/screen-framework/ScreenRenderer.jsx:149-155`)

```javascript
function ScreenSessionPublishers({ wsConfig }) {
  const bus = useMemo(() => getActionBus(), []);
  if (wsConfig?.publishState !== true) return null;   // ← the gate
  const deviceId = wsConfig?.guardrails?.device;
  if (!deviceId) return null;
  return <SessionPublishers deviceId={deviceId} actionBus={bus} />;
}
```

Renders nothing — and therefore Layer B never mounts — unless the screen YAML opts in with `publishState: true`. **No screen YAML opts in.**

### 4.4 The ack message and its routing

`buildCommandAck` (`shared/contracts/media/envelopes.mjs:205-223`):

```javascript
return {
  topic: 'device-ack',
  deviceId,
  commandId,
  ok,
  appliedAt: appliedAt ?? nowIso(),
  // optional: error, code
};
```

`waitForMessage` (`backend/src/0_system/eventbus/WebSocketEventBus.mjs:861-881`) registers a global `#messageHandlers` callback that the WebSocket server calls for every inbound client frame. The predicate runs in O(1); any frame whose JSON matches resolves the promise.

This routing is correct and battle-tested. The bug is one layer up: the ack is never produced.

---

## 5. Root Cause

### 5.1 The smoking gun

Production `data/household/screens/living-room.yml`:

```yaml
screen: living-room
route: /screen/living-room
input:
  type: remote
  keyboard_id: tvremote

websocket:
  commands: true               # ← receives commands ✓
  guardrails:
    device: livingroom-tv
                               # ← publishState: true is MISSING
# … rest of file …
```

`data/household/screens/office.yml` has the identical shape and the identical gap.

A grep for `publishState` across the entire DaylightStation tree returns **three matches, all in `ScreenRenderer.jsx`**. No YAML, no documentation, no other JS file references it. The flag was introduced in commit `961063a35` ("feat(screen-framework): opt-in state+ack publishers for media screens", Apr 17 2026) but the configuration that activates it was never written.

### 5.2 Verification by absence

Production logs around the dispatch contain:

- `commands.queue` from frontend (Layer A fired) ✓
- **No `mounted` log from `useCommandAckPublisher`** (Layer B never mounted) ✗
- **No `ack-sent` log** (Layer B never ran) ✗
- **No `device-ack` topic in `eventbus.broadcast`** ✗
- `wake-and-load.load.ws-failed` after exactly 4000 ms ✗

The shape of the failure is consistent with Layer C dropping the publisher.

### 5.3 Why the failure has been invisible

- `wake-and-load.load.ws-failed` is logged at `warn` level, not `error`. It silently degrades.
- The FKB fallback succeeds (eventually), so triggers do work — just slowly and ugly.
- There is no metric tracking ack-rate or ws-fast-path-success-rate.
- The `fullykiosk.load.unverified` warning at step #19 is treated as benign.
- No alerting on `ws-failed` rate or `wake-and-load.complete.totalElapsedMs`.

The fast path has likely been broken since `961063a35` was deployed (Apr 17 2026, eight days before this incident).

---

## 6. Code References

| Concern | File | Lines |
|---|---|---|
| Fast-path decision + timeout | `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | 384–443 |
| FKB URL fallback | `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | 445–523 |
| `waitForMessage` impl | `backend/src/0_system/eventbus/WebSocketEventBus.mjs` | 861–881 |
| Topic factories | `shared/contracts/media/topics.mjs` | full file |
| CommandEnvelope shape | `shared/contracts/media/envelopes.mjs` | 36–59 |
| CommandAck shape | `shared/contracts/media/envelopes.mjs` | 205–223 |
| Layer A: command receiver | `frontend/src/screen-framework/commands/useScreenCommands.js` | 36–181 (esp. 103–107) |
| Layer B: ack publisher | `frontend/src/screen-framework/publishers/useCommandAckPublisher.js` | 52–136 |
| Layer C: mount gate | `frontend/src/screen-framework/ScreenRenderer.jsx` | 149–155 |
| Wrapper | `frontend/src/screen-framework/publishers/SessionPublishers.jsx` | full file |
| Living-room config (the fix site) | `data/household/screens/living-room.yml` | `websocket:` block |
| Office config (the fix site) | `data/household/screens/office.yml` | `websocket:` block |
| Plan that introduced the flag | `docs/plans/2026-04-17-media-foundation.md` | line 885 |

---

## 7. Impact Assessment

### Per-trigger cost (current)

- 4000 ms wasted on the doomed `waitForMessage`
- ~500 ms of FKB REST round-trip
- ~3000 ms for the new page to load + parse + mount
- Visible UX disruption: menu flashes between current state and fresh state
- Any in-progress overlay/state is destroyed (overlay subscriptions, debouncers, timers)
- `ScreenAutoplay`'s 500 ms safety delay (`ScreenRenderer.jsx`)

**Net penalty: ~7–8 s of avoidable latency, plus a UX glitch, on every NFC tap, every Home Assistant push, every voice command — anywhere a wake-and-load dispatch happens to a warm screen with content.**

### Scope

Both production screens are affected: `livingroom-tv` and `office-tv`. Every modality (NFC, REST API, scheduled triggers) goes through the same `wake-and-load.load` step. The bug is universal, not modality-specific.

### Side effects

- Subscriber state on the page is wiped every trigger, contributing to the `fullykiosk.load.unverified` warnings (step #19) — FKB never sees a stable `currentUrl` because the page reload races its own verification.
- The `ws-fallback` recovery path (`WakeAndLoadService.mjs:466-513`) — which adds *additional* artificial 3 s + 2 s waits before sending a follow-up WS command — is dead code in normal operation, since the FKB load succeeds. It would only trigger if the FKB REST API itself failed.

---

## 8. Recommendations

### 8.1 Primary fix — activate the fast path (one-line change × 2)

Add `publishState: true` to both screen configs:

`data/household/screens/living-room.yml`:
```yaml
websocket:
  commands: true
  publishState: true            # NEW
  guardrails:
    device: livingroom-tv
```

`data/household/screens/office.yml`:
```yaml
websocket:
  commands: true
  publishState: true            # NEW
  guardrails:
    device: office-tv
```

**Validation steps after deploy:**

1. SSH to homeserver, restart container: `docker restart daylight-station`.
2. Open browser console on a screen, set `window.DAYLIGHT_LOG_LEVEL = 'debug'`.
3. Look for the `[useCommandAckPublisher] mounted { deviceId: "livingroom-tv" }` debug log on screen mount.
4. Trigger a known plex item via NFC.
5. Confirm logs show: `wake-and-load.load.ws-check (subscriberCount: 2)` → `eventbus.broadcast (homeline:…)` → `commands.queue` → `ack-sent` → `wake-and-load.load.ws-ack (ackMs: <100)` and **NOT** `ws-failed`.
6. Confirm the screen does not visually flash; the existing menu remains until the Player overlay mounts on top.

### 8.2 Secondary — make the fast path fail loudly when broken

The fast path being silently disabled is the real failure. Add observability so the next regression is caught immediately:

1. **Promote `wake-and-load.load.ws-failed` to `error` level when `subscriberCount > 0`.** Subscribers but no ack = a real bug. Subscribers but ack-timeout from a slow client is the recoverable case.
2. **Add a frontend warn log when `useScreenCommands` receives a command but `useCommandAckPublisher` is not mounted.** This is detectable: the ActionBus event `media:queue-op` will fire with no listener for `device-ack`. Wire a sentinel that logs `wsConfig.publishState` at mount and warns if commands arrive without it.
3. **Track `wake-and-load.complete.totalElapsedMs` p50/p95** and alert when p50 exceeds ~9 s for a warm-prepare path. Healthy fast-path completes in ~8.5 s (still bottlenecked by the 7.7 s `prepare` step — see §8.5).
4. **Add a `wake-and-load.load.method` counter** with values `websocket`, `websocket-fallback`, `fkb`, `fkb-with-ws-recovery`. Anything but `websocket` on a warm screen is a regression.

### 8.3 Reconsider the gate's default

`publishState` defaults to **false**. The plan doc framed this as "opt-in state+ack publishers for media screens" — but `commands: true` is already opt-in. Once a screen opts in to receive commands, it should always be expected to ack them. Two possibilities:

- **(Preferred)** Drop the `publishState` gate entirely. If `websocket.commands === true` and `guardrails.device` is set, mount `useCommandAckPublisher`. The state-publisher (`useSessionStatePublisher`) is the heavier piece; if a separate gate is wanted, gate that one alone with `publishState`.
- **(Conservative)** Default `publishState` to `true` if `commands: true && guardrails.device`. Allow YAML to override to `false` only for screens that explicitly need the legacy URL-reload behavior.

Either way, the failure mode "commands enabled, acks disabled" should not be expressible.

### 8.4 Tighten the timeout (optional)

4000 ms is generous for a localhost WebSocket round-trip. After the fast path is healthy and we have ackMs telemetry, consider lowering to 1500 ms. Faster fallback when the screen really is dead. Defer this to a follow-up after step 8.1 is verified in prod.

### 8.5 Out of scope: the 7.7 s `prepare` step

The `wake-and-load.prepare` step (line 6 in §3) takes 7.7 s on every dispatch even though the TV was already on and FKB was already running. This is the single largest contributor to total latency, larger than the fast-path failure itself. It is a separate audit — file `2026-04-25-wake-and-load-prepare-step-latency-audit.md` if/when investigated. Mentioning here only so it's not forgotten while attention is on the load step.

### 8.6 Frontend hardening (defense in depth)

Even with the publisher mounted, the ack flow has a few subtle holes worth closing in a follow-up:

- `useCommandAckPublisher.js:74-100` swallows `wsService.send()` failures silently when the WS is queueing. If the message queue is overflowing or the WS is reconnecting, an ack might never reach the backend. Surface this to a `warn` log.
- The 60 s dedupe window keys on `commandId` only. Two unrelated dispatches that happen to share a UUID (impossibly unlikely, but) would have the second dropped. Acceptable.
- `useScreenCommands` accepts envelopes with a wildcard subscription filter (`ACCEPT_ENVELOPES` is a function predicate, which forces wildcard mode in `WebSocketService._syncSubscriptions`). Verify that the wildcard subscription is actually being established — if a screen accidentally subscribes only to specific topics, the `command` envelope (which carries `topic: 'homeline:<deviceId>'`) may not reach `useScreenCommands` at all. The current 2-subscriber count suggests this is fine, but worth confirming with debug logging post-fix.

---

## 9. Open Questions / Follow-ups

1. **Why 2 subscribers on `homeline:livingroom-tv`?** The frontend logs show clients subscribing to `*` (wildcard) — the wildcard count likely inflates `getTopicSubscriberCount`. This is benign for the ack predicate (it filters by topic regardless), but worth confirming `getTopicSubscriberCount` does not over-count and gate the fast path on phantom subscribers in some other future scenario.

2. **Does the office screen behave identically?** Office should have the same bug. Worth a single trigger replay against `office-tv` to confirm the same `ws-failed` pattern, and re-check after the fix.

3. **Is `trigger.received` worth adding?** The trigger pipeline emits `trigger.fired` only at the end of dispatch (22 s later). Adding a `trigger.received` log at the entry point would close the observability gap and make latency budgets easier to attribute (NFC-receive vs power-on vs prepare vs load).

4. **`fullykiosk.load.unverified` `currentUrl never populated`** — does this resolve once the page-reload fallback stops happening? The hypothesis is that the page reload races FKB's `currentUrl` polling; with the WS path active the URL never changes, so FKB's check should pass. Verify post-fix.

5. **Plan §2.3 follow-up.** `docs/plans/2026-04-17-media-foundation.md` line 885 references upgrading `useSessionStatePublisher` from a fallback idle source to a live player source. Independent of this audit, but lives in the same file.

---

## 10. Conclusion

The architecture is correctly designed. The frontend, backend, eventbus, contracts, and timeout logic all do exactly what they should. **One config flag (`websocket.publishState: true`) was missed in two YAML files when the publisher was introduced eight days ago.**

The fix is two lines plus a container restart. The longer-term value is in §8.2 — instrumenting this so the next time someone introduces an "opt-in" gate, we notice within hours instead of days that nothing opted in.
