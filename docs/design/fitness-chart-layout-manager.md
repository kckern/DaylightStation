# Fitness Chart Layout Manager

## Overview

The Fitness Chart displays race-style progress lines with avatars at the tip of each line and dropout badges where participants have stopped broadcasting. Currently, when multiple participants have similar values or timing, their avatars and badges can overlap, making the chart unreadable.

This document designs a **Layout Manager** component to handle collision detection and resolution for all visual elements rendered on top of chart lines.

## Current Problem

Looking at the screenshot, we see:
- Multiple avatars (circular user images) stacking vertically at nearly the same X position
- All avatars positioned at the same X coordinate (~0:00) but different Y values
- When users start at similar times with similar coin counts, avatars overlap
- Dropout badges (small circles with initials) can also overlap with avatars and each other

### Temporal Nature of Elements

**Critical distinction:**

| Element | X Position | Behavior |
|---------|------------|----------|
| **Avatar** | Always at current tick (rightmost) | Moves right as time progresses |
| **Dropout Badge** | Frozen at dropout tick | Stays fixed; chart scrolls past it |

**Example timeline for one user (Alice) with multiple dropouts:**

```
Time (ticks) →   0    10    20    30    40    50 (current)
                 │     │     │     │     │     │
Alice's line:    ●━━━━━━━━━━━●    ●━━━━━━━━━━━●━━━[A]
                              ↓    ↓              ↑
                             [a]  [a]           Avatar
                           Badge #1  Badge #2   (current)
                           (frozen)  (frozen)
```

- **[A]**: Alice's avatar - always at tick 50 (current)
- **[a]** at tick 20: Dropout badge #1 - frozen forever at tick 20
- **[a]** at tick 30: Dropout badge #2 - frozen forever at tick 30

### Current Implementation

The existing `resolveAvatarOffsets()` function does basic collision detection:
```javascript
const resolveAvatarOffsets = (avatars) => {
  // Only handles vertical offset (y-axis)
  // Doesn't consider badges
  // Simple iterative approach, not globally optimal
}
```

**Limitations:**
1. Only shifts avatars vertically (upward), causing stacking above the chart
2. No consideration of dropout badges in collision detection
3. Avatars can be pushed outside the visible chart area
4. No horizontal spreading when vertical space is exhausted
5. Label positioning (coin values) not included in collision checks

## Requirements

### State Persistence Problem

**Current Issue:** When user navigates away from FitnessChart and returns:
- ✅ `fitnessSession` persists in `FitnessContext` (timeline, roster, etc.)
- ✅ `participantRoster` rebuilds from session
- ✅ Timeline series data (`getUserTimelineSeries`) remains intact
- ❌ `dropoutMarkers` are lost (stored in component `useState`)
- ❌ `participantCache` resets (component-local state)

**Root Cause:** In `useRaceChartWithHistory`, dropout markers are created reactively when detecting a "rejoin" event (was inactive → now active). On remount, no rejoin events fire because we start fresh.

### Solution: Derive Dropout Markers from Timeline

Dropout markers must be **reconstructible from persisted timeline data**, not just from observed state transitions.

```javascript
// On mount/remount, reconstruct dropout markers from timeline
function reconstructDropoutMarkers(userId, getSeries, timebase) {
  const hrSeries = getSeries(userId, 'heart_rate', { clone: true }) || [];
  const coinsSeries = getSeries(userId, 'coins_total', { clone: true }) || [];
  
  const markers = [];
  let wasActive = false;
  
  for (let tick = 0; tick < hrSeries.length; tick++) {
    const isActive = hrSeries[tick] != null && Number.isFinite(hrSeries[tick]);
    
    // Detect dropout: was active, now inactive
    if (wasActive && !isActive && tick > 0) {
      markers.push({
        tick: tick - 1,  // Last active tick
        value: coinsSeries[tick - 1] ?? 0,
        timestamp: timebase.startTime + (tick - 1) * timebase.intervalMs
      });
    }
    
    wasActive = isActive;
  }
  
  return markers;
}
```

### Where to Reconstruct

| Option | Pros | Cons |
|--------|------|------|
| **A. In LayoutManager** | Centralized, layout owns all position data | Couples layout to timeline API |
| **B. In useRaceChartWithHistory** | Near existing dropout logic | Still component-local |
| **C. In FitnessSession/Context** | Persists across mounts | Requires session schema change |
| **D. In ActivityMonitor** | Already tracks activity state | Natural fit for dropout events |

**Recommended: Option D** - Extend `ActivityMonitor` to track dropout events. It already owns activity state and persists in the session.

### Functional Requirements

1. **FR-1**: All avatars must be fully visible within the chart bounds
2. **FR-2**: All dropout badges must be fully visible within the chart bounds
3. **FR-3**: No avatar should overlap another avatar by more than 10%
4. **FR-4**: No badge should overlap another badge
5. **FR-5**: Badges may partially overlap avatars if necessary (they are smaller)
6. **FR-6**: Coin labels next to avatars must not overlap other elements
7. **FR-7**: Layout must update smoothly during real-time data streaming
8. **FR-8**: Dropout markers must survive component remount (reconstructible from session)
9. **FR-9**: Layout state should be derivable entirely from session data (no hidden component state)

### Non-Functional Requirements

1. **NFR-1**: Layout computation must complete within 16ms (60fps target)
2. **NFR-2**: Layout should minimize total displacement from original positions
3. **NFR-3**: Visual connections between line endpoints and avatars must remain clear
4. **NFR-4**: All layout inputs must be derivable from session-persisted data
5. **NFR-5**: Component remount must produce identical layout (deterministic)

## Design

### Prerequisite: ActivityMonitor Dropout Tracking

Before implementing the LayoutManager, extend `ActivityMonitor` to persist dropout events:

