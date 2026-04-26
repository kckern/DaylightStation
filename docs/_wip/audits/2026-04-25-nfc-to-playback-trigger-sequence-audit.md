---
date: 2026-04-25
scope: backend/src/2_domains/trigger + 3_applications/trigger + WakeAndLoadService
source: prod logs, container `daylight-station` on `homeserver.local`
dispatchId: 6de18739-0029-4338-90f2-649c903294bf
---

# NFC → Playback Trigger Sequence Audit

End-to-end trace of the most recent NFC-driven trigger seen in prod logs:
**tag `8d_6d_2a_07` → location `livingroom` → device `livingroom-tv` →
content `plex:620707` ("The Three Little Pigs", Disney Read-Along)**.

Total elapsed (HTTP request → `trigger.fired`): **27.609 s**. Playback
actually started at **~23.5 s** in (first `play.log.request_received` at
19:32:32.417, halfway through the doomed FKB-load verification window).

---

## 1. Config in play

`/usr/src/app/data/household/config/nfc.yml` (live in container):

```yaml
livingroom:
  target: livingroom-tv
  action: play              # default for tags
  tags:
    83_8e_68_06:
      plex: 620707
    8d_6d_2a_07:
      plex: 620707
  states:
    off:
      action: clear
```

Per `TriggerConfig.parseTriggerConfig`, this becomes:

```js
{
  livingroom: {
    target: 'livingroom-tv',
    action: 'play',
    auth_token: null,
    entries: {
      nfc:   { '8d_6d_2a_07': { plex: 620707 }, '83_8e_68_06': { plex: 620707 } },
      state: { off: { action: 'clear' } },
    },
  },
}
```

The `8d_6d_2a_07` entry has **no explicit `content`/`action`/`target`** — it
relies entirely on:
- the location-default `action: play` (TriggerIntent.mjs:30),
- the location-default `target: livingroom-tv` (TriggerIntent.mjs:31),
- the **single-content-prefix shorthand** in `expandShorthand` which
  takes the lone non-reserved key `plex` and a value `620707`, joins them
  to `plex:620707`, and asks `contentIdResolver.resolve()` to validate it
  (TriggerIntent.mjs:17–24).

Resolved intent:

```js
{
  action: 'play',
  target: 'livingroom-tv',
  content: 'plex:620707',
  params: {},   // `plex` was consumed by shorthand
  dispatchId: '6de18739-0029-4338-90f2-649c903294bf',
}
```

---

## 2. Code path traversed

```
HTTP GET /api/v1/trigger/livingroom/nfc/8d_6d_2a_07
   └── trigger.mjs:22  router.get('/:location/:type/:value')
        └── TriggerDispatchService.handleTrigger('livingroom', 'nfc', '8d_6d_2a_07')
             ├── normalizeValue → '8d_6d_2a_07'
             ├── locationConfig lookup ✓
             ├── auth_token: null → skip auth check
             ├── valueEntry lookup ✓ (registered:true)
             ├── resolveIntent(...) → intent above
             └── dispatchAction(intent, deps)
                  └── actionHandlers.play(intent, { wakeAndLoadService })
                       └── wakeAndLoadService.execute(
                             'livingroom-tv',
                             { play: 'plex:620707' },        ← buildLoadQuery
                             { dispatchId: <intent.dispatchId> }
                           )
                            └── WakeAndLoadService.#executeInner (steps below)
        └── #emit() broadcasts trigger.fired on `trigger:livingroom:nfc`
```

`actionHandlers.play` (actionHandlers.mjs:32–37) maps `intent.content` to
the `play` query key, producing `{ play: 'plex:620707' }`. The dispatchId
from the intent is forwarded so every downstream `wake-and-load.*` event
correlates with the final `trigger.fired` log line.

---

## 3. Step-by-step prod timeline (dispatchId 6de18739-…)

