# Unified Timeline Source of Truth Design

## Problem Statement

Four UI components display fitness session data but read from different sources at different intervals, causing visual inconsistencies:

| Component | Data Source | Update Frequency | Issue |
|-----------|-------------|------------------|-------|
| ParticipantRoster | TreasureBox.getUserZoneSnapshot() | Every React render (~1s) | Works well (baseline) |
| GovernanceStateOverlay | GovernanceEngine._latestInputs | 1000ms pulse timer | 1-2 second lag behind roster |
| FitnessChart | FitnessTimeline.series | 5000ms timeline tick | Sawtooth pattern, flat lines in colored zones |
| TreasureBox UI | TreasureBox.perUser | Immediate | Shows correct totals |

### Symptoms

1. **Governance lag**: When 3 people reach hot zone, roster shows it immediately but governance overlay takes 1-2 seconds to register the challenge as complete.

2. **Chart sawtooth**: Lines alternate between sloped and flat segments even when user stays in same zone. Caused by timeline recording `[0, 5, 5, 10, 10, 15]` (coins awarded in bursts) and chart connecting points directly.

3. **Flat colored lines**: Non-blue zones should always show slope (coins being earned), but flat segments appear when coin award and timeline tick aren't synchronized.

## Architecture

### Current Data Flow (Problematic)

```
DeviceManager → UserManager → TreasureBox → TimelineRecorder → FitnessTimeline
                                   ↓                                ↓
                          ParticipantRoster              FitnessChart (5s stale)
                                   ↓
                          GovernanceEngine (1s poll)
```

### New Data Flow (Unified)

```
TreasureBox (Single Source of Truth - Real-time)
├─→ GovernanceEngine.evaluate() - reactive callback, no timer
├─→ ParticipantRoster - zone colors (unchanged)
├─→ FitnessChart - live edge + zone-based interpolation
└─→ TimelineRecorder - writes snapshots every 5s (unchanged)

FitnessTimeline (Historical Record)
├─→ FitnessChart - base series data
└─→ Session save/restore
```

### Design Decisions

1. **TreasureBox as real-time source**: All UI components read current state from TreasureBox directly.

2. **Timeline unchanged**: Keep 5-second tick interval for session persistence. More frequent ticks would 6x storage for minimal benefit.

3. **Render-time interpolation**: Chart smooths sawtooth pattern visually based on zone coin rates. Raw data stays honest for session saves.

4. **Reactive governance**: Remove polling timer, trigger evaluation on TreasureBox state changes.

## Component Changes

### 1. TreasureBox Additions

**File**: `frontend/src/hooks/fitness/TreasureBox.js`

#### New Method: `getIntervalProgress(userId)`

Returns real-time progress within current coin interval:

```javascript
/**
 * Get real-time interval progress for a user.
 * Used by chart for live edge rendering.
 *
 * @param {string} userId - User ID
 * @returns {Object} Progress data
 */
getIntervalProgress(userId) {
  const acc = this.perUser.get(userId);
  if (!acc || !acc.currentIntervalStart) {
    return { progress: 0, pendingCoins: 0, zone: null, totalCoins: 0, projectedTotal: 0 };
  }

  const elapsed = Date.now() - acc.currentIntervalStart;
  const progress = Math.min(1, elapsed / this.coinTimeUnitMs);
  const zone = acc.highestZone;
  const pendingCoins = zone ? zone.coins * progress : 0;

  return {
    progress,              // 0-1 through interval
    pendingCoins,          // interpolated coins earned so far
    zone,                  // current zone object (null if no HR)
    zoneId: acc.lastZoneId,
    zoneColor: acc.lastColor,
    totalCoins: acc.totalCoins || 0,
    projectedTotal: (acc.totalCoins || 0) + pendingCoins
  };
}
```

#### New Method: `getLiveSnapshot()`

Returns all users' real-time state:

```javascript
/**
 * Get live snapshot of all users for governance and chart.
 * Single source of truth for current zone/coin state.
 *
 * @returns {Array<Object>} Snapshot of all users
 */
getLiveSnapshot() {
  const snapshot = [];
  this.perUser.forEach((acc, userId) => {
    const progress = this.getIntervalProgress(userId);
    snapshot.push({
      userId,
      zoneId: acc.lastZoneId,
      zoneColor: acc.lastColor,
      totalCoins: acc.totalCoins || 0,
      projectedCoins: progress.projectedTotal,
      intervalProgress: progress.progress,
      isActive: acc.highestZone !== null,
      lastHR: acc.lastHR
    });
  });
  return snapshot;
}
```

#### New Method: `setGovernanceCallback(callback)`

Allows GovernanceEngine to subscribe to state changes:

```javascript
/**
 * Set callback for governance engine to react to zone changes.
 * Called when any user's zone changes.
 *
 * @param {Function|null} callback
 */
setGovernanceCallback(callback) {
  this._governanceCb = typeof callback === 'function' ? callback : null;
}

_notifyGovernance() {
  if (this._governanceCb) {
    try { this._governanceCb(); } catch (_) {}
  }
}
```

#### Modify: `recordUserHeartRate()`

Add governance notification when zone changes:

```javascript
// In recordUserHeartRate(), after zone resolution:
if (zone) {
  const previousZoneId = acc.lastZoneId;
  if (!acc.highestZone || zone.min > acc.highestZone.min) {
    acc.highestZone = zone;
    acc.currentColor = zone.color;
    acc.lastColor = zone.color;
    acc.lastZoneId = zone.id || zone.name || null;

    // Notify governance if zone changed
    if (acc.lastZoneId !== previousZoneId) {
      this._notifyGovernance();
    }
  }
}
```

### 2. GovernanceEngine Changes

**File**: `frontend/src/hooks/fitness/GovernanceEngine.js`

#### Remove: Self-polling in `configure()`

```javascript
// REMOVE this line from configure():
// this._schedulePulse(1000);
```

#### Add: Reactive subscription in `configure()`

```javascript
configure(config) {
  // ... existing config parsing ...

  // Subscribe to TreasureBox for reactive evaluation
  if (this.session?.treasureBox) {
    this.session.treasureBox.setGovernanceCallback(() => {
      this._evaluateFromTreasureBox();
    });
  }

  // Initial evaluation
  this._evaluateFromTreasureBox();
}
```

#### New Method: `_evaluateFromTreasureBox()`

```javascript
/**
 * Evaluate governance state from TreasureBox snapshot.
 * Called reactively when zone state changes.
 */
_evaluateFromTreasureBox() {
  const box = this.session?.treasureBox;
  if (!box) return;

  const snapshot = box.getLiveSnapshot();

  const activeParticipants = snapshot
    .filter(s => s.isActive)
    .map(s => s.userId);

  const userZoneMap = {};
  snapshot.forEach(s => {
    if (s.userId) {
      userZoneMap[s.userId] = s.zoneId;
    }
  });

  this.evaluate({
    activeParticipants,
    userZoneMap,
    totalCount: activeParticipants.length
  });
}
```

#### Rename: `_schedulePulse()` → `_scheduleChallengeTimer()`

Keep the timer mechanism but only for challenge countdown/expiry logic:

```javascript
// Rename all occurrences of _schedulePulse to _scheduleChallengeTimer
// to clarify it's only for challenge timing, not zone evaluation
```

### 3. FitnessChart Changes

**File**: `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx`

#### Update: `useFitnessPlugin` to provide TreasureBox

```javascript
const {
  participants,
  historicalParticipants,
  getUserTimelineSeries,
  timebase,
  registerLifecycle,
  activityMonitor,
  treasureBox  // ADD: Direct access to TreasureBox
} = useFitnessPlugin('fitness_chart');
```

#### Update: Pass TreasureBox to data hooks

```javascript
const { allEntries, presentEntries, absentEntries, dropoutMarkers, maxValue, maxIndex } = useRaceChartWithHistory(
  participants,
  getUserTimelineSeries,
  timebase,
  historicalParticipants,
  { activityMonitor, treasureBox }  // ADD treasureBox
);
```

