# Homeline Videocall Hardening — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close all open issues from the [2026-02-21 videocall system audit](../docs/_wip/audits/2026-02-21-homeline-videocall-system-audit.md) — webcam readiness gate, connection timeout, ICE failure handling, server-side call state, tab coordination, mute controls, and logging fixes.

**Architecture:** Seven tasks progressing from quick logging fixes through frontend UX improvements, backend call-state tracking, and finally mute/unmute controls. Each task is independently committable. The backend call-state tracker (Task 5) and tab coordination (Task 6) work together to eliminate spurious power-off commands from stale tabs.

**Tech Stack:** React hooks, WebRTC, WebSocket signaling, Express.js, BroadcastChannel API, structured logging framework (`frontend/src/lib/logging/`)

**Source Audit:** `docs/_wip/audits/2026-02-21-homeline-videocall-system-audit.md`

---

## Task 1: Fix Raw `console.error` Calls in Media Hooks

**Audit refs:** Issues 11, 12 (O6) — Low severity, quick warmup

**Files:**
- Modify: `frontend/src/modules/Input/hooks/useMediaDevices.js:33`
- Modify: `frontend/src/modules/Input/hooks/useWebcamStream.js:56`

**Context:** The project's CLAUDE.md mandates all diagnostic logging go through the structured logging framework at `frontend/src/lib/logging/Logger.js`. Two hooks bypass this with raw `console.error` calls. Both hooks already follow the lazy-init logger pattern used throughout the codebase — `useWebcamStream.js` has a logger at the top; `useMediaDevices.js` does not.

**Step 1: Add lazy logger to `useMediaDevices.js`**

At the top of `useMediaDevices.js`, after the existing imports, add the lazy-init pattern:

```javascript
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaDevices' });
  return _logger;
}
```

Then replace line 33:
```javascript
// BEFORE:
console.error("Error enumerating devices:", error);

// AFTER:
logger().warn('media-devices.enumerate-error', { error: error.message });
```

**Step 2: Fix `useWebcamStream.js` raw console.error**

`useWebcamStream.js` already has a logger (`logger()` lazy-init at top). Replace line 56:

```javascript
// BEFORE:
console.error("Error accessing default devices:", fallbackErr);

// AFTER:
logger().error('webcam.access-error-final', { error: fallbackErr.message });
```

**Step 3: Verify no raw console calls remain in Input hooks**

Run:
```bash
grep -rn 'console\.\(log\|error\|warn\|debug\)' frontend/src/modules/Input/hooks/
```
Expected: Zero results.

**Step 4: Commit**

```bash
git add frontend/src/modules/Input/hooks/useMediaDevices.js frontend/src/modules/Input/hooks/useWebcamStream.js
git commit -m "fix: replace raw console.error with structured logging in media hooks

Closes audit issues 11, 12 (O6). useMediaDevices and useWebcamStream
now use the project logging framework instead of console.error."
```

---

## Task 2: Add Webcam Readiness Gate to CallApp

**Audit refs:** Issue 7, Gap G5 — High severity. Phone can initiate a call with a failed camera, resulting in a connected call that sends no video.

**Files:**
- Modify: `frontend/src/Apps/CallApp.jsx`
- Modify: `frontend/src/Apps/CallApp.scss`

**Context:** `useWebcamStream` returns `{ videoRef, stream, error }`. Currently `CallApp.jsx` uses `videoRef` and `stream` but never checks `error` or gates on `stream !== null` before allowing `dropIn()`. When `getUserMedia` fails (common on mobile — another app holding camera, permissions denied), the user sees a black local preview but can still tap device buttons and initiate a call.

**Step 1: Add stream/error checks to `dropIn()` guard**

In `CallApp.jsx`, the `dropIn` function currently has this guard:

```javascript
const dropIn = async (deviceId) => {
  if (waking || status !== 'idle') return;
```

Add a stream check after the existing guard:

```javascript
const dropIn = async (deviceId) => {
  if (waking || status !== 'idle') return;
  if (!stream) {
    logger.warn('drop-in-blocked-no-stream', { deviceId, error: error?.message });
    return;
  }
```

