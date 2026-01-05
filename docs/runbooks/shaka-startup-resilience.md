# Shaka Player Startup Resilience Analysis

**Date:** December 13, 2025  
**Issue:** Resilience system triggers premature recovery during normal Shaka startup

---

## Problem Statement

The `useMediaResilience` hook is classifying normal startup latency as a "decoder-stall" and triggering unnecessary recovery actions (micro-seeks, bitrate reductions, remounts) before Shaka Player has a fair chance to initialize.

**Evidence from logs (22:35:47):**
```javascript
{
  "event": "stall-root-cause",
  "classification": "decoder-stall",
  "diagnostics": {
    "readyState": 0,         // HAVE_NOTHING
    "networkState": 0,       // NETWORK_EMPTY  
    "buffered": [],          // No data yet
    "paused": true,
    "currentTime": 0,
    "totalFrames": 0
  }
}
```

This is **not a stall** — it's a player that hasn't loaded any data yet. The resilience system is being too aggressive.

---

## Root Cause Analysis

### Current Behavior

1. **Grace period too short:** `DECODER_NUDGE_GRACE_MS = 2000` (2 seconds)
2. **Startup not distinguished from playback:** The stall detection logic treats `readyState: 0` the same as a mid-playback stall
3. **No awareness of backend warmup:** Plex transcoder and NAS disk spinup can take 5-15 seconds
4. **Shaka's own recovery not trusted:** We intervene before Shaka's `stallEnabled` can handle it

### Why This Matters

| Scenario | Expected Startup Time | Current Grace |
|----------|----------------------|---------------|
| Hot cache, SSD | 1-2 seconds | ✅ 2s OK |
| Cold transcode session | 3-8 seconds | ❌ Too short |
| NAS disk spinup | 5-15 seconds | ❌ Way too short |
| Network congestion | 2-10 seconds | ❌ Often too short |

### Shaka's Built-in Capabilities

Shaka Player already has robust startup handling:

```javascript
// Current config (from logs)
{
  "streaming": {
    "bufferingGoal": 90,
    "rebufferingGoal": 30,
    "stallEnabled": true,
    "stallThreshold": 0.25,
    "retryParameters": {
      "maxAttempts": 7,
      "baseDelay": 250,
      "backoffFactor": 2
    }
  }
}
```

Shaka will:
- Retry failed segment fetches up to 7 times with exponential backoff
- Detect stalls after 0.25 seconds of no playback progress
- Automatically adjust quality based on bandwidth

**We should let Shaka handle normal startup, only intervening when it truly fails.**

---

## Recommended Solution

### 1. Distinguish Startup Phase from Active Playback

**Current:** Stall detection triggers immediately regardless of playback state.

**Proposed:** Add a "startup phase" that ends when:
- `readyState >= 3` (HAVE_FUTURE_DATA) AND
- At least one `timeupdate` event received AND  
- `progressToken > 0`

During startup phase:
- Use extended timeouts
- Don't classify `readyState: 0` as decoder-stall
- Let Shaka's retry logic work

### 2. Tiered Timeout Strategy

```javascript
// Proposed constants
const STARTUP_INITIAL_GRACE_MS = 8000;      // 8s for initial manifest + first segments
const STARTUP_EXTENDED_GRACE_MS = 20000;    // 20s max for slow NAS/transcode
const PLAYBACK_STALL_THRESHOLD_MS = 4000;   // 4s for mid-playback stalls
const DECODER_NUDGE_MIN_BUFFER_MS = 8000;   // Only nudge if we HAD buffer

// Watchdog escalation
const STARTUP_WATCHDOG_TIERS = [
  { atMs: 8000,  action: 'log-warning' },
  { atMs: 15000, action: 'reduce-bitrate' },
  { atMs: 20000, action: 'force-remount' },
  { atMs: 30000, action: 'hard-reload' }
];
```

### 3. Smarter Stall Classification

**Current classification logic:**
```javascript
// Treats readyState:0 as decoder-stall
if (readyState === 0 && !paused) {
  return 'decoder-stall';  // ❌ Wrong during startup
}
```

