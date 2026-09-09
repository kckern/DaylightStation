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
requires a local request with an exact `X-Daylight-Device` match, then rotates
to its short-lived call credential.

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
- `POST /devices/:deviceId/join-active` — local TV bootstrap; the explicit
  `X-Daylight-Device` must exactly match.
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
ephemeral and never enters the generic WebSocket reconnect queue.

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
