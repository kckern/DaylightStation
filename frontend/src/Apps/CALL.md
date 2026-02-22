# Home Line — Video Call

Phone-side standalone page for 1:1 P2P WebRTC video calls to TV kiosks.

## URL

```
/call
```

No auth required. If you can reach the URL, you're in.

## How It Works (Drop-In Model)

1. Phone opens `/call`, fetches device list from `GET /api/v1/device`
2. Devices with `contentControl` capability are shown (or auto-selected if only one)
3. Phone calls `GET /api/v1/device/{id}/load?open=videocall/{id}` to wake the TV (power on + Fully Kiosk loads the videocall URL)
4. Phone subscribes to `homeline:{deviceId}` WebSocket topic and waits
5. TV boots, loads videocall app, starts broadcasting `waiting` heartbeats
6. Phone receives heartbeat, sends SDP offer; TV answers; ICE candidates exchanged
7. Media flows directly P2P via `RTCPeerConnection` (STUN only, no TURN)

The phone initiates unilaterally — like Alexa Drop In. No waiting for the TV to already be running.

## Layout

Portrait phone screen:
- **Top:** Remote TV camera (landscape 16:9, full width)
- **Middle:** Local self-preview (portrait 9:16)
- **Bottom:** Hang up button

## Status Flow (Phone)

`idle` → `connecting` (wake TV + wait for heartbeat) → `connected` (call active)

On hangup or remote hangup → back to `idle`.

## Hooks

| Hook | Role |
|------|------|
| `useMediaDevices` | Enumerate camera/mic |
| `useWebcamStream` | Open `getUserMedia`, attach to `<video>` |
| `useWebRTCPeer` | `RTCPeerConnection` lifecycle |
| `useHomeline` | WebSocket signaling (offer/answer, ICE, hangup) |

## TV Counterpart

The TV side is a separate component registered as `videocall` in the app registry:
- URL: `/tv?open=videocall/{deviceId}`
- Component: `modules/Input/VideoCall.jsx`
- Split view: phone portrait + local landscape side by side

## Signaling

All signaling goes through the existing WebSocket event bus at `/ws`. Topic format: `homeline:{deviceId}`. Message types: `waiting`, `offer`, `answer`, `candidate`, `hangup`, `occupied`.

## Limitations

- 1:1 only (one phone per TV)
- LAN only (STUN, no TURN server)
- No mute/unmute controls yet
- No call history or persistence

## Related

- [Design doc](../../docs/plans/2026-02-21-homeline-videocall-design.md)
- [LiveKit upgrade path](../../docs/roadmap/2026-02-21-livekit-video-calling-design.md)