**Step 2: Disable device buttons when stream is unavailable**

Find the device button rendering in the lobby view. The buttons currently have:

```jsx
disabled={waking || status !== 'idle'}
```

Change to:

```jsx
disabled={waking || status !== 'idle' || !stream}
```

**Step 3: Add camera error banner to lobby UI**

Above the device list in the lobby, add a conditional error banner:

```jsx
{error && (
  <div className="call-app__camera-error">
    Camera unavailable — check permissions
  </div>
)}
{!error && !stream && (
  <div className="call-app__camera-loading">
    Starting camera...
  </div>
)}
```

**Step 4: Add styles for the error/loading banners**

In `CallApp.scss`, add inside the `.call-app--lobby` block:

```scss
.call-app__camera-error {
  color: #ff6b6b;
  font-size: 1rem;
  padding: 0.75rem 1.5rem;
  background: rgba(255, 107, 107, 0.1);
  border-radius: 8px;
  margin-bottom: 1rem;
  text-align: center;
}

.call-app__camera-loading {
  color: #aaa;
  font-size: 0.9rem;
  margin-bottom: 1rem;
  text-align: center;
}
```

**Step 5: Verify behavior**

Manual test: Open `/call` with camera permissions blocked in the browser. Expect:
- "Camera unavailable" banner shows
- Device buttons are disabled (opacity 0.4)
- Tapping a button does nothing (guard returns early)

**Step 6: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx frontend/src/Apps/CallApp.scss
git commit -m "feat: add webcam readiness gate to CallApp

Blocks call initiation when getUserMedia fails. Shows 'Camera unavailable'
banner and disables device buttons. Prevents connected-but-no-video calls.
Closes audit issue 7 (O1)."
```

---

## Task 3: Add User-Facing Connection Timeout

**Audit refs:** O4 — Medium severity. `useHomeline.js` has a 10s diagnostic log but no UI feedback. User stuck on "Waiting for TV..." forever.

**Files:**
- Modify: `frontend/src/Apps/CallApp.jsx`
- Modify: `frontend/src/Apps/CallApp.scss`

**Context:** When the phone enters `connecting` status (after waking the TV), it shows "Waiting for TV..." with a spinner. If the TV doesn't respond (FKB crashed, network issue, ADB fallback slow), the user has no feedback and must manually cancel. The `useHomeline` hook already has a `connect-timeout` diagnostic at 10s, but it only logs.

The cancel button already exists (added in commit `bb06b6b3`), so we need to add a timeout message *alongside* it, not replace it.

**Step 1: Add a timer to the connecting overlay**

In `CallApp.jsx`, add a state variable for the timeout:

```javascript
const [connectingTooLong, setConnectingTooLong] = useState(false);
```

Add an effect that watches `status` and starts a timer:

```javascript
useEffect(() => {
  if (status !== 'connecting') {
    setConnectingTooLong(false);
    return;
  }
  const timer = setTimeout(() => setConnectingTooLong(true), 15000);
  return () => clearTimeout(timer);
}, [status]);
```

**Step 2: Update the connecting overlay to show the timeout message**

Find the connecting overlay JSX. It currently shows "Waking up TV..." or "Waiting for TV..." depending on the `waking` state. After the existing text, add:

```jsx
{connectingTooLong && (
  <div className="call-app__timeout-msg">
    TV is not responding. You can retry or cancel.
  </div>
)}
```

**Step 3: Add a retry button alongside the existing cancel button**

When `connectingTooLong` is true, show a retry button that calls `endCall()` then `dropIn()` again:

```jsx
{connectingTooLong && (
  <button
    className="call-app__retry-btn"
    onClick={() => {
      const devId = connectedDeviceRef.current;
      endCall();
      if (devId) setTimeout(() => dropIn(devId), 500);
    }}
  >
    Retry
  </button>
)}
```

**Step 4: Add styles**

In `CallApp.scss`:

```scss
.call-app__timeout-msg {
  color: #ff9f43;
  font-size: 0.9rem;
  margin-top: 1rem;
  text-align: center;
}

