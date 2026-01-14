# Production Session Summary - January 14, 2026

## Session Overview
- **Container Start**: 2026-01-14 21:58:19Z
- **Session End**: 2026-01-14 22:45:37Z (last log entry)
- **Duration**: ~47 minutes
- **Total Log Lines**: 76,474
- **Log File Size**: 17MB

## Session Activity

### Initialization (21:58:19 - 21:58:21)
- Container started successfully
- ConfigService loaded (3 layers: app, apps, secrets)
- WebSocket server started on /ws
- MQTT connected to mosquitto:1883
  - Subscribed to 3 vibration sensors (punching bag, step platform, pull-up bar)
- Cron scheduler started (21 tasks registered)
- API servers started:
  - Primary: port 3111
  - Secondary: port 3119

### Active Fitness Session (21:59 - 22:45)
- **Total Fitness Profile Samples**: 94 (every 30 seconds)
- **Participants**: Started with 1 user, grew to 5-6 devices by mid-session
- **Peak Device Count**: 6 devices
- **Peak Series Points**: 44,100 data points
- **Active Roster Size**: 4-5 participants

### Memory Usage Progression

#### Early Session (samples 1-10, first 4.5 minutes)
- Start: 14.6 MB heap
- Growth: +14-86 MB

#### Mid Session (samples 20-50, 9.5-25 minutes)
- Range: 100-237 MB heap
- Steady climb with garbage collection cycles

#### Late Session (samples 60-89, 30-44 minutes)
- Range: 269-722 MB heap  
- **Peak**: 722.4 MB at sample 86 (42:30 elapsed)
- **Final**: 669.7 MB at sample 89 (44:00 elapsed)
- **Total Growth**: +650 MB from start

**Memory Pattern**: Continuous linear growth averaging ~15 MB/minute with no plateau, suggesting a memory leak.

## Critical Issues

### 1. **FRONTEND JAVASCRIPT ERROR** (22:44:03)
```
ReferenceError: intervalMs is not defined
  at JI (index-Bqng0ggg.js:353:68214)
  Context: FitnessChart component, useMemo hook
```
- **Impact**: Frontend chart rendering error
- **Location**: frontend/src/modules/Fitness/FitnessSidebar/FitnessVideo.jsx
- **Logged**: console.error, window.onerror, error event
- **Severity**: High - breaks chart functionality

### 2. **MEMORY LEAK** (Progressive)
- **Rate**: ~15 MB/minute sustained growth
- **Total Growth**: 655 MB over 44 minutes (14.6 → 669.7 MB)
- **Pattern**: No stabilization or garbage collection plateau
- **Context**: 
  - Series count: 84
  - Total series points: 44,100
  - Max series length: 525
  - Chart cache size: 5
  - Chart dropout markers: 2

### 3. **ABRUPT TERMINATION**
- Last log entry: 22:45:37.187Z
- **No graceful shutdown logs**
- **No error messages** indicating crash reason
- Session ended at ~47 minutes without cleanup

## Recurring Warnings (Non-Critical)

1. **FitnessChart Status Corrections** (~10,000+ occurrences)
   - "Status corrected from roster.isActive"
   - Participants: felix, soren (marked as removed/idle)
   - Indicates state synchronization issues between roster and chart

2. **Avatar Mismatch Warnings** (hundreds)
   - Roster count vs chart count discrepancies
   - Missing/extra participants in chart

## Session Characteristics

### Frontend Activity
- Multiple fitness video components mounted/unmounted
- Zoom operations on charts (zoom-in, zoom-reset, seek operations)
- Heart rate zones tracked: warm, hot
- Treasure box coin system active

### Backend Activity  
- Websocket broadcasts: ~1-4 clients connected
- Topics: fitness, vibration, midi, playback, menu, system
- MQTT vibration data flowing from garage sensors
- Cron tasks running on 5-second intervals

## Analysis

### Probable Crash Cause
The session terminated abruptly without logs, suggesting either:
1. **Out-of-Memory Kill**: Container/process killed by OS due to 670+ MB heap
2. **Node.js Heap Limit**: Process exceeded V8 heap limit
3. **External Termination**: Docker/system restart

### Root Cause: Memory Leak
The `intervalMs undefined` error appeared late in the session (42:44) during chart rendering, possibly triggered by the large data set accumulated over time. The continuous memory growth indicates data structures (likely time series arrays) are not being properly garbage collected.

### Data Retention Issue
With 525 maximum series length and 84 series (per device), storing ~44K data points without windowing or pruning caused unbounded growth. Chart cache (size 5) and event log (500 entries) were bounded, but the primary series data was not.

## Recommendations

1. **Fix intervalMs error** in FitnessChart/FitnessVideo component
2. **Implement data windowing**: Limit series point retention (e.g., rolling 10-minute window)
3. **Add heap monitoring**: Alert when heap > 500 MB
4. **Investigate state sync** issues between roster and chart
5. **Test with multiple devices** for extended periods (>1 hour)
6. **Add graceful degradation** when memory pressure is high

## Files of Interest
- Frontend error source: `frontend/src/modules/Fitness/`
- Related: TreasureBox, FitnessChart components
- Backend: MQTT vibration handlers, WebSocket fitness broadcasts
