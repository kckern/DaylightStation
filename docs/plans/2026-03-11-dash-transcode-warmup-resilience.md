# DASH Transcode Warmup Resilience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent fitness video playback from permanently failing when Plex's transcoder takes 60-90s to prepare segments for deep seeks into long videos.

**Architecture:** Three layered fixes: (1) detect 0-byte fragment responses in the DASH diagnostic layer and surface them as a distinct "transcode warming" state, (2) make the resilience system use exponential backoff so it doesn't exhaust all attempts in 45s, and (3) fix `retryFromExhausted()` to preserve the original seek offset instead of restarting from 0.

**Tech Stack:** React hooks, dash.js web component events, existing resilience config system

**Audit:** `docs/_wip/audits/2026-03-11-fitness-video-dash-playback-failure-audit.md`

---

### Task 1: Detect consecutive 0-byte fragments in VideoPlayer

The dash.js `fragmentLoadingCompleted` handler already logs fragment data including byte count. We need to track consecutive 0-byte fragments and emit a distinct event when a threshold is reached.

**Files:**
- Modify: `frontend/src/modules/Player/renderers/VideoPlayer.jsx:276-286`

**Step 1: Add 0-byte fragment tracking in the dash.js event wiring**

Inside the `waitForApi` block in `VideoPlayer.jsx`, after the existing `fragmentLoadingCompleted` handler (line 276), replace it with a version that tracks consecutive 0-byte loads and dispatches a custom event on the element:

```javascript
// Replace the existing fragmentLoadingCompleted handler (line 276-286)
let consecutiveEmptyFragments = 0;
const EMPTY_FRAGMENT_THRESHOLD = 6; // 6 fragments × 5s segments ≈ 30s of silence

api.on('fragmentLoadingCompleted', (e) => {
  const r = e?.request;
  const resp = e?.response;
  const bytes = resp?.byteLength ?? resp?.length ?? null;

  dashLog.info('dash.fragment-loaded', {
    type: r?.mediaType,
    index: r?.index,
    startTime: r?.startTime,
    bytes,
    status: r?.requestEndDate ? 'ok' : 'unknown'
  });

  if (bytes === 0 || bytes === null) {
    consecutiveEmptyFragments++;
    if (consecutiveEmptyFragments === EMPTY_FRAGMENT_THRESHOLD) {
      dashLog.warn('dash.transcode-warming', {
        consecutiveEmpty: consecutiveEmptyFragments,
        lastType: r?.mediaType,
        lastIndex: r?.index,
        lastStartTime: r?.startTime
      });
      // Dispatch custom event so resilience system can hear it
      el.dispatchEvent(new CustomEvent('transcodewarming', {
        detail: { consecutiveEmpty: consecutiveEmptyFragments }
      }));
    }
  } else {
    if (consecutiveEmptyFragments > 0) {
      dashLog.info('dash.transcode-warmed', {
        emptyCount: consecutiveEmptyFragments,
        firstDataType: r?.mediaType,
        firstDataIndex: r?.index,
        firstDataBytes: bytes
      });
      el.dispatchEvent(new CustomEvent('transcodewarmed'));
    }
    consecutiveEmptyFragments = 0;
  }
});
```

**Step 2: Verify existing tests still pass**

Run: `npx playwright test tests/live/flow/fitness/ --reporter=line`
Expected: existing tests still pass (this is additive)

**Step 3: Commit**

```
feat(player): detect 0-byte DASH fragments as transcode warmup state
```

---

### Task 2: Exponential backoff in resilience recovery

The current system uses a fixed cooldown (`recoveryCooldownMs: 4000`) between attempts with `maxAttempts: 3`. Total window: ~45s. For slow transcoders, we need the window to be ~120s.

