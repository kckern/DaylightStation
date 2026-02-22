# VideoCall TV Display Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the TV-side VideoCall component so both local and remote video display correctly when a call connects.

**Architecture:** The root cause is conditional rendering — when `peerConnected` flips to `true`, React destroys and recreates `<video>` elements, losing their `srcObject` assignments. The fix: always mount both video elements and use CSS class toggles for layout changes (matching the pattern CallApp.jsx already uses for the phone side). Additionally, queue ICE candidates that arrive before `setRemoteDescription` completes to prevent media flow failure.

**Tech Stack:** React hooks, WebRTC, SCSS

---

### Task 1: Restructure VideoCall.jsx — always mount video elements

**Files:**
- Modify: `frontend/src/modules/Input/VideoCall.jsx`

**Step 1: Replace conditional rendering with always-mounted elements**

Replace the entire return block (lines 71–133) with this structure that always mounts both `<video>` elements and uses a CSS class toggle on the root:

```jsx
  return (
    <div className={`videocall-tv ${peerConnected ? 'videocall-tv--connected' : ''}`}>
      {/* Remote: phone portrait video — always mounted, hidden until connected via CSS */}
      <div className="videocall-tv__remote-panel">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="videocall-tv__video videocall-tv__video--portrait"
        />
      </div>

      {/* Local: TV landscape camera — always mounted */}
      <div className="videocall-tv__local-panel">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="videocall-tv__video"
          style={{ transform: 'scaleX(-1)' }}
        />
      </div>

      {/* Remote mute indicator */}
      {peerConnected && remoteMuteState.audioMuted && (
        <div className="videocall-tv__remote-muted">Phone audio muted</div>
      )}

      {/* Status indicator */}
      <div className="videocall-tv__status">
        {iceError || (
          <>
            {status === 'waiting' && 'Home Line \u2014 Waiting'}
            {status === 'connecting' && 'Connecting...'}
            {status === 'connected' && 'Connected'}
          </>
        )}
      </div>

      {/* Volume meter */}
      <div className="videocall-tv__meter">
        <div className="videocall-tv__meter-fill" style={{ width: `${volumePercentage}%` }} />
      </div>
    </div>
  );
```

**Step 2: Add local stream re-sync effect**

Add this effect after the existing "Attach remote stream" effect (after line 56). This ensures `videoRef.current.srcObject` is re-assigned if the element exists but somehow lost its srcObject:

```js
  // Re-sync local camera stream to video element.
  // useWebcamStream sets srcObject on stream acquisition, but if the
  // element wasn't ready or layout changed, this ensures it stays in sync.
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = new MediaStream(stream.getVideoTracks());
    }
  }, [stream, videoRef]);
```

**Step 3: Verify the component compiles**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build 2>&1 | tail -5`
Expected: Build succeeds (no import or syntax errors)

**Step 4: Commit**

```bash
git add frontend/src/modules/Input/VideoCall.jsx
git commit -m "fix(videocall): always mount video elements to prevent srcObject loss on view transition"
```

---

### Task 2: Update VideoCall.scss — CSS-driven layout switching

**Files:**
- Modify: `frontend/src/modules/Input/VideoCall.scss`

**Step 1: Replace SCSS with always-mounted layout rules**

Replace the entire file content with:

```scss
.videocall-tv {
  width: 100%;
  height: 100%;
  position: relative;
  background: #000;
  overflow: hidden;

  // ── Solo mode (default): local fullscreen, remote hidden ──

  &__remote-panel {
    display: none;
  }

  &__local-panel {
    width: 100%;
    height: 100%;
  }

  &__local-panel &__video {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 0;
    background: #111;
  }

  // ── Connected mode: side-by-side split ──

  &--connected {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2rem;
    padding: 2rem;
    box-sizing: border-box;
  }

  &--connected &__remote-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    height: 90%;
  }

  &--connected &__remote-panel &__video {
    height: 100%;
    max-width: 100%;
    aspect-ratio: 9/16;
    border-radius: 8px;
    object-fit: contain;
    background: #111;
  }

  &--connected &__local-panel {
    flex: 1;
    height: 90%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &--connected &__local-panel &__video {
    position: static;
    width: 100%;
    max-height: 100%;
    aspect-ratio: 16/9;
    border-radius: 8px;
    object-fit: contain;
    background: #111;
  }

  // ── Overlays ──

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

  &__remote-muted {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: rgba(0, 0, 0, 0.6);
    color: #ccc;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-size: 1rem;
    z-index: 10;
  }
}
```

**Step 2: Verify build**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add frontend/src/modules/Input/VideoCall.scss
git commit -m "fix(videocall): CSS-driven layout toggle instead of element destruction"
```