**File**: `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js`

#### New: Zone coin rate lookup

```javascript
/**
 * Get coin rate for a zone ID.
 * @param {string} zoneId - Zone ID (e.g., 'active', 'warm', 'hot', 'fire')
 * @param {Array} zoneConfig - Zone configuration array
 * @returns {number} Coins per interval (0 for blue/unknown)
 */
export const getZoneCoinRate = (zoneId, zoneConfig = []) => {
  if (!zoneId) return 0;
  const normalizedId = String(zoneId).toLowerCase();
  const zone = zoneConfig.find(z =>
    String(z.id || '').toLowerCase() === normalizedId ||
    String(z.name || '').toLowerCase() === normalizedId
  );
  return zone?.coins || 0;
};
```

#### Update: `buildSegments()` - Zone-based slope enforcement

```javascript
/**
 * Build chart segments with zone-based slope enforcement.
 *
 * Rules:
 * - Blue zones (coinRate=0): Always flat
 * - Non-blue zones: Always sloped based on coin rate
 * - Grey (dropout): Flat + dashed
 *
 * @param {number[]} beats - Recorded coin values per tick
 * @param {(string|null)[]} zones - Zone IDs per tick
 * @param {boolean[]} active - Activity status per tick
 * @param {Object} options
 * @param {Array} options.zoneConfig - Zone configuration for coin rates
 * @returns {Object[]} Segments with interpolated points
 */
export const buildSegments = (beats = [], zones = [], active = [], options = {}) => {
  const { zoneConfig = [] } = options;
  const segments = [];

  // ... existing segment building logic ...

  // POST-PROCESS: Enforce zone-based slopes
  return enforceZoneSlopes(segments, zoneConfig);
};

/**
 * Enforce that segment slopes match zone coin rates.
 * Eliminates sawtooth pattern by interpolating based on zone, not raw data.
 */
function enforceZoneSlopes(segments, zoneConfig) {
  return segments.map(segment => {
    if (segment.isGap) return segment; // Dropout segments stay flat+dashed

    const coinRate = getZoneCoinRate(segment.zone, zoneConfig);

    if (coinRate === 0) {
      // Blue zone: enforce flat (use start value for all points)
      const startValue = segment.points[0]?.v ?? 0;
      return {
        ...segment,
        points: segment.points.map(p => ({ ...p, v: startValue }))
      };
    }

    // Non-blue zone: ensure slope exists
    // If points are flat (same value), interpolate based on expected rate
    const startValue = segment.points[0]?.v ?? 0;
    const endValue = segment.points[segment.points.length - 1]?.v ?? startValue;

    if (startValue === endValue && segment.points.length > 1) {
      // Flat segment in non-blue zone - create slope
      // Distribute expected gain across segment
      const tickCount = segment.points.length - 1;
      const expectedGain = coinRate * tickCount;

      return {
        ...segment,
        points: segment.points.map((p, idx) => ({
          ...p,
          v: startValue + (expectedGain * (idx / tickCount))
        })),
        _interpolated: true // Mark for debugging
      };
    }

    return segment;
  });
}
```

#### New: Live edge rendering

Add live edge extension from last recorded point to current TreasureBox state:

```javascript
/**
 * Build live edge data for real-time chart updates.
 * Extends from last timeline point to current TreasureBox state.
 *
 * @param {Object} entry - Chart entry with beats/zones
 * @param {Object} liveData - From TreasureBox.getIntervalProgress()
 * @param {number} currentTick - Current tick index
 * @returns {Object|null} Live edge segment
 */
export const buildLiveEdge = (entry, liveData, currentTick) => {
  if (!liveData || !liveData.isActive) return null;

  const lastIdx = entry.beats.length - 1;
  if (lastIdx < 0) return null;

  const lastValue = entry.beats[lastIdx];
  const projectedValue = liveData.projectedCoins;

  // Only show live edge if it extends beyond last recorded point
  if (currentTick <= lastIdx) return null;

  return {
    startTick: lastIdx,
    startValue: lastValue,
    endTick: currentTick + liveData.progress, // Fractional tick
    endValue: projectedValue,
    zone: liveData.zoneId,
    color: liveData.zoneColor,
    isLive: true
  };
};
```