```javascript
// In ActivityMonitor (session-level, persists across component mounts)
class ActivityMonitor {
  // Existing...
  #dropoutEvents = new Map(); // userId -> DropoutEvent[]
  
  recordDropout(userId, tick, value) {
    const events = this.#dropoutEvents.get(userId) || [];
    events.push({ tick, value, timestamp: Date.now() });
    this.#dropoutEvents.set(userId, events);
  }
  
  getDropoutEvents(userId) {
    return this.#dropoutEvents.get(userId) || [];
  }
  
  getAllDropoutEvents() {
    const all = [];
    this.#dropoutEvents.forEach((events, participantId) => {
      events.forEach(e => all.push({ ...e, participantId }));
    });
    return all;
  }
  
  // Called on session start or component mount to reconstruct from timeline
  reconstructFromTimeline(getSeries, participantIds, timebase) {
    participantIds.forEach(userId => {
      if (this.#dropoutEvents.has(userId)) return; // Already have events
      
      const markers = reconstructDropoutMarkers(userId, getSeries, timebase);
      if (markers.length) {
        this.#dropoutEvents.set(userId, markers);
      }
    });
  }
}
```

### Component Mount Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FitnessChartApp Mount                            │
├─────────────────────────────────────────────────────────────────────┤
│  1. Get activityMonitor from FitnessContext (session-level)        │
│  2. Get participantRoster from FitnessContext                       │
│  3. Get getUserTimelineSeries from FitnessContext                   │
│                                                                     │
│  4. IF activityMonitor.getAllDropoutEvents() is empty:              │
│       → Call activityMonitor.reconstructFromTimeline(...)           │
│       → Populates dropout events from HR series gaps                │
│                                                                     │
│  5. Build dropoutMarkers from activityMonitor.getAllDropoutEvents() │
│  6. Build avatarPositions from roster + timeline                    │
│  7. Pass both to LayoutManager                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         FitnessSession (persists)                        │
├──────────────────────────────────────────────────────────────────────────┤
│  timeline.series['user:alice:heart_rate'] = [80, 82, null, null, 85...] │
│  timeline.series['user:alice:coins_total'] = [0, 2, 4, 4, 6...]         │
│  activityMonitor.dropoutEvents = Map { alice → [{tick:2, value:4}] }    │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ (on mount)
┌──────────────────────────────────────────────────────────────────────────┐
│                      FitnessChartApp (component)                         │
├──────────────────────────────────────────────────────────────────────────┤
│  // Dropout markers come from session, NOT local state                   │
│  const dropoutMarkers = activityMonitor.getAllDropoutEvents();          │
│                                                                          │
│  // Avatars derived from roster + timeline (both session-persisted)      │
│  const avatars = computeAvatarPositions(roster, getSeries, ...);        │
│                                                                          │
│  // Layout is pure function of session-derived data                      │
│  const layout = layoutManager.layout([...avatars, ...badges]);          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      LayoutManager                          │
├─────────────────────────────────────────────────────────────┤
│  Input:                                                     │
│    - avatars: { id, x, y, radius }[]                       │
│    - badges: { id, x, y, radius }[]                        │
│    - bounds: { width, height, margin }                     │
│    - options: LayoutOptions                                │
├─────────────────────────────────────────────────────────────┤
│  Output:                                                    │
│    - positioned: { id, x, y, offsetX, offsetY }[]          │
│    - connectors: { fromX, fromY, toX, toY }[]              │
└─────────────────────────────────────────────────────────────┘
```

### Key Insight: Temporal Zones

**Avatars and badges occupy fundamentally different regions of the chart:**

```
Time →
├─────────────────────────────────────────────────────────┤
│  HISTORICAL ZONE              │  CURRENT ZONE           │
│  (Dropout badges frozen here) │  (Avatars always here)  │
│                               │                         │
│    [B1]     [B2]    [B3]      │      [A1][A2][A3]       │
│                               │                         │
│  X = dropout tick (fixed)     │  X = latest tick        │
├─────────────────────────────────────────────────────────┤
```

- **Dropout badges**: Frozen at the X position (tick) where the user stopped broadcasting. Multiple badges per user can exist if they dropped out/rejoined multiple times.
- **Avatars**: Always positioned at the rightmost X position (current tick or user's last active tick).

This means:
- **Avatar↔Avatar collisions**: Common - all cluster at the right edge
- **Badge↔Badge collisions**: Possible when multiple users drop out at similar times/values
- **Avatar↔Badge collisions**: Rare - only if a dropout just happened at current tick

### Layout Algorithm

#### Phase 1: Spatial Partitioning

Separate elements into temporal zones for more efficient collision handling:

```javascript
function partitionByZone(elements, currentTick) {
  const RECENCY_THRESHOLD = 3; // ticks
  
  return {
    // Avatars + very recent badges (all at/near current tick)
    currentZone: elements.filter(e => 
      e.type === 'avatar' || 
      (e.type === 'badge' && currentTick - e.tick <= RECENCY_THRESHOLD)
    ),
    // Historical badges (frozen in time)
    historicalZone: elements.filter(e => 
      e.type === 'badge' && currentTick - e.tick > RECENCY_THRESHOLD
    )
  };
}
```

#### Phase 2: Priority Assignment

Within each zone, elements are prioritized:

**Current Zone (right edge):**
1. **Priority 1 - Active avatars**: Users currently broadcasting
2. **Priority 2 - Idle avatars**: Users who stopped but haven't been removed
3. **Priority 3 - Recent badges**: Dropouts within last few ticks

**Historical Zone (distributed across timeline):**
1. **Priority 1 - Most recent badge per user**: The latest dropout point
2. **Priority 2 - Older badges**: Previous dropout points for same user

#### Phase 3: Cluster Detection

Group elements that are within collision distance:

```javascript
const CLUSTER_THRESHOLD = AVATAR_RADIUS * 3; // Elements within 3 radii form a cluster

