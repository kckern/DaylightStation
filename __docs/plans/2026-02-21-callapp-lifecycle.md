# CallApp Lifecycle Improvements

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent duplicate calls, add cancel ability, clean up the TV on all exit paths (unmount, navigate, refresh, cancel), and give immediate visual feedback on button press.

**Architecture:** All changes are in `CallApp.jsx` — no hook changes needed. Merge `endCall` and cancel into one cleanup function. Add guards to `dropIn`. Add unmount effect for TV power-off. Add cancel button to connecting screen.

**Tech Stack:** React (existing component), existing `DaylightAPI`, existing `useHomeline` hook

---

## Task 1: Add guards and fix wake failure handling

**Files:**
- Modify: `frontend/src/Apps/CallApp.jsx`

**Step 1: Add guard to dropIn and stop on wake failure**

Replace lines 76-90 (the `dropIn` callback):

```javascript
  // Wake device (power on + load videocall URL) then connect signaling
  const dropIn = useCallback(async (targetDeviceId) => {
    if (waking || status !== 'idle') return;
    logger.info('drop-in-start', { targetDeviceId });
    setWaking(true);
    connectedDeviceRef.current = targetDeviceId;
    try {
      await DaylightAPI(`/api/v1/device/${targetDeviceId}/load?open=videocall/${targetDeviceId}`);
      logger.info('wake-success', { targetDeviceId });
    } catch (err) {
      logger.warn('wake-failed', { targetDeviceId, error: err.message });
      setWaking(false);
      connectedDeviceRef.current = null;
      return;
    }
    setWaking(false);
    // connect() subscribes and waits for the TV's heartbeat before sending the offer
    connect(targetDeviceId);
  }, [logger, connect, waking, status]);
```

**Step 2: Disable device buttons while waking or connecting**

Replace lines 118-129 (the device list buttons):

```javascript
          {devices && devices.length > 1 && (
            <div className="call-app__device-list">
              {devices.map((device) => (
                <button
                  key={device.id}
                  className="call-app__device-btn"
                  disabled={waking || status !== 'idle'}
                  onClick={() => dropIn(device.id)}
                >
                  {device.id}
                </button>
              ))}
            </div>
          )}
```

**Step 3: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx
git commit -m "fix: guard dropIn against double-tap and wake failure"
```

---

## Task 2: Merge endCall, add cancel button, add unmount cleanup

**Files:**
- Modify: `frontend/src/Apps/CallApp.jsx`

**Step 1: Merge endCall to also reset waking**

Replace lines 56-67 (the `endCall` callback):

```javascript
  // Clean up call: hangup signaling + power off TV + reset state
  const endCall = useCallback(() => {
    const devId = connectedDeviceRef.current;
    hangUp();
    setWaking(false);
    if (devId) {
      logger.info('tv-power-off', { targetDeviceId: devId });
      DaylightAPI(`/api/v1/device/${devId}/off`).catch(err => {
        logger.warn('tv-power-off-failed', { targetDeviceId: devId, error: err.message });
      });
      connectedDeviceRef.current = null;
    }
  }, [hangUp, logger]);
```

**Step 2: Add unmount cleanup that powers off TV**

Replace lines 69-74 (the `beforeunload` effect) with a combined effect that handles both tab close AND component unmount:

```javascript
  // Clean up on tab close or component unmount (SPA navigation)
  useEffect(() => {
    const handleBeforeUnload = () => endCall();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // SPA navigation: power off TV if we were in a call or connecting
      const devId = connectedDeviceRef.current;
      if (devId) {
        DaylightAPI(`/api/v1/device/${devId}/off`).catch(() => {});
      }
    };
  }, [endCall]);
```

**Step 3: Add cancel button to connecting screen**

Replace lines 136-148 (the connecting screen render):

```javascript
  // Connecting: waking TV + waiting for heartbeat
  if (status === 'connecting' || waking) {
    return (
      <div className="call-app call-app--lobby">
        <div className="call-app__lobby-content">
          <h1 className="call-app__title">Home Line</h1>
          <p className="call-app__message">
            {waking ? 'Waking up TV...' : 'Waiting for TV...'}
          </p>
          <button className="call-app__cancel" onClick={endCall}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
```

**Step 4: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx
git commit -m "feat: add cancel button, unmount cleanup, merge endCall"
```

---

## Task 3: Style the cancel button and disabled state

**Files:**
- Modify: `frontend/src/Apps/CallApp.scss`

**Step 1: Add cancel button and disabled button styles**

Add after the `&__hangup` block (after line 110):

```scss
  &__cancel {
    background: transparent;
    color: #aaa;
    border: 1px solid #444;
    border-radius: 24px;
    padding: 0.6rem 2rem;
    font-size: 1rem;
    cursor: pointer;
    margin-top: 2rem;

    &:active {
      background: #222;
      color: #fff;
    }
  }

  &__device-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/CallApp.scss
git commit -m "style: add cancel button and disabled device button styles"
```

---

## Verification

1. Start dev server: `npm run dev`
2. Open `/call` on phone
3. **Double-tap test:** Tap a device button rapidly — should only fire one `drop-in-start` log, button disables immediately
4. **Cancel test:** During "Waking up TV..." or "Waiting for TV...", tap Cancel — should return to lobby and power off TV
5. **Wake failure test:** Kill the backend, tap a device — should return to lobby (not stuck on connecting)
6. **Navigate away test:** Start a call, navigate away via browser back — TV should power off
7. **Refresh test:** Start a call, refresh the page — TV should power off
8. **Full call test:** Complete a call end-to-end, verify endCall still works with Hang Up button
