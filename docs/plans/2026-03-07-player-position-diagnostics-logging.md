# Player Position Diagnostics Logging — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add structured logging to the media controller's position tracking, seek lifecycle, and recovery pipeline so that future resume/seek failures can be diagnosed from session logs without needing `DEBUG_MEDIA=true`.

**Architecture:** All changes in one file (`useCommonMediaController.js`). Add a lazy-init child logger, then instrument 9 blind spots with structured `mcLog().info/warn` calls. No behavior changes — logging only.

**Tech Stack:** React hooks, `getLogger()` from `frontend/src/lib/logging/Logger.js`

---

## Task 1: Add lazy-init logger

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js:5-6`

**Step 1: Add logger after the existing import**

After line 5 (`import { getLogger } from ...`), add:

```javascript
// Lazy-init child logger for media controller diagnostics
let _mcLogger;
function mcLog() {
  if (!_mcLogger) _mcLogger = getLogger().child({ component: 'media-controller' });
  return _mcLogger;
}
```

**Step 2: Commit**

```
feat(player): add lazy-init structured logger for media controller diagnostics
```

---

## Task 2: Log start time decision tree (`playback.start-time-decision`)

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — in `onLoadedMetadata`, after the start time decision logic (~line 998-1034)

**Step 1: Add structured log after start time is fully resolved**

After the sticky resume block ends (after line 1034, just before `mediaEl.dataset.key = assetId`), add:

```javascript
      // Structured diagnostic: log the full start time decision
      mcLog().info('playback.start-time-decision', {
        mediaKey: assetId,
        requestedStart: start,
        effectiveStart: startTime,
        duration,
        isEffectiveInitial,
        isRecovering: isRecoveringRef.current,
        hasAppliedForKey,
        hasSnapshot: !!snapshot,
        snapshotTarget,
        isDash,
        stickyUsed: startTime > 0 && !isEffectiveInitial && !snapshot,
        lastSeekIntent: lastSeekIntentRef.current,
        lastSeekByKey: useCommonMediaController.__lastSeekByKey[assetId] ?? null,
        lastPosByKey: useCommonMediaController.__lastPosByKey[assetId] ?? null
      });
```

**Step 2: Commit**

```
feat(player): log start time decision tree on loadedmetadata
```

---

## Task 3: Log start time application result (`playback.start-time-applied`)

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — DASH deferred seek handler (~line 1050-1060) and non-DASH seek (~line 1064-1068)

**Step 1: Add log in DASH deferred seek handler**

Inside the `onTimeUpdate` handler, after the seek is applied (after line 1058, before the existing DEBUG_MEDIA log), add:

```javascript
              mcLog().info('playback.start-time-applied', {
                mediaKey: assetId,
                method: 'dash-deferred',
                intent: startTime,
                actual: mediaEl.currentTime,
                drift: Math.abs(mediaEl.currentTime - startTime)
              });
```

**Step 2: Add log in non-DASH seek path**

After line 1066 (`mediaEl.currentTime = startTime`), add:

```javascript
          mcLog().info('playback.start-time-applied', {
            mediaKey: assetId,
            method: 'direct',
            intent: startTime,
            actual: mediaEl.currentTime,
            drift: Math.abs(mediaEl.currentTime - startTime)
          });
```

**Step 3: Commit**

```
feat(player): log start time application result (intent vs actual)
```

---

## Task 4: Log progress bar clicks (`playback.progress-click`)

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — `handleProgressClick` (~line 337-350)

**Step 1: Add log at the end of handleProgressClick**

After the `mediaEl.currentTime = ...` assignment (after line 348, before the closing `}`), add:

```javascript
    mcLog().info('playback.progress-click', {
      mediaKey: assetId,
      clickPercent: Math.round(clickPercent * 1000) / 10,
      targetTime: mediaEl.currentTime,
      duration,
      segment: segment ? { start: segStart, end: segEnd } : null
    });