**Proposed classification:**
```javascript
const classifyStall = (diagnostics, isStartupPhase) => {
  const { readyState, networkState, buffered, totalFrames } = diagnostics;
  
  // During startup, don't classify as stall until we've had data
  if (isStartupPhase) {
    if (readyState < 2) return 'startup-pending';  // Not a stall
    if (buffered.length === 0) return 'startup-buffering';  // Expected
  }
  
  // Only classify as decoder-stall if we HAD buffer and lost it
  if (totalFrames > 0 && readyState < 3) {
    return 'decoder-stall';
  }
  
  // Buffer gap during playback
  if (buffered.length > 0 && readyState < 3) {
    return 'buffer-underrun';
  }
  
  // Network issue
  if (networkState === 0 || networkState === 3) {
    return 'network-stall';
  }
  
  return 'unknown';
};
```

### 4. Trust Shaka's Stall Recovery First

**Proposed flow:**

```
Startup Request
      │
      ▼
┌─────────────────────────┐
│  Startup Grace Period   │ ◄── 8-20 seconds based on conditions
│  - Let Shaka buffer     │
│  - Monitor readyState   │
│  - Log progress         │
└─────────────────────────┘
      │
      ▼ (readyState >= 3, progress detected)
┌─────────────────────────┐
│  Active Playback        │
│  - Normal stall detect  │
│  - 4s threshold         │
└─────────────────────────┘
      │
      ▼ (stall detected, 4s+ no progress)
┌─────────────────────────┐
│  Shaka Stall Handler    │ ◄── Let Shaka try first (stallEnabled: true)
│  - Wait 2s for Shaka    │
└─────────────────────────┘
      │
      ▼ (Shaka didn't recover)
┌─────────────────────────┐
│  Resilience Nudge       │ ◄── Micro-seek, check buffer
│  - Decoder nudge        │
│  - Check frame advance  │
└─────────────────────────┘
      │
      ▼ (still stalled)
┌─────────────────────────┐
│  Bitrate Reduction      │ ◄── Try lower quality
│  - Reduce 10%           │
│  - Trigger new manifest │
└─────────────────────────┘
      │
      ▼ (still stalled)
┌─────────────────────────┐
│  Hard Recovery          │ ◄── Last resort
│  - Force remount        │
│  - If repeated: reload  │
└─────────────────────────┘
```

---

## Action Plan

### Phase 1: Extend Startup Grace (Low Risk)

**Files:** `useMediaResilience.js`, `useResilienceConfig.js`

1. Increase `DECODER_NUDGE_GRACE_MS` from 2000 → 8000
2. Add `STARTUP_EXTENDED_GRACE_MS = 20000` for cold starts
3. Track `hasHadPlayback` flag to distinguish startup from mid-playback

**Estimated effort:** 1-2 hours

### Phase 2: Smarter Stall Classification (Medium Risk)

**Files:** `useResiliencePolicy.js`

1. Add `isStartupPhase` to classification context
2. Don't classify `readyState < 2` as decoder-stall during startup
3. Require `totalFrames > 0` or `buffered.length > 0` before declaring stall

**Estimated effort:** 2-3 hours

### Phase 3: Tiered Watchdog (Medium Risk)

**Files:** `useMediaResilience.js`, `useResilienceRecovery.js`

1. Implement `STARTUP_WATCHDOG_TIERS` escalation
2. Log warnings before taking action
3. Give Shaka 2s to handle stalls before our nudge

**Estimated effort:** 3-4 hours

### Phase 4: Configuration & Observability

1. Make grace periods configurable via `config.app.yml`
2. Add Loggly preset for startup diagnostics: `--startup-timing`
3. Add metrics: `startup_duration_ms`, `startup_intervention_count`

**Estimated effort:** 2-3 hours

---

## Success Criteria

1. **No decoder-stall events at startup** when `readyState < 2`
2. **Startup completes without intervention** in 95% of cases
3. **Cold NAS spinup** (15s) handled gracefully without reload
4. **True mid-playback stalls** still detected and recovered within 8s
5. **No infinite hangs** — hard watchdog at 30s max

---

## Rollback Plan

If issues arise:
1. Revert grace period constants to previous values
2. Feature flag: `RESILIENCE_STARTUP_GRACE_ENABLED` in config
3. Monitor Loggly for `startup-watchdog-timeout` events

---

## Related Files

| File | Purpose |
|------|---------|
| `useMediaResilience.js` | Main resilience hook |
| `useResilienceConfig.js` | Configuration and defaults |
| `useResiliencePolicy.js` | Stall classification logic |
| `useResilienceRecovery.js` | Recovery actions |
| `usePlaybackHealth.js` | Media element monitoring |
| `config/logging.yml` | Configurable thresholds |