.call-app__retry-btn {
  margin-top: 0.75rem;
  padding: 0.5rem 1.5rem;
  border: 1px solid #ff9f43;
  border-radius: 8px;
  background: transparent;
  color: #ff9f43;
  font-size: 0.9rem;
  cursor: pointer;

  &:hover {
    background: rgba(255, 159, 67, 0.15);
  }
}
```

**Step 5: Add logging**

Log when the timeout triggers:

```javascript
useEffect(() => {
  if (connectingTooLong) {
    logger.warn('connect-timeout-user-visible', {
      deviceId: connectedDeviceRef.current,
      elapsed: '15s'
    });
  }
}, [connectingTooLong]);
```

**Step 6: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx frontend/src/Apps/CallApp.scss
git commit -m "feat: add user-facing connection timeout with retry option

After 15s in connecting state, shows 'TV is not responding' message with
retry and cancel buttons. Surfaces existing diagnostic timeout to the user.
Closes audit issue O4."
```

---

## Task 4: Handle ICE Connection Failure

**Audit refs:** Gap G6 — High severity. If ICE negotiation fails or the P2P connection drops mid-call, the UI stays in "connected" state with dead video.

**Files:**
- Modify: `frontend/src/modules/Input/hooks/useWebRTCPeer.js`
- Modify: `frontend/src/Apps/CallApp.jsx`
- Modify: `frontend/src/modules/Input/VideoCall.jsx`
- Modify: `frontend/src/Apps/CallApp.scss`
- Modify: `frontend/src/modules/Input/VideoCall.scss`

**Context:** `useWebRTCPeer.js` already tracks `connectionState` via the `onconnectionstatechange` event and logs it at `debug` level. But neither CallApp nor VideoCall consume this state to react to failures. The hook returns `connectionState` but the consumers don't use it.

**Step 1: Verify `connectionState` is returned from `useWebRTCPeer`**

Check the return object of `useWebRTCPeer.js`. It should already return `connectionState`. If not, add it to the return object:

```javascript
return {
  // ... existing returns
  connectionState,
};
```

**Step 2: Consume `connectionState` in CallApp**

In `CallApp.jsx`, destructure `connectionState` from the peer hook:

```javascript
const { createOffer, handleAnswer, addIceCandidate, onIceCandidate, reset, remoteStream, connectionState } = peer;
```

(Note: The peer is passed to `useHomeline`, so `CallApp.jsx` needs to destructure from the same `useWebRTCPeer` return value. Check how `peer` is currently used — it may be that `CallApp.jsx` destructures the peer object. Adapt accordingly.)

Add a `useEffect` that watches `connectionState`:

```javascript
useEffect(() => {
  if (connectionState === 'failed') {
    logger.error('ice-connection-failed', { deviceId: connectedDeviceRef.current });
    setIceError('Connection lost — the video link failed.');
  } else if (connectionState === 'disconnected') {
    logger.warn('ice-connection-disconnected', { deviceId: connectedDeviceRef.current });
    // Disconnected is often transient — show warning but don't end call
    setIceError('Connection unstable...');
  } else if (connectionState === 'connected') {
    setIceError(null);
  }
}, [connectionState]);
```

Add state:
```javascript
const [iceError, setIceError] = useState(null);
```

**Step 3: Show ICE error overlay in CallApp connected view**

In the connected view JSX, add an error overlay:

```jsx
{iceError && (
  <div className="call-app__ice-error">
    <span>{iceError}</span>
    {connectionState === 'failed' && (
      <button onClick={() => endCall()} className="call-app__ice-error-btn">
        End Call
      </button>
    )}
  </div>
)}
```

**Step 4: Style the ICE error overlay**

In `CallApp.scss`:

```scss
.call-app__ice-error {
  position: absolute;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 50, 50, 0.85);
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  z-index: 10;
}

.call-app__ice-error-btn {
  padding: 0.25rem 0.75rem;
  border: 1px solid white;
  border-radius: 4px;
  background: transparent;
  color: white;
  cursor: pointer;
  font-size: 0.8rem;
  white-space: nowrap;
}
```