| Wall clock (PDT) | Δ start | Event | Notes |
|------------------|--------:|-------|-------|
| 19:32:08.885 | 0 ms | (router enters `handleTrigger`) | inferred — `trigger.fired.elapsedMs` minus 27 609 |
| 19:32:08.888 | +3 | `wake-and-load.power.start` | livingroom-tv |
| 19:32:08.888 | +3 | `device.ha.powerOn` | script `script.living_room_tv_on`, sensor `binary_sensor.living_room_tv_power`, maxAttempts=2 |
| 19:32:13.411 | +4 526 | `device.ha.powerOn.verified` | attempt 1, elapsed **4 523 ms** |
| 19:32:13.412 | +4 527 | `wake-and-load.power.done` | `verified:true` |
| 19:32:13.412 | +4 527 | `wake-and-load.verify.skipped` | reason `power_on_verified` |
| 19:32:13.413 | +4 528 | `wake-and-load.volume.start` | level 15 (default) |
| 19:32:13.413 | +4 528 | `device.ha.setVolume` | livingroom-tv → 15 |
| 19:32:13.418 | +4 533 | `wake-and-load.volume.done` | ok, 5 ms |
| 19:32:13.418 | +4 533 | `wake-and-load.prepare.start` | FKB / Shield TV prep begins |
| 19:32:16.835 | +7 950 | `fullykiosk.prepareForContent.foregroundConfirmed` | attempt 1, **3 416 ms** to confirm FKB is foreground |
| 19:32:17.315 | +8 430 | `fullykiosk.prepareForContent.companionApp` | `net.kckern.audiobridge` ok |
| 19:32:17.378 | +8 493 | `fullykiosk.prepareForContent.micClear` | mic free, **3 959 ms** total for mic check |
| 19:32:17.453 | +8 568 | `fullykiosk.prepareForContent.cameraCheck.failed` | attempt 1 / 3 |
| 19:32:19.491 | +10 606 | `fullykiosk.prepareForContent.cameraCheck.failed` | attempt 2 / 3 |
| 19:32:21.530 | +12 645 | `fullykiosk.prepareForContent.cameraCheck.failed` | attempt 3 / 3 — **~4.1 s wasted** |
| 19:32:21.531 | +12 646 | `wake-and-load.prepare.done` | (camera failure NOT propagated as fatal — `prepResult.ok` was true) |
| 19:32:21.531 | +12 646 | `wake-and-load.load.start` | query `{ play: 'plex:620707' }` |
| 19:32:21.532 | +12 647 | `wake-and-load.load.ws-check` | topic `homeline:livingroom-tv`, **subscriberCount: 4** → WS-first attempted |
| 19:32:21.495 | +12 610 | `commands.queue` (frontend, Mac/Chrome) | Frontend received the play-now envelope |
| 19:32:21.496 | +12 611 | `commands.queue` (frontend, Mac/Chrome #2) | duplicate subscriber received |
| 19:32:20.619 | +11 734 | `commands.queue` (frontend, Shield TV) | clock skew, but Shield received it too |
| 19:32:25.534 | +16 649 | `wake-and-load.load.ws-failed` | **`waitForMessage timed out after 4000 ms`** — no `device-ack` arrived |
| 19:32:25.534 | +16 649 | `device.loadContent.start` | FKB URL fallback |
| 19:32:25.535 | +16 650 | `fullykiosk.load.start` | `https://daylightlocal.kckern.net/screen/living-room?play=plex%3A620707` → kiosk `10.0.0.195:2323` |
| 19:32:25.535 | +16 650 | `fullykiosk.load.builtUrl` | (URL above) |
| 19:32:26.055 | +17 170 | `fullykiosk.load.acknowledged` | attempt 1, 520 ms — FKB accepted the URL |
| 19:32:32.417 | +23 532 | `play.log.request_received` | **playback begins** — `plex:620707`, seconds=10.5, percent=1.8 |
| 19:32:32.448 | +23 563 | `play.log.updated` | first ledger write |
| 19:32:36.493 | +27 608 | `fullykiosk.load.unverified` | `currentUrl never populated`, 10 958 ms — FKB poll never confirmed nav |
| 19:32:36.493 | +27 608 | `device.loadContent.done` | (still ok:true — see §5) |
| 19:32:36.494 | +27 609 | `wake-and-load.complete` | `totalElapsedMs:27 607` |
| 19:32:36.494 | +27 609 | **`trigger.fired`** | `ok:true`, `elapsedMs:27 609` |
| 19:32:36.494 | +27 609 | `eventbus.broadcast` | topic `trigger:livingroom:nfc`, sentCount=4 |

---

## 4. Cumulative time budget

| Phase | Time | Useful? |
|-------|-----:|---------|
| Power-on (HA script + sensor verify) | **4.5 s** | yes |
| Verify (skipped — power_on already verified) | 0 s | yes |
| Volume set | 5 ms | yes |
| Prepare: FKB foreground confirm | 3.4 s | yes |
| Prepare: companion app + mic check | 0.5 s | yes |
| Prepare: **camera check (3 retries)** | **~4.1 s** | **wasted — failure ignored** |
| Load: **WS-first ack timeout** | **4.0 s** | **wasted — frontend received but didn't ack** |
| Load: FKB URL build + acknowledge | 0.5 s | yes |
| Load: **FKB currentUrl verification timeout** | **~10.4 s** | **wasted — playback already started 6.4 s in** |
| **Total** | **~27.6 s** | ~14 s of that is timeouts/retries |

Of 27.6 s, roughly **18 s is pure overhead** from doomed verification
paths. Playback was actually visible at **~23.5 s** — the remaining
~4 s was the load-verification timeout finishing its work after the
video was already playing.

---

## 5. Findings (severity-ordered)

### F1. WS-first fast path silently broken — and it actively *steamrolls* the working WS playback (CRITICAL)

**Root cause confirmed (gating bug).** WS-first delivery worked end-to-end on the screen:

| Frontend ts (UTC) | Source | Event | Evidence |
|------|--------|-------|------|
| 02:32:20.619Z | Shield TV | `commands.queue` | `op: play-now`, `contentId: plex:620707`, `commandId: 6de18739…` received by `ScreenCommands` |
| 02:32:21.477Z | Shield TV | `playback.start-time-decision` | media-controller decided start time |
| 02:32:21.491Z | Shield TV | `playback.seek` (seeking → 0) | seeking |
| 02:32:21.535Z | Shield TV | `playback.seek` (seeked → 0.007) | seek complete |
| 02:32:21.542Z | Shield TV | **`playback.started`** | audio playing, currentTime 0.0146 |
| 02:32:21.669Z | Shield TV | **`playback.cover-loaded`** | **cover artwork on screen** |
| (no `ack-sent` log appears anywhere from `CommandAckPublisher`) | — | — | **no ack ever sent back** |

So within ~50 ms of the WS envelope arriving, the Shield was already
playing audio with the cover art rendered — exactly the "full-screen
view with only the cover image" the user reported.

**Why no ack:** in `frontend/src/screen-framework/ScreenRenderer.jsx:149-154`,
`<ScreenSessionPublishers>` is gated on `wsConfig.publishState === true`.
The live `data/household/screens/living-room.yml` declares only:

```yaml
websocket:
  commands: true              # ← gates useScreenCommands (it works)
  guardrails:
    device: livingroom-tv
# (no publishState: true)     # ← gates SessionPublishers (skipped!)
```

So `<SessionPublishers>` returns null, `useCommandAckPublisher` is
**never mounted**, and there is no listener to call `wsService.send(buildCommandAck(...))`
when `media:queue-op` is dispatched on the ActionBus. The
`useScreenCommands` → `bus.emit('media:queue-op', { ...params, commandId })`
call (useScreenCommands.js:103-106) lands on a bus with no ack subscriber.

Backend's `eventBus.waitForMessage(msg => msg.topic === 'device-ack' && …)`
times out at 4 s and `device.loadContent(…)` fires.

**The steamroll** (timestamps relative to dispatch start):

| Δ | Event | Effect |
|--:|-------|--------|
| +12.6 s | WS envelope sent → Shield receives it ~immediately | Cover image + audio start within ~50–250 ms |
| +16.6 s | Backend gives up on ack → `device.loadContent.start` | — |
| +17.2 s | `fullykiosk.load.acknowledged` (520 ms) | **WebView navigates to `/screen/living-room?play=plex:620707`, killing the running player** |
| +20.4 s | Shield: new `playback.start-time-decision` (re-mount) | player re-initializes from scratch |
| +21.5 s | Shield: second `playback.started` | second startup |
| +43.7 s | Mac mirror: `playback.player-remount` (`startup-deadline-exceeded`) | resilience kicks in chasing the chaos |
| +60–73 s | Two more `player-remount` cycles | — |

Net cost: **+4 s ack timeout** plus **a hard page reload that re-starts
playback from scratch** plus **multiple resilience remounts** — every
NFC trigger that hits a warm FKB pays this.

**Fix:** decouple the ack publisher from the `publishState` gate. The
two concerns are different — `commands: true` means "this screen
receives commands and must ack them" (otherwise backend WS-first is
broken). `publishState: true` means "publish my live session state for
hand-off" (optional). The minimal patch:

```jsx
// ScreenRenderer.jsx
function ScreenSessionPublishers({ wsConfig }) {
  const bus = useBus();
  const deviceId = wsConfig?.guardrails?.device;
  if (!deviceId) return null;

  // Ack publisher mounts whenever this screen accepts commands.
  // State publisher only mounts when explicitly enabled.
  const ackOnly = wsConfig?.commands === true && wsConfig?.publishState !== true;
  if (ackOnly) {
    return <CommandAckOnly deviceId={deviceId} actionBus={bus} />;
  }
  if (wsConfig?.publishState === true) {
    return <SessionPublishers deviceId={deviceId} actionBus={bus} />;
  }
  return null;
}
```

Or — simpler — split `SessionPublishers` so the ack publisher is always
mounted when `commands: true`, regardless of `publishState`. Either way,
the YAML doesn't need to change once the wiring is fixed.

This matches and resolves the prior audit
[`2026-04-25-wake-and-load-ws-fast-path-disabled-audit.md`](2026-04-25-wake-and-load-ws-fast-path-disabled-audit.md).

### F2. `cameraCheck.failed` x3 ignored, `prepare.done` reported success (MEDIUM)

Three failed attempts over ~4 s, then `wake-and-load.prepare.done` fires
with no warning surfaced upstream. Either the camera retries are
unnecessary for an audio-only or video-with-no-camera flow (Three Little
Pigs is Plex VOD, no camera needed), or the failure should fail-fast.
Right now the cost is paid every time and the result is discarded.

