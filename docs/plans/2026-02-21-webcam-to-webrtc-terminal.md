# WebRTC Terminal: Converting Webcam.jsx to a WebRTC-Based UI

Convert the current webcam preview app into a WebRTC-based communication terminal running on the Shield via Fully Kiosk Browser. The Shield becomes a always-on living room video endpoint — camera, mic, speaker, and TV display — controllable remotely.

## Current State

### What exists
- `Webcam.jsx` — fullscreen camera preview with device labels and volume meter
- `useMediaDevices.js` — enumerates video/audio devices, cycles between them
- `useWebcamStream.js` — opens `getUserMedia` stream, attaches to `<video>` element
- `useVolumeMeter.js` — attempts Web Audio API volume metering (broken on Shield)

### What works on Shield (Fully Kiosk Browser, Chrome 144 WebView)
- `getUserMedia({video: true, audio: true})` — camera + mic streams confirmed working
- `RTCPeerConnection` — instantiates successfully, `signalingState=stable`
- `MediaRecorder` — can encode audio/video to webm/opus
- Camera: Angetube Live Camera (USB, 1280x720, front-facing)
- Mic: USB audio (webcam built-in) + Speakerphone (Shield built-in)
- Fully Kiosk auto-grants camera/mic permissions (`webcamAccess`, `microphoneAccess`, `videoCapturePermission` all enabled)

### What's broken on Shield
- **Web Audio API `createMediaStreamSource`** — returns flat silence (128-128 / 0.0000) for all audio data. This is a known Android WebView bug. AnalyserNode, ScriptProcessorNode, and createMediaElementSource all affected. Volume metering via Web Audio API is impossible on this platform.

## Target Architecture

```
┌─────────────────────────────────────────────────┐
│  Shield (Fully Kiosk Browser)                   │
│  https://daylightlocal.kckern.net/tv?open=webrtc│
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Camera   │  │ Mic      │  │ Speaker      │  │
│  │ (USB)    │  │ (USB)    │  │ (HDMI/TV)    │  │
│  └────┬─────┘  └────┬─────┘  └──────▲───────┘  │
│       │              │               │          │
│       ▼              ▼               │          │
│  getUserMedia ───► RTCPeerConnection │          │
│       │              │           ▲   │          │
│       ▼              │           │   │          │
│  <video> local       │     remote track         │
│  preview             │           │   │          │
│                      │           │   │          │
└──────────────────────┼───────────┼───┼──────────┘
                       │           │   │
                   signaling    media (STUN/TURN)
                       │           │   │
┌──────────────────────┼───────────┼───┼──────────┐
│  Remote Peer         │           │   │          │
│  (browser/phone)     ▼           │   ▼          │
│              RTCPeerConnection ──┘              │
│                      │                          │
│              ┌───────┴────────┐                 │
│              │ Remote video   │                 │
│              │ + audio        │                 │
│              └────────────────┘                 │
└─────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: WebRTC Loopback (prove audio flows)

Replace `useVolumeMeter` with a WebRTC loopback that reads `audioLevel` from `RTCRtpReceiver.getStats()`.

**New hook: `useWebRTCLoopback.js`**
```
getUserMedia stream
  → addTrack to local RTCPeerConnection (pc1)
  → createOffer / setLocalDescription
  → pc2.setRemoteDescription(pc1.localDescription)
  → pc2.createAnswer / setLocalDescription
  → pc1.setRemoteDescription(pc2.localDescription)
  → ICE candidates exchanged locally
  → pc2.ontrack fires with remote stream
  → poll pc2.getReceivers()[audioReceiver].getStats()
  → extract audioLevel → update volume state