**Step 5: Add same ICE failure handling to VideoCall (TV side)**

In `frontend/src/modules/Input/VideoCall.jsx`, add the same pattern. The TV side should show a "Connection lost" indicator and auto-clear after a timeout (since the TV has no user to tap buttons):

```javascript
const [iceError, setIceError] = useState(null);

useEffect(() => {
  if (connectionState === 'failed') {
    logger.error('ice-connection-failed', { deviceId });
    setIceError('Connection lost');
    // Auto-clear after 10s — phone should send hangup or TV will reset
    const timer = setTimeout(() => clear(), 10000);
    return () => clearTimeout(timer);
  } else if (connectionState === 'connected') {
    setIceError(null);
  }
}, [connectionState, clear, deviceId]);
```

Add a visual indicator in the TV's status area:

```jsx
{iceError && <div className="videocall__ice-error">{iceError}</div>}
```

Style in `VideoCall.scss`:

```scss
.videocall__ice-error {
  position: absolute;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 50, 50, 0.85);
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 1.2rem;
  z-index: 10;
}
```

**Step 6: Commit**

```bash
git add frontend/src/modules/Input/hooks/useWebRTCPeer.js frontend/src/Apps/CallApp.jsx frontend/src/Apps/CallApp.scss frontend/src/modules/Input/VideoCall.jsx frontend/src/modules/Input/VideoCall.scss
git commit -m "feat: handle ICE connection failure with user feedback

Both CallApp (phone) and VideoCall (TV) now react to 'failed' and
'disconnected' peer connection states. Phone shows error overlay with
End Call button. TV shows error and auto-clears after 10s.
Closes audit gap G6."
```

---

## Task 5: Add Server-Side Call State Tracking

**Audit refs:** Issues 8, 9 (O2, O3), Gap G1 — High severity. The backend is a "dumb relay" with no call awareness. The `/off` endpoint unconditionally powers off devices, even during active calls.

**Files:**
- Create: `backend/src/3_applications/homeline/CallStateService.mjs`
- Modify: `backend/src/4_api/v1/routers/device.mjs`
- Modify: `backend/src/0_system/websocket.mjs` (or wherever WS relay lives — need to verify exact path)

**Context:** The backend already relays all `homeline:*` WebSocket messages. We need a lightweight service that watches these messages and maintains a map of active calls: `{ deviceId: { phonePeerId, startedAt } }`. The `/off` endpoint should check this map before powering off. This is the server-side half of fixing spurious power-offs; Task 6 handles the client-side half.

**Step 1: Find the WebSocket relay code**

Before implementing, locate the file that handles WebSocket message relay. Search for:
```bash
grep -rn 'homeline' backend/src/
```

Identify where `homeline:*` messages are relayed. The service will hook into this relay to observe signaling traffic.

**Step 2: Create `CallStateService.mjs`**

```javascript
// backend/src/3_applications/homeline/CallStateService.mjs

/**
 * Lightweight in-memory tracker for active homeline calls.
 * Watches WebSocket signaling messages to maintain call state.
 * Used by device endpoints to guard against spurious power-off.
 */

const activeCalls = new Map(); // deviceId -> { phonePeerId, startedAt }

const ZOMBIE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — auto-clear stale calls

export function handleSignalingMessage(message) {
  const { topic, type, from } = message;
  if (!topic?.startsWith('homeline:')) return;

  const deviceId = topic.replace('homeline:', '');

  if (type === 'offer' && from?.startsWith('phone-')) {
    activeCalls.set(deviceId, { phonePeerId: from, startedAt: Date.now() });
    // Auto-clear zombie calls after timeout
    setTimeout(() => {
      const call = activeCalls.get(deviceId);
      if (call && call.phonePeerId === from) {
        activeCalls.delete(deviceId);
      }
    }, ZOMBIE_TIMEOUT_MS);
  }

  if (type === 'hangup') {
    activeCalls.delete(deviceId);
  }
}

export function getActiveCall(deviceId) {
  return activeCalls.get(deviceId) || null;
}

export function hasActiveCall(deviceId) {
  return activeCalls.has(deviceId);
}

export function forceEndCall(deviceId) {
  activeCalls.delete(deviceId);
}
```