Recommendation: skip `cameraCheck` when the resolved content has no
camera capability requirement, OR drop retry count to 1 for non-call
paths. Camera retries are only meaningful when prepping for videocall
content; for `play=plex:*` they're dead weight.

### F3. FKB `currentUrl` verification timeout outlives the actual load (MEDIUM)

`fullykiosk.load.acknowledged` fires at +17.2 s (520 ms after request),
playback starts at +23.5 s, but `fullykiosk.load.unverified` doesn't
return until +27.6 s — and only then does `wake-and-load.complete` fire
and the user-facing `trigger.fired` ack get emitted. The verification
window is a `~11 s` poll for `currentUrl` to populate; on Shield TV with
FKB it routinely never does.

Two options:
1. Reduce the verification timeout to ~3 s — the URL ack at 520 ms is
   already a strong signal; if the FKB content adapter can detect a
   playback.log event for the loaded contentId in the meantime, treat
   that as "verified" and short-circuit.
2. Decouple `trigger.fired` from `wake-and-load.complete` — fire the
   trigger ack on `fullykiosk.load.acknowledged` and let verification
   continue async. The phone UI / NFC source doesn't care that
   `currentUrl` is populated.

### F4. End-to-end NFC latency feels slow (MEDIUM)

User taps a tag → ~23 s before video plays. Even with F1/F2/F3 fixed,
the unavoidable budget is power-on (4.5 s) + prepare (~4 s, mostly FKB
foreground) + URL load (~0.5 s) ≈ **9 s**. With current bugs, it's
27 s. F1 alone would shave ~4 s; F3 reframes the perceived completion
even if the actual playback start time stays the same.

### F5. Menu flashes before player on action-URL initial load (MEDIUM, UX)

When the screen-framework boots from a URL that already declares an
action — `/screen/living-room?play=plex:620707`, `?queue=…`, `?open=…` —
the screen renders its default layout (the menu widget) first. Only
after the action handler fires does the player mount and replace it.
The user reports a visible "menu flash" before playback / cover image
appears.