Change: use exponential backoff (4s → 12s → 36s) instead of fixed 4s. This spreads 3 attempts across ~52s, plus the 15s startup grace = ~67s total. Also bump `maxAttempts` to 5, giving a total window of ~160s.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js:132-163`
- Modify: `frontend/src/modules/Player/hooks/useResilienceConfig.js:17-19`

**Step 1: Add backoff multiplier to config defaults**

In `useResilienceConfig.js`, update the defaults:

```javascript
// In DEFAULT_MEDIA_RESILIENCE_CONFIG (line 9-23)
monitor: {
  progressEpsilonSeconds: 0.25,
  stallDetectionThresholdMs: 5000,
  hardRecoverAfterStalledForMs: 2000,
  hardRecoverLoadingGraceMs: 15000,
  recoveryCooldownMs: 4000,
  recoveryCooldownBackoffMultiplier: 3
},
recovery: {
  enabled: true,
  maxAttempts: 5
},
```

And expose the multiplier in the `monitorSettings` return (line 73-78):

```javascript
monitorSettings: {
  epsilonSeconds: coerceNumber(monitorConfig.progressEpsilonSeconds, 0.25),
  stallDetectionThresholdMs: coerceNumber(monitorConfig.stallDetectionThresholdMs, 5000),
  hardRecoverAfterStalledForMs: coerceNumber(monitorConfig.hardRecoverAfterStalledForMs, 2000),
  hardRecoverLoadingGraceMs: coerceNumber(monitorConfig.hardRecoverLoadingGraceMs, 15000),
  recoveryCooldownMs: coerceNumber(monitorConfig.recoveryCooldownMs, 4000),
  recoveryCooldownBackoffMultiplier: coerceNumber(monitorConfig.recoveryCooldownBackoffMultiplier, 3)
},
```

**Step 2: Apply exponential backoff in triggerRecovery**

In `useMediaResilience.js`, update the `triggerRecovery` callback. The cooldown check (line 136-137) needs to compute the effective cooldown based on attempt count:

```javascript
const triggerRecovery = useCallback((reason) => {
  const now = Date.now();
  const tracker = _getTracker(playbackSessionKey);

  // Exponential backoff: cooldown doubles (or multiplies) with each attempt
  // attempt 0→4s, 1→12s, 2→36s, 3→108s ...
  const effectiveCooldown = recoveryCooldownMs * Math.pow(recoveryCooldownBackoffMultiplier, tracker.count);
  if (now - tracker.lastAt < effectiveCooldown) return;

  // Max attempts check — prevents infinite remount loop
  if (tracker.count >= maxAttempts) {
    playbackLog('resilience-recovery-exhausted', {
      reason, waitKey: logWaitKey,
      attempts: tracker.count, maxAttempts
    });
    actions.setStatus(STATUS.exhausted);
    return;
  }

  const attempt = _recordRecovery(playbackSessionKey);
  playbackLog('resilience-recovery', {
    reason, waitKey: logWaitKey,
    status: statusRef.current, attempt, maxAttempts,
    effectiveCooldownMs: effectiveCooldown
  });
  actions.setStatus(STATUS.recovering);

  if (typeof onReload === 'function') {
    onReload({
      reason,
      meta,
      waitKey,
      seekToIntentMs: (targetTimeSeconds || playbackHealth.lastProgressSeconds || seconds || 0) * 1000
    });
  }
}, [actions, logWaitKey, meta, onReload, playbackHealth.lastProgressSeconds, recoveryCooldownMs, recoveryCooldownBackoffMultiplier, maxAttempts, seconds, statusRef, targetTimeSeconds, waitKey, playbackSessionKey]);
```

Update the destructure at line 82-84 to include the new config:

```javascript
const {
  epsilonSeconds,
  hardRecoverLoadingGraceMs,
  recoveryCooldownMs,
  recoveryCooldownBackoffMultiplier
} = monitorSettings;
```

**Step 3: Commit**

```
feat(player): exponential backoff for resilience recovery attempts
```

---

### Task 3: Extend startup grace period when transcode is warming

When the `transcodewarming` event fires, the resilience system should extend its startup deadline rather than triggering recovery immediately.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js` (new effect)

