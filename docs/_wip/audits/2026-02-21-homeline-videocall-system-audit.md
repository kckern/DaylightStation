# Homeline Videocall System Audit — 2026-02-21

> Scope: Full audit of the Home Line 1:1 P2P WebRTC video calling system — phone CallApp, TV VideoCall components, signaling hook (useHomeline), WebRTC peer hook, webcam stream acquisition, device wake/power-off backend, and resilient content adapter chain. Cross-referenced against design docs, implementation plan, and real-world testing session.

---

## Summary

The Home Line feature was built on 2026-02-21 (commit `18ca0d82`) and immediately tested in production. The initial implementation contained a prop name mismatch that prevented calls from ever connecting, plus a signaling race condition that caused non-deterministic connection failures. These and several other issues were identified and fixed in the same session across four follow-up commits. This audit documents all findings, root causes, fixes applied, and remaining gaps.

| Severity | Fixed | Open | Total |
|----------|-------|------|-------|
| Critical | 1 | 0 | 1 |
| High | 3 | 4 | 7 |
| Medium | 2 | 2 | 4 |
| Low | 0 | 2 | 2 |

---

## Architecture Overview

The Home Line system follows a "drop-in" model (like Alexa Drop In). The phone initiates the call unilaterally; the TV is woken, connected, and powered off automatically — no ringing, no answering.

### Component Map

```
Phone (/call)                    Backend                          TV (/tv?open=videocall/{id})
┌──────────────┐                 ┌─────────────┐                 ┌──────────────────────┐
│  CallApp.jsx │                 │ device.mjs  │                 │ AppContainer         │
│  ┌──────────┐│   REST: wake    │ (router)    │   FKB REST      │  └─ VideoCall.jsx    │
│  │useHomeline├─────────────────►─────────────►─────────────────►    └─ VideoCall.jsx  │
│  │(phone)   ││                 │             │                 │       (Input/*)      │
│  │          ││   WS: signaling │  WS relay   │   WS: signaling │    ┌──────────┐     │
│  │          ├──────────────────►─────────────►─────────────────►    │useHomeline│     │
│  │          ◄──────────────────◄─────────────◄─────────────────◄    │(tv)      │     │
│  └──────────┘│                 │             │                 │    └──────────┘     │
│  ┌──────────┐│                 └─────────────┘                 │    ┌──────────┐     │
│  │useWebRTC ├──── P2P Media (Direct, STUN) ────────────────────►    │useWebRTC │     │
│  │Peer      ◄──────────────────────────────────────────────────◄    │Peer      │     │
│  └──────────┘│                                                 │    └──────────┘     │
│  ┌──────────┐│                                                 │    ┌──────────┐     │
│  │useWebcam ││                                                 │    │useWebcam │     │
│  │Stream    ││                                                 │    │Stream    │     │
│  └──────────┘│                                                 │    └──────────┘     │
└──────────────┘                                                 └──────────────────────┘
```

### Call Flow (Current State — Post-Fixes)

1. **Phone loads `/call`** — fetches device list from `GET /api/v1/device`, filters to `contentControl` devices
2. **Phone calls `dropIn(deviceId)`** — sends `GET /api/v1/device/{id}/load?open=videocall/{id}` to wake TV
3. **Backend wakes TV** — `powerOn()` via HA scripts, `prepareForContent()` via Fully Kiosk REST, `loadContent('/tv', { open: 'videocall/{id}' })` via Fully Kiosk `loadURL`
4. **TV boots and mounts VideoCall** — `useHomeline('tv', deviceId, peer)` starts broadcasting `waiting` heartbeats every 5s
5. **Phone subscribes and sends `ready`** — the `connect()` function subscribes to the device topic and immediately sends a `ready` message
6. **TV receives `ready`, responds with `waiting`** — eliminates the 0-5s heartbeat wait window
7. **Phone receives `waiting`, sends SDP `offer`** — via `peer.createOffer()`
8. **TV receives `offer`, sends SDP `answer`** — via `peer.handleOffer()`
9. **ICE candidates exchanged bidirectionally**
10. **P2P media flows directly** — STUN via `stun:stun.l.google.com:19302`
11. **Hang up** — phone sends `hangup` via WS + calls `GET /api/v1/device/{id}/off` to power off TV

