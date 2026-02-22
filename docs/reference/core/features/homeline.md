# Home Line — Video Calling

Home Line is a 1:1 P2P WebRTC video calling system between phone browsers and TV kiosks. It follows a "drop-in" model like Alexa Drop In — the phone initiates unilaterally, the TV is woken and connected automatically.

## Overview

```
┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
│   Phone          │  Wake   │   Backend        │  WS      │   TV (Shield)   │
│   /call          │────────►│   Device API     │─────────►│   Fully Kiosk   │
│                  │         │                  │          │                  │
│   WebRTC Offer  ─┼────────►│   WS Relay       │─────────►│   WebRTC Answer │
│                  │◄────────┼─  ICE Candidates ─┼◄─────────┼─               │
│                  │         │                  │          │                  │
│   P2P Media     ◄┼─────────────────────────────────────►│   P2P Media     │
└─────────────────┘  Direct  └─────────────────┘          └─────────────────┘
```

Key characteristics:
- **Drop-in model**: Phone wakes TV, no ringing or answering required
- **P2P media**: Audio/video flows directly between devices (STUN, no TURN)
- **Signaling via WebSocket**: SDP offers/answers and ICE candidates relay through the existing message bus
- **Device integration**: Uses the DDD device control system (power on, display verification, Fully Kiosk URL loading)
- **1:1 only**: One phone per TV at a time (backend enforces via CallStateService)
- **Mute controls**: Both sides can mute/unmute audio and video independently

## Call Flow

### Phone Initiates (Drop-In)

```
Phone                          Backend                         TV
  │                              │                              │
  │  GET /api/v1/device          │                              │
  │─────────────────────────────►│                              │
  │  [{id, capabilities}]        │                              │
  │◄─────────────────────────────│                              │
  │                              │                              │
  │  GET /device/{id}/load       │                              │
  │  ?open=videocall/{id}        │                              │
  │─────────────────────────────►│  powerOn + verify display    │
  │                              │─────────────────────────────►│
  │                              │                              │  Boot Fully Kiosk
  │                              │                              │  Load /tv?open=videocall/{id}
  │                              │                              │
  │  subscribe homeline:{id}     │                              │
  │  send "ready"                │  relay                       │
  │─────────────────────────────►│─────────────────────────────►│
  │                              │                              │
  │                              │  homeline:{id} "waiting"     │
  │                              │◄─────────────────────────────│  Immediate + heartbeat (5s)
  │  "waiting" received          │                              │
  │◄─────────────────────────────│                              │
  │                              │                              │
  │  SDP Offer                   │                              │
  │─────────────────────────────►│  relay + CallState.start     │
  │                              │─────────────────────────────►│
  │                              │                              │  handleOffer → createAnswer
  │                              │  SDP Answer                  │
  │  answer received             │◄─────────────────────────────│
  │◄─────────────────────────────│                              │
  │                              │                              │
  │  ◄──────────── ICE Candidates ────────────►                 │
  │                              │                              │
  │  ◄═══════════ P2P Media (Direct) ═════════►                 │
```

### Key Timing: Ready-Wait Handshake

The phone does **not** send the SDP offer immediately after waking the TV. Instead:

1. Phone calls the wake endpoint (power on + load URL)
2. Phone subscribes to the WebSocket topic and sends a `ready` message
3. TV boots, loads the videocall app, connects to WebSocket, starts broadcasting `waiting` heartbeats (every 5s)
4. On receiving `ready`, the TV responds immediately with `waiting` (no waiting for the next heartbeat cycle)
5. Phone receives `waiting` — confirming the TV is alive and listening
6. **Only then** does the phone create and send the SDP offer

This avoids race conditions where the offer arrives before the TV is ready. The `ready` message eliminates up to 5s latency from waiting for the next periodic heartbeat.

### Hang Up Flow

When the phone hangs up (button press or tab close), three things happen:

1. **Signaling hangup**: `useHomeline.hangUp()` sends a `hangup` message via WebSocket, resets the peer connection
2. **Call state end**: Backend `CallStateService` clears the active call record
3. **TV power off**: `CallApp.endCall()` calls `GET /api/v1/device/{id}/off?force=true` — but only if the current tab owns the call (see Call Ownership below)

