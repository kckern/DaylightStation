# Fitness Module Architecture Review

## Executive Summary

The dropout detection bug revealed deeper architectural issues in the fitness module. Data flows through multiple layers with inconsistent transformations, violating several software engineering principles. This document analyzes the violations and proposes improvements.

---

## Current Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA FLOW                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ANT+ Devices                                                                │
│       │                                                                      │
│       ▼                                                                      │
│  DeviceManager ──► recordDeviceActivity() ──► FitnessSession               │
│       │                    │                        │                        │
│       │                    ▼                        ▼                        │
│       │              TreasureBox            FitnessTimeline                  │
│       │              (coins, zones)         (time series)                    │
│       │                    │                        │                        │
│       ▼                    ▼                        ▼                        │
│  UserManager ◄──── Session.roster ◄──── _collectTimelineTick()             │
│       │                    │                        │                        │
│       ▼                    ▼                        ▼                        │
│  FitnessContext.participantRoster    FitnessContext.getUserTimelineSeries  │
│       │                                             │                        │
│       ▼                                             ▼                        │
│  FitnessChartApp (roster prop)      buildBeatsSeries() + buildSegments()   │
│       │                                             │                        │
│       └─────────────────────┬───────────────────────┘                        │
│                             ▼                                                │
│                    Chart Rendering                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Principle Violations

### 1. Single Source of Truth (SSOT) Violation

**Problem**: User "presence" is determined by TWO independent sources:
- **Roster membership**: User is in roster → "present" (full avatar)
- **Timeline data**: heart_rate series has values → "active"

These sources can disagree:
- User in roster but HR stopped broadcasting → roster says present, timeline says inactive
- User removed from roster but timeline has historical data → roster says absent, timeline has data

**Impact**: The chart used roster for avatar display but timeline for line rendering, causing inconsistent visual representation.

```javascript
// FitnessChartApp.jsx - Presence from roster
const presentIds = new Set();
presentEntries.forEach((entry) => {
  presentIds.add(entry.id);
  next[id] = { ...entry, isPresent: true };  // Based on roster membership
});

// FitnessChart.helpers.js - Activity from timeline
const isActive = active[i] === true;  // Based on heart_rate series
```

**Recommendation**: Define a single `ParticipantState` model:
```typescript
interface ParticipantState {
  id: string;
  status: 'active' | 'inactive' | 'absent';  // Single source
  lastActiveAt: number;
  lastSeenAt: number;
  // ... other fields
}
```

---

### 2. Separation of Concerns Violation

**Problem**: `FitnessSession._collectTimelineTick()` does too much:
- Iterates devices
- Iterates users  
- Resolves device-to-user mapping
- Calculates cumulative metrics
- Sanitizes values
- Records to timeline
- Handles equipment tracking

This 200+ line method mixes data collection, transformation, and persistence.

**Impact**: Difficult to understand when/why values are null vs. present. The `hasNumericSample()` check that skips recording is buried in complex logic.

```javascript
// FitnessSession.js lines 694-698 - Hidden skip logic
if (!hasNumericSample(entry.metrics)) return;  // Easy to miss!
assignMetric(`user:${slug}:heart_rate`, entry.metrics.heartRate);
assignMetric(`user:${slug}:zone_id`, entry.metrics.zoneId);
```

**Recommendation**: Extract into focused functions:
```javascript
class TimelineCollector {
  collectDeviceMetrics(devices) { /* ... */ }
  collectUserMetrics(users) { /* ... */ }
  resolveUserDeviceMapping(devices, users) { /* ... */ }
  recordTick(metrics) { /* ... */ }
}
```

---

### 3. Leaky Abstraction

**Problem**: Chart helpers need to know internal details of data storage:
- Must know that `coins_total` is cumulative (never decreases)
- Must know that `heart_rate` has nulls during dropout
- Must know that `zone_id` might be forward-filled
- Must fetch multiple series and cross-reference them

```javascript
// FitnessChart.helpers.js - Knowledge of internal data semantics
const coinsRaw = getSeries(targetId, 'coins_total', { clone: true });  // Cumulative
const heartRate = getSeries(targetId, 'heart_rate', { clone: true });  // Has nulls
const zones = getSeries(targetId, 'zone_id', { clone: true });         // Forward-filled?

// Must build "active" mask from heart_rate because other series don't have dropout info
const active = heartRate.map(hr => hr != null && Number.isFinite(hr) && hr > 0);
```

**Impact**: Consumers must understand implementation details to use the data correctly.