function detectClusters(elements, zone) {
  // For current zone: cluster by Y only (all have same/similar X)
  // For historical zone: cluster by both X and Y (badges scattered across timeline)
  
  if (zone === 'current') {
    // All elements at right edge - only Y matters
    return clusterByProximity(elements, { xWeight: 0.1, yWeight: 1.0 });
  } else {
    // Historical badges spread across time - both dimensions matter
    return clusterByProximity(elements, { xWeight: 1.0, yWeight: 1.0 });
  }
}
```

#### Phase 3: Cluster Layout

For each cluster, apply layout strategy based on cluster size:

| Cluster Size | Strategy |
|--------------|----------|
| 1 | No adjustment needed |
| 2-3 | **Fan layout**: Spread vertically around centroid |
| 4-6 | **Arc layout**: Arrange in arc to the right of line endpoints |
| 7+ | **Multi-row**: Arrange in grid pattern to the right |

```javascript
function layoutCluster(cluster, bounds, strategy) {
  const centroid = computeCentroid(cluster);
  
  switch (strategy) {
    case 'fan':
      return fanLayout(cluster, centroid);
    case 'arc':
      return arcLayout(cluster, centroid, bounds);
    case 'grid':
      return gridLayout(cluster, centroid, bounds);
  }
}
```

#### Phase 4: Zone-Specific Layout

**Current Zone Strategy (avatars at right edge):**

All avatars share the same X position (current tick), so collisions are purely vertical. When users have similar coin totals, their Y anchors cluster together.

##### Avatar Overlap Scenarios

```
Scenario A: Minor overlap (2 avatars, small Y gap)
─────────────────────────────────●[A]    ← y=100
                                 ●[B]    ← y=95  (5px gap, overlap!)

Scenario B: Cluster (3+ avatars at similar Y)
─────────────────────────────────●[A]    ← y=100
                                 ●[B]    ← y=98
                                 ●[C]    ← y=96
                                 ●[D]    ← y=94  (all within 6px!)

Scenario C: Tie (identical Y values)
═════════════════════════════════●[A]    ← y=100
═════════════════════════════════●[B]    ← y=100 (exact tie!)
```

##### Strategy Selection by Cluster Size

| Cluster Size | Strategy | Max Displacement | Visual |
|--------------|----------|------------------|--------|
| 1 | None | 0 | Avatar at line tip |
| 2 | **Straddle** | ±½ avatar | Spread equally above/below centroid |
| 3-4 | **Stack** | 1-2 avatars | Vertical stack with connectors |
| 5-6 | **Fan Right** | 2 avatars | Arc to the right of line tips |
| 7+ | **Grid Right** | 3 avatars | 2-column grid to the right |

##### Strategy 1: Straddle (2 avatars)

When exactly 2 avatars overlap, offset them equally above and below their centroid:

```javascript
function straddleLayout(a, b, minGap = AVATAR_RADIUS * 2 + 4) {
  const centroidY = (a.originalY + b.originalY) / 2;
  const currentGap = Math.abs(a.originalY - b.originalY);
  
  if (currentGap >= minGap) return [a, b]; // No overlap
  
  const halfOffset = minGap / 2;
  const [upper, lower] = a.originalY < b.originalY ? [a, b] : [b, a];
  
  return [
    { ...upper, finalY: centroidY - halfOffset, offsetY: (centroidY - halfOffset) - upper.originalY },
    { ...lower, finalY: centroidY + halfOffset, offsetY: (centroidY + halfOffset) - lower.originalY }
  ];
}
```

**Visual:**
```
Before:                          After:
─────────●[A] y=100              ─────────┐  ●[A] y=97  (centroid-3)
─────────●[B] y=98               ─────────┼──●         (connector)
                                 ─────────┘  ●[B] y=103 (centroid+3)
```

##### Strategy 2: Stack (3-4 avatars)

Maintain relative order, expand gaps uniformly:

```javascript
function stackLayout(avatars, minGap = AVATAR_RADIUS * 2 + 4) {
  // Sort by original Y (top to bottom)
  const sorted = [...avatars].sort((a, b) => a.originalY - b.originalY);
  const centroidY = sorted.reduce((sum, a) => sum + a.originalY, 0) / sorted.length;
  
  // Calculate total height needed
  const totalHeight = (sorted.length - 1) * minGap;
  const startY = centroidY - totalHeight / 2;
  
  return sorted.map((avatar, idx) => ({
    ...avatar,
    finalY: startY + idx * minGap,
    offsetY: (startY + idx * minGap) - avatar.originalY
  }));
}
```

**Visual:**
```
Before:                          After (with connectors):
─────────●[A] y=100              ─────────┐     ●[A] y=91
─────────●[B] y=99               ─────────┼─────●[B] y=97
─────────●[C] y=98               ─────────┼─────●[C] y=103
─────────●[D] y=97               ─────────┘     ●[D] y=109
```

##### Strategy 3: Fan Right (5-6 avatars)

When vertical stacking would push avatars too far from their line tips, fan out horizontally:

```javascript
function fanRightLayout(avatars, minGap = AVATAR_RADIUS * 2 + 4) {
  const sorted = [...avatars].sort((a, b) => a.originalY - b.originalY);
  const centroidY = sorted.reduce((sum, a) => sum + a.originalY, 0) / sorted.length;
  const count = sorted.length;
  
  // Arc parameters
  const arcRadius = AVATAR_RADIUS * 3;
  const arcSpan = Math.PI * 0.6; // 108 degrees
  const startAngle = -arcSpan / 2;
  
  return sorted.map((avatar, idx) => {
    const angle = startAngle + (idx / (count - 1)) * arcSpan;
    const offsetX = Math.cos(angle) * arcRadius;
    const offsetY = Math.sin(angle) * arcRadius;
    
    return {
      ...avatar,
      finalX: avatar.originalX + arcRadius + offsetX,
      finalY: centroidY + offsetY,
      offsetX: arcRadius + offsetX,
      offsetY: (centroidY + offsetY) - avatar.originalY
    };
  });
}
```

**Visual:**
```
                                          ●[A]
                                        ●[B]