**Step 1: Listen for transcodewarming/transcodewarmed events**

Add a new effect after the existing startup deadline effect (line 219). This listens for the custom events dispatched by VideoPlayer's dash.js instrumentation:

```javascript
// Transcode warmup awareness: extend deadline when 0-byte fragments detected
const transcodeWarmingRef = useRef(false);

useEffect(() => {
  if (disabled) return;
  const el = getMediaEl?.();
  if (!el) return;

  // Also check the container (dash-video web component dispatches on the element itself)
  const target = el.closest?.('dash-video') || el.parentElement?.closest?.('dash-video') || el;

  const handleWarming = () => {
    transcodeWarmingRef.current = true;
    playbackLog('resilience-transcode-warming', { waitKey: logWaitKey });

    // Extend the startup deadline: clear current timer and set a longer one
    clearTimeout(startupDeadlineRef.current);
    startupDeadlineRef.current = setTimeout(() => {
      triggerRecovery('startup-deadline-exceeded-after-warmup');
      startupDeadlineRef.current = null;
    }, 60000); // 60s grace while transcode warms
  };

  const handleWarmed = () => {
    if (transcodeWarmingRef.current) {
      transcodeWarmingRef.current = false;
      playbackLog('resilience-transcode-warmed', { waitKey: logWaitKey });
    }
  };

  target.addEventListener('transcodewarming', handleWarming);
  target.addEventListener('transcodewarmed', handleWarmed);

  return () => {
    target.removeEventListener('transcodewarming', handleWarming);
    target.removeEventListener('transcodewarmed', handleWarmed);
  };
}, [disabled, getMediaEl, logWaitKey, triggerRecovery]);
```

**Step 2: Commit**

```
feat(player): extend startup deadline when transcode warmup detected
```

---

### Task 4: Fix retryFromExhausted to preserve seek offset