**Recommendation**: Provide a higher-level API that encapsulates these details:
```javascript
// Clean interface - consumer doesn't need to know about data quirks
const userTimeline = session.getUserTimeline(userId);
const segments = userTimeline.getSegments();  // Already handles dropout detection
```

---

### 4. DRY (Don't Repeat Yourself) Violation

**Problem**: Dropout detection logic is implemented in multiple places:

1. **DeviceManager**: Prunes stale devices after timeout
2. **FitnessSession.roster**: Only includes active HR devices
3. **FitnessChartApp**: Tracks `isPresent` vs `absentEntries`
4. **buildSegments()**: Detects gaps via `active[]` array
5. **useRaceChartWithHistory**: Creates gap segments on rejoin

Each layer has its own interpretation of "active" vs "inactive".

```javascript
// DeviceManager - 180s timeout
if (now - d.lastSeen <= remove) { stillActive.add(d.id); }

// FitnessSession.roster - device must exist
heartRateDevices.forEach((device) => { /* build roster */ });

// FitnessChartApp - roster membership
const absent = allEntries.filter((e) => !e.isPresent);

// buildSegments - heart_rate presence
const isActive = active[i] === true;
```

**Recommendation**: Centralize activity state:
```javascript
class ParticipantActivityTracker {
  isActive(participantId, timestamp?) { /* single source of truth */ }
  getActivityPeriods(participantId) { /* returns [{start, end, isActive}] */ }
  onActivityChange(callback) { /* pub/sub for state changes */ }
}
```

---

### 5. Interface Segregation Violation

**Problem**: `FitnessSession` is a god object with 1300+ lines handling:
- Session lifecycle (start, end, persist)
- Device management delegation
- User management delegation
- Timeline recording
- Roster computation
- Equipment tracking
- Snapshot persistence
- Voice memo integration
- TreasureBox integration

**Impact**: Changes to one concern risk breaking others. Testing requires mocking the entire system.

**Recommendation**: Decompose into focused modules:
```javascript
// Separate concerns
class SessionLifecycle { start(), end(), persist() }
class ParticipantTracker { roster, activity, presence }
class MetricsRecorder { recordTick(), getSeries() }
class EquipmentTracker { trackRotations(), getEquipment() }
```

---

### 6. Temporal Coupling

**Problem**: Data correctness depends on execution order:
1. Devices must broadcast before `_collectTimelineTick()`
2. UserManager must resolve mapping before metrics are recorded
3. TreasureBox must update before roster is computed
4. Roster must be computed before chart reads it

If timing changes, data becomes inconsistent.

```javascript
// Order matters!
this.deviceManager.pruneStaleDevices(timeouts);  // 1. Prune first
const allDevices = this.deviceManager.getAllDevices();  // 2. Then get devices
// ... 
this._collectTimelineTick({ timestamp: now });  // 3. Then record
// If (3) happens before (1), stale data gets recorded
```

**Impact**: Race conditions, stale data, inconsistent state across renders.

**Recommendation**: Use event-driven architecture:
```javascript
eventBus.on('device:broadcast', (data) => metricsRecorder.record(data));
eventBus.on('device:timeout', (deviceId) => activityTracker.markInactive(deviceId));
eventBus.on('tick', () => timeline.advance());
```

---

### 7. Missing Domain Model

**Problem**: No explicit model for key domain concepts:
- What is "activity" vs "presence" vs "participation"?
- What is a "dropout period"?
- What is a "segment" in chart terms?

These concepts are implicitly defined by code behavior, not explicitly modeled.

**Impact**: Different parts of the codebase interpret concepts differently.

**Recommendation**: Define explicit domain types:
```typescript
// domain/types.ts
type ParticipantStatus = 'broadcasting' | 'idle' | 'disconnected' | 'removed';

interface ActivityPeriod {
  startTick: number;
  endTick: number;
  status: ParticipantStatus;
}

interface ChartSegment {
  participantId: string;
  activityPeriod: ActivityPeriod;
  dataPoints: DataPoint[];
  style: 'solid' | 'dashed';  // Derived from status
}
```

---

### 8. Data Transformation Chain

**Problem**: Data undergoes multiple transformations with side effects:

```
Raw HR → DeviceManager → UserManager → TreasureBox → Timeline
                                           ↓
                                    coins_total (cumulative)
                                           ↓
                                    fillEdgesOnly()
                                           ↓
                                    buildSegments()
                                           ↓
                                    createPaths()
```