**Step 3: Hook into WebSocket relay**

In the WebSocket relay file (path to be confirmed in Step 1), add a call to `handleSignalingMessage` whenever a message is relayed:

```javascript
import { handleSignalingMessage } from '../3_applications/homeline/CallStateService.mjs';

// Inside the message relay handler:
handleSignalingMessage(message);
```

This is a passive observer — it does not modify the relay behavior.

**Step 4: Guard the `/off` endpoint in `device.mjs`**

In `backend/src/4_api/v1/routers/device.mjs`, modify the `/:deviceId/off` handler:

```javascript
import { hasActiveCall, forceEndCall } from '../../../3_applications/homeline/CallStateService.mjs';

// Inside the /off handler, before powering off:
router.get('/:deviceId/off', asyncHandler(async (req, res) => {
  const { deviceId } = req.params;
  const force = req.query.force === 'true';

  if (hasActiveCall(deviceId) && !force) {
    logger.info?.('power-off-blocked-active-call', { deviceId });
    return res.status(409).json({
      ok: false,
      error: 'Active videocall in progress',
      hint: 'Use ?force=true to override'
    });
  }

  if (force && hasActiveCall(deviceId)) {
    logger.info?.('power-off-forced-during-call', { deviceId });
    forceEndCall(deviceId);
  }

  // ... existing power-off logic
}));
```

**Step 5: Update the phone's `endCall` to use `?force=true`**

In `CallApp.jsx`, the `endCall` function calls `DaylightAPI(\`/api/v1/device/${devId}/off\`)`. Update this to include `?force=true` since the phone explicitly ending the call is a legitimate power-off:

```javascript
DaylightAPI(`/api/v1/device/${devId}/off?force=true`).catch(() => {});
```

Also update the unmount cleanup:

```javascript
// In the cleanup effect:
DaylightAPI(`/api/v1/device/${devId}/off?force=true`).catch(() => {});
```

**Step 6: Test the guard**

Manual test flow:
1. Start a call between phone and TV
2. While call is active, open a new terminal and `curl http://localhost:3112/api/v1/device/{deviceId}/off`
3. Expected: 409 response with `"Active videocall in progress"`
4. `curl http://localhost:3112/api/v1/device/{deviceId}/off?force=true`
5. Expected: 200 response, device powers off

**Step 7: Commit**

```bash
git add backend/src/3_applications/homeline/CallStateService.mjs backend/src/4_api/v1/routers/device.mjs backend/src/0_system/websocket.mjs frontend/src/Apps/CallApp.jsx
git commit -m "feat: add server-side call state tracking, guard power-off endpoint

New CallStateService watches homeline signaling to track active calls.
The /off endpoint now returns 409 during active calls unless ?force=true.
Phone's endCall and cleanup use ?force=true for legitimate power-offs.
Includes 5-minute zombie timeout for crashed phone sessions.
Closes audit issues 8, 9 (O2, O3) and gap G1."
```

---

## Task 6: Add Tab Coordination for Power-Off

**Audit refs:** Issue 8 (O2), Gap G4 — High severity. Multiple browser tabs independently send power-off commands. Only the tab that initiated the call should control power-off.

**Files:**
- Create: `frontend/src/modules/Input/hooks/useCallOwnership.js`
- Modify: `frontend/src/Apps/CallApp.jsx`

**Context:** When a user opens `/call` in multiple tabs (or refreshes during a call), each tab independently tracks `connectedDeviceRef` and fires `GET /device/{id}/off` on close. Combined with Task 5's server-side guard, the spurious power-offs will now be rejected (409). But we should also prevent the unnecessary requests from the frontend.

The `BroadcastChannel` API allows same-origin tabs to communicate. We'll create a hook that elects one tab as the "call owner" and only that tab sends power-off commands.