Currently `retryFromExhausted()` passes `seekToIntentMs: 0`, losing the original resume position.

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useMediaResilience.js:166-174`

**Step 1: Preserve offset in retryFromExhausted**

Replace the existing `retryFromExhausted` callback:

```javascript
const retryFromExhausted = useCallback(() => {
  _clearTracker(playbackSessionKey);
  // Preserve the original seek intent — don't restart from 0
  const seekMs = (targetTimeSeconds || playbackHealth.lastProgressSeconds || seconds || 0) * 1000;
  consumeTargetTimeSeconds();
  actions.setStatus(STATUS.recovering);
  playbackLog('resilience-retry-from-exhausted', { waitKey: logWaitKey, seekToIntentMs: seekMs });
  if (typeof onReload === 'function') {
    onReload({ reason: 'user-retry-exhausted', meta, waitKey, seekToIntentMs: seekMs });
  }
}, [actions, consumeTargetTimeSeconds, logWaitKey, meta, onReload, playbackSessionKey, waitKey, targetTimeSeconds, playbackHealth.lastProgressSeconds, seconds]);
```

**Step 2: Commit**

```
fix(player): preserve seek offset when retrying from exhausted state
```

---

### Task 5: Improve 0-byte fragment diagnostics

Currently all fragment loads are logged at `info` level regardless of whether they contain data. 0-byte loads should be visually distinct in logs.

**Files:**
- Modify: `frontend/src/modules/Player/renderers/VideoPlayer.jsx` (already modified in Task 1)

**Step 1: Log 0-byte fragments at warn level**

This is already handled in the Task 1 replacement code — fragments with `bytes === 0` increment the counter and the threshold event fires at warn level. The individual fragment logs stay at info (they're too high-frequency for warn), but the `dash.transcode-warming` aggregate event fires at warn.

No additional code needed — this is covered by Task 1.

**Step 2: Commit**

Included in Task 1 commit.

---

### Task 6: Add 0-byte detection to BufferResilienceManager

Extend the existing 404 handling to also catch 0-byte 200 responses (which are the actual failure mode).

**Files:**
- Modify: `frontend/src/modules/Player/lib/BufferResilienceManager.js:24-68`

**Step 1: Add 0-byte detection in handleNetworkResponse**

After the existing 404 check (line 36-48), add a check for 0-byte segment responses:

```javascript
handleNetworkResponse(requestType, response) {
  const status = typeof response?.status === 'number' ? response.status : null;
  const latencyMs = (() => {
    const candidate = response?.timeMs ?? response?.time ?? response?.durationMs ?? response?.tookMs ?? response?.elapsedMs;
    return Number.isFinite(candidate) ? Math.round(candidate) : null;
  })();
  const bytes = (() => {
    const candidate = response?.bytesLoaded ?? response?.totalBytes ?? response?.size ?? null;
    return Number.isFinite(candidate) ? candidate : null;
  })();

  // 1 = SEGMENT
  if (status === 404 && requestType === 1) {
    this.callbacks.onLog('warn', 'shaka-network-response', {
      requestType,
      uri: response?.uri || null,
      status,
      action: 'attempt-404-recovery'
    });

    this.state.suppressed404 = true;

    // Return a hanging promise to induce stall
    return this._induceStall(response);
  }

  // Detect 0-byte segment responses (transcode not ready)
  if (requestType === 1 && status === 200 && (bytes === 0 || bytes === null)) {
    this.state.consecutiveEmpty = (this.state.consecutiveEmpty || 0) + 1;
    if (this.state.consecutiveEmpty >= 4) {
      this.callbacks.onLog('warn', 'shaka-zero-byte-segments', {
        consecutiveEmpty: this.state.consecutiveEmpty,
        uri: response?.uri || null,
        action: 'transcode-warming-detected'
      });
    }
  } else if (requestType === 1 && bytes > 0) {
    if (this.state.consecutiveEmpty > 0) {
      this.callbacks.onLog('info', 'shaka-zero-byte-cleared', {
        wasEmpty: this.state.consecutiveEmpty
      });
    }
    this.state.consecutiveEmpty = 0;
  }

  this.callbacks.onLog(status && status >= 400 ? 'warn' : 'debug', 'shaka-network-response', {
    requestType,
    uri: response?.uri || null,
    originalUri: response?.originalUri || null,
    fromCache: Boolean(response?.fromCache),
    status,
    latencyMs,
    bytes
  });

  if (Number.isFinite(latencyMs) && latencyMs >= 2000 && (!status || status < 400)) {
    this.callbacks.onLog('info', 'shaka-network-slow', {
      requestType,
      uri: response?.uri || null,
      latencyMs,
      status
    });
  }
}
```

Also add `consecutiveEmpty: 0` to the initial state (line 12-18):

```javascript
this.state = {
  suppressed404: false,
  attempts: 0,
  cooldownUntil: 0,
  pendingFetch: false,
  skipped: false,
  consecutiveEmpty: 0
};
```

**Step 2: Commit**

```
feat(player): detect 0-byte segment responses in BufferResilienceManager
```

---

## Summary

| Task | What | Risk | LOC |
|------|------|------|-----|
| 1 | 0-byte fragment detection in VideoPlayer | Low — additive logging | ~30 |
| 2 | Exponential backoff for recovery | Medium — changes retry timing | ~15 |
| 3 | Extend deadline on transcode warming | Low — additive event listener | ~25 |
| 4 | Preserve seek offset on retry | Low — one-line fix | ~5 |
| 5 | Diagnostics (covered by Task 1) | None | 0 |
| 6 | 0-byte detection in BufferResilienceManager | Low — additive state tracking | ~20 |

**Total recovery window before fix:** ~45s (3 attempts × 15s deadline, 4s cooldown)
**Total recovery window after fix:** ~160s (5 attempts × backoff 4→12→36→108s, plus 60s warmup grace)

Plex typically finishes transcoding in 60-90s → this covers it with margin.
