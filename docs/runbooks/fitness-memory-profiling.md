# Fitness App Memory Leak & Performance Profiling Runbook

## Overview

The Fitness app runs on a large touchscreen TV (Firefox kiosk mode) and must remain stable for extended workout sessions. Memory leaks or performance degradation can cause crashes or UI freezes mid-session.

This runbook covers how to monitor, diagnose, and fix memory issues using the built-in profiling system.

**Related code:**
- `frontend/src/Apps/FitnessApp.jsx` - Main profiling logic (lines 75-188)
- `frontend/src/hooks/fitness/FitnessSession.js` - Session memory stats
- `frontend/src/context/FitnessContext.jsx` - Render stats exposure

---

## Profiling System

### How It Works

The Fitness app automatically logs memory/performance profiles every **30 seconds** using rate-limited sampling (`maxPerMinute: 2`). These logs go to the backend via WebSocket and appear in production logs.

### Log Event Names

| Event | Level | Description |
|-------|-------|-------------|
| `fitness-profile` | info | Regular profile snapshot |
| `fitness-profile-memory-warning` | warn | Heap growth > 20MB |
| `fitness-profile-timer-warning` | warn | Timer count increased > 5 |
| `fitness-profile-series-warning` | warn | Data series > 1500 points |
| `fitness-profile-snapshot-series-warning` | warn | Snapshot pruning failing |
| `fitness-profile-treasurebox-warning` | warn | Timeline > 800 points |
| `fitness-profile-orphan-timer` | error | Tick timer running without session |
| `fitness-profile-excessive-renders` | warn | forceUpdate count > 100 |

---

## Monitoring Production

### Quick Health Check

```bash
# Watch fitness profile logs in real-time
ssh {hosts.prod} 'docker logs -f {docker.container}' 2>&1 | grep 'fitness-profile'

# Check for warnings only
ssh {hosts.prod} 'docker logs -f {docker.container}' 2>&1 | grep 'fitness-profile.*warning'

# Check for memory warnings specifically
ssh {hosts.prod} 'docker logs -f {docker.container}' 2>&1 | grep 'fitness-profile-memory-warning'
```

### Extract Profile Metrics

```bash
# Get profile samples as TSV (timestamp, heap, growth, series)
ssh {hosts.prod} 'docker logs {docker.container} 2>&1' | \
  grep '"fitness-profile"' | \
  jq -r '[.ts, .data.heapMB, .data.heapGrowthMB, .data.totalSeriesPoints] | @tsv'
```

### Check Session During Active Workout

```bash
# Monitor active session stats
ssh {hosts.prod} 'docker logs -f {docker.container}' 2>&1 | \
  grep 'fitness-profile' | \
  jq -r '[.data.elapsedSec, .data.heapMB, .data.sessionActive, .data.rosterSize] | @tsv'
```

---

## Profile Metrics Reference

### Memory Metrics

| Metric | Description | Warning Threshold |
|--------|-------------|-------------------|
| `heapMB` | Current JS heap size in MB | - |
| `heapGrowthMB` | Growth from baseline | > 20 MB |
| `timers` | Active interval count | - |
| `timerGrowth` | Intervals added since start | > 5 |
| `timeouts` | Active timeout count | - |

### Session Data Metrics

| Metric | Description | Warning Threshold |
|--------|-------------|-------------------|
| `sessionActive` | Is workout session running | - |
| `tickTimerRunning` | Is tick timer active | - |
| `rosterSize` | Participants in session | - |
| `deviceCount` | Connected ANT+ devices | - |
| `seriesCount` | Number of data series | - |
| `totalSeriesPoints` | All series data combined | - |
| `maxSeriesLength` | Longest individual series | > 1500 |
| `eventLogSize` | Session event log entries | - |

### Subsystem Leak Indicators

| Metric | Description | Warning Threshold |
|--------|-------------|-------------------|
| `snapshotSeriesPoints` | Snapshot data size | - |
| `maxSnapshotSeriesLength` | Longest snapshot series | > 2500 |
| `treasureBoxCumulativeLen` | Timeline accumulation | > 800 |
| `treasureBoxPerColorPoints` | Per-color tracking data | - |
| `voiceMemoCount` | Voice memos in memory | - |
| `cumulativeBeatsSize` | Heart rate history | - |
| `cumulativeRotationsSize` | Cadence history | - |

### Rendering Metrics

| Metric | Description | Warning Threshold |
|--------|-------------|-------------------|
| `chartCacheSize` | Chart participant cache | - |
| `chartDropoutMarkers` | Dropout markers stored | - |
| `forceUpdateCount` | React forceUpdate calls | > 100 |
| `renderCount` | Total render count | - |

---

## Diagnosing Leaks

### Decision Tree