─────────┬─────────────────────────── ●[C]
─────────┤ (connectors)              ●[D]
─────────┴──────────────────────────●[E]
```

##### Strategy 4: Grid Right (7+ avatars)

For large clusters, arrange in a grid to the right:

```javascript
function gridRightLayout(avatars, columns = 2, minGap = AVATAR_RADIUS * 2 + 4) {
  // Sort by original Y, then by value (breaks ties consistently)
  const sorted = [...avatars].sort((a, b) => a.originalY - b.originalY || b.value - a.value);
  const centroidY = sorted.reduce((sum, a) => sum + a.originalY, 0) / sorted.length;
  
  const rows = Math.ceil(sorted.length / columns);
  const totalHeight = (rows - 1) * minGap;
  const startY = centroidY - totalHeight / 2;
  const colWidth = AVATAR_RADIUS * 2 + COIN_LABEL_GAP + 40; // Space for label
  
  return sorted.map((avatar, idx) => {
    const row = Math.floor(idx / columns);
    const col = idx % columns;
    
    return {
      ...avatar,
      finalX: avatar.originalX + AVATAR_RADIUS * 2 + col * colWidth,
      finalY: startY + row * minGap,
      offsetX: AVATAR_RADIUS * 2 + col * colWidth,
      offsetY: (startY + row * minGap) - avatar.originalY
    };
  });
}
```

**Visual:**
```
─────────┬────────────●[A] 15   ●[B] 15
─────────┤            ●[C] 14   ●[D] 14
─────────┤            ●[E] 13   ●[F] 12
─────────┴────────────●[G] 11   ●[H] 10
         (single connector to grid)
```

##### Tie-Breaking Rules

When avatars have **identical** Y values (exact coin total tie):

1. **Primary**: Sort by `profileId` alphabetically (deterministic)
2. **Secondary**: Sort by join order (earlier participant gets priority position)
3. **Tertiary**: Hash of `id` for stable pseudo-random ordering

```javascript
function tieBreaker(a, b) {
  // Y values are identical
  if (a.profileId !== b.profileId) {
    return a.profileId.localeCompare(b.profileId);
  }
  if (a.joinTick !== b.joinTick) {
    return a.joinTick - b.joinTick;
  }
  // Stable hash fallback
  return hashCode(a.id) - hashCode(b.id);
}
```

##### Connector Rendering for Displaced Avatars

When an avatar is displaced significantly, draw a connector line:

```javascript
const CONNECTOR_THRESHOLD = AVATAR_RADIUS * 1.5;

function shouldDrawConnector(avatar) {
  const displacement = Math.hypot(avatar.offsetX || 0, avatar.offsetY || 0);
  return displacement > CONNECTOR_THRESHOLD;
}

// In SVG render:
{avatars.filter(shouldDrawConnector).map(avatar => (
  <line
    key={`connector-${avatar.id}`}
    x1={avatar.originalX}
    y1={avatar.originalY}
    x2={avatar.finalX - AVATAR_RADIUS}  // Connect to avatar edge
    y2={avatar.finalY}
    stroke={avatar.color}
    strokeWidth={2}
    strokeDasharray="4 2"
    opacity={0.5}
  />
))}
```

##### Label Collision Handling

Coin labels appear to the right of avatars. After avatar positioning, check label collisions:

```javascript
function resolveLabelsCollisions(avatars, labelWidth = 40) {
  // Labels are at (avatar.finalX + AVATAR_RADIUS + COIN_LABEL_GAP, avatar.finalY)
  // Check if any label overlaps another avatar
  
  return avatars.map(avatar => {
    const labelX = avatar.finalX + AVATAR_RADIUS + COIN_LABEL_GAP;
    const labelY = avatar.finalY;
    
    const blocked = avatars.some(other => 
      other.id !== avatar.id &&
      Math.abs(other.finalX - labelX) < AVATAR_RADIUS &&
      Math.abs(other.finalY - labelY) < AVATAR_RADIUS
    );
    
    if (blocked) {
      // Move label to left side or above
      return { ...avatar, labelPosition: 'left' }; // or 'above'
    }
    return { ...avatar, labelPosition: 'right' };
  });
}
```

**Historical Zone Strategy (frozen badges):**
- **X position is IMMUTABLE** - badges stay at their dropout tick
- Only Y offset allowed to resolve collisions
- Smaller displacement tolerance (badges should stay near their data point)

```javascript
function layoutHistoricalZone(badges) {
  // Group badges by similar X (tick) position
  const timeGroups = groupByTickProximity(badges, TICK_PROXIMITY_THRESHOLD);
  
  timeGroups.forEach(group => {
    if (group.length === 1) return; // No collision possible
    
    // Sort by Y, spread vertically while keeping X fixed
    const sorted = group.sort((a, b) => a.y - b.y);
    sorted.forEach((badge, idx) => {
      badge.offsetY = idx * (ABSENT_BADGE_RADIUS * 2 + 4);
      badge.offsetX = 0; // X stays fixed!
    });
  });
}
```

#### Phase 5: Multi-Badge Per User Handling

A single user may have multiple dropout badges from repeated dropout/rejoin cycles:

```javascript
interface DropoutBadge {
  id: string;              // Unique: `${participantId}-dropout-${tick}`
  participantId: string;   // Links badges to same user
  tick: number;            // IMMUTABLE - when dropout occurred
  value: number;           // Y-axis value at dropout
  timestamp: number;       // Real-world time (for age-based filtering)
}

