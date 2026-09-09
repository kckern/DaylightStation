# Home Line: the call reaches `negotiating` and deadlocks, and the phone never says so

**Date:** 2026-09-08
**Surfaces:** `frontend/src/Apps/CallApp.jsx` (phone), `frontend/src/modules/Input/VideoCall.jsx` (TV)
**Status:** §2, §5.1, §5.2 and silent drops (proposal 3) FIXED — see
`docs/_wip/plans/2026-09-08-homeline-negotiation-deadlock-fix.md`; §5.3 (TV
WS flap) and §6 (TURN) still OPEN
**Prod at time of writing:** `4833008df`, container healthy

---

## 1. Symptom

A call placed from the phone to `livingroom-tv` walks the state machine correctly
as far as `negotiating` and then stops. Nothing connects. The phone shows
**"Connecting securely…" indefinitely** — there is no timeout, no error, and no
retry offered — so the only way out is for the caller to hang up, which the logs
then record as `user_cancelled`, i.e. **a system failure is filed as a user
decision.**

On the TV the call surface mounts and the local camera preview goes live, so a
room full of people sees a large picture of themselves with no call attached to
it. Reported from the room: *"the kids are distracted by the cam view"*, and
*"I put the cover on the webcam, the video is still live."*

---

## 2. What was already fixed (deployed, verified)

Until `c13573eff` the TV signed its requests as an anonymous
`browser:<token>` because nothing set `window.__DAYLIGHT_DEVICE_ID`, so
`join-active` refused it:

```
01:12:50 warn lease.join.failed {"reason":"HTTP 403 … {\"code\":\"DEVICE_ID_MISMATCH\"}"}   ×23
01:57:07 info homeline.join.denied {"declared":"browser:968748c03fe14fcc","deviceId":"livingroom-tv","status":"403"}
```

`useFleetDeviceIdentity` now sets it from the screen's own served config. Verified
end to end rather than assumed:

- `/api/v1/screens/living-room` serves `websocket.guardrails.device = "livingroom-tv"`;
- a probe injected into the live TV page read back
  `PROBE_DEVICE=[livingroom-tv]` and `PROBE_BUILD=[…4833008df]`;
- since the TV reloaded onto that build, **every `lease.join.failed` has stopped**
  and `lease.joined` succeeds (02:39:58, 02:43:14).

That defect is closed. **It was not the cause of the stall** — it was in front of it.

---

## 3. Timeline of a failing call (attempt `45a0faa3`, callId `b5ac10ce`)

| Time (UTC) | Source | Event |
|---|---|---|
| 02:39:49 | phone | `idle → reserving` |
| 02:39:50 | api | `homeline.lease.created`, `homeline.signaling.ready` |
| 02:39:52 | api | `homeline.wake.started` |
| 02:39:58 | **TV** | `mounted`, WS connect |
| 02:39:58 | **TV** | `lease.joined` ✅, `device-input-config {hasAudioBridge:true}` |
| 02:39:59 | api | `homeline.wake.completed` |
| 02:40:01 | api | `homeline.tv.joined` |
| 02:40:02 | **phone** | `pc-created` — audio + video tracks |
| 02:40:02 | api | `homeline.signaling.waiting` — `outcome:"accepted"`, both peer ids assigned |
| 02:40:02 | phone | `waiting_tv → negotiating` |
| … | | **nothing further from either side** |
| 02:42:08 | TV | WS reconnect |
| 02:43:30, 02:44:09, 02:44:51, 02:46:07 | TV | WS reconnect, repeatedly |

The **TV never logs `pc-created`.** The phone does. So the phone built its peer
connection and the TV never built one — which means the TV never acted on an
offer.

---

## 4. What is NOT the cause (each ruled out with evidence)

These were checked and cleared, so nobody re-checks them:

- **The TV's camera.** A `getUserMedia({video:true})` probe injected into the live
  page returned `VIDEO_OK label=camera 0, facing external state=live`. The
  WebView has the feed; the room can see it on screen.
- **`microphoneAccess = false` on FKB.** This looks wrong and is *correct*: the
  Shield's mic belongs to the **AudioBridge** native service
  (`_extensions/audio-bridge/`), not to the WebView — hardware constraints forced
  that design. It was briefly flipped to `true` during this investigation and
  **reverted**; do not flip it. `VideoCall` asks `useWebcamStream` for
  video-only whenever the bridge is active, so no mic permission is needed.
- **The audio bridge.** Healthy: `bridge-connected` with `aec:"ready"`,
  `sampleRate:48000`, and live `bridge-volume` samples (`maxLevel` 0.018–0.035).
  The `AudioBridgeService` is running (`dumpsys activity services`).
- **ICE / STUN / TURN.** Not reached. Negotiation dies before any candidate is
  exchanged, so the STUN-only config (`stun.l.google.com:19302`, no TURN) is
  **not** implicated in this failure. It remains a latent risk once the handshake
  works — see §6.
- **The main WebSocket.** `/ws` connects successfully on both sides.

---

## 5. Root cause (three defects that compound)

### 5.1 The offer can be sent exactly once, and it can be dropped silently

The handshake in `useCallSignaling.js` is:

```
TV subscribes → authorize-ack → TV sends `waiting`
phone receives `waiting` → createOffer → sends `offer`
TV receives `offer` → handleOffer → sends `answer`
```

The phone's re-offer guard:

```js
else if (message.type === 'waiting' && role === 'phone'
  && peerRef.current.connectionState !== 'connected'
  && offeredRevisionRef.current !== revisionRef.current) {
  offeredRevisionRef.current = revisionRef.current;
  … send('offer', …)
}
```

`offeredRevisionRef` is set to the current revision on the first offer, so **one
offer per revision, ever.** The comment above the ack handler says a reconnect
should "permit one new offer for this revision" — but that reset
(`offeredRevisionRef.current = null`) runs in the handler of *the reconnecting
peer's own* ack. When the **TV** reconnects, the **phone's** ref is untouched.

Meanwhile every signalling message goes out via `sendEphemeral`, which
**deliberately does not queue**:

```js
send(data, { ephemeral = false } = {}) {
  if (this.connected && this.ws?.readyState === WebSocket.OPEN) return this._sendRaw(message);
  else if (!ephemeral) this.messageQueue.push(message);   // ephemeral: dropped, silently
  return false;
}
```

Its `false` return value is discarded at every call site.

**The deadlock:** the single permitted offer is dropped (socket not open at that
instant, or the TV reconnected after sending `waiting` and lost it). The TV
re-subscribes and sends `waiting` again; the phone's guard now refuses to
re-offer because the revision has not changed. Both sides wait forever. This
matches the observed evidence exactly: TV `waiting` recorded server-side, phone
`pc-created`, and then silence from both.

*Confidence: high. Established by code reading plus the log pattern; not yet
proven by instrumented reproduction — see §7.*

### 5.2 `negotiating` has no timeout — the phone lies about what is happening

From `callMachine.js`:

```js
waiting_tv:  ['TV_READY', 'WAIT_TIMEOUT', 'FAIL', 'CANCEL'],
negotiating: ['ANSWERED', 'ICE_INTERRUPTED', 'FAIL', 'CANCEL'],   // ← no timeout
```

`waiting_tv` is armed with a 45s/75s `WAIT_TIMEOUT` in `useCallController.js`;
`negotiating` is armed with nothing. So a stalled negotiation displays
`'Connecting securely…'` (`statusCopy`) forever.

This is the defect the user reported directly: *"The failure was not
acknowledged on the mobile view, it still says that I'm connecting securely."*
It also corrupts the record — every one of these ends as
`recoveryRung: 'user_cancelled'`, so the logs blame the person.

