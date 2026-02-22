# CallApp Phone Remote Video Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the phone not displaying the TV's remote video during calls — same root cause as the TV display bug fixed earlier (conditional rendering destroys the `<video>` element, so `remoteVideoRef.current` is null when `peer.remoteStream` is set).

**Architecture:** Always mount the remote `<video>` element and controls in the DOM. Use CSS class toggle (`call-app--connected`) to show/hide them, matching the pattern already used on the TV side (`VideoCall.jsx`). The overlays (lobby, wake error, connecting, ICE error, remote-muted badge) stay conditionally rendered since they don't hold refs.

**Tech Stack:** React JSX, SCSS

---

### Task 1: Always mount remote video + controls in CallApp.jsx

**Files:**
- Modify: `frontend/src/Apps/CallApp.jsx:216-391`

**Context:** The remote `<video ref={remoteVideoRef}>` is currently inside `{isConnected && (<>...</>)}` (line 344). This means `remoteVideoRef.current` is null until `isConnected` flips to true. But `peer.remoteStream` is set when the answer arrives (before `peerConnected` is true), so the attachment effect on line 92 finds a null ref and silently does nothing. The fix: always mount the remote video and controls, move conditional overlays outside.

**Step 1: Rewrite the return JSX**

Replace the entire return block (lines 216-392) with:

```jsx
  return (
    <div className={`call-app ${isConnected ? 'call-app--connected' : 'call-app--preview'}`}>
      {/* Local camera — always mounted */}
      <div className={`call-app__local ${isConnected ? 'call-app__local--pip' : 'call-app__local--full'}`}>
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className="call-app__video call-app__video--tall"
          style={{ transform: 'scaleX(-1)' }}
        />
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
      </div>

      {/* Remote video — always mounted, hidden until connected via CSS */}
      <div className="call-app__remote">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="call-app__video call-app__video--wide"
        />
      </div>

      {/* Controls — always mounted, hidden until connected via CSS */}
      <div className="call-app__controls">
        <button
          className={`call-app__mute-btn ${audioMuted ? 'call-app__mute-btn--active' : ''}`}
          onClick={handleToggleAudio}
          aria-label={audioMuted ? 'Unmute audio' : 'Mute audio'}
        >
          {audioMuted ? 'Mic Off' : 'Mic'}
        </button>
        <button className="call-app__hangup" onClick={endCall}>
          Hang Up
        </button>
        <button
          className={`call-app__mute-btn ${videoMuted ? 'call-app__mute-btn--active' : ''}`}
          onClick={handleToggleVideo}
          aria-label={videoMuted ? 'Enable video' : 'Disable video'}
        >
          {videoMuted ? 'Cam Off' : 'Cam'}
        </button>
      </div>

      {/* ICE error banner — conditional is fine (no ref) */}
      {isConnected && iceError && (
        <div className="call-app__ice-error">
          <span>{iceError}</span>
          {connectionState === 'failed' && (
            <button onClick={() => endCall()} className="call-app__ice-error-btn">
              End Call
            </button>
          )}
        </div>
      )}

      {/* Remote mute badge — conditional is fine */}
      {isConnected && remoteMuteState.audioMuted && (
        <div className="call-app__remote-muted">Remote audio muted</div>
      )}

      {/* Lobby overlay — device selection */}
      {isIdle && (
        <div className="call-app__overlay-bottom">
          <h1 className="call-app__title">Home Line</h1>

          {devices === null && (
            <p className="call-app__message">Loading devices...</p>
          )}

          {devices && devices.length === 0 && (
            <p className="call-app__message">No video call devices configured</p>
          )}

          {status === 'occupied' && (
            <p className="call-app__message">Room is busy</p>
          )}

          {devices && devices.length > 1 && (
            <div className="call-app__device-list">
              {devices.map((device) => (
                <button
                  key={device.id}
                  className="call-app__device-btn"
                  disabled={waking || status !== 'idle' || !stream}
                  onClick={() => dropIn(device.id)}
                >
                  {device.label || device.id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wake error overlay */}
      {wakeError && !isConnecting && !isConnected && (
        <div className="call-app__overlay-bottom">
          <p className="call-app__status-text call-app__status-text--error">
            {wakeError}
          </p>
          <button
            className="call-app__retry-btn"
            disabled={cooldown}
            onClick={() => {
              setWakeError(null);
              const devId = connectedDeviceRef.current;
              if (devId) dropIn(devId);
            }}
          >
            {cooldown ? 'Wait...' : 'Try Again'}
          </button>
          <button
            className="call-app__device-btn"
            onClick={() => {
              setWakeError(null);
              const devId = connectedDeviceRef.current;
              if (devId) {
                setWaking(false);
                connect(devId);
              }
            }}
          >
            Connect anyway
          </button>
          <button className="call-app__cancel" onClick={() => {
            setWakeError(null);
            connectedDeviceRef.current = null;
            setActiveDeviceId(null);
          }}>
            Cancel
          </button>
        </div>
      )}

      {/* Connecting overlay */}
      {isConnecting && (
        <div className="call-app__overlay-bottom">
          <p className="call-app__status-text">
            {waking ? 'Waking up TV...' : 'Establishing call...'}
          </p>
          {connectingTooLong && (
            <div className="call-app__timeout-msg">
              TV is not responding. You can retry or cancel.
            </div>
          )}
          {connectingTooLong && (
            <button
              className="call-app__retry-btn"
              onClick={() => {
                const devId = connectedDeviceRef.current;
                if (devId) setPendingRetry(devId);
                endCall();
              }}
            >
              Retry
            </button>
          )}
          <button className="call-app__cancel" onClick={endCall}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
```