The TV receives the hangup message and resets to `waiting` state. Then the power-off command turns it off via Home Assistant (CEC/IR).

On `beforeunload` (tab close), `endCall()` fires to ensure the TV doesn't stay on with a dead call.

### Wake Failure Handling

If the wake endpoint fails (network error, display verification failure), the phone shows three options:

- **Try Again** — re-attempt the full wake sequence (3s cooldown)
- **Connect anyway** — skip wake verification, proceed directly to signaling (useful if TV is already on)
- **Cancel** — abort the call attempt

Display verification failure (`displayVerifyFailed`) means the TV power-on script ran but the display state sensor didn't confirm within 8s. This suggests the TV screen may be physically off.

## Signaling Protocol

All signaling uses the existing WebSocket message bus. Topic format: `homeline:{deviceId}`.

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `ready` | Phone → TV | Phone is listening, prompt immediate heartbeat response |
| `waiting` | TV → All | Heartbeat (every 5s) + immediate response to `ready` |
| `offer` | Phone → TV | SDP offer to start WebRTC negotiation |
| `answer` | TV → Phone | SDP answer completing negotiation |
| `candidate` | Both | ICE candidate exchange for NAT traversal |
| `hangup` | Both | End the call, reset to idle/waiting |
| `occupied` | TV → Phone | Reject: TV already in a call |
| `mute-state` | Both | Audio/video mute status sync |

### Message Format

```json
{
  "topic": "homeline:livingroom-tv",
  "type": "offer",
  "from": "phone-1708541234-a3f2",
  "sdp": "v=0\r\no=- ..."
}
```

The `from` field is a unique peer ID generated per session (`{role}-{timestamp}-{random}`). Messages from self are filtered out client-side.

### Mute State Messages

```json
{
  "topic": "homeline:livingroom-tv",
  "type": "mute-state",
  "from": "phone-1708541234-a3f2",
  "audioMuted": true,
  "videoMuted": false
}
```

Mute state is sent on every toggle and displayed as a badge on the remote peer's UI.

### ICE Candidate Queuing

ICE candidates from the remote peer can arrive before `setRemoteDescription` completes on the local side. The `useWebRTCPeer` hook queues these candidates in `pendingCandidatesRef` and flushes them after `setRemoteDescription` resolves (in both `handleOffer` and `handleAnswer`).

### Backend Relay

The backend relay is minimal — broadcast on topic match plus call state tracking:

```javascript
if (message.topic?.startsWith('homeline:')) {
  callStateService.handleSignalingMessage(message);
  eventBus.broadcast(message.topic, message);
  return;
}
```

## Call State Service

`backend/src/3_applications/homeline/CallStateService.mjs` tracks active calls in-memory:

- **On offer** (from phone): records `{ phonePeerId, startedAt }` keyed by deviceId
- **On hangup**: clears the record
- **Zombie cleanup**: 5-minute timeout auto-clears stale calls (e.g., if both peers crash)
- **Power-off guard**: `GET /device/{id}/off` returns 409 if a call is active (unless `force=true`)
- **State query**: `hasActiveCall(deviceId)` used by device router to guard power-off

## Call Ownership

`useCallOwnership(deviceId)` — coordinates which browser tab "owns" the call for power-off purposes.

When the same device is targeted from multiple browser tabs (e.g., user refreshed the page), only the owning tab should send the power-off command. Uses `BroadcastChannel` API:

- Tab claims ownership when starting a call
- On hangup, only the owner sends power-off
- If `BroadcastChannel` is unavailable (e.g., Shield WebView), assumes owner

## Device Discovery

The phone fetches the device list from the REST API on mount:

```
GET /api/v1/device
→ { ok: true, devices: [{ id, type, capabilities }] }
```

Devices with `capabilities.contentControl === true` can load URLs and serve as videocall endpoints. The phone filters to these and displays them as options. If only one device qualifies, it auto-connects.

## Device Wake

When the phone selects a target, it calls the device load endpoint:

```
GET /api/v1/device/{deviceId}/load?open=videocall/{deviceId}
```