```

**Step 2: Commit**

```
feat(player): log progress bar click seeks
```

---

## Task 5: Log seek intent lifecycle (`playback.seek`)

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — `handleSeeking` (~line 1135-1143) and `clearSeeking` (~line 1145-1147)

**Step 1: Add sampled log in handleSeeking**

After line 1140 (`useCommonMediaController.__lastSeekByKey[assetId] = ...`), add:

```javascript
        mcLog().sampled('playback.seek', {
          mediaKey: assetId,
          phase: 'seeking',
          intent: mediaEl.currentTime,
          duration: mediaEl.duration,
          source: mediaEl.__seekSource || 'programmatic'
        }, { maxPerMinute: 30 });
        delete mediaEl.__seekSource;
```

**Step 2: Add log in clearSeeking for seeked confirmation**

Replace the `clearSeeking` function:

Before:
```javascript
    const clearSeeking = () => {
      requestAnimationFrame(() => setIsSeeking(false));
    };
```

After:
```javascript
    const clearSeeking = () => {
      const el = getMediaEl();
      if (el) {
        mcLog().sampled('playback.seek', {
          mediaKey: assetId,
          phase: 'seeked',
          actual: el.currentTime,
          intent: lastSeekIntentRef.current,
          drift: lastSeekIntentRef.current != null ? Math.abs(el.currentTime - lastSeekIntentRef.current) : null,
          duration: el.duration
        }, { maxPerMinute: 30 });
      }
      requestAnimationFrame(() => setIsSeeking(false));
    };
```

**Step 3: Commit**

```
feat(player): log seek intent lifecycle (seeking + seeked confirmation)
```

---

## Task 6: Log recovery strategy execution (`playback.recovery-strategy`)

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — `attemptRecovery` (~line 652-720)

**Step 1: Add log after strategy execution**

After line 706 (`s.strategyCounts[step.name] = ...`), add:

```javascript
    mcLog().warn('playback.recovery-strategy', {
      mediaKey: assetId,
      strategy: step.name,
      attempt: s.strategyCounts[step.name],
      manual,
      success,
      priorTime: getMediaEl()?.currentTime,
      lastSeekIntent: lastSeekIntentRef.current,
      duration: getMediaEl()?.duration,
      totalAttempts: s.recoveryAttempt,
      pipelineLength: strategySteps.length
    });
```

**Step 2: Log terminal failure**

In `handleTerminalFailure` (~line 613-624), after line 618 (`s.lastError = ...`), add:

```javascript
      mcLog().error('playback.recovery-terminal', {
        mediaKey: assetId,
        lastStrategy: s.lastStrategy,
        totalAttempts: s.recoveryAttempt,
        lastError: s.lastError,
        currentTime: getMediaEl()?.currentTime,
        duration: getMediaEl()?.duration
      });
```

**Step 3: Commit**

```
feat(player): log recovery strategy execution and terminal failures
```

---

## Task 7: Log recovery resolved (`playback.recovery-resolved`)

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — `markProgress` when `wasStalled` (~line 855-873)

**Step 1: Add log when stall is resolved by progress resuming**

After line 857 (the DEBUG_MEDIA log), add:

```javascript
      mcLog().info('playback.recovery-resolved', {
        mediaKey: assetId,
        currentTime: mediaEl?.currentTime,
        duration: mediaEl?.duration,
        stallDurationMs: s.sinceTs ? Date.now() - s.sinceTs : null,
        strategiesAttempted: s.recoveryAttempt,
        lastStrategy: s.lastStrategy,
        lastSeekIntent: lastSeekIntentRef.current
      });
```

**Step 2: Commit**

```
feat(player): log stall recovery resolution with duration and strategy info
```

---

## Task 8: Log position watchdog results (`playback.position-watchdog`)

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — `verifyRecoveryPosition` (~line 627-649)

**Step 1: Replace DEBUG_MEDIA logs with structured logger**

In the drift detected branch (line 635), add before the correction attempt:

```javascript
        mcLog().warn('playback.position-watchdog', {
          mediaKey: assetId,
          status: 'drift-detected',
          expected: expectedTime,
          actual,
          drift,
          tolerance: toleranceSeconds,
          correcting: true
        });
```

In the correction failure catch (line 643), add:

```javascript
          mcLog().error('playback.position-watchdog', {
            mediaKey: assetId,
            status: 'correction-failed',
            expected: expectedTime,
            actual,
            drift
          });
