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
- **Device integration**: Uses the DDD device control system (power on, Fully Kiosk URL loading)
- **1:1 only**: One phone per TV at a time

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
  │─────────────────────────────►│  powerOn + loadContent       │
  │                              │─────────────────────────────►│
  │                              │                              │  Boot Fully Kiosk
  │                              │                              │  Load /tv?open=videocall/{id}
  │                              │                              │
  │  subscribe homeline:{id}     │                              │
  │─────────────────────────────►│                              │
  │                              │                              │
  │                              │  homeline:{id} "waiting"     │
  │                              │◄─────────────────────────────│  Heartbeat (every 5s)
  │  "waiting" received          │                              │
  │◄─────────────────────────────│                              │
  │                              │                              │
  │  SDP Offer                   │                              │
  │─────────────────────────────►│  relay                       │
  │                              │─────────────────────────────►│
  │                              │                              │  createAnswer
  │                              │  SDP Answer                  │
  │  answer received             │◄─────────────────────────────│
  │◄─────────────────────────────│                              │
  │                              │                              │
  │  ◄──────────── ICE Candidates ────────────►                 │
  │                              │                              │
  │  ◄═══════════ P2P Media (Direct) ═════════►                 │
```

### Key Timing Detail

The phone does **not** send the SDP offer immediately after waking the TV. Instead:

1. Phone calls the wake endpoint (power on + load URL)
2. Phone subscribes to the WebSocket topic and **waits**
3. TV boots, loads the videocall app, connects to WebSocket, starts broadcasting `waiting` heartbeats
4. Phone receives the first heartbeat — confirming the TV is alive and listening
5. **Only then** does the phone send the SDP offer

This avoids race conditions where the offer arrives before the TV is ready.

### Hang Up Flow

When the phone hangs up (button press or tab close), two things happen:

1. **Signaling hangup**: `useHomeline.hangUp()` sends a `hangup` message via WebSocket, resets the peer connection
2. **TV power off**: `CallApp.endCall()` calls `GET /api/v1/device/{id}/off` to power off the TV remotely

The TV receives the hangup message and resets to `waiting` state. Then the power-off command turns it off via Home Assistant (CEC/IR). This mirrors the drop-in wake — the phone controls the full lifecycle.

On `beforeunload` (tab close), `endCall()` fires to ensure the TV doesn't stay on with a dead call.

## Signaling Protocol

All signaling uses the existing WebSocket message bus. Topic format: `homeline:{deviceId}`.

### Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `waiting` | TV → All | Heartbeat every 5s, confirms TV is alive and available |
| `offer` | Phone → TV | SDP offer to start WebRTC negotiation |
| `answer` | TV → Phone | SDP answer completing negotiation |
| `candidate` | Both | ICE candidate exchange for NAT traversal |
| `hangup` | Both | End the call, reset to idle/waiting |
| `occupied` | TV → Phone | Reject: TV already in a call |

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

### Backend Relay

The backend relay is minimal — 4 lines in `app.mjs`:

```javascript
if (message.topic?.startsWith('homeline:')) {
  eventBus.broadcast(message.topic, message);
  return;
}
```

No server-side logic, validation, or state. The backend is a dumb relay. All intelligence is in the clients.

## Device Discovery

The phone fetches the device list from the REST API on mount:

```
GET /api/v1/device
→ { ok: true, devices: [{ id, type, capabilities }] }
```

Devices with `capabilities.contentControl === true` can load URLs and serve as videocall endpoints. The phone filters to these and displays them as options. If only one device qualifies, it auto-connects.

This replaces the earlier heartbeat-based discovery model. The phone knows about devices from config, not from waiting for broadcasts.

## Device Wake

When the phone selects a target, it calls the device load endpoint:

```
GET /api/v1/device/{deviceId}/load?open=videocall/{deviceId}
```

This triggers the DDD device control chain:
1. `Device.powerOn()` — HA script turns on TV via CEC/IR
2. `Device.prepareForContent()` — Fully Kiosk wakes screen, brings to foreground
3. `Device.loadContent('/tv', { open: 'videocall/{id}' })` — Fully Kiosk loads the URL

The phone proceeds to signaling regardless of whether the wake succeeds (the TV may already be on).

## Components

### Phone Side

| File | Purpose |
|------|---------|
| `frontend/src/Apps/CallApp.jsx` | Standalone page at `/call` |
| `frontend/src/Apps/CallApp.scss` | Phone layout styles |

**Status flow:** `idle` → `connecting` → `connected` → `idle`

**Layout (portrait):** TV video (wide, top) → self-preview (tall, middle) → hang up button (bottom)

### TV Side

| File | Purpose |
|------|---------|
| `frontend/src/modules/Input/VideoCall.jsx` | TV videocall component |
| `frontend/src/modules/Input/VideoCall.scss` | TV layout styles |
| `frontend/src/modules/AppContainer/Apps/VideoCall/VideoCall.jsx` | App wrapper (passes deviceId) |

**Status flow:** `waiting` → `connecting` → `connected` → `waiting`

**Layout (landscape):**
- Solo mode: fullscreen local camera preview
- Connected mode: split view — phone portrait video (left) + local landscape camera (right)

### Shared Hooks

| File | Purpose |
|------|---------|
| `frontend/src/modules/Input/hooks/useWebRTCPeer.js` | RTCPeerConnection lifecycle |
| `frontend/src/modules/Input/hooks/useHomeline.js` | WebSocket signaling orchestration |
| `frontend/src/modules/Input/hooks/useMediaDevices.js` | Camera/mic enumeration |
| `frontend/src/modules/Input/hooks/useWebcamStream.js` | getUserMedia stream management |
| `frontend/src/modules/Input/hooks/useVolumeMeter.js` | WebRTC-based volume meter |

## Hook Details

### useHomeline(role, deviceId, peer)

The signaling orchestrator. Behavior depends on `role`:

**TV mode** (`role: 'tv'`):
- Broadcasts `waiting` heartbeats every 5 seconds
- Listens for `offer` messages, creates answer, sends back
- Rejects with `occupied` if already in a call
- Resets to `waiting` on hangup

**Phone mode** (`role: 'phone'`):
- `connect(targetDeviceId)`: subscribes to device topic, waits for `waiting` heartbeat, then sends SDP offer
- Handles `answer`, `candidate`, `occupied`, `hangup` messages
- `hangUp()`: sends hangup message, resets peer connection

**Returns:** `{ peerConnected, status, connect, hangUp }`

### useWebRTCPeer(localStream)

Manages RTCPeerConnection lifecycle. Creates peer connections with STUN config (`stun:stun.l.google.com:19302`), attaches local media tracks, and collects remote tracks.

**Returns:** `{ pcRef, remoteStream, connectionState, createOffer, handleOffer, handleAnswer, addIceCandidate, onIceCandidate, reset }`

### useVolumeMeter(stream)

WebRTC-based volume meter that reads `audioLevel` from sender `media-source` stats. Uses a loopback RTCPeerConnection internally. This approach works on Android WebView (Shield) where Web Audio API returns silence.

**Returns:** `{ volume }` (0–1 float)

## App Registry

The videocall TV app is registered in `frontend/src/lib/appRegistry.js`:

```javascript
videocall: {
  label: 'Video Call',
  param: { name: 'device' },
  component: lazy(() => import('../modules/AppContainer/Apps/VideoCall/VideoCall.jsx'))
}
```

URL format: `/tv?open=videocall/{deviceId}` — the device ID is passed as the `param` prop.

## Logging

All hooks and components use the structured logging framework. Key events:

| Component | Event | Level | Data |
|-----------|-------|-------|------|
| useHomeline | `heartbeat-start` | info | deviceId |
| useHomeline | `connect-waiting-for-tv` | info | target |
| useHomeline | `tv-ready` | info | target |
| useHomeline | `offer-sent` / `offer-received` | info | target/from |
| useHomeline | `answer-received` | info | from |
| useHomeline | `call-connected` | info | target |
| useHomeline | `hangup` | info | role, devId |
| useHomeline | `device-occupied` | info | target |
| useWebRTCPeer | `pc-created` | debug | tracks |
| useWebRTCPeer | `connection-state` | debug | state |
| useWebRTCPeer | `remote-track-added` | debug | kind |
| CallApp | `devices-loaded` | info | count, ids |
| CallApp | `drop-in-start` | info | targetDeviceId |
| CallApp | `wake-success` / `wake-failed` | info/warn | targetDeviceId |
| VideoCall | `mounted` / `unmounted` | info | deviceId |
| VideoCall | `status-change` | debug | status, peerConnected |
| VideoCall | `remote-stream-attached` | info | tracks |

Enable debug output in browser console: `window.DAYLIGHT_LOG_LEVEL = 'debug'`

## Limitations

- **1:1 only** — one phone per TV at a time; multi-party requires LiveKit
- **LAN only** — STUN for NAT traversal, no TURN server for relay
- **No mute/unmute** — not yet implemented
- **No call history** — no persistence or logging of past calls
- **No auth** — anyone who can reach `/call` can drop in

## Future

- **LiveKit integration** for multi-party calls, TURN relay, and better quality — see `docs/roadmap/2026-02-21-livekit-video-calling-design.md`
- Mute/unmute controls
- Call notifications
- Room IDs, invite codes, PIN protection
