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
grants caller authority. The TV bootstrap route is the sole exception: it is
limited to a local request with an exact `X-Daylight-Device` match, then rotates
to its short-lived call credential.

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
_time:2h AND callId:"{callId}" AND (outcome:"failed" OR level:"error")
_time:2h AND deviceId:"{deviceId}" AND _msg:"homeline.lease.conflict"
```

For a wake failure, follow the lease's `dispatchId` into `wake-and-load.*`
events. For a blank or partial call, compare `peerRevision`, signaling
milestones, and media-health changes. For teardown, require a `homeline.lease.ended`
or expiry event and inspect its restoration `outcome`; `left_on` is intentional
when a destructive restoration cannot be proven safe.
