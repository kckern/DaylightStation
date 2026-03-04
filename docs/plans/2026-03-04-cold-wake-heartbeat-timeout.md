# Cold Wake Heartbeat Timeout Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Increase the drop-in call heartbeat timeout from 10s to 30s when the TV underwent a cold wake (FKB force-stop/relaunch), preventing false connect-timeout failures.

**Architecture:** Thread a `coldRestart` flag from `FullyKioskContentAdapter.prepareForContent()` through `WakeAndLoadService` result, into the frontend `CallApp` → `useHomeline` chain. The phone-side heartbeat timeout and user-visible timeout both increase when the flag is set. No new state machines, no new hooks — just a boolean flowing through existing plumbing.

**Tech Stack:** React hooks, Express backend, WebSocket progress events

---

### Task 1: Return `coldRestart` from `FullyKioskContentAdapter.prepareForContent()`

**Files:**
- Modify: `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs:109-163`

**Step 1: Add `coldRestart` tracking**

In `prepareForContent()`, track whether the ADB force-stop path executed. Add a `let coldRestart = false;` at the top of the try block (after line 86), set it to `true` after a successful ADB force-stop (line 114), and include it in the return value (line 163).

```javascript
// After line 86 (inside try block):
let coldRestart = false;

// After line 114 (the adbForceStop log):
coldRestart = true;

// Line 163 — change the success return:
return { ok: true, coldRestart, elapsedMs: Date.now() - startTime };
```

**Step 2: Verify no callers break**

The only caller of `prepareForContent()` is `WakeAndLoadService.execute()` at line 116, which stores the result in `result.steps.prepare` and checks `prepResult.ok`. Adding `coldRestart` to the return object is additive — nothing breaks.

**Step 3: Commit**

```bash
git add backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs
git commit -m "feat(fullykiosk): return coldRestart flag from prepareForContent"
```

---

### Task 2: Propagate `coldWake` through `WakeAndLoadService` result

**Files:**
- Modify: `backend/src/3_applications/devices/services/WakeAndLoadService.mjs:50-158`

**Step 1: Add `coldWake` to the result object**

After the prepare step succeeds (line 128), read `prepResult.coldRestart` and store it on the result. Also include it in the final success result.

```javascript
// After line 128 (prepare done log), add:
const coldWake = !!prepResult.coldRestart;

// Line 150-152 — update the success block:
result.ok = true;
result.canProceed = true;
result.coldWake = coldWake;
result.totalElapsedMs = Date.now() - startTime;
```

The `coldWake` boolean is also in the initial result object (defaults to `false`):

```javascript
// Line 50-56 — add coldWake: false to initial result:
const result = {
  ok: false,
  deviceId,
  steps: {},
  canProceed: false,
  allowOverride: false,
  coldWake: false
};
```

**Step 2: Commit**

```bash
git add backend/src/3_applications/devices/services/WakeAndLoadService.mjs
git commit -m "feat(wake-and-load): propagate coldWake flag in result"
```

---

### Task 3: Pass `coldWake` from `CallApp` to `useHomeline.connect()`

**Files:**
- Modify: `frontend/src/Apps/CallApp.jsx:87,98-99,344-352,552-583`
- Modify: `frontend/src/modules/Input/hooks/useHomeline.js:113,175-188`

**Step 1: Modify `useHomeline.connect()` to accept options**

Change the `connect` function signature to accept an optional second argument `{ coldWake = false } = {}`. Use it to set the heartbeat timeout duration.

In `useHomeline.js`:

```javascript
// Line 113 — change connect signature:
const connect = useCallback(async (targetDeviceId, { coldWake = false } = {}) => {
```

Store the coldWake flag in a ref so the timeout effect can read it:

```javascript
// Add a new ref near line 17 (after answerUnsubRef):
const coldWakeRef = useRef(false);

// Inside connect, after line 116 (setStatus('connecting')):
coldWakeRef.current = coldWake;
```

**Step 2: Use `coldWakeRef` in the heartbeat timeout effect**

In `useHomeline.js`, lines 175-188 — use the ref to pick the timeout duration:

```javascript
// Phone: warn if stuck waiting for TV heartbeat
useEffect(() => {
  if (role !== 'phone' || status !== 'connecting') return;

  const timeoutMs = coldWakeRef.current ? 30_000 : 10_000;

  const timer = setTimeout(() => {
    logger().warn('connect-timeout', {
      target: connectedDeviceRef.current,
      waitedMs: timeoutMs,
      coldWake: coldWakeRef.current,
      hint: `No heartbeat received from TV in ${timeoutMs / 1000}s`
    });
  }, timeoutMs);

  return () => clearTimeout(timer);
}, [role, status]);
```

**Step 3: Pass `coldWake` from `CallApp.dropIn()` to `connect()`**

In `CallApp.jsx`, inside the `dropIn` callback, after the wake API succeeds:

```javascript
// Line 582 — change connect call to pass coldWake:
connect(targetDeviceId, { coldWake: !!result.coldWake });
```

**Step 4: Also store `coldWake` in a ref for the user-visible timeout**

Add a ref in `CallApp.jsx` to track cold wake for the user-visible timeout:

```javascript
// Near line 106 (after connectedDeviceRef):
const coldWakeRef = useRef(false);

// Inside dropIn, before the connect call (after line 581):
coldWakeRef.current = !!result.coldWake;
```

**Step 5: Increase user-visible timeout for cold wake**

In `CallApp.jsx`, lines 344-352:

```javascript
// User-facing connection timeout (15s normal, 35s cold wake)
useEffect(() => {
  if (status !== 'connecting') {
    setConnectingTooLong(false);
    return;
  }
  const timeoutMs = coldWakeRef.current ? 35_000 : 15_000;
  const timer = setTimeout(() => setConnectingTooLong(true), timeoutMs);
  return () => clearTimeout(timer);
}, [status]);
```

**Step 6: Reset `coldWakeRef` in `endCall`**

In `CallApp.jsx`, inside the `endCall` callback (near line 496-517), add:

```javascript
// After resetWakeProgress() call:
coldWakeRef.current = false;
```

**Step 7: Commit**

```bash
git add frontend/src/modules/Input/hooks/useHomeline.js frontend/src/Apps/CallApp.jsx
git commit -m "feat(homeline): increase heartbeat timeout to 30s for cold wake scenarios"
```

---

### Task 4: Add logging for cold wake path

**Files:**
- Modify: `frontend/src/Apps/CallApp.jsx:565`

**Step 1: Log cold wake detection**

After the wake result is received (line 565), add a log when cold wake is detected:

```javascript
// After line 565 (wake-result log), add conditional:
if (result.coldWake) {
  logger.info('cold-wake-detected', {
    targetDeviceId,
    hint: 'Using extended heartbeat timeout (30s)'
  });
}
```

**Step 2: Commit**

```bash
git add frontend/src/Apps/CallApp.jsx
git commit -m "feat(callapp): log cold wake detection for observability"
```

---

### Task 5: Manual smoke test

**No code changes — verification only.**

**Step 1: Test normal (warm) wake path**

1. Ensure Shield TV and Fully Kiosk are already running
2. Initiate a drop-in call from mobile
3. Verify the call connects normally (no extended timeout)
4. Check browser console: `connect-timeout` should NOT fire (call connects within 10s)

**Step 2: Test cold wake path**

1. Power off the Shield TV (or force-stop FKB via ADB)
2. Initiate a drop-in call from mobile
3. Verify the stepper shows all 4 steps completing
4. Check browser console for `cold-wake-detected` log
5. Verify the call connects (may take 15-25s total)
6. Verify `connect-timeout` does NOT fire at 10s (should wait 30s now)

**Step 3: Test timeout still works**

1. Power off Shield TV and disconnect it (so it truly can't respond)
2. Initiate a drop-in call
3. Verify `connect-timeout` fires at 30s (cold wake path)
4. Verify "TV is not responding" message appears at 35s

---

## Summary of Changes

| File | Change |
|------|--------|
| `backend/src/1_adapters/devices/FullyKioskContentAdapter.mjs` | Return `coldRestart: true` from `prepareForContent()` when ADB force-stop executed |
| `backend/src/3_applications/devices/services/WakeAndLoadService.mjs` | Thread `coldWake` from prepare result into final API response |
| `frontend/src/modules/Input/hooks/useHomeline.js` | Accept `{ coldWake }` option in `connect()`, use 30s timeout when true |
| `frontend/src/Apps/CallApp.jsx` | Pass `result.coldWake` to `connect()`, extend user-visible timeout to 35s for cold wake |
