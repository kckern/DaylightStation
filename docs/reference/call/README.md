# Home Line Call System

Home Line is an unauthenticated, one-to-one LAN WebRTC call between `/call` and
the TV `videocall` screen. Media remains peer-to-peer. The backend controls an
in-memory call lease, device wake/recovery, signaling authorization, and safe
restoration. There is no TURN service, group calling, recording, or durable
call-history store.

## Call authority

`CallLeaseService` permits one non-ended lease per TV. `POST
/api/v1/homeline/calls` captures the TV's power and content state before any
device action and returns an unguessable `homeline-call:{callId}` topic plus a
memory-only phone credential. A second caller receives `409 DEVICE_BUSY` and
does not wake or change the TV.

There is no user provisioning, no sign-in and no identification. Home Line is a
tin can on a string: two ends, and whoever picks one up can talk into it. The
access boundary is the network — the house LAN or the VPN — not anything in the
call code, and `/call` is deliberately served ungated.

A caller still gets an identity, but only so the lease has an owner: an
unidentified local request is `trusted-local-network` (the same anonymous
identity the state-gates ingress adapter uses), which is what stops a stray tab
from ending a call it did not place and lets a phone that refreshed mid-call
resume its own. A JWT is honoured if one happens to be present, giving that
caller a distinct owner, but nobody is ever asked for one.

The only remaining refusal is a request that is not local at all, logged as
`homeline.call.denied` with `cause: off_network`. Behind the reverse proxy every
request presents a private peer, so in practice this refuses nobody; it is the
shape of the boundary, not the boundary. The TV bootstrap route is stricter: it
requires a local request whose `X-Daylight-Device` is `fleet:<deviceId>` — the
name a rendered screen takes from its own served config
(`websocket.guardrails.device`, published by `useFleetDeviceIdentity`) — then
rotates to its short-lived call credential. Anonymous `browser:`/`ephemeral:`
tokens can never match. A refusal is logged as `homeline.join.denied` with the
declared value; until 2026-09-08 it was recorded nowhere, and no TV had ever
joined because every screen still declared a browser token.

## The phone surface

`/call` is a fixed phone UI: it occupies the viewport exactly, does not scroll,
and locks pinch-zoom while mounted (restored on unmount, so no other app
inherits it).

Every size is multiplied by `--u`, a scale the component sets from the layout
viewport width (`innerWidth / 410`, clamped to 1–3). This exists because a
browser in **"Desktop site" mode ignores `width=device-width`** — that is the
point of the mode, and no meta tag overrides it. It lays the page out at 980 CSS
px and zooms the result down to fit the glass: measured on a real phone at
980x1747, DPR 3, visual scale 0.37, which rendered a 52px button at roughly
three millimetres. Sizing in fractions of the viewport makes the physical result
the same either way, so the screen does not depend on a browser setting nobody
should have to know about. `--u` is 1 on a normal phone. `call.surface` reports
`layoutScale` and `desktopMode`, which is how this was diagnosed. The caller's own camera is the surface — it takes every pixel the
controls do not — and the same two bands carry the lobby, the connecting state
and the live call, so nothing jumps between them.

Colours come from the design-system tokens (`AppThemeProvider`, pack `home`);
the stylesheet defines no raw values. Green marks the one action that places a
call, red marks leaving or ending, and nothing else is coloured. Chrome icons
are inline SVG rather than unicode, so an unsupported codepoint in a kiosk
WebView cannot silently erase an affordance; the per-device icon is whatever
`icon:` in devices.yml declares.

A screen is never labelled with its id. `name` in devices.yml is the label; a
device missing one is humanised (`yellow-room-tablet` → "Yellow Room Tablet")
and reported in `devices.loaded`'s `unnamed`, which is the cue to enrich the
config rather than leave a slug on screen.

## Who can be called

A device is offered as a call target only if it declares `video_call: true` in
`devices.yml`. It is a declaration, never an inference: `content_control` is
what every kiosk panel in the house has, so deriving eligibility from it offers
screens that have no camera or microphone. Anything silent is not a call
target. `GET /api/v1/device` reports it as `capabilities.videoCall`, alongside
the `name`, `location` and `icon` a picker needs to name the device to a person
rather than showing its id.