**What changed:**
- Remote `<video>` and `__remote` div moved **outside** the `{isConnected && ...}` conditional — always in the DOM
- Controls `__controls` div moved **outside** the conditional — always in the DOM
- ICE error and remote-muted badge stay conditional (no refs, just UI)
- Overlays (lobby, wake error, connecting) unchanged
- All element attributes, class names, event handlers, and refs are identical

**Step 2: Build to verify**

```bash
cd frontend && npx vite build
```

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx
git commit -m "fix(call): always mount remote video element to prevent srcObject loss"
```

---

### Task 2: Hide remote + controls via CSS when not connected

**Files:**
- Modify: `frontend/src/Apps/CallApp.scss:141-163`

**Context:** Now that the remote panel and controls are always in the DOM, they need to be hidden by default and shown only when the parent has `call-app--connected`.

**Step 1: Update the `&__remote` block**

Replace the `&__remote` block (lines 141-149):

```scss
  // Remote video (always mounted, shown in connected state)
  &__remote {
    display: none;
  }

  &--connected &__remote {
    display: flex;
    flex: 1;
    min-height: 0;
    width: 100%;
    align-items: center;
    justify-content: center;
  }
```

**Step 2: Update the `&__controls` block**

Replace the `&__controls` block (lines 151-163):

```scss
  // Call controls (always mounted, shown in connected state)
  &__controls {
    display: none;
  }

  &--connected &__controls {
    display: flex;
    flex: 0 0 auto;
    width: 100%;
    gap: 1rem;
    align-items: center;
    justify-content: center;
    padding: 0.75rem 0 calc(0.75rem + env(safe-area-inset-bottom, 0px));
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
```

**Step 3: Build to verify**

```bash
cd frontend && npx vite build
```

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add frontend/src/Apps/CallApp.scss
git commit -m "fix(call): CSS hide remote/controls when not connected"
```

---

## Verification

After both tasks, the prod logs should show `remote-stream-attached` from the **phone** (Chrome Mobile user agent) — this event was previously absent because `remoteVideoRef.current` was null when the effect ran.

**Phone (`/call`) checklist:**
- [ ] Idle: self-camera fullscreen, no remote video visible, no controls visible
- [ ] Connecting: self-camera fullscreen with "Waking up TV..." overlay, no controls visible
- [ ] Connected: remote TV video visible in main area, self-camera as PIP, controls bar at bottom
- [ ] Logs show `remote-stream-attached` from phone with `tracks: [audio, video]`