function filterUserBadges(badges, options = {}) {
  const { maxBadgesPerUser = 3 } = options;
  
  // Group by participant
  const byUser = groupBy(badges, 'participantId');
  
  return Object.values(byUser).flatMap(userBadges => {
    if (userBadges.length <= maxBadgesPerUser) return userBadges;
    
    // Keep most recent N badges per user
    return userBadges
      .sort((a, b) => b.tick - a.tick)
      .slice(0, maxBadgesPerUser);
  });
}
```

#### Phase 6: Global Optimization

After cluster-level layout, perform global collision checks:

```javascript
function resolveGlobalCollisions(positioned, bounds) {
  let iterations = 0;
  const MAX_ITERATIONS = 50;
  
  while (hasCollisions(positioned) && iterations < MAX_ITERATIONS) {
    // Push overlapping elements apart using force-directed approach
    // Respect bounds constraints
    iterations++;
  }
  
  return positioned;
}
```

#### Phase 7: Connector Generation

Generate visual connectors (leader lines) from original line endpoints to final avatar positions:

```javascript
function generateConnectors(originalPositions, finalPositions) {
  return originalPositions.map((orig, i) => {
    const final = finalPositions[i];
    const distance = Math.hypot(final.x - orig.x, final.y - orig.y);
    
    // Only draw connector if displacement exceeds threshold
    if (distance > AVATAR_RADIUS * 1.5) {
      return {
        fromX: orig.x,
        fromY: orig.y,
        toX: final.x - AVATAR_RADIUS, // Connect to edge of avatar
        toY: final.y,
        style: 'dotted'
      };
    }
    return null;
  }).filter(Boolean);
}
```

### Data Structures

```typescript
interface LayoutElement {
  id: string;
  type: 'avatar' | 'badge';
  originalX: number;
  originalY: number;
  radius: number;
  priority: number;
  // For badges only:
  tick?: number;           // IMMUTABLE - the time position on X axis
  participantId?: string;  // Links multiple badges to same user
  // After layout:
  finalX?: number;
  finalY?: number;
  offsetX?: number;        // Always 0 for badges (X is frozen)
  offsetY?: number;
  clusterId?: string;
  zone?: 'current' | 'historical';
}

interface LayoutOptions {
  minSpacing: number;           // Minimum gap between elements (default: 4)
  maxDisplacement: number;      // Max distance from original position (default: 100)
  preferVertical: boolean;      // Prefer vertical spreading (default: true)
  enableConnectors: boolean;    // Draw lines to displaced avatars (default: true)
  maxBadgesPerUser: number;     // Limit historical badges per user (default: 3)
  badgeRecencyThreshold: number; // Ticks before badge is "historical" (default: 3)
}

interface LayoutResult {
  elements: LayoutElement[];
  connectors: Connector[];
  clusters: Cluster[];
  metrics: {
    totalDisplacement: number;
    collisionCount: number;
    computeTimeMs: number;
  };
}
```

### Implementation Plan

#### File Structure

```
frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/
├── FitnessChartApp.jsx           # Main component (existing)
├── FitnessChartApp.scss          # Styles (existing)
├── layout/
│   ├── index.js                  # Public API
│   ├── LayoutManager.js          # Main layout orchestrator
│   ├── ClusterDetector.js        # Cluster detection logic
│   ├── strategies/
│   │   ├── FanLayout.js          # 2-3 element strategy
│   │   ├── ArcLayout.js          # 4-6 element strategy
│   │   └── GridLayout.js         # 7+ element strategy
│   ├── CollisionResolver.js      # Force-directed collision resolution
│   └── ConnectorGenerator.js     # Leader line generation
```

#### Integration Points

1. **Replace `resolveAvatarOffsets()`** with `LayoutManager.layout()`
2. **Modify `computeAvatarPositions()`** to return raw positions
3. **Modify `computeBadgePositions()`** to return raw positions  
4. **Add `<Connectors />` component** to `RaceChartSvg`
5. **Update SCSS** for connector styling

### API Design

```javascript
// Usage in FitnessChartApp.jsx
import { LayoutManager } from './layout';

const layoutManager = useMemo(() => new LayoutManager({
  bounds: { width, height, margin: CHART_MARGIN },
  avatarRadius: AVATAR_RADIUS,
  badgeRadius: ABSENT_BADGE_RADIUS,
  options: {
    minSpacing: 4,
    maxDisplacement: 100,
    enableConnectors: true
  }
}), [width, height]);

// In render logic:
const rawAvatars = computeAvatarPositions(...);
const rawBadges = computeBadgePositions(...);

const { elements, connectors } = layoutManager.layout([
  ...rawAvatars.map(a => ({ ...a, type: 'avatar' })),
  ...rawBadges.map(b => ({ ...b, type: 'badge' }))
]);

const avatars = elements.filter(e => e.type === 'avatar');
const badges = elements.filter(e => e.type === 'badge');
```

### Visual Design

#### Connectors (Leader Lines)

When avatars are displaced significantly from their line endpoints:

```
Line endpoint ─ ─ ─ ─ ┐
                      │
                      ▼
                   [Avatar]
```

- **Style**: Dotted line, 1px, same color as zone or gray
- **Opacity**: 0.5 to avoid visual clutter
- **Threshold**: Only show if displacement > 1.5 × avatar radius

#### Cluster Layouts

**Fan Layout (2-3 elements):**
```
         [A]
    ─────•
         [B]
```

**Arc Layout (4-6 elements):**
```
              [A]
           [B]
    ─────•[C]
           [D]
              [E]
```

**Grid Layout (7+ elements):**
```
    ─────•  [A][B][C]
            [D][E][F]
            [G][H]
```

### Edge Cases

| Scenario | Handling |
|----------|----------|
| All avatars at origin (race start) | Grid layout to the right of origin |
| Avatar pushed outside bounds | Clamp to bounds, shorten connector |
| Two users with identical data | Stack with minimal offset |
| Badge on top of avatar | Badge gets priority (smaller, informational) |
| Rapid rejoins creating many badges | Limit visible badges per user (default: 3 most recent) |
| User drops out multiple times | Multiple badges at different X positions, each frozen |
| Multiple users drop at same tick | Cluster badges, spread vertically only (X frozen) |
| User rejoins after dropout | Avatar moves to current X; old badge stays at dropout X |
| Badge scrolls off left edge | Hide or fade out badges older than visible X range |
| Same-tick collision (avatar + recent badge) | Badge yields to avatar (avatar is larger, more important) |
| Component remount | Dropout markers reconstructed from ActivityMonitor (session-level) |
| Session resume after app restart | ActivityMonitor reconstructs from timeline series on init |
| Timeline data but no dropout events yet | Reconstruction scans HR series for null gaps |
| 2 avatars with same Y | Straddle: spread equally above/below centroid |
| 3-4 avatars clustered | Stack: vertical stack with connectors |
| 5-6 avatars clustered | Fan: arc to the right of line tips |
| 7+ avatars clustered | Grid: 2-column layout to the right |
| Exact Y tie (same coin total) | Tie-break by profileId → joinTick → id hash |
| Label overlaps another avatar | Move label to left side or above |
| Cluster exceeds chart bounds (top) | Shift entire cluster down, prioritize visibility |
| Cluster exceeds chart bounds (bottom) | Shift entire cluster up |
| Rapid value changes causing layout thrash | Debounce layout, animate transitions smoothly |

### Performance Considerations

1. **Memoization**: Cache layout results, only recompute on position changes
2. **Incremental Updates**: When only one element moves, avoid full re-layout
3. **Debouncing**: During rapid updates, debounce layout computation
4. **Web Worker**: For complex layouts (10+ elements), consider offloading
5. **Animation Smoothing**: Animate position changes over 150-200ms to prevent jarring jumps

```javascript
// Memoization example
const layoutResult = useMemo(() => {
  return layoutManager.layout(elements);
}, [
  // Only recompute when positions actually change
  elements.map(e => `${e.id}:${Math.round(e.x)}:${Math.round(e.y)}`).join('|')
]);