```
Heap growing steadily?
├── YES: Check which metrics correlate
│   ├── maxSeriesLength growing → Series pruning bug
│   ├── snapshotSeriesPoints growing → Snapshot pruning bug
│   ├── treasureBoxCumulativeLen growing → TreasureBox cleanup bug
│   ├── timerGrowth increasing → Interval leak (missing clearInterval)
│   ├── forceUpdateCount high → Render thrashing
│   └── All stable → DOM/event listener leak (not tracked)
└── NO: Check for spikes
    ├── Spikes during video transitions → Media cleanup issue
    └── Spikes during user changes → Roster cleanup issue
```

### Common Leak Patterns

#### 1. Orphaned Tick Timer (CRITICAL)

**Symptom:** `fitness-profile-orphan-timer` error in logs

**Cause:** Session ended but tick timer wasn't stopped

**Fix:** Check `FitnessSession.js` cleanup in `useEffect` return

```bash
# Find orphan timer events
ssh {hosts.prod} 'docker logs {docker.container} 2>&1' | grep 'orphan-timer'
```

#### 2. Series Data Accumulation

**Symptom:** `maxSeriesLength` or `totalSeriesPoints` growing unbounded

**Cause:** Data not being pruned after session window

**Fix:** Check pruning logic in series accumulator hooks

#### 3. TreasureBox Timeline Growth

**Symptom:** `treasureBoxCumulativeLen` > 800

**Cause:** Zone color history not being trimmed

**Fix:** Check `TreasureBox` component cleanup

#### 4. Render Thrashing

**Symptom:** `forceUpdateCount` > 100 in 30 seconds

**Cause:** Infinite re-render loop, often from:
- State update in useEffect without proper deps
- Unstable object/array references in context

**Fix:** Check recent changes to context providers or hooks

#### 5. DOM/Event Listener Leak

**Symptom:** Heap grows but ALL tracked metrics stay stable

**Cause:** Event listeners not removed, DOM nodes orphaned

**Fix:** 
- Check `useEffect` cleanup functions
- Look for `addEventListener` without `removeEventListener`
- Check for refs holding stale DOM elements

---

## Emergency Procedures

### Mid-Session Crash Prevention

If heap growth is concerning during an active session:

1. **Complete current video** - don't interrupt mid-workout
2. **End session cleanly** - uses normal cleanup path
3. **Reload app** - clears all memory
4. **Resume workout** - fresh state

### Force Reload (Last Resort)

```javascript
// Browser console on fitness TV
window.location.reload();
```

### Container Restart

```bash
# If app is completely unresponsive
ssh {hosts.prod} 'docker restart {docker.container}'
```

---

## Post-Incident Analysis

### Collect Session Logs

```bash
# Dump all logs for a specific timeframe
ssh {hosts.prod} 'docker logs {docker.container} 2>&1' | \
  grep '2026-01-19T12' > ~/Downloads/fitness-session-logs.txt

# Extract just fitness-profile data
cat ~/Downloads/fitness-session-logs.txt | \
  grep 'fitness-profile' | \
  jq '.' > ~/Downloads/fitness-profiles.json
```

### Generate Memory Timeline

```bash
# Create CSV for graphing
ssh {hosts.prod} 'docker logs {docker.container} 2>&1' | \
  grep '"fitness-profile"' | \
  jq -r '[.data.elapsedSec, .data.heapMB, .data.heapGrowthMB, .data.maxSeriesLength, .data.treasureBoxCumulativeLen] | @csv' \
  > ~/Downloads/memory-timeline.csv
```

### Check for Correlation

Look for metrics that increase linearly with heap:
- If metric X and heap both grow → leak is in subsystem X
- If heap grows alone → untracked leak (DOM, closures, event listeners)

---

## Prevention

### Code Review Checklist

When reviewing Fitness app changes:

- [ ] All `useEffect` hooks have cleanup functions
- [ ] All `setInterval` calls have matching `clearInterval`
- [ ] All `setTimeout` calls are tracked and cleared
- [ ] Event listeners are removed in cleanup
- [ ] Refs don't hold stale data after unmount
- [ ] Context values use stable references (useMemo/useCallback)
- [ ] No state updates in render phase

### Testing

Run extended session tests before deployment:

```bash
# Run memory leak integration test
npm run test -- tests/integration/fitness/memory-leak.test.mjs
```

---

## Related Documentation

- [frontend-logging-debugging.md](frontend-logging-debugging.md) - General frontend logging
- [docs/reference/fitness/2-architecture.md](../reference/fitness/2-architecture.md) - Fitness architecture
- [docs/reference/core/4-codebase.md](../reference/core/4-codebase.md) - Logging infrastructure

## Related Audits

- [docs/_wip/audits/2026-01-19-fitness-memory-audit.md](../_wip/audits/2026-01-19-fitness-memory-audit.md) - Memory leak investigation that led to this runbook