*Confidence: certain. Read directly from the transition table.*

### 5.3 The TV's WebSocket reconnects every 30–60s

Observed on the TV (`context.app: frontend`) at 02:42:08, 02:42:15, 02:43:12,
02:43:30, 02:44:09, 02:44:51, 02:46:07 — during and after a call attempt. Each
reconnect re-authorizes the topic and re-sends `waiting`, which is what walks
into 5.1. This may be the known ~60s flap (protocol ping vs app heartbeat) or
something specific to the Shield; **not diagnosed here.**

*Confidence: the flapping is observed; its cause is not established.*

---

## 6. Latent, not yet implicated

**No TURN server.** `useWebRTCPeer.js` configures `stun.l.google.com:19302` and
nothing else. Two devices on one LAN normally connect on host candidates, but
Chrome's mDNS candidate obfuscation plus any AP client-isolation would leave no
path and **no relay to fall back to**. This cannot be assessed until the
handshake completes, and must be re-checked immediately afterwards.

---

## 7. Proposed fixes, smallest first

> 2026-09-08 (later): items 1–3 are implemented. The re-offer guard is now
> "until an answer for this revision is accepted", `NEGOTIATE_TIMEOUT` (20s)
> reuses the `WAIT_TIMEOUT` ladder and ends in `tv_no_answer`, and every
> dropped signal logs `signaling.dropped`. Items 4 and 5 remain.

1. **Let a fresh `waiting` re-offer.** `waiting` is already sent only once per TV
   subscription, so it is self-throttling — the revision guard is the wrong
   instrument. Re-offer whenever `waiting` arrives and the connection is not
   `connected`. *(Fixes the deadlock.)*
2. **Arm a `NEGOTIATE_TIMEOUT`** on `negotiating` (~20s), routing to the existing
   `recovery_prompt` the way `WAIT_TIMEOUT` does, with copy that says the TV did
   not answer and offers retry. *(Fixes the false "Connecting securely…", and
   stops mislabelling failures as `user_cancelled`.)*
3. **Stop dropping signalling silently.** `sendEphemeral` returning `false` must
   at least be logged at the call site with the message type; a dropped `offer`
   or `answer` is currently invisible.
4. **Diagnose the TV WS flap** (§5.3) separately.
5. **Re-evaluate TURN** once a call connects (§6).

Also requested by the user, tracked separately as UI work rather than bugs:
mirror the phone's self-view (`transform: scaleX(-1)` — the TV already does
this), and a pull-to-refresh on the phone's camera pane, since the preview can
wedge (`useIndependentMedia` already exposes `retry`).

---

## 8. How to verify a fix

1. Place a call. Expect on the phone: `pc-created`; on the **TV**: `pc-created`
   (this is the single most diagnostic line — its absence is the current bug),
   then `remote-stream-attached`.
2. Expect state `negotiating → verifying_media → connected`.
3. Force the failure path: block the TV's WS mid-negotiation and confirm the
   phone leaves `negotiating` within the timeout and says something true.
4. Log store:
   `context.component:VideoCall` for the TV side,
   `context.app:homeline-phone` for the phone,
   `_msg:"homeline.*"` for the server.
   Note `status-change` on the TV is `debug` and **never reaches the store**, so
   its absence proves nothing.

---

## 9. Field notes

- The FKB REST API returns HTTP 200 with `status:"Error"` envelopes; always
  read the value back rather than trusting the response.
- `fkb.cli.mjs cmd <x>` truncates any output over 400 chars to `(ok)` — useless
  for `getHtmlSource`. Fetch the raw response separately (~32KB) when probing
  the live DOM.
- The Shield's `injectJsCode` is normally **empty**. If you inject a probe,
  restore it to empty, not to the CLI's piano-specific `back-script` default —
  and remember a camera probe left in place re-acquires the camera on every page
  load, which is exactly the thing the room complained about.