// Animation smoothing for avatar positions
const useAnimatedPositions = (targetPositions, duration = 150) => {
  const [positions, setPositions] = useState(targetPositions);
  const animationRef = useRef(null);
  
  useEffect(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    
    const startPositions = positions;
    const startTime = performance.now();
    
    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      
      const interpolated = targetPositions.map((target, i) => ({
        ...target,
        finalX: lerp(startPositions[i]?.finalX ?? target.finalX, target.finalX, eased),
        finalY: lerp(startPositions[i]?.finalY ?? target.finalY, target.finalY, eased)
      }));
      
      setPositions(interpolated);
      
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };
    
    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [targetPositions]);
  
  return positions;
};
```

### Best Practices Summary

#### DO:
- ✅ **Preserve relative order** - If A is above B in data, keep A above B visually
- ✅ **Minimize displacement** - Prefer smaller offsets over larger ones
- ✅ **Use connectors** - When displacement > 1.5× radius, show connection to line tip
- ✅ **Animate transitions** - Smooth 150ms ease-out for position changes
- ✅ **Deterministic tie-breaking** - Same input = same output, always
- ✅ **Respect bounds** - Keep all elements within visible chart area
- ✅ **Progressive strategies** - Start with simplest (straddle), escalate only when needed

#### DON'T:
- ❌ **Don't allow full overlap** - Minimum visible portion: 90%
- ❌ **Don't hide labels** - If label collides, reposition it, don't remove
- ❌ **Don't break association** - Avatar must be visually linked to its line
- ❌ **Don't thrash layout** - Debounce rapid updates, settle before re-computing
- ❌ **Don't over-displace** - Max displacement: 3× avatar radius from original

### Testing Strategy

1. **Unit Tests**: Each layout strategy in isolation
2. **Visual Regression**: Storybook snapshots for common scenarios
3. **Performance Tests**: Benchmark with 10, 20, 50 elements
4. **Edge Case Tests**: All scenarios from edge cases table

### Migration Path

1. **Phase 0**: Extend ActivityMonitor with dropout event tracking + reconstruction
2. **Phase 1**: Implement LayoutManager with current behavior (vertical only)
3. **Phase 2**: Migrate dropout marker source from component state to ActivityMonitor
4. **Phase 3**: Add horizontal spreading strategies
5. **Phase 4**: Add connectors
6. **Phase 5**: Add badge collision handling
7. **Phase 6**: Performance optimization

---

## Phased Implementation Plan

### Phase 0: ActivityMonitor Dropout Tracking
**Goal**: Persist dropout events at session level so they survive component remount.

**Duration**: 1-2 days

**Files to Modify**:
- `backend/lib/fitness/ActivityMonitor.mjs` (or create if doesn't exist)
- `frontend/src/context/FitnessContext.jsx` - expose dropout events

**Tasks**:
| Task | Description | Est. |
|------|-------------|------|
| 0.1 | Add `#dropoutEvents` Map to ActivityMonitor | 1h |
| 0.2 | Implement `recordDropout(userId, tick, value)` | 1h |
| 0.3 | Implement `getDropoutEvents(userId)` and `getAllDropoutEvents()` | 1h |
| 0.4 | Implement `reconstructFromTimeline(getSeries, participantIds, timebase)` | 2h |
| 0.5 | Expose `activityMonitor.dropoutEvents` in FitnessContext | 1h |
| 0.6 | Write unit tests for reconstruction logic | 2h |

**Acceptance Criteria**:
- [ ] Dropout events persist when FitnessChart unmounts/remounts
- [ ] Reconstruction produces same markers as live observation
- [ ] Multiple dropouts per user tracked correctly

**Deliverable**: ActivityMonitor with dropout event persistence

---

### Phase 1: LayoutManager Foundation
**Goal**: Create LayoutManager class with current vertical-only behavior (parity with existing `resolveAvatarOffsets`).

**Duration**: 2-3 days

**Files to Create**:
```
frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/
└── layout/
    ├── index.js
    ├── LayoutManager.js
    ├── ClusterDetector.js
    └── __tests__/
        ├── LayoutManager.test.js
        └── ClusterDetector.test.js
```

**Tasks**:
| Task | Description | Est. |
|------|-------------|------|
| 1.1 | Create `LayoutManager` class with constructor | 1h |
| 1.2 | Implement `layout(elements)` public API | 2h |
| 1.3 | Port existing `resolveAvatarOffsets` logic as default strategy | 2h |
| 1.4 | Implement `ClusterDetector.detectClusters(elements)` | 2h |
| 1.5 | Add spatial partitioning (current vs historical zones) | 2h |
| 1.6 | Write integration test: same output as old code | 2h |
| 1.7 | Feature flag: `USE_LAYOUT_MANAGER` for gradual rollout | 1h |

**Acceptance Criteria**:
- [ ] LayoutManager produces identical output to current implementation
- [ ] Feature flag allows A/B testing
- [ ] No visual regressions

**Deliverable**: Drop-in replacement for `resolveAvatarOffsets`

---

### Phase 2: Integrate Dropout Markers from ActivityMonitor
**Goal**: Replace component-local `dropoutMarkers` state with session-persisted source.