### Key Files

| File | Role |
|------|------|
| `frontend/src/Apps/CallApp.jsx` | Phone-side standalone page at `/call` |
| `frontend/src/Apps/CallApp.scss` | Phone layout styles |
| `frontend/src/modules/Input/VideoCall.jsx` | TV-side base component (camera + signaling + split view) |
| `frontend/src/modules/Input/VideoCall.scss` | TV layout styles |
| `frontend/src/modules/AppContainer/Apps/VideoCall/VideoCall.jsx` | App wrapper (registry bridge, passes `device` prop as `deviceId`) |
| `frontend/src/modules/Input/hooks/useHomeline.js` | Signaling orchestration (heartbeat, ready handshake, offer/answer relay) |
| `frontend/src/modules/Input/hooks/useWebRTCPeer.js` | RTCPeerConnection lifecycle |
| `frontend/src/modules/Input/hooks/useWebcamStream.js` | getUserMedia stream acquisition |
| `frontend/src/modules/Input/hooks/useMediaDevices.js` | Camera/mic enumeration |
| `frontend/src/lib/appRegistry.js` | App registry (`videocall` entry, `param: { name: 'device' }`) |
| `frontend/src/modules/AppContainer/AppContainer.jsx` | Generic app loader (parses URL params, passes to component) |
| `backend/src/4_api/v1/routers/device.mjs` | Device REST endpoints (`/load`, `/off`, `/on`) |
| `backend/src/3_applications/devices/services/DeviceFactory.mjs` | Builds device with resilient adapter chain |
| `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` | FKB REST API adapter |
| `backend/src/1_adapters/devices/ResilientContentAdapter.mjs` | FKB + ADB fallback wrapper |
| `backend/src/1_adapters/devices/AdbAdapter.mjs` | ADB CLI adapter for recovery |

---

## Issues Found

### Issue 1: Prop Name Mismatch — TV Never Received `deviceId` [Critical]

**Root cause:** The implementation plan (Task 5) specified the VideoCall wrapper as:

```jsx
export default function VideoCallApp({ param, clear }) {
  return <BaseVideoCall deviceId={param} clear={clear} />;
}
```

But the app registry defines `param: { name: 'device' }`, and `AppContainer.jsx` line 40-42 uses `entry.param.name` as the prop key:

```javascript
if (entry.param?.name && param) {
  appProps[entry.param.name] = param;
}
```

This means AppContainer passes `{ device: 'livingroom-tv', clear: fn }` — not `{ param: 'livingroom-tv' }`. The wrapper destructured `{ param }`, which was always `undefined`, so `BaseVideoCall` received `deviceId={undefined}`. With no `deviceId`, the TV's `useHomeline` guard (`if (role !== 'tv' || !deviceId) return`) prevented heartbeat startup, and calls never connected.

**Impact:** Feature completely broken. Zero calls could connect.

**Evidence:** The plan document at `docs/plans/2026-02-21-homeline-videocall-plan.md` lines 658-659 shows the original buggy code. The design was correct but the plan and implementation had a mismatch between the registry's `param.name` convention and the wrapper's destructuring.

**Status:** Fixed in `1f73fa29`. Wrapper now correctly destructures `{ device, clear }`.

---

### Issue 2: Signaling Race Condition — Phone Missed TV Heartbeat [High]

**Root cause:** The original signaling flow was:

1. Phone wakes TV via REST API
2. Phone subscribes to WS topic
3. Phone waits for TV's `waiting` heartbeat (sent every 5s)
4. Phone sends offer on first heartbeat received