**Step 1: Create `useCallOwnership.js`**

```javascript
// frontend/src/modules/Input/hooks/useCallOwnership.js
import { useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useCallOwnership' });
  return _logger;
}

const CHANNEL_NAME = 'homeline-call-owner';

/**
 * Coordinates call ownership across browser tabs.
 * Only the tab that claims ownership should send power-off on close.
 *
 * @param {string|null} deviceId - The device currently being called, or null if idle
 * @returns {{ isOwner: boolean }}
 */
export default function useCallOwnership(deviceId) {
  const channelRef = useRef(null);
  const isOwnerRef = useRef(false);
  const tabId = useRef(`${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);

  useEffect(() => {
    if (!window.BroadcastChannel) {
      // Fallback: assume owner if BroadcastChannel not available
      isOwnerRef.current = !!deviceId;
      return;
    }

    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;

    if (deviceId) {
      // Claim ownership
      channel.postMessage({ type: 'claim', tabId: tabId.current, deviceId });
      isOwnerRef.current = true;
      logger().info('call-ownership-claimed', { tabId: tabId.current, deviceId });
    } else {
      isOwnerRef.current = false;
    }

    channel.onmessage = (event) => {
      const { type, tabId: claimantId, deviceId: claimantDevice } = event.data;
      if (type === 'claim' && claimantId !== tabId.current && claimantDevice === deviceId) {
        // Another tab claimed ownership for the same device — yield
        isOwnerRef.current = false;
        logger().info('call-ownership-yielded', { to: claimantId, deviceId });
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [deviceId]);

  const isOwner = useCallback(() => isOwnerRef.current, []);

  return { isOwner };
}
```

**Step 2: Integrate into CallApp**

In `CallApp.jsx`, import and use the hook:

```javascript
import useCallOwnership from '../modules/Input/hooks/useCallOwnership.js';
```

Call the hook with the currently connected device:

```javascript
const { isOwner } = useCallOwnership(connectedDeviceRef.current && status !== 'idle' ? connectedDeviceRef.current : null);
```

Update the cleanup effect to check ownership before sending power-off:

```javascript
return () => {
  window.removeEventListener('beforeunload', handleBeforeUnload);
  const devId = connectedDeviceRef.current;
  if (devId && isOwner()) {
    DaylightAPI(`/api/v1/device/${devId}/off?force=true`).catch(() => {});
  }
};
```

Update `endCall` similarly — only power off if this tab is the owner:

```javascript
if (devId && isOwner()) {
  await DaylightAPI(`/api/v1/device/${devId}/off?force=true`).catch(() => {});
}
```

**Step 3: Test multi-tab behavior**

Manual test:
1. Open `/call` in Tab A, start a call
2. Open `/call` in Tab B (same browser)
3. Close Tab B — expect NO power-off request (Tab B is not the owner)
4. Close Tab A — expect power-off request (Tab A is the owner)

**Step 4: Commit**

```bash
git add frontend/src/modules/Input/hooks/useCallOwnership.js frontend/src/Apps/CallApp.jsx
git commit -m "feat: add tab coordination for call power-off via BroadcastChannel

Only the tab that initiated the call sends power-off on close. Other tabs
yield ownership when they detect a claim from another tab. Prevents the
'six spurious power-offs' scenario from multi-tab use.
Closes audit issue 8 (O2) and gap G4."
```

---

## Task 7: Add Mute/Unmute Controls

**Audit refs:** O5 — Medium severity. No way to mute audio or disable video during a call. Essential for production use.

**Files:**
- Create: `frontend/src/modules/Input/hooks/useMediaControls.js`
- Modify: `frontend/src/Apps/CallApp.jsx`
- Modify: `frontend/src/Apps/CallApp.scss`
- Modify: `frontend/src/modules/Input/VideoCall.jsx`
- Modify: `frontend/src/modules/Input/VideoCall.scss`
- Modify: `frontend/src/modules/Input/hooks/useHomeline.js`

**Context:** Both the phone (CallApp) and TV (VideoCall) need mute/unmute for audio and video. The implementation has two parts: (1) toggling `track.enabled` on the local MediaStream's tracks (this is instant, no renegotiation needed), and (2) sending a signaling message so the remote side can show a mute indicator.

**Step 1: Create `useMediaControls.js`**

```javascript
// frontend/src/modules/Input/hooks/useMediaControls.js
import { useState, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useMediaControls' });
  return _logger;
}

/**
 * Controls mute/unmute for audio and video tracks on a MediaStream.
 *
 * @param {MediaStream|null} stream - The local media stream
 * @returns {{ audioMuted, videoMuted, toggleAudio, toggleVideo }}
 */
export default function useMediaControls(stream) {
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);

  const toggleAudio = useCallback(() => {
    if (!stream) return;
    const newMuted = !audioMuted;
    stream.getAudioTracks().forEach(track => { track.enabled = !newMuted; });
    setAudioMuted(newMuted);
    logger().info('audio-toggle', { muted: newMuted });
  }, [stream, audioMuted]);

  const toggleVideo = useCallback(() => {
    if (!stream) return;
    const newMuted = !videoMuted;
    stream.getVideoTracks().forEach(track => { track.enabled = !newMuted; });
    setVideoMuted(newMuted);
    logger().info('video-toggle', { muted: newMuted });
  }, [stream, videoMuted]);

  return { audioMuted, videoMuted, toggleAudio, toggleVideo };
}
```

**Step 2: Add signaling messages for mute state**

In `useHomeline.js`, the `sendMessage` function sends messages to the topic. We need to expose a `sendMuteState` function that both CallApp and VideoCall can call. Rather than modifying the hook's return, both sides can use the existing WebSocket `publish` function.

Add a new message type to the signaling protocol. In both CallApp and VideoCall, after toggling a track, send a message:

```javascript
// In the toggle handler (after calling toggleAudio/toggleVideo):
wsService.publish({
  topic: `homeline:${deviceId}`,
  type: 'mute-state',
  from: peerId,
  audioMuted: newAudioMuted,
  videoMuted: newVideoMuted
});
```

Actually, let's keep it simpler — add `sendMuteState` to the `useHomeline` return value:

In `useHomeline.js`, add a function:

```javascript
const sendMuteState = useCallback((audioMuted, videoMuted) => {
  if (!connectedDeviceRef.current) return;
  wsService.publish({
    topic: `homeline:${connectedDeviceRef.current}`,
    type: 'mute-state',
    from: peerIdRef.current,
    audioMuted,
    videoMuted
  });
}, []);
```

Add `mute-state` to the message handler. When received, expose the remote mute state:

```javascript
// Add state:
const [remoteMuteState, setRemoteMuteState] = useState({ audioMuted: false, videoMuted: false });

// In the message handler:
case 'mute-state':
  setRemoteMuteState({ audioMuted: msg.audioMuted, videoMuted: msg.videoMuted });
  break;
```

Add to the return object:

```javascript
return { peerConnected, status, connect, hangUp, sendMuteState, remoteMuteState };
```

**Step 3: Add mute buttons to CallApp**

In `CallApp.jsx`, import and use the hook:

```javascript
import useMediaControls from '../modules/Input/hooks/useMediaControls.js';

// Inside the component:
const { audioMuted, videoMuted, toggleAudio, toggleVideo } = useMediaControls(stream);
```

Send mute state to remote when toggling:

```javascript
const handleToggleAudio = () => {
  toggleAudio();
  sendMuteState(!audioMuted, videoMuted);
};

const handleToggleVideo = () => {
  toggleVideo();
  sendMuteState(audioMuted, !videoMuted);
};
```

Add buttons to the connected view, next to the existing hangup button:

```jsx
<div className="call-app__controls">
  <button
    className={`call-app__mute-btn ${audioMuted ? 'call-app__mute-btn--active' : ''}`}
    onClick={handleToggleAudio}
    aria-label={audioMuted ? 'Unmute audio' : 'Mute audio'}
  >
    {audioMuted ? '🔇' : '🔊'}
  </button>
  <button
    className={`call-app__mute-btn ${videoMuted ? 'call-app__mute-btn--active' : ''}`}
    onClick={handleToggleVideo}
    aria-label={videoMuted ? 'Enable video' : 'Disable video'}
  >
    {videoMuted ? '📷' : '📹'}
  </button>
  {/* existing hangup button */}
</div>
```

Note: Using emoji above as placeholders. If the project has an icon system, use that instead. Check what the hangup button uses for its icon and follow the same pattern.

**Step 4: Show remote mute indicator**

In CallApp's connected view, show an indicator when the remote side is muted:

```jsx
{remoteMuteState.audioMuted && (
  <div className="call-app__remote-muted">Remote audio muted</div>
)}
```

**Step 5: Style mute controls**

In `CallApp.scss`:

```scss
.call-app__controls {
  display: flex;
  gap: 1rem;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 0;
}

.call-app__mute-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.1);
  color: white;
  font-size: 1.2rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  &--active {
    background: rgba(255, 50, 50, 0.5);
    border-color: rgba(255, 50, 50, 0.7);
  }
}

