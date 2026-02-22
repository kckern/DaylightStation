# Home Line Video Call Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 1:1 P2P WebRTC video calling between a TV kiosk and a mobile browser, using the existing WebSocket event bus for signaling.

**Architecture:** TV broadcasts availability on a device-specific WebSocket topic (`homeline:{deviceId}`). Phone discovers available devices, sends an SDP offer, TV answers. Media flows directly P2P via RTCPeerConnection. No new backend services — signaling piggybacks on the existing `/ws` event bus.

**Tech Stack:** WebRTC (native browser), existing WebSocket event bus, React hooks

**Design doc:** `docs/plans/2026-02-21-homeline-videocall-design.md`

---

### Task 1: Backend — Homeline Message Relay

**Files:**
- Modify: `backend/src/app.mjs` (near line 344, after piano MIDI handler)

**Step 1: Add homeline relay handler**

In `app.mjs`, inside the `eventBus.onClientMessage` callback (line 323), add after the piano MIDI block (after line 344):

```javascript
    // Homeline video call signaling - relay to all subscribers of this device's topic
    if (message.topic?.startsWith('homeline:')) {
      eventBus.broadcast(message.topic, message);
      return;
    }
```

This relays any message with a `homeline:*` topic to all WebSocket clients subscribed to that topic. The sender may also receive their own message — hooks filter by `from` field.

**Step 2: Verify backend restarts cleanly**

Check dev.log for errors after nodemon restarts.

**Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "feat: relay homeline signaling messages via WebSocket event bus"
```

---

### Task 2: Hook — useWebRTCPeer

**Files:**
- Create: `frontend/src/modules/Input/hooks/useWebRTCPeer.js`

**Step 1: Implement the hook**

```javascript
import { useState, useEffect, useRef, useCallback } from 'react';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useWebRTCPeer' });
  return _logger;
}

const STUN_CONFIG = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

/**
 * Manages a single RTCPeerConnection lifecycle.
 *
 * @param {MediaStream|null} localStream - local getUserMedia stream to send
 * @returns {{
 *   pcRef, remoteStream, connectionState,
 *   createOffer, handleOffer, handleAnswer, addIceCandidate,
 *   onIceCandidate, reset
 * }}
 */
export const useWebRTCPeer = (localStream) => {
  const pcRef = useRef(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('new');
  const iceCandidateCallbackRef = useRef(null);

  const createPC = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
    }

    const pc = new RTCPeerConnection(STUN_CONFIG);
    pcRef.current = pc;

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Collect remote tracks
    const remote = new MediaStream();
    setRemoteStream(remote);

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach(track => {
        remote.addTrack(track);
      });
      // Trigger re-render with updated stream
      setRemoteStream(new MediaStream(remote.getTracks()));
      logger().debug('remote-track-added', { kind: event.track.kind });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && iceCandidateCallbackRef.current) {
        iceCandidateCallbackRef.current(event.candidate);
      }
    };

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      logger().debug('connection-state', { state: pc.connectionState });
    };

    return pc;
  }, [localStream]);

  const createOffer = useCallback(async () => {
    const pc = createPC();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }, [createPC]);

  const handleOffer = useCallback(async (offer) => {
    const pc = createPC();
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }, [createPC]);

  const handleAnswer = useCallback(async (answer) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }, []);

  const addIceCandidate = useCallback(async (candidate) => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      logger().warn('ice-candidate-failed', { error: err.message });
    }
  }, []);

  const onIceCandidate = useCallback((callback) => {
    iceCandidateCallbackRef.current = callback;
  }, []);

  const reset = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    setRemoteStream(null);
    setConnectionState('new');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, []);

  return {
    pcRef,
    remoteStream,
    connectionState,
    createOffer,
    handleOffer,
    handleAnswer,
    addIceCandidate,
    onIceCandidate,
    reset,
  };
};
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Input/hooks/useWebRTCPeer.js
git commit -m "feat: add useWebRTCPeer hook for P2P connection lifecycle"
```

---

### Task 3: Hook — useHomeline

**Files:**
- Create: `frontend/src/modules/Input/hooks/useHomeline.js`

**Step 1: Implement the hook**

This hook orchestrates signaling over the WebSocket bus. It has two modes:
- **TV mode (`role: 'tv'`):** broadcasts `waiting` heartbeat, listens for `offer`, creates answer
- **Phone mode (`role: 'phone'`):** listens for `waiting`/`occupied`, creates offer, sends answer

```javascript
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import wsService from '../../../services/WebSocketService.js';
import getLogger from '../../../lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'useHomeline' });
  return _logger;
}