**Duration**: 1-2 days

**Files to Modify**:
- `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx`

**Tasks**:
| Task | Description | Est. |
|------|-------------|------|
| 2.1 | Remove `dropoutMarkers` from `useRaceChartWithHistory` state | 1h |
| 2.2 | Call `activityMonitor.reconstructFromTimeline()` on mount | 1h |
| 2.3 | Get dropout markers from `activityMonitor.getAllDropoutEvents()` | 1h |
| 2.4 | Update `recordDropout` calls to use ActivityMonitor | 1h |
| 2.5 | Add remount test: badges survive unmount/remount | 2h |
| 2.6 | Remove deprecated `participantCache.dropoutMarkers` field | 1h |

**Acceptance Criteria**:
- [ ] Dropout badges visible after component remount
- [ ] No change in live dropout detection behavior
- [ ] All existing tests pass

**Deliverable**: Dropout markers sourced from session, not component state

---

### Phase 3: Avatar Overlap Strategies
**Goal**: Implement straddle, stack, fan, and grid strategies for avatar clusters.

**Duration**: 3-4 days

**Files to Create**:
```
frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/
└── layout/
    └── strategies/
        ├── index.js
        ├── StraddleLayout.js
        ├── StackLayout.js
        ├── FanLayout.js
        ├── GridLayout.js
        └── __tests__/
            └── strategies.test.js
```

**Tasks**:
| Task | Description | Est. |
|------|-------------|------|
| 3.1 | Implement `StraddleLayout` (2 avatars) | 2h |
| 3.2 | Implement `StackLayout` (3-4 avatars) | 2h |
| 3.3 | Implement `FanLayout` (5-6 avatars) | 3h |
| 3.4 | Implement `GridLayout` (7+ avatars) | 3h |
| 3.5 | Implement `StrategySelector` to choose based on cluster size | 2h |
| 3.6 | Add tie-breaking logic for identical Y values | 1h |
| 3.7 | Update LayoutManager to use strategies | 2h |
| 3.8 | Visual regression tests with Storybook snapshots | 3h |

**Acceptance Criteria**:
- [ ] 2 overlapping avatars spread via straddle
- [ ] 3-4 overlapping avatars stack vertically
- [ ] 5-6 overlapping avatars fan to the right
- [ ] 7+ overlapping avatars form grid
- [ ] Identical Y values produce deterministic order

**Deliverable**: All avatar overlap scenarios handled gracefully

---

### Phase 4: Connectors (Leader Lines)
**Goal**: Draw visual connections from line tips to displaced avatars.

**Duration**: 1-2 days

**Files to Modify**:
- `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx`
- `frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.scss`

**Files to Create**:
```
frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/
└── layout/
    └── ConnectorGenerator.js
```

**Tasks**:
| Task | Description | Est. |
|------|-------------|------|
| 4.1 | Implement `ConnectorGenerator.generate(originalPositions, finalPositions)` | 2h |
| 4.2 | Add `shouldDrawConnector()` threshold logic (1.5× radius) | 1h |
| 4.3 | Add `<Connectors />` SVG group to `RaceChartSvg` | 2h |
| 4.4 | Style connectors: dotted, 50% opacity, zone color | 1h |
| 4.5 | Ensure connectors render behind avatars (z-order) | 1h |
| 4.6 | Add Storybook story for connector visualization | 1h |

**Acceptance Criteria**:
- [ ] Connectors appear when avatar displaced > 45px (1.5× radius)
- [ ] Connectors are visually subtle (dotted, semi-transparent)
- [ ] Connectors connect line tip to avatar edge (not center)

**Deliverable**: Visual association between lines and displaced avatars

---

### Phase 5: Badge Collision Handling
**Goal**: Handle overlapping dropout badges, especially when multiple users drop at similar times.

**Duration**: 2 days

**Files to Modify**:
- `layout/LayoutManager.js`
- `layout/ClusterDetector.js`

**Tasks**:
| Task | Description | Est. |
|------|-------------|------|
| 5.1 | Extend ClusterDetector to handle badge-only clusters | 2h |
| 5.2 | Implement Y-only spreading for badge clusters (X frozen) | 2h |
| 5.3 | Implement `maxBadgesPerUser` filtering (default: 3) | 1h |
| 5.4 | Handle badge↔avatar near-collision (badge yields) | 2h |
| 5.5 | Add badge aging: fade badges approaching left edge | 2h |
| 5.6 | Write tests for multi-dropout scenarios | 2h |

**Acceptance Criteria**:
- [ ] Badges at same tick spread vertically
- [ ] Max 3 badges per user visible (most recent)
- [ ] Badges near avatars don't obscure avatars
- [ ] Old badges fade as they scroll left

**Deliverable**: Clean badge visualization even with many dropouts

---

### Phase 6: Label Collision Handling
**Goal**: Ensure coin labels don't overlap avatars or other labels.

**Duration**: 1-2 days

**Files to Modify**:
- `layout/LayoutManager.js`
- `FitnessChartApp.jsx` (label rendering)

**Tasks**:
| Task | Description | Est. |
|------|-------------|------|
| 6.1 | Add label bounds to LayoutElement interface | 1h |
| 6.2 | Implement `resolveLabelCollisions()` | 2h |
| 6.3 | Add `labelPosition` property (right/left/above) | 1h |
| 6.4 | Update SVG rendering to respect labelPosition | 2h |
| 6.5 | Handle edge case: label pushed outside chart bounds | 1h |

**Acceptance Criteria**:
- [ ] Labels never overlap avatars
- [ ] Labels repositioned gracefully when blocked
- [ ] All labels remain visible within chart

**Deliverable**: Readable labels in all configurations

---

### Phase 7: Animation & Performance
**Goal**: Smooth transitions and 60fps performance.

**Duration**: 2-3 days

**Files to Create**:
```
frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/
└── layout/
    └── useAnimatedLayout.js
```