The setup lease expires after 180 seconds. A confirmed hard recovery may extend
that setup window once. Participants send five-second heartbeats; an active
lease ends when either participant is stale for 20 seconds. Active calls
otherwise have no duration limit.

The API surface is:

- `POST /calls` — reserve a TV for a caller on the home network.
- `POST /calls/:callId/wake` — run one correlated wake/load dispatch with its
  deferred retry disabled.
- `POST /devices/:deviceId/join-active` — local TV bootstrap; the request's
  `X-Daylight-Device` must be `fleet:<deviceId>`. Refusals log
  `homeline.join.denied`.
- `POST /calls/:callId/resume` — same-caller refresh recovery and phone
  credential rotation.
- `POST /calls/:callId/recover` — one soft reload, or one explicitly confirmed
  hard recovery.
- `POST /calls/:callId/end` — idempotent teardown and prior-state restoration.

Routine teardown never forces device power. It restores known prior content
when possible, powers off only when this call turned on a previously off TV,
and leaves the TV on when prior state is unknown or cannot safely be restored.

## Phone state machine

`callMachine.js` is the pure visible-state reducer. `useCallController.js` owns
the active attempt, abort controller, timers, lease requests, signaling, media
verification, and bounded recovery. Late events with another `attemptId` are
ignored.

```text
booting -> idle -> reserving -> probing -> waking -> waiting_tv
                                        \-> negotiating -> verifying_media
                                                           |-> connected
                                                           |-> degraded
                                                           \-> recovery_prompt

connected/degraded -> reconnecting -> recovery_prompt
any active setup/call state -> ending -> ended
reservation conflict -> occupied -> idle
unrecoverable error -> failed -> idle
```

Every setup state is bounded by a clock. `waiting_tv` expires after 45 seconds
(75 after a cold wake) and `negotiating` after 20. Both expiries climb the same
ladder: the first spends the attempt's single automatic soft recovery (the TV
call page is reloaded and the handshake restarts), the second opens the
recovery prompt with a reason that names what the TV failed to do —
`tv_unavailable` when it never joined, `tv_no_answer` when it joined and never
answered an offer. The prompt's copy reflects that reason. An expiry is never
recorded as a caller decision; `user_cancelled` only ever means the caller hung up.

There is no one-device auto-start. The user must tap Call after media preview is
ready. Entering teardown aborts HTTP, clears timers, unsubscribes signaling,
closes the peer connection, and ends the server lease. Wake orchestration also
checks the lease cancellation token between device steps, so an ended attempt
cannot continue into preparation or content loading.

## Signaling and recovery

Each signaling envelope carries `callId`, `attemptId`, `role`, `peerId`,
`revision`, `sequence`, `type`, and `payload`. The event bus accepts a call-topic
subscription only after `homeline-authorize`; wildcard subscribers never
receive call messages. Credentials are removed before relay. Socket reconnect
reauthorizes the exact subscription and starts a fresh handshake. Signaling is
ephemeral and never enters the generic WebSocket reconnect queue; a message
that finds the socket closed is dropped and recorded as `signaling.dropped`
(warn, with the type and sequence), so a lost offer or answer is visible in the
log store rather than inferred from silence.

The phone answers every fresh `waiting` from the TV with a fresh offer on the
current revision until an answer for that revision has been accepted. The TV
sends `waiting` once per (re)subscription, so this is self-throttling; the
server accepts a repeated offer at the same revision as long as its sequence
number rises. Once an answer is in, a stray `waiting` from a TV socket flap is
ignored so that it cannot tear down an ICE attempt that is about to succeed —
if that attempt fails, the recovery ladder below takes over on a new revision.
Each offer is logged as `signaling.offer` with whether the socket delivered it.

ICE candidates are scoped to a peer revision. After five seconds disconnected,
the phone performs one ICE restart with a ten-second deadline, then one full
peer rebuild on a new revision with a fifteen-second deadline. Exhaustion opens
the recovery prompt; it does not loop.

An SDP answer is negotiation progress, not success. The media monitor requires
live inbound tracks plus increasing inbound RTP bytes, and increasing rendered
frames for video. After eight seconds both kinds yield `connected`, one kind
yields a persistent audio-only or video-only `degraded` state, and neither kind
opens recovery choices. WebSocket loss alone does not end healthy P2P media.