The race: the TV might broadcast a heartbeat just before the phone subscribes, creating a 0-5 second window where the phone misses it. If the phone subscribes between heartbeats, it must wait for the next one. In practice, the TV boot time (~3-5s for FKB to load the URL) often aligned with the heartbeat interval, causing the phone to miss the first heartbeat and wait 5+ more seconds — or in some cases, lose sync entirely if the WS connection was delayed.

**Impact:** Intermittent connection failures. When it failed, both sides waited forever — the phone waiting for a heartbeat it already missed, the TV broadcasting heartbeats that the phone's late subscription never caught.

**Fix approach:** Added a `ready` handshake. After subscribing, the phone immediately sends a `ready` message. The TV listens for `ready` and responds instantly with `waiting`, bypassing the 5s heartbeat interval. The periodic heartbeat continues as a fallback.

**Status:** Fixed in `13aec7c3`. The `ready` handshake is now the primary connection path; the periodic heartbeat serves as a safety net.

---

### Issue 3: No Guard Against Double-Tap on Device Buttons [Medium]

**Root cause:** The `dropIn()` function in the original `CallApp.jsx` had no guard against being called while already in progress. Tapping a device button rapidly could fire multiple wake requests and multiple `connect()` calls.

**Impact:** Duplicate API calls, potential for multiple concurrent signaling sessions with the same device, confusing state.

**Status:** Fixed in `bb06b6b3`. Guard added: `if (waking || status !== 'idle') return;`. Device buttons now include `disabled={waking || status !== 'idle'}` and are styled with `opacity: 0.4` when disabled.

---

### Issue 4: No Cancel Button During Connecting [Medium]

**Root cause:** The original CallApp showed a "Connecting..." overlay but provided no way for the user to cancel. If the TV was slow to boot or the connection failed, the user was stuck.

**Impact:** Poor UX — users had to close the tab to escape a stuck connecting state, which also meant no cleanup of the TV power state.

**Status:** Fixed in `bb06b6b3`. A cancel button is now shown during both "Waking up TV..." and "Waiting for TV..." states. Cancel calls `endCall()` which sends a hangup, powers off the TV, and resets to idle.

---

### Issue 5: No Cleanup on SPA Navigation — TV Left Powered On [High]

**Root cause:** The original `CallApp.jsx` only handled tab close via `beforeunload`. If the user navigated away within the SPA (e.g., browser back button), the component unmounted without sending a power-off command. The TV stayed on with a dead call.

**Impact:** TV left powered on and displaying a stale videocall screen after the phone navigated away.

**Status:** Fixed in `bb06b6b3`. The cleanup effect now handles both `beforeunload` (tab close) and component unmount (SPA navigation):

```javascript
useEffect(() => {
  const handleBeforeUnload = () => endCall();
  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
    const devId = connectedDeviceRef.current;
    if (devId) {
      DaylightAPI(`/api/v1/device/${devId}/off`).catch(() => {});
    }
  };
}, [endCall]);
```

---

### Issue 6: Wake Failure Swallowed — Phone Proceeded to Connect Anyway [High]

**Root cause:** The original `dropIn()` function did not check the wake API response for errors. If the `GET /device/{id}/load` call failed (TV unreachable, FKB down), the phone still called `connect()` and entered the connecting state, waiting for a TV heartbeat that would never come.

**Impact:** User stuck on "Connecting..." with no error feedback when the TV wake fails.

**Status:** Fixed in `bb06b6b3`. The `dropIn()` function now wraps the wake call in a try/catch. On failure, it resets `waking` to false, clears `connectedDeviceRef`, and returns without calling `connect()`.

---

### Issue 7: Phone Webcam Failure — Call Proceeds with Blank Video [High]

**Root cause:** `useWebcamStream.js` has a two-tier fallback for `getUserMedia`:
1. Try with specific device IDs
2. Fallback to `{ video: true, audio: true }`