**Tasks**:
| Task | Description | Est. |
|------|-------------|------|
| 7.1 | Implement `useAnimatedLayout` hook with RAF interpolation | 3h |
| 7.2 | Add easing function (ease-out-cubic) | 1h |
| 7.3 | Implement layout result memoization | 2h |
| 7.4 | Add debouncing for rapid position changes | 2h |
| 7.5 | Profile with React DevTools, identify bottlenecks | 2h |
| 7.6 | Add hysteresis for strategy changes (prevent thrashing) | 2h |
| 7.7 | Benchmark: ensure <16ms layout time for 10 avatars | 2h |

**Acceptance Criteria**:
- [ ] Position changes animate over 150ms
- [ ] No jarring jumps when values change
- [ ] Layout computation < 16ms for typical usage
- [ ] Strategy changes (stack→fan) don't cause flicker

**Deliverable**: Smooth, performant layout experience

---

### Phase 8: Cleanup & Documentation
**Goal**: Remove feature flags, document API, clean up dead code.

**Duration**: 1 day

**Tasks**:
| Task | Description | Est. |
|------|-------------|------|
| 8.1 | Remove `USE_LAYOUT_MANAGER` feature flag | 1h |
| 8.2 | Delete old `resolveAvatarOffsets` function | 1h |
| 8.3 | Add JSDoc comments to all public APIs | 2h |
| 8.4 | Update this design doc with final implementation notes | 1h |
| 8.5 | Add Storybook documentation page | 2h |

**Acceptance Criteria**:
- [ ] No dead code remaining
- [ ] All public APIs documented
- [ ] Storybook shows all layout scenarios

**Deliverable**: Production-ready, documented LayoutManager

---

## Implementation Timeline

```
Week 1:
├── Phase 0: ActivityMonitor (Days 1-2)
├── Phase 1: LayoutManager Foundation (Days 2-4)
└── Phase 2: Integrate Dropout Markers (Days 4-5)

Week 2:
├── Phase 3: Avatar Overlap Strategies (Days 1-4)
└── Phase 4: Connectors (Days 4-5)

Week 3:
├── Phase 5: Badge Collision (Days 1-2)
├── Phase 6: Label Collision (Days 2-3)
└── Phase 7: Animation & Performance (Days 3-5)

Week 4:
└── Phase 8: Cleanup & Documentation (Day 1)
    Buffer for bugs/polish (Days 2-5)
```

**Total Estimated Duration**: 3-4 weeks

---

## Rollout Strategy

### Feature Flag Stages

```javascript
// config.app.yml
fitness:
  layoutManager:
    enabled: false          # Phase 1: Off by default
    strategies: 'vertical'  # Phase 3: 'vertical' | 'all'
    connectors: false       # Phase 4: Enable connectors
    animations: false       # Phase 7: Enable animations
```

### Rollout Sequence

1. **Dev Only** (Week 1): Flag on for developers only
2. **Internal Testing** (Week 2): Enable for household testers
3. **Staged Rollout** (Week 3): 
   - Day 1: Enable `strategies: 'all'`
   - Day 3: Enable `connectors: true`
   - Day 5: Enable `animations: true`
4. **General Availability** (Week 4): Remove flags, make default

### Rollback Plan

If issues arise:
1. Set `fitness.layoutManager.enabled: false` in config
2. Component falls back to legacy `resolveAvatarOffsets`
3. No data loss (dropout markers in ActivityMonitor unaffected)

### Remount Verification Test

```javascript
// Test: Verify layout survives component remount
describe('FitnessChart remount', () => {
  it('should restore dropout badges after unmount/remount', async () => {
    // Setup: User drops out at tick 10
    const { unmount, rerender } = render(<FitnessChartApp />);
    await simulateDropout('alice', tick: 10, value: 50);
    
    // Verify badge exists
    expect(screen.getByTestId('dropout-badge-alice-10')).toBeInTheDocument();
    
    // Unmount (user navigates away)
    unmount();
    
    // Remount (user returns)
    rerender(<FitnessChartApp />);
    
    // Badge should still exist (reconstructed from session)
    expect(screen.getByTestId('dropout-badge-alice-10')).toBeInTheDocument();
  });
  
  it('should produce identical layout after remount', async () => {
    const { unmount, rerender, container } = render(<FitnessChartApp />);
    await simulateMultipleDropouts();
    
    const layoutBefore = captureLayout(container);
    
    unmount();
    rerender(<FitnessChartApp />);
    
    const layoutAfter = captureLayout(container);
    
    // Layout should be deterministic
    expect(layoutAfter).toEqual(layoutBefore);
  });
});
```

## Open Questions

1. Should connectors animate or appear instantly?
2. ~~Maximum number of visible dropout badges per user?~~ → **Default: 3 per user**
3. Should displaced avatars have reduced size to indicate displacement?
4. Z-index ordering: avatars on top of badges, or vice versa?
5. **NEW**: Should old badges fade out as they approach the left edge of visible time?
6. **NEW**: When a user has 3+ badges, show only the most recent 3 or show all with reduced opacity for older ones?
7. **NEW**: If user is currently active, should their historical dropout badges be visually dimmed?
8. **NEW**: Should ActivityMonitor persist dropout events to disk/backend, or just reconstruct from timeline on session load?
9. **NEW**: What's the maximum number of total badges to display before UI becomes cluttered? (e.g., cap at 10 total across all users)
10. **NEW**: For avatar overlap - should the grid/fan layout be to the right (default) or respect chart RTL languages?
11. **NEW**: When cluster strategy changes (e.g., 4→5 avatars triggers stack→fan), should there be a hysteresis to prevent thrashing?
12. **NEW**: Should labels show abbreviated values (15) or full values (15,234) when space is tight?

## Appendix: Current Constants

From [FitnessChartApp.jsx](../../frontend/src/modules/Fitness/FitnessPlugins/plugins/FitnessChartApp/FitnessChartApp.jsx):

```javascript
const AVATAR_RADIUS = 30;
const AVATAR_OVERLAP_THRESHOLD = AVATAR_RADIUS * 2;  // 60px
const ABSENT_BADGE_RADIUS = 10;
const COIN_LABEL_GAP = 8;
```