Hard recovery is never automatic. It requires the confirmation/countdown UI
and is server-capped at one attempt per lease. Preparation or reload failure is
reported as a failed HTTP response.

## Correlation and field triage

Operational events use the shared fields where applicable:

```text
callId attemptId dispatchId deviceId callerId phonePeerId tvPeerId state
previousState reason peerRevision recoveryRung elapsedMs outcome
```

Credentials, SDP bodies, ICE candidate bodies, and media/device secrets must
not be logged.

Start every investigation with the `callId`:

```text
_time:2h AND callId:"{callId}"
```

Useful narrower queries:

```text
_time:2h AND callId:"{callId}" AND _msg:"homeline.lease"
_time:2h AND callId:"{callId}" AND _msg:"homeline.recovery"
_time:2h AND callId:"{callId}" AND _msg:"homeline.signaling.rejected"
_time:2h AND callId:"{callId}" AND (outcome:"failed" OR level:"error")
_time:2h AND deviceId:"{deviceId}" AND _msg:"homeline.lease.conflict"
```

When a call never reached a lease at all, the lobby offered the wrong thing or
the caller was off the network. Neither has a `callId`, so start from the event:

```text
_time:24h AND _msg:"homeline.call.denied"        # cause: off_network
_time:24h AND _msg:"devices.loaded"              # offered / withheld / unnamed
_time:24h AND _msg:"call.surface"                # viewport, DPR, zoom, orientation
_time:24h AND _msg:"connection-state"            # peer connection, warn on failed
```

`devices.loaded` names the devices offered and the near misses withheld, so a
wrong lobby is answerable without reading config; `unnamed` lists any device
shown under its raw id because `devices.yml` declares no `name`. `call.surface`
records the screen the caller actually used — a report about an unusable layout
can be checked against the viewport it happened on.

When the phone reaches `waiting_tv` and stays there, the TV woke but never
joined. Two things have to be true on the TV and both were false on
2026-09-08 — every attempt that day looked like a crash from the sofa:

```text
_time:24h AND _msg:"homeline.join.denied"        # declared: what the TV sent
_time:24h AND _msg:"lease.join.failed"           # the TV's own view of the same
_time:24h AND _msg:"webcam.access-error-final"   # TV getUserMedia refused
```

- `homeline.join.denied` with `declared: browser:…` means the screen is not
  publishing its fleet name (see [Call authority](#call-authority)).
When the phone reaches `negotiating` and leaves it with `tv_no_answer`, the TV
joined and sent `waiting` but never answered an offer. Read the attempt from
both ends:

```text
_time:1h AND _msg:"call.negotiate.timeout"      # connectionState at expiry
_time:1h AND _msg:"signaling.dropped"           # the socket ate a message
_time:1h AND _msg:"signaling.offer"             # delivered:false = never left the phone
_time:1h AND context.component:useWebRTCPeer    # the TV's pc-created, or its absence
```

- No `pc-created` on the TV means the offer never reached it, or it never ran
  the handler: check `signaling.dropped` on the phone and
  `homeline.signaling.rejected` on the server.
- `pc-created` on the TV with no answer on the phone means the answer was the
  message lost; the next `waiting` re-offers.

- `webcam.access-error-final` on a Fully Kiosk TV means FKB's `webcamAccess`
  is off. Call preparation now sets it on every dispatch; if it still fails,
  check the Android-level CAMERA grant for `de.ozerov.fully`. The microphone is
  deliberately NOT granted to the WebView — it belongs to the native audio
  bridge (`_extensions/audio-bridge/DESIGN.md`).

For a wake failure, follow the lease's `dispatchId` into `wake-and-load.*`
events. For a blank or partial call, compare `peerRevision`, signaling
milestones, and media-health changes. For teardown, require a `homeline.lease.ended`
or expiry event and inspect its restoration `outcome`; `left_on` is intentional
when a destructive restoration cannot be proven safe.

The phone and TV also each write a durable 14-day session trace under
`media/logs/homeline-phone/` and `media/logs/homeline-tv/`. Use those traces
when a browser disconnected before it could ship its final WebSocket log batch.
Rejected signaling records only the safe lease fields, revision, and rejection
code; it never records SDP, ICE candidate, or credential payloads.