/**
 * Signaling for the home line video call.
 *
 * @param {'tv'|'phone'} role
 * @param {string|null} deviceId - required for TV, selected by phone
 * @param {Object} peer - useWebRTCPeer instance
 * @returns {{
 *   peerConnected, availableDevices, status,
 *   connect, hangUp
 * }}
 */
export const useHomeline = (role, deviceId, peer) => {
  const [peerConnected, setPeerConnected] = useState(false);
  const [availableDevices, setAvailableDevices] = useState([]);
  const [status, setStatus] = useState(role === 'tv' ? 'waiting' : 'discovering');
  const peerId = useMemo(() => `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, [role]);
  const heartbeatRef = useRef(null);
  const connectedDeviceRef = useRef(null);

  const topic = useCallback((devId) => `homeline:${devId}`, []);

  const send = useCallback((devId, type, payload = {}) => {
    wsService.send({ topic: topic(devId), type, from: peerId, ...payload });
  }, [topic, peerId]);

  // TV: broadcast waiting heartbeat
  useEffect(() => {
    if (role !== 'tv' || !deviceId) return;

    const sendWaiting = () => send(deviceId, 'waiting', { label: deviceId });
    sendWaiting();
    heartbeatRef.current = setInterval(sendWaiting, 5000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [role, deviceId, send]);

  // Set up ICE candidate relay
  useEffect(() => {
    const devId = role === 'tv' ? deviceId : connectedDeviceRef.current;
    if (!devId) return;

    peer.onIceCandidate((candidate) => {
      send(devId, 'candidate', { candidate });
    });
  }, [role, deviceId, peer, send]);

  // TV: listen for signaling messages
  useEffect(() => {
    if (role !== 'tv' || !deviceId) return;

    const unsubscribe = wsService.subscribe(
      (data) => data.topic === topic(deviceId) && data.from !== peerId,
      async (message) => {
        try {
          if (message.type === 'offer') {
            if (peerConnected) {
              send(deviceId, 'occupied');
              return;
            }
            logger().info('offer-received', { from: message.from });
            setStatus('connecting');
            const answer = await peer.handleOffer({ type: 'offer', sdp: message.sdp });
            send(deviceId, 'answer', { sdp: answer.sdp });
            setPeerConnected(true);
            setStatus('connected');
          } else if (message.type === 'candidate') {
            await peer.addIceCandidate(message.candidate);
          } else if (message.type === 'hangup') {
            logger().info('peer-hangup');
            peer.reset();
            setPeerConnected(false);
            setStatus('waiting');
          }
        } catch (err) {
          logger().warn('signaling-error', { error: err.message });
        }
      }
    );

    return unsubscribe;
  }, [role, deviceId, topic, peerId, peer, peerConnected, send]);

  // Phone: discover available devices
  useEffect(() => {
    if (role !== 'phone') return;

    const devices = new Map(); // deviceId → { label, lastSeen }

    const unsubscribe = wsService.subscribe(
      (data) => data.topic?.startsWith('homeline:') && data.from !== peerId,
      (message) => {
        if (message.type === 'waiting') {
          const devId = message.topic.replace('homeline:', '');
          devices.set(devId, { label: message.label || devId, lastSeen: Date.now() });
          setAvailableDevices([...devices.entries()].map(([id, d]) => ({ id, label: d.label })));
        } else if (message.type === 'occupied') {
          setStatus('occupied');
        }
      }
    );

    // Prune stale devices (no heartbeat for 15s)
    const pruner = setInterval(() => {
      const now = Date.now();
      for (const [id, d] of devices) {
        if (now - d.lastSeen > 15000) devices.delete(id);
      }
      setAvailableDevices([...devices.entries()].map(([id, d]) => ({ id, label: d.label })));
    }, 5000);

    return () => {
      unsubscribe();
      clearInterval(pruner);
    };
  }, [role, peerId]);

  // Phone: connect to a specific device
  const connect = useCallback(async (targetDeviceId) => {
    if (role !== 'phone') return;
    connectedDeviceRef.current = targetDeviceId;
    setStatus('connecting');

    // Set up ICE relay for this device
    peer.onIceCandidate((candidate) => {
      send(targetDeviceId, 'candidate', { candidate });
    });

    // Listen for answer and ICE from TV
    const unsubAnswer = wsService.subscribe(
      (data) => data.topic === topic(targetDeviceId) && data.from !== peerId,
      async (message) => {
        try {
          if (message.type === 'answer') {
            await peer.handleAnswer({ type: 'answer', sdp: message.sdp });
            setPeerConnected(true);
            setStatus('connected');
          } else if (message.type === 'candidate') {
            await peer.addIceCandidate(message.candidate);
          } else if (message.type === 'hangup') {
            peer.reset();
            setPeerConnected(false);
            setStatus('discovering');
            connectedDeviceRef.current = null;
          }
        } catch (err) {
          logger().warn('signaling-error', { error: err.message });
        }
      }
    );

    // Create and send offer
    const offer = await peer.createOffer();
    send(targetDeviceId, 'offer', { sdp: offer.sdp });

    logger().info('offer-sent', { target: targetDeviceId });

    // Store unsubscribe for cleanup
    return unsubAnswer;
  }, [role, peer, peerId, topic, send]);

  // Hang up
  const hangUp = useCallback(() => {
    const devId = role === 'tv' ? deviceId : connectedDeviceRef.current;
    if (devId) send(devId, 'hangup');
    peer.reset();
    setPeerConnected(false);
    setStatus(role === 'tv' ? 'waiting' : 'discovering');
    connectedDeviceRef.current = null;
  }, [role, deviceId, peer, send]);

  // Send hangup on unmount
  useEffect(() => {
    return () => {
      const devId = role === 'tv' ? deviceId : connectedDeviceRef.current;
      if (devId) {
        wsService.send({ topic: topic(devId), type: 'hangup', from: peerId });
      }
    };
  }, [role, deviceId, topic, peerId]);

  return { peerConnected, availableDevices, status, connect, hangUp };
};
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Input/hooks/useHomeline.js
git commit -m "feat: add useHomeline hook for WebSocket signaling"
```

---

### Task 4: Component — VideoCall.jsx (TV Side)

**Files:**
- Create: `frontend/src/modules/Input/VideoCall.jsx`
- Create: `frontend/src/modules/Input/VideoCall.scss`

**Step 1: Implement TV-side split view**

`VideoCall.jsx`:

```jsx
import React, { useRef, useEffect, useMemo } from 'react';
import { useMediaDevices } from './hooks/useMediaDevices';
import { useWebcamStream } from './hooks/useWebcamStream';
import { useVolumeMeter } from './hooks/useVolumeMeter';
import { useWebRTCPeer } from './hooks/useWebRTCPeer';
import { useHomeline } from './hooks/useHomeline';
import './VideoCall.scss';

export default function VideoCall({ deviceId, clear }) {
  const {
    selectedVideoDevice,
    selectedAudioDevice,
  } = useMediaDevices();

  const { videoRef, stream } = useWebcamStream(selectedVideoDevice, selectedAudioDevice);
  const { volume } = useVolumeMeter(stream);
  const peer = useWebRTCPeer(stream);
  const { peerConnected, status } = useHomeline('tv', deviceId, peer);

  const remoteVideoRef = useRef(null);

  // Attach remote stream to video element
  useEffect(() => {
    if (remoteVideoRef.current && peer.remoteStream) {
      remoteVideoRef.current.srcObject = peer.remoteStream;
    }
  }, [peer.remoteStream]);

  // Escape to exit
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' || e.key === 'XF86Back') {
        clear?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clear]);

  const volumePercentage = Math.min(volume * 100, 100);

  return (
    <div className="videocall-tv">
      {peerConnected ? (
        <div className="videocall-tv__split">
          {/* Remote: phone portrait video */}
          <div className="videocall-tv__panel videocall-tv__panel--remote">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="videocall-tv__video videocall-tv__video--portrait"
            />
          </div>

          {/* Local: TV landscape camera */}
          <div className="videocall-tv__panel videocall-tv__panel--local">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="videocall-tv__video videocall-tv__video--landscape"
              style={{ transform: 'scaleX(-1)' }}
            />
          </div>
        </div>
      ) : (
        /* Solo: fullscreen local preview (existing webcam behavior) */
        <div className="videocall-tv__solo">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="videocall-tv__video videocall-tv__video--fullscreen"
            style={{ transform: 'scaleX(-1)' }}
          />
        </div>
      )}

      {/* Status indicator */}
      <div className="videocall-tv__status">
        {status === 'waiting' && 'Home Line — Waiting'}
        {status === 'connecting' && 'Connecting...'}
        {status === 'connected' && 'Connected'}
      </div>

      {/* Volume meter */}
      <div className="videocall-tv__meter">
        <div className="videocall-tv__meter-fill" style={{ width: `${volumePercentage}%` }} />
      </div>
    </div>
  );
}
```

`VideoCall.scss`:

```scss
.videocall-tv {
  width: 100%;
  height: 100%;
  position: relative;
  background: #000;
  overflow: hidden;

  &__split {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2rem;
    width: 100%;
    height: 100%;
    padding: 2rem;
    box-sizing: border-box;
  }

  &__panel {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    &--remote {
      flex: 0 0 auto;
      height: 90%;
    }

    &--local {
      flex: 1;
      height: 90%;
    }
  }

  &__video {
    border-radius: 8px;
    object-fit: contain;
    background: #111;

    &--portrait {
      height: 100%;
      max-width: 100%;
      aspect-ratio: 9/16;
    }

    &--landscape {
      width: 100%;
      max-height: 100%;
      aspect-ratio: 16/9;
    }

    &--fullscreen {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &__solo {
    width: 100%;
    height: 100%;
  }

  &__status {
    position: absolute;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
    padding: 0.4rem 1rem;
    border-radius: 4px;
    font-size: 0.9rem;
    z-index: 10;
  }

  &__meter {
    position: absolute;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    width: 300px;
    height: 16px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    overflow: hidden;
    z-index: 10;
  }

  &__meter-fill {
    height: 100%;
    background: #4caf50;
    border-radius: 8px;
    transition: width 0.1s;
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Input/VideoCall.jsx frontend/src/modules/Input/VideoCall.scss
git commit -m "feat: add VideoCall TV-side split view component"
```

---

### Task 5: App Wrapper — VideoCall Registry Entry

**Files:**
- Create: `frontend/src/modules/AppContainer/Apps/VideoCall/VideoCall.jsx`
- Create: `frontend/src/modules/AppContainer/Apps/VideoCall/VideoCall.scss`
- Create: `frontend/src/assets/app-icons/videocall.svg`
- Modify: `frontend/src/lib/appRegistry.js`

**Step 1: Create the thin wrapper**

`frontend/src/modules/AppContainer/Apps/VideoCall/VideoCall.jsx`:

```jsx
import BaseVideoCall from "../../../Input/VideoCall.jsx";
import "./VideoCall.scss";

export default function VideoCallApp({ param, clear }) {
  return <BaseVideoCall deviceId={param} clear={clear} />;
}
```

`frontend/src/modules/AppContainer/Apps/VideoCall/VideoCall.scss`:

```scss
.videocall-app {
  width: 100%;
  height: 100%;
}
```

**Step 2: Create icon SVG**

`frontend/src/assets/app-icons/videocall.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
```

**Step 3: Add to registry**

In `frontend/src/lib/appRegistry.js`, add import (after line 11):

```javascript
import videocallIcon from '../assets/app-icons/videocall.svg';
```

Add entry (after the `webcam` entry):

```javascript
  'videocall':       { label: 'Video Call',       icon: videocallIcon,      param: { name: 'device' }, component: () => import('../modules/AppContainer/Apps/VideoCall/VideoCall.jsx') },
```

The `param: { name: 'device' }` means the URL `/tv?open=videocall/livingroom-tv` passes `param="livingroom-tv"` to the component.

**Step 4: Commit**

```bash
git add frontend/src/modules/AppContainer/Apps/VideoCall/ \
       frontend/src/assets/app-icons/videocall.svg \
       frontend/src/lib/appRegistry.js
git commit -m "feat: register videocall app with icon and wrapper"
```

---

### Task 6: CallApp — Phone-Side Standalone Page

**Files:**
- Create: `frontend/src/Apps/CallApp.jsx`
- Create: `frontend/src/Apps/CallApp.scss`
- Modify: `frontend/src/main.jsx`

**Step 1: Implement CallApp**

`CallApp.jsx`:

```jsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useMediaDevices } from '../modules/Input/hooks/useMediaDevices';
import { useWebcamStream } from '../modules/Input/hooks/useWebcamStream';
import { useWebRTCPeer } from '../modules/Input/hooks/useWebRTCPeer';
import { useHomeline } from '../modules/Input/hooks/useHomeline';
import './CallApp.scss';

export default function CallApp() {
  const {
    selectedVideoDevice,
    selectedAudioDevice,
  } = useMediaDevices();

  const { videoRef: localVideoRef, stream } = useWebcamStream(selectedVideoDevice, selectedAudioDevice);
  const peer = useWebRTCPeer(stream);
  const { peerConnected, availableDevices, status, connect, hangUp } = useHomeline('phone', null, peer);

  const remoteVideoRef = useRef(null);

  // Attach remote stream
  useEffect(() => {
    if (remoteVideoRef.current && peer.remoteStream) {
      remoteVideoRef.current.srcObject = peer.remoteStream;
    }
  }, [peer.remoteStream]);

  // Send hangup on tab close
  useEffect(() => {
    const handleBeforeUnload = () => hangUp();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hangUp]);

  // Auto-connect if only one device
  useEffect(() => {
    if (status === 'discovering' && availableDevices.length === 1) {
      connect(availableDevices[0].id);
    }
  }, [status, availableDevices, connect]);

  if (status === 'discovering' || status === 'occupied') {
    return (
      <div className="call-app call-app--lobby">
        <div className="call-app__lobby-content">
          <h1 className="call-app__title">Home Line</h1>

          {availableDevices.length === 0 && (
            <p className="call-app__message">Looking for available rooms...</p>
          )}

          {status === 'occupied' && (
            <p className="call-app__message">Room is busy</p>
          )}

          {availableDevices.length > 1 && (
            <div className="call-app__device-list">
              {availableDevices.map((device) => (
                <button
                  key={device.id}
                  className="call-app__device-btn"
                  onClick={() => connect(device.id)}
                >
                  {device.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="call-app call-app--connected">
      {/* Remote: TV landscape video */}
      <div className="call-app__remote">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="call-app__video call-app__video--wide"
        />
      </div>

      {/* Local: phone portrait self-preview */}
      <div className="call-app__local">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className="call-app__video call-app__video--tall"
          style={{ transform: 'scaleX(-1)' }}
        />
      </div>

      {/* Hang up button */}
      <button className="call-app__hangup" onClick={hangUp}>
        Hang Up
      </button>

      {status === 'connecting' && (
        <div className="call-app__overlay">Connecting...</div>
      )}
    </div>
  );
}
```

**Step 2: Style the phone layout**

`CallApp.scss`:

```scss
.call-app {
  width: 100vw;
  height: 100vh;
  background: #000;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  overflow: hidden;

  // ── Lobby ──
  &--lobby {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__lobby-content {
    text-align: center;
    padding: 2rem;
  }

  &__title {
    font-size: 1.8rem;
    font-weight: 300;
    margin-bottom: 2rem;
  }

  &__message {
    color: #aaa;
    font-size: 1rem;
  }

  &__device-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  &__device-btn {
    background: #222;
    color: #fff;
    border: 1px solid #444;
    border-radius: 8px;
    padding: 1rem 2rem;
    font-size: 1.1rem;
    cursor: pointer;

    &:active {
      background: #333;
    }
  }

  // ── Connected ──
  &--connected {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 1rem;
    box-sizing: border-box;
  }

  &__remote {
    flex: 0 0 auto;
    width: 100%;
    display: flex;
    justify-content: center;
  }

  &__local {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 0;
  }

  &__video {
    border-radius: 8px;
    background: #111;
    object-fit: contain;

    &--wide {
      width: 100%;
      aspect-ratio: 16/9;
    }

    &--tall {
      height: 100%;
      max-width: 100%;
      aspect-ratio: 9/16;
    }
  }

  &__hangup {
    flex: 0 0 auto;
    background: #d32f2f;
    color: #fff;
    border: none;
    border-radius: 24px;
    padding: 0.8rem 2.5rem;
    font-size: 1.1rem;
    cursor: pointer;
    margin-bottom: 1rem;

    &:active {
      background: #b71c1c;
    }
  }

  &__overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    font-size: 1.2rem;
    z-index: 100;
  }
}
```

**Step 3: Add route to main.jsx**

In `frontend/src/main.jsx`, add import near the other lazy app imports:

```javascript
const CallApp = lazy(() => import('./Apps/CallApp.jsx'));
```

Add route before the wildcard `<Route path="*"`:

```jsx
<Route path="/call" element={<Suspense><CallApp /></Suspense>} />
```

**Step 4: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx frontend/src/Apps/CallApp.scss frontend/src/main.jsx
git commit -m "feat: add /call phone-side standalone page with route"
```

---

### Task 7: Integration Test — Two-Window Manual Verification

**Step 1: Start dev server**

```bash
lsof -i :3111  # check if already running
npm run dev     # start if not
```

**Step 2: Test TV side**

Open: `http://localhost:3111/tv?open=videocall/livingroom-tv`

Verify:
- Camera preview shows fullscreen
- Status shows "Home Line — Waiting"
- Volume meter responds to speech

**Step 3: Test phone side**

Open in a second browser tab: `http://localhost:3111/call`

Verify:
- Lobby shows "Looking for available rooms..." briefly
- Auto-connects (only one device)
- Both windows show the other's video
- TV switches to split view (portrait + landscape)
- Phone shows TV video (wide) + self-preview (tall)

**Step 4: Test hang up**

Click "Hang Up" on phone tab.

Verify:
- Phone returns to lobby
- TV returns to solo fullscreen + "Home Line — Waiting"
- Closing the phone tab also triggers hangup

**Step 5: Test occupied state**

While one phone is connected, open a third tab to `/call`.

Verify:
- Third tab sees "Room is busy"

---

### Task 8: Webcam.jsx — Update with Home Line Indicator (optional)

**Files:**
- Modify: `frontend/src/modules/Input/Webcam.jsx`

This is optional — the existing webcam app continues to work as-is. The `videocall` app is a separate registry entry. If you want the webcam app to also show "Home Line" status, add a small indicator, but this can be deferred since they're separate apps.

---

## Dependency Graph

```
Task 1 (backend relay) ──┐
                          ├──► Task 3 (useHomeline) ──┐
Task 2 (useWebRTCPeer) ──┘                            │
                                                       ├──► Task 4 (VideoCall.jsx)
                                                       │    Task 5 (registry + wrapper)
                                                       │
                                                       └──► Task 6 (CallApp.jsx + route)
                                                            │
                                                            ▼
                                                       Task 7 (integration test)
```

Tasks 1 and 2 can be done in parallel. Task 3 depends on both. Tasks 4–6 depend on Task 3 and can be done in parallel. Task 7 is last.