This compounds F1 / the steamroll: today the user sees menu →
cover-image (WS-first playback) → page reload → menu flash again →
cover-image (FKB-fallback playback). Even with F1 fixed they would
still see one menu flash on the URL-initiated path.

**Desired behavior:** if the *initial* URL carries an action parameter
(`play` | `queue` | `open` and friends), suppress the menu render
entirely. Show a blank screen or the player's loading/cover state from
first paint. Once the action completes (player exits or user navigates
back), the menu appears naturally — that part of the behavior is
correct and should not change.

Implementation hint: the screen-framework already has the action params
available during layout selection (URL search params on initial mount).
A guard at the menu-widget render site that checks for action params on
*first render only* (not subsequent menu visits within the same screen
session) should be sufficient.

### F6. Trigger-config redundancy (LOW)

`83_8e_68_06` and `8d_6d_2a_07` both map to `plex: 620707`. Either both
tags are wired to the same physical card-set on purpose (intentional
redundancy) or one is a stale entry. Worth confirming.

### F7. Conflicted-copy YAML still on disk (LOW)

`/usr/src/app/data/household/config/nfc (kckern-server's conflicted copy 2026-04-24).yml`
is sitting next to the live `nfc.yml`. It's not loaded (ConfigService
keys off `nfc.yml`), but Dropbox/Syncthing-style conflict files
accumulate confusion. Delete or move into `_archive/`.

---

## 6. What works correctly

- `TriggerConfig.parseTriggerConfig` — correctly normalizes both `tags`
  and `states` entries blocks; lowercases values; rejects malformed
  configs with structured `ValidationError`.
- `TriggerIntent.resolveIntent` shorthand expansion — `{ plex: 620707 }`
  was correctly turned into `content: 'plex:620707'` with `params: {}`
  and the `plex` key consumed (no leak into `params`).
- DispatchId correlation — the same `6de18739…` UUID flows from
  `handleTrigger` → `actionHandlers.play` → `wakeAndLoadService.execute`
  → every `wake-and-load.*` event → final `trigger.fired`. Excellent
  for log forensics.
- Auth bypass for unconfigured `auth_token` — the `livingroom`
  location has `auth_token: null` and the request had no `?token=`,
  which is correctly skipped (TriggerDispatchService.mjs:38).
- Sensor-verified power-on — `binary_sensor.living_room_tv_power`
  confirmed within 4.5 s, allowing `wake-and-load.verify.skipped` to
  short-circuit the second readiness probe.
- Volume default applied without an explicit query param (15 from
  `device.defaultVolume`).
- EventBus broadcast — `trigger:livingroom:nfc` published to 4
  subscribers after completion, so any subscribed phone/UI gets the
  ack.

---

## 7. Recommended next steps

1. **(F1, critical) Decouple ack publisher from `publishState`** —
   patch `ScreenRenderer.jsx:149-154` so `useCommandAckPublisher` mounts
   whenever `wsConfig.commands === true`. No YAML change required. This
   single fix eliminates the WS ack timeout AND the page-reload steamroll
   that follows it. Expected win: NFC → audible playback drops from
   ~23 s to ~13 s, and the cover-image-then-refresh visual artifact
   disappears.
2. **(F2) Patch `prepareForContent`** to skip camera retries when the
   incoming query has `play=plex:*` or `play=files:*` (no camera
   needed). One-line capability gate. Saves ~4 s.
3. **(F3) Decouple `trigger.fired` from FKB `currentUrl` verification** —
   ack the trigger on `fullykiosk.load.acknowledged` + a small
   playback.log grace window. Move the unverified-URL warning to a
   background watchdog (already exists for playback timeout —
   `#armPlaybackWatchdog`). With F1 fixed this becomes mostly moot for
   warm FKB cases since the FKB load no longer runs.
4. **(F6) Delete or archive** the conflicted-copy `nfc.yml`.

After F1 alone, expected new timeline for the same NFC tag:

| Phase | Time |
|-------|-----:|
| Power-on | 4.5 s |
| Prepare (incl. camera waste) | 8.1 s |
| WS-first delivery + ack | ~0.3 s |
| **Trigger ack to user** | **~13 s** |
| Audible playback already in progress since | ~13 s |