.call-app__remote-muted {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  background: rgba(0, 0, 0, 0.6);
  color: #ccc;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
}
```

**Step 6: Add mute controls to VideoCall (TV side)**

Same pattern in `VideoCall.jsx`:

```javascript
import useMediaControls from './hooks/useMediaControls.js';

const { audioMuted, videoMuted, toggleAudio, toggleVideo } = useMediaControls(stream);
```

The TV likely doesn't need on-screen mute buttons (no one is there to tap them), but it should show the remote mute indicator:

```jsx
{remoteMuteState.audioMuted && (
  <div className="videocall__remote-muted">Phone audio muted</div>
)}
```

Style in `VideoCall.scss`:

```scss
.videocall__remote-muted {
  position: absolute;
  top: 1rem;
  right: 1rem;
  background: rgba(0, 0, 0, 0.6);
  color: #ccc;
  padding: 0.25rem 0.75rem;
  border-radius: 4px;
  font-size: 1rem;
}
```

**Step 7: Commit**

```bash
git add frontend/src/modules/Input/hooks/useMediaControls.js frontend/src/modules/Input/hooks/useHomeline.js frontend/src/Apps/CallApp.jsx frontend/src/Apps/CallApp.scss frontend/src/modules/Input/VideoCall.jsx frontend/src/modules/Input/VideoCall.scss
git commit -m "feat: add mute/unmute controls for audio and video

