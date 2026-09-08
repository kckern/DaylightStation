# Home Line Call System

Home Line is an authenticated, one-to-one LAN WebRTC call between `/call` and
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

The caller must have a valid user JWT whose configured application permissions
include `homeline` (or `call`/`*`). Device-local or kiosk identity alone never
grants caller authority — being on the house network grants `sysadmin` in
`req.roles`, and that deliberately does not open a camera in the living room.
The TV bootstrap route is the sole exception: it is limited to a local request
with an exact `X-Daylight-Device` match, then rotates to its short-lived call
credential.

Because of that, `/call` is served behind the auth gate: a caller without a
token gets the sign-in form, not the lobby. A refusal is logged as
`homeline.call.denied`, whose `cause` separates the two failures — `no_caller`
(no usable JWT; the caller signs in) from `no_permission` (a real user whose
roles do not expand to `call`; the fix is in `auth.yml`).

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

- `POST /calls` — reserve a TV for an authenticated caller.
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

When a call never reached a lease at all, the caller was refused or the lobby
offered the wrong thing. Neither has a `callId`, so start from the event:

```text
_time:24h AND _msg:"homeline.call.denied"        # cause: no_caller | no_permission
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
