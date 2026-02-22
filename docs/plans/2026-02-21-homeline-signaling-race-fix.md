# Homeline Signaling Race Condition Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the race condition where the phone misses the TV's heartbeat and both sides wait forever, plus add diagnostic logging so future issues are visible.

**Architecture:** Add a `ready` handshake — when the phone subscribes, it immediately sends a `ready` message. The TV responds instantly with `waiting`, eliminating the dependency on the 5-second heartbeat interval. Also add diagnostic logging for heartbeat sends, subscription establishment, and a timeout warning when no heartbeat is received.

**Tech Stack:** React hooks, WebSocket signaling (existing `wsService`)

---

## Task 1: Add `ready` handshake to fix the race condition

**Files:**
- Modify: `frontend/src/modules/Input/hooks/useHomeline.js`

**Step 1: TV listens for `ready` and responds immediately**

In the TV signaling listener effect (lines 50-85), add handling for `message.type === 'ready'` — when received, immediately send a `waiting` response so the phone doesn't have to wait for the next heartbeat.

In `useHomeline.js`, replace lines 50-85:

```javascript
  // TV: listen for signaling messages
  useEffect(() => {
    if (role !== 'tv' || !deviceId) return;

    const unsubscribe = wsService.subscribe(
      (data) => data.topic === topic(deviceId) && data.from !== peerId,
      async (message) => {
        try {
          if (message.type === 'ready') {
            // Phone is listening — respond immediately so it doesn't wait for next heartbeat
            logger().info('ready-received', { from: message.from });
            send(deviceId, 'waiting', { label: deviceId });
          } else if (message.type === 'offer') {
            if (peerConnected) {
              logger().info('offer-rejected-occupied', { from: message.from });
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
```

**Step 2: Phone sends `ready` after subscribing**

In the `connect` callback (lines 90-141), after calling `wsService.subscribe()`, immediately send a `ready` message so the TV responds right away. Replace lines 90-141:

```javascript
  // Phone: connect to a specific device (drop-in model)
  // Subscribes to the device's topic, sends a "ready" signal, and waits
  // for the TV's "waiting" heartbeat before sending the SDP offer.
  const connect = useCallback(async (targetDeviceId) => {
    if (role !== 'phone') return;
    connectedDeviceRef.current = targetDeviceId;
    setStatus('connecting');
    logger().info('connect-waiting-for-tv', { target: targetDeviceId });

    peer.onIceCandidate((candidate) => {
      send(targetDeviceId, 'candidate', { candidate });
    });

    // Clean up previous subscription
    if (answerUnsubRef.current) answerUnsubRef.current();

    let offerSent = false;

    const unsubAnswer = wsService.subscribe(
      (data) => data.topic === topic(targetDeviceId) && data.from !== peerId,
      async (message) => {
        try {
          if (message.type === 'waiting' && !offerSent) {
            // TV is alive and listening — send the offer now
            offerSent = true;
            logger().info('tv-ready', { target: targetDeviceId });
            const offer = await peer.createOffer();
            send(targetDeviceId, 'offer', { sdp: offer.sdp });
            logger().info('offer-sent', { target: targetDeviceId });
          } else if (message.type === 'answer') {
            logger().info('answer-received', { from: message.from });
            await peer.handleAnswer({ type: 'answer', sdp: message.sdp });
            setPeerConnected(true);
            setStatus('connected');
            logger().info('call-connected', { target: targetDeviceId });
          } else if (message.type === 'occupied') {
            logger().info('device-occupied', { target: targetDeviceId });
            setStatus('occupied');
          } else if (message.type === 'candidate') {
            await peer.addIceCandidate(message.candidate);
          } else if (message.type === 'hangup') {
            logger().info('remote-hangup', { target: targetDeviceId });
            peer.reset();
            setPeerConnected(false);
            setStatus('idle');
            connectedDeviceRef.current = null;
          }
        } catch (err) {
          logger().warn('signaling-error', { error: err.message });
        }
      }
    );

    answerUnsubRef.current = unsubAnswer;

    // Tell the TV we're listening — it will respond immediately with "waiting"
    // This eliminates the race where we miss the periodic heartbeat
    send(targetDeviceId, 'ready');
    logger().info('ready-sent', { target: targetDeviceId });
  }, [role, peer, peerId, topic, send]);
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Input/hooks/useHomeline.js
git commit -m "fix: add ready handshake to eliminate homeline signaling race condition"
```

---

## Task 2: Add diagnostic logging

**Files:**
- Modify: `frontend/src/modules/Input/hooks/useHomeline.js`

**Step 1: Log heartbeat sends (sampled) and add no-heartbeat timeout warning**

Replace the TV heartbeat effect (lines 25-38) with a version that logs sends, and add a timeout effect to the phone side that warns after 10s of no heartbeat.

Replace lines 25-38 (TV heartbeat):

```javascript
  // TV: broadcast waiting heartbeat
  useEffect(() => {
    if (role !== 'tv' || !deviceId) return;

    let count = 0;
    logger().info('heartbeat-start', { deviceId });
    const sendWaiting = () => {
      count++;
      send(deviceId, 'waiting', { label: deviceId });
      if (count <= 3 || count % 12 === 0) {
        logger().debug('heartbeat-sent', { deviceId, count });
      }
    };
    sendWaiting();
    heartbeatRef.current = setInterval(sendWaiting, 5000);

    return () => {
      logger().debug('heartbeat-stop', { deviceId, count });
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [role, deviceId, send]);
```

**Step 2: Add no-heartbeat timeout warning on phone side**

Add a new effect after the `connect` callback (after line 141 in the original, which is now the end of the updated `connect`). This logs a warning if the phone is stuck in `connecting` for more than 10 seconds.

Add after the `connect` callback (before `hangUp`):

```javascript
  // Phone: warn if stuck waiting for TV heartbeat
  useEffect(() => {
    if (role !== 'phone' || status !== 'connecting') return;

    const timer = setTimeout(() => {
      logger().warn('connect-timeout', {
        target: connectedDeviceRef.current,
        waitedMs: 10000,
        hint: 'No heartbeat received from TV in 10s'
      });
    }, 10_000);

    return () => clearTimeout(timer);
  }, [role, status]);
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Input/hooks/useHomeline.js
git commit -m "feat: add diagnostic logging for homeline heartbeat and connect timeout"
```

---

## Verification

### What the fix changes

**Before:** Phone subscribes → waits for next 5s heartbeat → may never receive it if timing is wrong.

**After:** Phone subscribes → immediately sends `ready` → TV responds with `waiting` within milliseconds → phone sends offer → connected.

The periodic heartbeat still runs as a fallback (in case `ready` is lost), but the `ready` handshake provides an immediate, deterministic connection path.

### How to test

1. Start dev server: `npm run dev`
2. Open `/call` on phone
3. Tap the TV device to initiate call
4. Watch dev logs for the new sequence:
   ```
   connect-waiting-for-tv → ready-sent → (TV) ready-received → (TV) waiting sent → tv-ready → offer-sent → call-connected
   ```
5. Verify the call connects within 1-2 seconds of TV loading (no 5s wait)
6. Kill FKB to test ADB recovery + signaling together

### Logging verification

Check prod logs after deploy for:
- `heartbeat-sent` with counts (first 3, then every 60s)
- `ready-sent` / `ready-received` on each call
- `connect-timeout` if anything goes wrong (should never appear under normal conditions)