```

This replaces the broken Web Audio API meter with native WebRTC audio levels. No server needed — both peers live in the same page.

**Files changed:**
- `hooks/useVolumeMeter.js` → rewrite to use WebRTC loopback `getStats()` for audio level
- `Webcam.jsx` → no changes needed (already consumes `{ volume }` from the hook)

### Phase 2: Signaling Server

Add a lightweight signaling relay so remote peers can exchange SDP offers/answers and ICE candidates with the Shield.

**Options (pick one):**
1. **WebSocket on existing backend** — add a `/ws/rtc` endpoint to the DaylightStation backend. Rooms identified by screen ID. Simplest if the backend already runs Node/Express.
2. **Fully Kiosk + polling** — Shield polls a REST endpoint for incoming offers; remote peer posts offers to the same endpoint. No WebSocket needed but higher latency.
3. **Firebase Realtime Database** — zero-server signaling via shared document. Good for prototyping, bad for privacy.

**Signaling protocol (minimal):**
```json
{ "type": "offer",     "sdp": "...",       "from": "remote-123" }
{ "type": "answer",    "sdp": "...",       "from": "shield" }
{ "type": "candidate", "candidate": "...", "from": "shield" }
{ "type": "candidate", "candidate": "...", "from": "remote-123" }
{ "type": "hangup",    "from": "remote-123" }
```

**New files:**
- `backend/src/routes/rtc.js` — WebSocket signaling relay
- `frontend/src/modules/Input/hooks/useSignaling.js` — connects to signaling, handles offer/answer exchange

### Phase 3: Single Remote Peer

One remote browser connects to the Shield terminal.

**New hook: `useWebRTCPeer.js`**
- Accepts signaling channel from `useSignaling`
- Creates `RTCPeerConnection` with STUN server (`stun:stun.l.google.com:19302`)
- Shield side: adds local camera+mic tracks, creates offer
- Remote side: receives offer, adds own tracks, sends answer
- Handles ICE candidate exchange
- Exposes: `remoteStream`, `connectionState`, `audioLevel`

**Updated `Webcam.jsx` → `WebRTCTerminal.jsx`:**
- Local camera preview (small, corner PIP)
- Remote video (fullscreen)
- Connection status indicator
- Volume meter (from `getStats().audioLevel`)
- Mute/unmute toggle (via Shield remote arrow keys)

**STUN/TURN considerations:**
- STUN is free (Google's public server) and works for same-network calls
- If peers are on different networks (e.g., phone on cellular), need a TURN relay
- coturn is the standard self-hosted TURN server, or use Twilio/Xirsys for hosted

### Phase 4: UI Polish

- Ring/notification when incoming call (Fully Kiosk `textToSpeech` or overlay)
- Auto-answer mode (Shield always accepts — it's a terminal, not a phone)
- Fullscreen remote video with local PIP
- On-screen labels: caller name, call duration, connection quality
- Keyboard shortcuts via Shield remote (mute, hangup, switch camera)

### Phase 5: Multi-Peer (future)

- SFU (Selective Forwarding Unit) for 3+ participants — mediasoup or Janus
- Or simple mesh for 2-3 peers (each peer connects to every other)
- Beyond 3 peers, mesh becomes impractical — need SFU

## Key Constraints

| Constraint | Impact | Mitigation |
|-----------|--------|------------|
| Web Audio API broken on Shield WebView | No local audio metering via AnalyserNode | Use WebRTC `getStats().audioLevel` instead |
| Shield has no TURN server | Calls from outside LAN may fail | Self-host coturn or use hosted TURN for Phase 3+ |
| Fully Kiosk must be running | Port 2323 API unavailable if app killed | Shield auto-launches Fully on boot (configure in Fully settings) |
| Single USB camera | Can't switch cameras | Only one video source; remove camera cycling UI |
| Shield remote has limited keys | Complex UI interactions difficult | Map arrows/enter/back to: navigate, mute, hangup, accept |
| `getUserMedia` requires real origin | `about:blank` won't work | Always load from `https://daylightlocal.kckern.net` |

## Volume Meter: WebRTC getStats Approach

Since Web Audio API is broken on Shield, the volume meter uses WebRTC's native audio level reporting:

```js
// Poll audio level from receiver stats
const receivers = pc.getReceivers();
const audioReceiver = receivers.find(r => r.track.kind === 'audio');
const stats = await audioReceiver.getStats();
stats.forEach(report => {
  if (report.type === 'inbound-rtp' && report.kind === 'audio') {
    // audioLevel: 0.0 (silence) to 1.0 (max)
    setVolume(report.audioLevel);
  }
});
```

This works because WebRTC handles audio at the native layer, bypassing the broken Web Audio API pipeline entirely.

## File Structure (target)

```
frontend/src/modules/Input/
├── Webcam.jsx                    → rename to WebRTCTerminal.jsx
├── hooks/
│   ├── useMediaDevices.js        → keep (device enumeration)
│   ├── useWebcamStream.js        → keep (local preview stream)
│   ├── useVolumeMeter.js         → rewrite (WebRTC getStats)
│   ├── useSignaling.js           → new (WebSocket signaling)
│   └── useWebRTCPeer.js          → new (peer connection management)
```

## Phased Delivery

| Phase | Deliverable | Blocks on |
|-------|-------------|-----------|
| 1 | Volume meter works on Shield via WebRTC loopback | Nothing — can ship immediately |
| 2 | Signaling server on backend | Backend route + WebSocket |
| 3 | One remote peer can video-call the Shield | Phase 2 |
| 4 | UI polish, auto-answer, PIP layout | Phase 3 |
| 5 | Multi-peer / SFU | Phase 3 + infrastructure |