---

### Task 3: Add ICE candidate queuing to useWebRTCPeer.js

**Files:**
- Modify: `frontend/src/modules/Input/hooks/useWebRTCPeer.js`

ICE candidates from the phone can arrive via WebSocket while the TV's `handleOffer` is still awaiting `setRemoteDescription`. Since `createPC()` sets `pcRef.current` before `setRemoteDescription` completes, `addIceCandidate` sees a valid PC but one that hasn't had its remote description set yet — causing the candidate to fail silently. This means ICE negotiation can't complete and `ontrack` never fires.

**Step 1: Add a pending candidates ref**

After `const iceCandidateCallbackRef = useRef(null);` (line 18), add:

```js
  const pendingCandidatesRef = useRef([]);
```

**Step 2: Flush queued candidates inside handleOffer after setRemoteDescription**

Replace the `handleOffer` function (lines 71–77) with:

```js
  const handleOffer = useCallback(async (offer) => {
    const pc = createPC();
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    // Flush any ICE candidates that arrived before remote description was set
    const queued = pendingCandidatesRef.current.splice(0);
    if (queued.length > 0) {
      logger().debug('ice-candidates-flushed', { count: queued.length });
    }
    for (const c of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        logger().warn('ice-candidate-flush-failed', { error: err.message });
      }
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }, [createPC]);
```

**Step 3: Do the same for handleAnswer (phone side)**

Replace the `handleAnswer` function (lines 79–83) with:

```js
  const handleAnswer = useCallback(async (answer) => {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    // Flush any ICE candidates that arrived before remote description was set
    const queued = pendingCandidatesRef.current.splice(0);
    if (queued.length > 0) {
      logger().debug('ice-candidates-flushed', { count: queued.length });
    }
    for (const c of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        logger().warn('ice-candidate-flush-failed', { error: err.message });
      }
    }
  }, []);
```

**Step 4: Queue candidates when PC isn't ready**

Replace the `addIceCandidate` function (lines 85–93) with:

```js
  const addIceCandidate = useCallback(async (candidate) => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) {
      // PC not ready — queue for later flush
      pendingCandidatesRef.current.push(candidate);
      logger().debug('ice-candidate-queued', { queueLength: pendingCandidatesRef.current.length });
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      logger().warn('ice-candidate-failed', { error: err.message });
    }
  }, []);
```

**Step 5: Clear the queue on reset**

In the `reset` function (lines 99–106), add `pendingCandidatesRef.current = [];` before the state resets:

```js
  const reset = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingCandidatesRef.current = [];
    setRemoteStream(null);
    setConnectionState('new');
  }, []);
```

**Step 6: Verify build**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npx vite build 2>&1 | tail -5`
Expected: Build succeeds

**Step 7: Commit**

```bash
git add frontend/src/modules/Input/hooks/useWebRTCPeer.js
git commit -m "fix(webrtc): queue ICE candidates arriving before setRemoteDescription"
```

---

### Task 4: Deploy and manual test

**Step 1: Build production bundle**

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npm run build`
Expected: Clean build with no errors

**Step 2: Deploy**

Follow the project's deployment process (user runs `deploy.sh` manually per CLAUDE.md rules).

**Step 3: Manual test checklist**

1. Open phone browser → navigate to CallApp URL
2. Tap device to initiate call
3. TV wakes and opens videocall
4. **Verify on TV:** local camera feed visible during "Waiting" state (fullscreen preview)
5. **Verify on TV:** after connection, split layout shows — remote (phone) video on left, local (TV) camera on right
6. **Verify on phone:** sees both local camera and remote (TV) video
7. **Verify status:** TV shows "Connected", phone shows connected state
8. Hang up → TV returns to waiting or powers off

**Step 4: Check prod logs after test**

```bash
ssh homeserver.local 'docker logs daylight-station 2>&1' | grep -E '(remote-stream-attached|remote-track-added|ice-candidate|connection-state|mounted)' | tail -30
```

Expected: See `remote-stream-attached` from the Shield TV UA with actual tracks, and no `ice-candidate-failed` errors.

---

## Known Separate Issue (not in scope)

**Webcam.jsx volume meter crash:** The `"can't access property 'volume' of null"` errors spamming ~2.5/sec from the Ubuntu/Firefox client are a separate `useVolumeMeter` bug in the Webcam.jsx app. This is on a different device, different component, and appears to involve a stale ref in the deployed bundle. File a separate bug to investigate.