This triggers the DDD device control chain:
1. `Device.powerOn()` — HA script turns on TV via CEC/IR, with display verification (polls state sensor for 8s)
2. `Device.prepareForContent()` — Fully Kiosk wakes screen, brings to foreground
3. `Device.loadContent('/tv', { open: 'videocall/{id}' })` — Fully Kiosk loads the URL

Response includes `displayVerified` (boolean) and `displayVerifyFailed` (boolean) so the phone can warn if the TV didn't respond.

## Components

### Phone Side

| File | Purpose |
|------|---------|
| `frontend/src/Apps/CallApp.jsx` | Standalone page at `/call` — device list, call controls, remote video |
| `frontend/src/Apps/CallApp.scss` | Phone layout styles |

**Status flow:** `idle` → `connecting` → `connected` → `idle`

**Layout (portrait):**
- Preview mode (idle/connecting): fullscreen self-camera with bottom overlay (device buttons, status, cancel)
- Connected mode: remote TV video (wide, landscape) + self-camera (tall, portrait PIP) + controls (mic/cam toggle, hang up)

**Wake error states:** retry button (with 3s cooldown), "connect anyway" option, cancel

**Connection timeout:** 15s timer shows "TV is not responding" with retry/cancel

### TV Side

| File | Purpose |
|------|---------|
| `frontend/src/modules/Input/VideoCall.jsx` | TV videocall component |
| `frontend/src/modules/Input/VideoCall.scss` | TV layout styles |
| `frontend/src/modules/AppContainer/Apps/VideoCall/VideoCall.jsx` | App wrapper (passes deviceId + clear) |

**Status flow:** `waiting` → `connecting` → `connected` → `waiting`

**Layout (landscape):**
- Solo mode (waiting): fullscreen local camera preview, "Home Line — Waiting" status overlay, volume meter
- Connected mode: side-by-side split — phone portrait video (left, 9:16 aspect) + local landscape camera (right, 16:9 aspect)

**Important:** Both `<video>` elements are always mounted in the DOM. Layout switching uses CSS class toggles (`.videocall-tv--connected`) rather than conditional rendering, to prevent `srcObject` loss when React destroys/recreates elements.

### Shared Hooks

| File | Purpose |
|------|---------|
| `hooks/useHomeline.js` | WebSocket signaling orchestration (heartbeat, offer/answer, mute relay) |
| `hooks/useWebRTCPeer.js` | RTCPeerConnection lifecycle (with ICE candidate queuing) |
| `hooks/useMediaDevices.js` | Camera/mic enumeration and cycling |
| `hooks/useWebcamStream.js` | getUserMedia stream management |
| `hooks/useVolumeMeter.js` | WebRTC loopback-based volume meter (Android WebView compatible) |
| `hooks/useCallOwnership.js` | Cross-tab call ownership via BroadcastChannel |
| `hooks/useMediaControls.js` | Audio/video track mute/unmute toggle |

All hooks are in `frontend/src/modules/Input/hooks/`.

## Hook Details

### useHomeline(role, deviceId, peer)

The signaling orchestrator. Behavior depends on `role`:

**TV mode** (`role: 'tv'`):
- Broadcasts `waiting` heartbeats every 5 seconds
- Responds immediately to `ready` messages (eliminates heartbeat wait)
- Listens for `offer` messages, creates answer, sends back
- Rejects with `occupied` if already in a call
- Tracks remote mute state
- Resets to `waiting` on hangup

**Phone mode** (`role: 'phone'`):
- `connect(targetDeviceId)`: subscribes to device topic, sends `ready`, waits for `waiting` heartbeat, then sends SDP offer
- Handles `answer`, `candidate`, `occupied`, `hangup`, `mute-state` messages
- `hangUp()`: sends hangup message, resets peer connection
- `sendMuteState(audioMuted, videoMuted)`: relays mute status to peer

**Returns:** `{ peerConnected, status, connect, hangUp, sendMuteState, remoteMuteState }`

### useWebRTCPeer(localStream)

Manages RTCPeerConnection lifecycle. Creates peer connections with STUN config (`stun:stun.l.google.com:19302`), attaches local media tracks, and collects remote tracks.

**ICE candidate queuing:** Candidates arriving before `setRemoteDescription` are stored in `pendingCandidatesRef` and flushed after the remote description is set. This prevents silent candidate loss during the async offer/answer processing window.