### 4. FitnessContext Changes

**File**: `frontend/src/context/FitnessContext.jsx`

#### Expose TreasureBox to plugins

Add `treasureBox` instance to context value:

```javascript
const value = {
  // ... existing values ...

  // TreasureBox direct access for chart live edge
  treasureBoxInstance: session?.treasureBox,
  getTreasureBoxLiveSnapshot: () => session?.treasureBox?.getLiveSnapshot() || [],
  getTreasureBoxIntervalProgress: (userId) => session?.treasureBox?.getIntervalProgress(userId) || null,
};
```

### 5. useFitnessPlugin Hook Changes

**File**: `frontend/src/modules/Fitness/FitnessPlugins/useFitnessPlugin.js`

Add TreasureBox access:

```javascript
// In the hook return value:
return {
  // ... existing values ...

  treasureBox: context.treasureBoxInstance,
  getLiveSnapshot: context.getTreasureBoxLiveSnapshot,
  getIntervalProgress: context.getTreasureBoxIntervalProgress,
};
```

## Visual Behavior Summary

### Chart Line Rules

| Zone | Coin Rate | Visual |
|------|-----------|--------|
| Blue (active) | 0 | Flat horizontal line |
| Yellow (warm) | 1 | Gentle upward slope |
| Orange (hot) | 3 | Medium upward slope |
| Red (fire) | 5 | Steep upward slope |
| Grey (dropout) | 0 | Flat horizontal + dashed |

### Live Edge Behavior

1. Last recorded point from timeline (solid line)
2. Extension to current tick with slope based on current zone (solid line, same color)
3. Updates every ~500ms (React render cycle)
4. Snaps to actual value when next timeline tick records

### Governance Behavior

1. Zone changes trigger immediate `evaluate()` call
2. No more 1-second polling delay
3. Challenge timers still use scheduled callbacks (renamed `_scheduleChallengeTimer`)

## Testing Considerations

### Unit Tests

1. `TreasureBox.getIntervalProgress()` - Returns correct progress/coins mid-interval
2. `TreasureBox.getLiveSnapshot()` - Returns all users with current state
3. `enforceZoneSlopes()` - Flat segments in non-blue zones get interpolated
4. `buildLiveEdge()` - Correct extension from last point to projected value

### Integration Tests

1. **Governance responsiveness**: Zone change → overlay update < 100ms
2. **Chart smoothness**: No flat segments in non-blue zones (visual inspection)
3. **Data integrity**: Session save contains correct coin totals (not interpolated values)

### Manual Testing Checklist

- [ ] Start session with 2+ participants
- [ ] Verify governance overlay updates immediately when zone requirements met
- [ ] Verify chart shows smooth slopes in red/orange/yellow zones
- [ ] Verify chart shows flat lines in blue zone only
- [ ] Verify dropout shows grey dashed line
- [ ] Verify session save contains correct final coin totals
- [ ] Verify chart live edge extends smoothly between ticks

## Implementation Order

1. **TreasureBox methods** - Add `getIntervalProgress()`, `getLiveSnapshot()`, `setGovernanceCallback()`
2. **GovernanceEngine reactive** - Remove polling, add callback subscription
3. **FitnessContext exposure** - Add TreasureBox access to context
4. **Chart interpolation** - Add `enforceZoneSlopes()` to fix sawtooth
5. **Chart live edge** - Add real-time extension rendering
6. **Testing** - Verify all behaviors

## Related Files

- `frontend/src/hooks/fitness/TreasureBox.js`
- `frontend/src/hooks/fitness/GovernanceEngine.js`
- `frontend/src/context/FitnessContext.jsx`
- `frontend/src/modules/Fitness/FitnessPlugins/useFitnessPlugin.js`
- `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx`
- `frontend/src/modules/Fitness/FitnessSidebar/FitnessChart.helpers.js`