New useMediaControls hook toggles track.enabled on local streams.
Mute state synced via homeline signaling so remote side shows indicator.
Phone gets mute buttons; TV shows remote mute status.
Closes audit issue O5."
```

---

## Summary

| Task | Audit Ref | Severity | Files Changed | New Files |
|------|-----------|----------|---------------|-----------|
| 1. Fix console.error | O6 | Low | 2 | 0 |
| 2. Webcam readiness gate | O1, G5 | High | 2 | 0 |
| 3. Connection timeout | O4 | Medium | 2 | 0 |
| 4. ICE failure handling | G6 | High | 5 | 0 |
| 5. Server-side call state | O2, O3, G1 | High | 3-4 | 1 |
| 6. Tab coordination | O2, G4 | High | 2 | 1 |
| 7. Mute/unmute controls | O5 | Medium | 6 | 1 |

**Total commits:** 7 (one per task)

**Dependencies:** Tasks 5 and 6 are related (both fix spurious power-offs) but can be committed independently. Task 5 provides the server-side guard; Task 6 prevents the requests from being sent. Either works standalone but together they provide defense in depth.

**Not addressed in this plan (deferred per audit Priority 3-4):**
- Call duration display (Priority 3 — polish)
- ICE restart / reconnection logic (Priority 3 — polish)
- TURN server / LiveKit migration (Priority 4 — future)
- Authentication for `/call` (Priority 4 — future)
- Call history persistence (Priority 4 — future)