Each step can:
- Drop data (null filtering)
- Transform data (cumulative sums)
- Fill data (forward-fill)
- Aggregate data (RLE encoding)

**Impact**: Impossible to trace why a specific value exists at a specific tick.

**Recommendation**: Make transformations explicit and reversible:
```javascript
class TimeSeriesTransformer {
  // Each transformation is explicit and documented
  cumulative(series) { /* ... */ }
  fillEdges(series) { /* ... */ }
  detectGaps(series, activityMask) { /* ... */ }
  
  // Provide tracing
  getTransformationHistory(seriesKey) { /* ... */ }
}
```

---

## Recommended Architecture

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                          │
│  FitnessChartApp, FitnessGovernance, etc.                      │
│  - Consumes domain objects                                      │
│  - No data transformation logic                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     APPLICATION LAYER                           │
│  useFitnessApp, FitnessContext                                 │
│  - Orchestrates domain services                                 │
│  - Provides React integration                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DOMAIN LAYER                               │
│  ParticipantTracker, ActivityMonitor, ChartDataBuilder         │
│  - Business logic                                               │
│  - Domain models (Participant, ActivityPeriod, Segment)        │
│  - Single source of truth for activity state                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   INFRASTRUCTURE LAYER                          │
│  DeviceManager, FitnessTimeline, SessionPersistence            │
│  - Data storage                                                 │
│  - External integrations (ANT+, WebSocket)                     │
│  - No business logic                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Key Interfaces

```typescript
// Domain layer - clean interfaces

interface IActivityMonitor {
  /** Single source of truth for participant activity */
  getStatus(participantId: string): ParticipantStatus;
  getActivityPeriods(participantId: string): ActivityPeriod[];
  subscribe(callback: (event: ActivityEvent) => void): Unsubscribe;
}

interface IChartDataBuilder {
  /** Returns pre-processed chart data with dropout handling built-in */
  getParticipantSegments(participantId: string): ChartSegment[];
  getAllSegments(): Map<string, ChartSegment[]>;
}

interface IParticipantRoster {
  /** Single source of truth for who is "in" the session */
  getActive(): Participant[];
  getInactive(): Participant[];
  getAll(): Participant[];
}
```

### Activity State Machine

```
                    ┌─────────────┐
                    │   ABSENT    │
                    │ (not seen)  │
                    └──────┬──────┘
                           │ first broadcast
                           ▼
    timeout        ┌─────────────┐        no data for N ticks
    ┌──────────────│   ACTIVE    │──────────────┐
    │              │(broadcasting)│              │
    │              └──────┬──────┘              │
    │                     │                      ▼
    │                     │              ┌─────────────┐
    │                     │              │    IDLE     │
    │                     │              │ (dropout)   │
    │                     │              └──────┬──────┘
    │                     │                     │
    │                     │ resumed             │ timeout
    │                     │◄────────────────────┤
    │                     │                     │
    ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────┐
│                      REMOVED                         │
│              (pruned from session)                   │
└─────────────────────────────────────────────────────┘
```

This state machine would be the **single source of truth** for participant status, eliminating the current ambiguity.

---

## Migration Path

### Phase 1: Introduce Domain Models (Low Risk)
1. Create `ParticipantStatus` enum
2. Create `ActivityPeriod` type
3. Create `ChartSegment` type
4. Update existing code to use these types

### Phase 2: Centralize Activity Tracking (Medium Risk)
1. Create `ActivityMonitor` class
2. Move activity detection from DeviceManager, Session, Chart
3. All consumers read from ActivityMonitor

### Phase 3: Clean Interfaces (Higher Risk)
1. Create `IChartDataBuilder` interface
2. Encapsulate data transformation logic
3. Chart components consume clean interface

### Phase 4: Decouple Session (Highest Risk)
1. Extract `SessionLifecycle` from `FitnessSession`
2. Extract `MetricsRecorder`
3. Extract `ParticipantRoster`
4. Compose smaller pieces

---

## Conclusion

The dropout bug was a symptom of:
1. **No single source of truth** for activity state
2. **Leaky abstractions** requiring consumers to understand internals
3. **Scattered logic** across multiple layers
4. **Missing domain model** for key concepts

The bandaid fix works by adding yet another layer of detection (`active[]` array), but the proper fix requires:
1. Defining explicit domain concepts
2. Centralizing activity state management
3. Providing clean interfaces that hide implementation details
4. Decomposing the monolithic `FitnessSession` class

These changes would prevent similar bugs and make the system easier to understand, test, and extend.