```

In the OK branch (line 646), add:

```javascript
        mcLog().debug('playback.position-watchdog', {
          mediaKey: assetId,
          status: 'ok',
          expected: expectedTime,
          actual,
          drift
        });
```

**Step 2: Commit**

```
feat(player): log position watchdog results as structured events
```

---

## Task 9: Log state dictionary mutations (`playback.state-mutation`)

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — all mutation sites for the three global dictionaries

**Step 1: Add logs at each mutation site**

There are 6 mutation sites to instrument:

**A.** Line 596 — `delete __appliedStartByKey[assetId]` (in softReinitRecovery):
```javascript
    mcLog().debug('playback.state-mutation', { dict: 'appliedStartByKey', action: 'delete', mediaKey: assetId, reason: 'softReinit' });
```

**B.** Line 598-599 — `lastSeekIntentRef = targetTime` + `__lastSeekByKey[assetId] = targetTime` (in softReinitRecovery):
```javascript
    mcLog().debug('playback.state-mutation', { dict: 'seekIntent', action: 'set', mediaKey: assetId, value: targetTime, reason: 'softReinit' });
```

**C.** Line 998 — `__appliedStartByKey[assetId] = true` (in onLoadedMetadata):
```javascript
        mcLog().debug('playback.state-mutation', { dict: 'appliedStartByKey', action: 'set', mediaKey: assetId, reason: 'initial-load' });
```

**D.** Lines 452, 494 — `lastSeekIntentRef.current = null` (in reload recovery seeked handlers):
```javascript
            mcLog().debug('playback.state-mutation', { dict: 'seekIntent', action: 'clear', mediaKey: assetId, reason: 'reload-seeked-confirmed' });
```

**E.** Line 1130 — `lastSeekIntentRef.current = null` (in snapshot cleanup):
```javascript
        mcLog().debug('playback.state-mutation', { dict: 'seekIntent', action: 'clear', mediaKey: assetId, reason: 'snapshot-cleanup' });
```

**F.** Lines 1139-1140 — `lastSeekIntentRef + __lastSeekByKey` (in handleSeeking):
Already covered by Task 5's `playback.seek` event — no duplicate needed.

**Step 2: Commit**

```
feat(player): log state dictionary mutations for position tracking
```

---

## Task 10: Log duration loss escalation (`playback.duration-lost`)

**Files:**
- Modify: `frontend/src/modules/Player/hooks/useCommonMediaController.js` — hard timer duration check (~line 820-824)

**Step 1: Add log when duration loss triggers escalation**

After line 821 (the DEBUG_MEDIA log), add:

```javascript
              mcLog().error('playback.duration-lost', {
                mediaKey: assetId,
                currentTime: mediaEl.currentTime,
                duration: mediaEl.duration,
                lastSeekIntent: lastSeekIntentRef.current,
                stallDurationMs: s.sinceTs ? Date.now() - s.sinceTs : null,
                escalatingTo: 'softReinit'
              });
```

**Step 2: Commit**

```
feat(player): log duration loss escalation as structured event
```

---

## Summary

| Task | Event | Level | Purpose |
|------|-------|-------|---------|
| 1 | — | — | Logger setup |
| 2 | `playback.start-time-decision` | info | Why did we pick this start time? |
| 3 | `playback.start-time-applied` | info | Did the seek land where intended? |
| 4 | `playback.progress-click` | info | User scrubbed to where? |
| 5 | `playback.seek` | sampled | Seek intent vs seeked actual |
| 6 | `playback.recovery-strategy` | warn | Which strategy, did it work? |
| 7 | `playback.recovery-resolved` | info | Stall over — how long, what fixed it? |
| 8 | `playback.position-watchdog` | warn/debug | Drift detected or OK? |
| 9 | `playback.state-mutation` | debug | __appliedStartByKey/seekIntent changes |
| 10 | `playback.duration-lost` | error | Duration null — escalating |

All changes in `frontend/src/modules/Player/hooks/useCommonMediaController.js`. No behavior changes — logging only.
