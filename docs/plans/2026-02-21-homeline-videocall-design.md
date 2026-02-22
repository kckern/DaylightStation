# Home Line Video Call Design

> P2P WebRTC 1:1 video calling between TV kiosks and mobile browsers, using the existing WebSocket event bus for signaling.

**Date:** 2026-02-21
**Status:** Design Complete

---

## Concept

An "open door" model — the TV is always available as a home line. No ringing, no answering, no room IDs. A family member opens `/call` on their phone and walks into the living room. One home line per device; if multiple TVs are active, the phone user picks which room.

## Architecture

```
TV (Shield/Kiosk)                    Phone (Mobile Browser)
/tv?open=videocall&device=X          /call

getUserMedia (cam+mic)               getUserMedia (cam+mic)
      │                                    │
      ▼                                    ▼
RTCPeerConnection ◄──── signaling ────► RTCPeerConnection
      │                via /ws bus              │
      ▼                (homeline:X)        ▼
Split view:                          Stack view:
[phone portrait] [local wide]        [TV wide]
                                     [self tall]
```

No new backend routes. Signaling rides the existing WebSocket event bus at `/ws` with device-specific topics.

---

## Signaling Protocol

Messages on the `homeline:{deviceId}` WebSocket topic:

```
TV → bus:    { topic: 'homeline:{deviceId}', type: 'waiting', label: 'Living Room' }
             Sent on mount, repeated every 5s as heartbeat.

Phone → bus: { topic: 'homeline:{deviceId}', type: 'offer', sdp: '...' }
TV → bus:    { topic: 'homeline:{deviceId}', type: 'answer', sdp: '...' }
Both → bus:  { topic: 'homeline:{deviceId}', type: 'candidate', candidate: '...' }

Phone → bus: { topic: 'homeline:{deviceId}', type: 'hangup' }
             Sent on hang up or tab close (beforeunload).

TV → bus:    { topic: 'homeline:{deviceId}', type: 'occupied' }
             Sent when already in a call. Second phone sees "room is busy."
```

Roles are fixed: TV always answers, phone always offers.

STUN: `stun:stun.l.google.com:19302` (free, sufficient for LAN calls).
TURN: deferred — not needed for same-network calls.

---

## Multi-Device Home Lines

Each TV broadcasts on its own topic (`homeline:livingroom-tv`, `homeline:office-tv`, etc.). The TV knows its device ID from its URL: `/tv?open=videocall&device=livingroom-tv`.

Phone side at `/call`:
1. Subscribes to `homeline:*` — listens for all `waiting` heartbeats
2. One device available → auto-connect
3. Multiple available → picker showing device labels
4. None available → "No rooms are open"

No changes to `devices.yml` schema. If a TV is running videocall, it's a home line.

---

## Layouts

### TV (landscape 16:9) — Split View

When no peer: existing Webcam.jsx with "Home Line" indicator.

When peer connects:

```
┌─────────────────────────────────────────────┐
│                                             │
│   ┌─────────┐     ┌───────────────────┐     │
│   │         │     │                   │     │
│   │  Phone  │     │    Local Camera   │     │
│   │  9:16   │     │      16:9         │     │
│   │         │     │                   │     │
│   │         │     │                   │     │
│   └─────────┘     └───────────────────┘     │
│                                             │
│   ┌─ volume meter ───────────────────┐      │
│                                             │
└─────────────────────────────────────────────┘
```

Portrait phone video and landscape local camera side by side, vertically centered, dark background. Volume meter shows local mic level.

When phone disconnects: returns to solo webcam view.

### Phone (portrait 9:16) — Stack View

```
┌──────────┐
│          │
│┌────────┐│
││ TV cam ││  landscape, full width
││  wide  ││
│└────────┘│
│          │
│ ┌──────┐ │
│ │ self │ │  portrait self-preview
│ │ tall │ │
│ └──────┘ │
│          │
│ [Hang up]│
└──────────┘
```

Lobby state: device picker if multiple TVs available, auto-connect if one, "no rooms open" if none.

---

## Files

### New

| File | Purpose |
|------|---------|
| `frontend/src/Apps/CallApp.jsx` | Phone-side standalone page |
| `frontend/src/Apps/CallApp.scss` | Phone-side styles |
| `frontend/src/modules/Input/VideoCall.jsx` | TV-side split view |
| `frontend/src/modules/Input/hooks/useHomeline.js` | Signaling over `/ws` bus |
| `frontend/src/modules/Input/hooks/useWebRTCPeer.js` | RTCPeerConnection lifecycle |

### Modified

| File | Change |
|------|--------|
| `frontend/src/main.jsx` | Add `/call` route |
| `frontend/src/lib/appRegistry.js` | Add `videocall` entry |
| `frontend/src/modules/Input/Webcam.jsx` | "Home Line" indicator, transition to VideoCall on peer connect |

### Reused As-Is

- `useMediaDevices.js` — device enumeration (both sides)
- `useWebcamStream.js` — getUserMedia + video element (both sides)
- `useVolumeMeter.js` — WebRTC sender stats volume meter (TV side)
- `WebSocketService.js` — existing WS client with topic subscriptions

### Not Touched

- Backend — no new routes, no new endpoints
- `devices.yml` — no schema changes

---

## Constraints

| Constraint | Decision |
|-----------|----------|
| 1:1 only | P2P, one RTCPeerConnection per call |
| LAN only for now | No TURN server; STUN only |
| No auth | If you can reach `/call`, you're in |
| No mute toggle | YAGNI — add later |
| No call history | Ephemeral — no persistence |

---

## Future (deferred)

- Room IDs and invite codes
- PIN-based access
- Personal rooms per household member
- Multi-party calls via LiveKit SFU (see `docs/roadmap/2026-02-21-livekit-video-calling-design.md`)
- Mute/unmute controls
- TURN server for remote (non-LAN) calls
- Call notifications on other screens

---

## Related

- [WebRTC Terminal Plan](./2026-02-21-webcam-to-webrtc-terminal.md) — original Phase 1 volume meter (completed)
- [LiveKit Design](../roadmap/2026-02-21-livekit-video-calling-design.md) — future multi-party upgrade path