**Returns:** `{ pcRef, remoteStream, connectionState, createOffer, handleOffer, handleAnswer, addIceCandidate, onIceCandidate, reset }`

### useVolumeMeter(stream)

WebRTC-based volume meter that reads `audioLevel` from sender `media-source` stats. Uses a loopback RTCPeerConnection internally (two PCs with local SDP exchange). This approach works on Android WebView (Shield) where Web Audio API's `createMediaStreamSource` returns flat silence.

**Returns:** `{ volume }` (0–1 float, polled every 100ms)

### useMediaControls(stream)

Toggles `track.enabled` on audio and video tracks from the stream.

**Returns:** `{ audioMuted, videoMuted, toggleAudio, toggleVideo, reset }`

### useCallOwnership(deviceId)

Uses `BroadcastChannel('homeline-call-ownership')` to coordinate which tab sends power-off.

**Returns:** `{ isOwner }` (function that returns boolean)

## App Registry

The videocall TV app is registered in `frontend/src/lib/appRegistry.js`:

```javascript
videocall: {
  label: 'Video Call',
  param: { name: 'device' },
  component: () => import('../modules/AppContainer/Apps/VideoCall/VideoCall.jsx')
}
```

URL format: `/tv?open=videocall/{deviceId}` — the device ID is passed as the `device` prop.

## Backend Files

| File | Purpose |
|------|---------|
| `backend/src/3_applications/homeline/CallStateService.mjs` | In-memory call state tracker |
| `backend/src/4_api/v1/routers/device.mjs` | Device REST API (wake, power, load) |
| `backend/src/0_system/eventbus/WebSocketEventBus.mjs` | WebSocket server with topic broadcast |
| `backend/src/1_adapters/devices/HomeAssistantDeviceAdapter.mjs` | HA power control with display verification |

## Logging

All hooks and components use the structured logging framework. Key events:

| Component | Event | Level | Data |
|-----------|-------|-------|------|
| useHomeline | `heartbeat-start` | info | deviceId |
| useHomeline | `ready-received` / `ready-sent` | info | from/target |
| useHomeline | `connect-waiting-for-tv` | info | target |
| useHomeline | `tv-ready` | info | target |
| useHomeline | `offer-sent` / `offer-received` | info | target/from |
| useHomeline | `answer-received` | info | from |
| useHomeline | `call-connected` | info | target |
| useHomeline | `hangup` | info | role, devId |
| useHomeline | `device-occupied` | info | target |
| useHomeline | `mute-state-sent` | debug | audioMuted, videoMuted |
| useWebRTCPeer | `pc-created` | debug | tracks |
| useWebRTCPeer | `connection-state` | debug | state |
| useWebRTCPeer | `remote-track-added` | debug | kind |
| useWebRTCPeer | `ice-candidate-queued` | debug | queueLength |
| useWebRTCPeer | `ice-candidates-flushed` | debug | count |
| CallApp | `devices-loaded` | info | count, ids |
| CallApp | `drop-in-start` | info | targetDeviceId |
| CallApp | `wake-success` / `wake-failed` | info/warn | targetDeviceId |
| CallApp | `tv-power-off` | info | targetDeviceId |
| VideoCall | `mounted` / `unmounted` | info | deviceId |
| VideoCall | `remote-stream-attached` | info | tracks |
| Backend | `call-state.started` / `call-state.ended` | info | deviceId |

Enable debug output in browser console: `window.DAYLIGHT_LOG_LEVEL = 'debug'`

## Limitations

- **1:1 only** — one phone per TV at a time; multi-party requires SFU (LiveKit)
- **LAN only** — STUN for NAT traversal, no TURN server for relay across networks
- **No call history** — no persistence or logging of past calls
- **No auth** — anyone who can reach `/call` can drop in
- **Shield WebView quirks** — Web Audio API returns silence (workaround: WebRTC loopback volume meter), BroadcastChannel may be unavailable

## Future

- **LiveKit integration** for multi-party calls, TURN relay, and better quality
- Call notifications (ring/announcement on TV before auto-answer)
- Room IDs, invite codes, PIN protection
- Call history / duration logging