If both fail, `error` is set and `stream` is null. However, `CallApp.jsx` does not check `error` or `stream` state before allowing the user to initiate a call. The phone can proceed through the entire signaling flow with a null stream, resulting in a connected call where the TV receives no media from the phone.

**Impact:** The call "connects" (WebRTC negotiation succeeds, P2P link established) but the TV sees a black/blank video from the phone. The user may not realize their camera failed. The phone shows a black local preview but the call proceeds.

**Evidence:** On mobile, "Could not start video source" errors are common when another app holds the camera, or when the browser was backgrounded. The error is logged at `warn` level but not surfaced to the user.

**Status:** OPEN. The error state exists in the hook but is not consumed by CallApp. Needs a pre-call readiness check.

**Recommended fix:**
1. `CallApp.jsx` should check `stream` and `error` from `useWebcamStream`
2. If `error` is set or `stream` is null, show an error message in the lobby: "Camera unavailable"
3. Disable the device buttons until the stream is available
4. Optionally: allow audio-only calls by checking if at least an audio track is present

---

### Issue 8: Spurious Power-Off Commands from Stale Phone Tabs [High]

**Root cause:** If a user opens `/call` in multiple browser tabs (or the phone refreshes and the old tab's `beforeunload` fires), each tab independently tracks `connectedDeviceRef`. When any tab closes, its cleanup effect fires `GET /api/v1/device/{id}/off`. During testing, six spurious power-off commands fired during a single active call.

The problem compounds because:
- `beforeunload` fires on refresh (old tab closes, new tab opens)
- Each tab generates a unique `peerId` but they all target the same device
- There is no coordination between tabs
- The backend has no protection against power-off during an active call (see Issue 9)

**Impact:** Active calls interrupted by power-off commands from stale tabs. TV turns off mid-call.

**Status:** OPEN. No tab coordination exists. Each tab operates independently.

**Recommended fix (two layers):**
1. **Frontend:** Use `BroadcastChannel` or `localStorage` events to coordinate between tabs. Only the tab that initiated the call should send power-off on close. Tabs that detect another active tab should not send power-off.
2. **Backend:** Add call-state awareness to the power-off endpoint (see Issue 9).

---

### Issue 9: Backend Has No Protection Against Power-Off During Active Call [High]

**Root cause:** The `GET /device/{id}/off` endpoint in `device.mjs` unconditionally powers off the device. It has no concept of call state — whether a videocall is active, who initiated it, or whether the power-off is legitimate.

The endpoint implementation (lines 115-131) is straightforward:

```javascript
router.get('/:deviceId/off', asyncHandler(async (req, res) => {
  const result = await device.powerOff(display);
  res.json(result);
}));
```

No validation, no call-state check, no auth.

**Impact:** Any HTTP request to `/api/v1/device/{id}/off` — from a stale tab, a mistyped curl command, or a Home Assistant automation — will power off the TV mid-call.

**Status:** OPEN.

**Recommended fix:**
1. Track active call state server-side. When the backend sees homeline signaling (it already relays `homeline:*` messages), it can maintain a lightweight `activeCall` map: `{ deviceId: { startedAt, phonePeerId } }`.
2. The `off` endpoint should check if a call is active. If so, either:
   - Reject with a 409 (Conflict) and a message like `{ ok: false, error: 'Active videocall in progress' }`
   - Accept a `force=true` query param to override
3. Only the `peerId` that started the call (or an explicit admin action) should be able to power off during a call.

---

### Issue 10: Fully Kiosk Browser Crashed — No Fallback [High, now Fixed]

**Root cause:** Fully Kiosk Browser on the NVIDIA Shield TV occasionally crashes or becomes unresponsive, leaving its REST API (port 2323) unreachable. When this happens, `FullyKioskContentAdapter` returns `ECONNREFUSED` errors, and all content loading (including videocall wake) silently fails.

**Impact:** TV cannot be woken for videocalls (or any content load). The failure is logged but there is no recovery — the device is bricked until someone manually restarts FKB on the Shield.

**Status:** Fixed in `66dee94e`. A three-layer adapter chain now handles this:
1. `ResilientContentAdapter` wraps `FullyKioskContentAdapter`
2. On `ECONNREFUSED` / `ETIMEDOUT` / `EHOSTUNREACH`, it delegates to `AdbAdapter`
3. `AdbAdapter` connects via ADB, launches the FKB activity (`am start -n de.ozerov.fully/.TvActivity`), waits 5s for boot, then retries the primary adapter

The `DeviceFactory` wires this automatically when the device config includes a `fallback` block under `content_control`.

---

### Issue 11: `useMediaDevices` Uses Raw `console.error` [Low]

**Root cause:** `useMediaDevices.js` line 33 uses `console.error("Error enumerating devices:", error)` instead of the structured logging framework.

**Impact:** Device enumeration errors bypass the logging framework (no structured events, no WebSocket transport, no rate limiting). These errors are invisible in production unless someone opens the browser console.

**Status:** OPEN.

**Recommended fix:** Replace with `getLogger().warn('input.mediaDevices.enumerate_error', { error: error.message })`.

---

### Issue 12: `useWebcamStream` Uses Raw `console.error` [Low]

**Root cause:** `useWebcamStream.js` line 56 uses `console.error("Error accessing default devices:", fallbackErr)` for the final fallback failure path.

**Impact:** Same as Issue 11 — bypasses logging framework.

**Status:** OPEN.

**Recommended fix:** Replace with `getLogger().error('input.webcam.access_error_final', { error: fallbackErr.message })`.

---

## Issues Fixed This Session

| # | Issue | Severity | Commit | Description |
|---|-------|----------|--------|-------------|
| 10 | FKB crash — no fallback | High | `66dee94e` | ADB fallback adapter chain; ResilientContentAdapter wraps FKB with ADB recovery |
| 2 | Signaling race condition | High | `13aec7c3` | Added `ready` handshake; phone sends `ready` after subscribing, TV responds immediately; 10s timeout warning |
| 1 | Prop name mismatch (`param` vs `device`) | Critical | `1f73fa29` | VideoCall wrapper now destructures `{ device }` matching registry `param.name` |
| 3 | No double-tap guard | Medium | `bb06b6b3` | Guard in `dropIn()`: `if (waking \|\| status !== 'idle') return`; buttons disabled during wake/connect |
| 4 | No cancel button | Medium | `bb06b6b3` | Cancel button shown during connecting state, calls `endCall()` |
| 5 | No SPA navigation cleanup | High | `bb06b6b3` | Unmount effect powers off TV via `connectedDeviceRef` |
| 6 | Wake failure swallowed | High | `bb06b6b3` | `dropIn()` catches wake errors, resets state, returns without connecting |

---

## Remaining Open Issues

### O1. Phone webcam failure not surfaced to user [High]

See Issue 7. The call proceeds with blank video when `getUserMedia` fails on the phone. The `error` and `stream` states from `useWebcamStream` are available but not checked by `CallApp.jsx` before allowing `dropIn()`.

**Recommended fix:** Add a pre-call readiness gate. If `stream` is null or `error` is set, disable device buttons and show "Camera unavailable — check permissions". Consider allowing audio-only as a degraded mode.

### O2. Spurious power-off commands from stale tabs [High]

See Issue 8. Multiple browser tabs independently send `GET /device/{id}/off` on close. No coordination, no deduplication.

**Recommended fix:** Two-layer approach:
- Frontend: `BroadcastChannel` to elect one tab as the call owner; only the owner sends power-off
- Backend: Call-state-aware power-off endpoint (see O3)

### O3. Backend has no call-state awareness [High]

See Issue 9. The `/off` endpoint is stateless and unguarded. Any request powers off the device regardless of whether a call is active.

**Recommended fix:** The backend already relays `homeline:*` messages. Add a lightweight middleware or service that tracks active calls. The `/off` endpoint should check this state before executing.

### O4. No connection timeout with user feedback [Medium]

`useHomeline.js` has a 10s diagnostic warning (`connect-timeout`) but it only logs — the user sees "Waiting for TV..." forever. There is no automatic recovery or timeout.

**Recommended fix:** After 15-20 seconds, show a user-facing message ("TV not responding") with options to retry or cancel. This could be driven from `CallApp.jsx` by watching the `status` state and a timer.

### O5. No mute/unmute controls [Medium]

Documented as a known limitation in `docs/reference/core/features/homeline.md`. No way to mute audio or disable video during a call. This is a basic video calling feature that will be needed for production use.

**Recommended fix:** Add mute/unmute buttons to both CallApp and VideoCall UI. Toggle `track.enabled` on the local stream's audio/video tracks. Send a `muted`/`unmuted` signaling message so the remote side can display a mute indicator.

### O6. Raw `console.error` in useMediaDevices and useWebcamStream [Low]

See Issues 11 and 12. Two files bypass the structured logging framework.

**Recommended fix:** Replace with `getLogger()` calls. Low effort, high consistency value.

---

## Architectural Gaps

### G1. No Server-Side Call State

The backend is a "dumb relay" for signaling — it has zero awareness of call state. This means:
- No way to reject spurious power-off commands during active calls
- No call history or logging
- No ability to show "line busy" without waiting for the TV's `occupied` message
- No rate limiting on signaling messages
- No timeout to clean up zombie calls (phone crashes without sending hangup)

The current client-side-only approach works for the happy path but breaks under real-world conditions (multiple tabs, network failures, browser crashes). A lightweight server-side call state tracker would address Issues 8, 9, and enable call history.

### G2. No Auth on `/call` or Signaling

Anyone who can reach `/call` can drop in on any TV. The signaling protocol has no authentication — any WebSocket client can send `offer` messages. This is acceptable for a household LAN but would need addressing if the system is ever exposed externally.

### G3. STUN-Only — No TURN Relay

P2P media uses STUN only (`stun:stun.l.google.com:19302`). This works for same-LAN calls but fails when either device is behind a symmetric NAT or when calling from outside the home network. If WAN calling is ever needed, a TURN server is required. The docs note this as a known limitation and point to LiveKit as the future path.

### G4. Single-Subscriber Tab Coordination Gap

The WebSocket subscription model is per-tab. If the user has multiple tabs open (or refreshes during a call), each tab independently subscribes to the same topic and independently manages `peerId`, `connectedDeviceRef`, and cleanup. There is no cross-tab coordination. This is the root cause of Issue 8 (spurious power-offs) and could also cause signaling confusion if two tabs try to connect simultaneously.

### G5. Webcam Stream as a Precondition, Not Validated

Both CallApp and VideoCall acquire a webcam stream via `useWebcamStream`, but neither validates that the stream is healthy before proceeding with signaling. The `useWebRTCPeer` hook adds whatever tracks exist on `localStream` to the RTCPeerConnection at `createPC()` time. If `localStream` is null (webcam failed), the peer connection is created with no tracks — the call "connects" but sends no media.

The stream and error states exist in the hooks but are not treated as preconditions by the consuming components. Stream acquisition should be a gate before call initiation.

### G6. No ICE Connection Failure Handling

`useWebRTCPeer.js` tracks `connectionState` via `onconnectionstatechange` and logs it at `debug` level, but neither CallApp nor VideoCall react to `failed` or `disconnected` states. If ICE negotiation fails (e.g., STUN unreachable, network change mid-call), the UI stays in the "connected" state with dead video. There is no reconnection logic or user feedback.

---

## Recommendations

### Priority 1 — Address Before Next Production Use

1. **Add webcam readiness gate to CallApp** (O1, G5): Check `stream` and `error` before allowing `dropIn()`. Show "Camera unavailable" if the stream is null. This is the most likely failure mode for phone users and currently results in a silently broken call.

2. **Add user-facing connection timeout** (O4): After 15-20s in `connecting` state, show "TV not responding" with retry/cancel options. The diagnostic log already exists; surface it to the user.

3. **Handle ICE connection failure** (G6): Watch `peer.connectionState` in both CallApp and VideoCall. On `failed` or `disconnected`, show a message and offer to retry or end the call.

### Priority 2 — Address Before Heavy Use

4. **Add server-side call state tracking** (G1, O3): Lightweight middleware that watches `homeline:*` messages and maintains `{ deviceId: activePeerId }`. Use this to guard the `/off` endpoint and clean up zombie calls.

5. **Add tab coordination for power-off** (O2, G4): `BroadcastChannel` or `localStorage` lock so only the call-initiating tab sends power-off commands. This prevents the "six spurious power-offs" scenario.

6. **Add mute/unmute controls** (O5): Essential for a usable video calling experience. Toggle `track.enabled` on local audio/video tracks, send signaling message for remote mute indicator.

### Priority 3 — Polish

7. **Fix raw console.error calls** (O6): Replace `console.error` in `useMediaDevices.js:33` and `useWebcamStream.js:56` with structured logging framework calls.

8. **Add call duration display**: Show elapsed time during connected state. Useful for both UX and debugging.

9. **Add reconnection logic for dropped P2P connections**: If ICE reports `disconnected` (not `failed`), attempt ICE restart before giving up.

### Priority 4 — Future

10. **TURN server / LiveKit migration** (G3): For WAN calling or improved reliability. Design doc exists at `docs/roadmap/2026-02-21-livekit-video-calling-design.md`.

11. **Authentication for `/call`** (G2): PIN or household member verification before allowing drop-in.

12. **Call history persistence**: Log call events (start, end, duration, device, caller) to a datastore.

---

## Appendix: Commit Timeline

| Order | Commit | Description |
|-------|--------|-------------|
| 1 | `18ca0d82` | Initial implementation — full feature (21 files, 3102 lines added) |
| 2 | `66dee94e` | ADB fallback for Fully Kiosk content control (backend resilience) |
| 3 | `13aec7c3` | Fix homeline signaling race condition; add diagnostics |
| 4 | `1f73fa29` | Fix prop name in VideoCall wrapper (root cause of call failures) |
| 5 | `bb06b6b3` | Add CallApp lifecycle guards, cancel button, and cleanup |

## Appendix: Prop Flow Through AppContainer

This is the chain that caused Issue 1 — documenting it here for future reference:

```
URL: /tv?open=videocall/livingroom-tv
                │
                ▼
AppContainer.jsx (line 9):
  const [app, paramFromApp] = rawApp.split('/')
  // app = "videocall", paramFromApp = "livingroom-tv"

AppContainer.jsx (line 27):
  const entry = getApp("videocall")
  // entry.param = { name: 'device' }

AppContainer.jsx (lines 40-42):
  if (entry.param?.name && param) {
    appProps[entry.param.name] = param;
  }
  // appProps = { device: 'livingroom-tv', clear: fn }

AppContainer.jsx (line 47):
  <Component {...appProps} />
  // VideoCallApp receives { device: 'livingroom-tv', clear: fn }

VideoCall.jsx (wrapper):
  BEFORE: function VideoCallApp({ param, clear })   // param = undefined!
  AFTER:  function VideoCallApp({ device, clear })   // device = 'livingroom-tv'
```

The registry's `param.name` defines the prop name. The wrapper must destructure using that exact name. The plan document used `param` (generic) instead of `device` (the actual prop name), and this was not caught during implementation.
