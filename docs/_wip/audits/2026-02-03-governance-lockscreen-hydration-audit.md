# Governance Lock Screen Hydration Timing Audit

**Date:** 2026-02-03
**Scope:** Frontend governance lock screen data flow and hydration timing
**Severity:** Medium (UX polish, architectural debt)
**Related Bug:** `docs/_wip/bugs/2026-02-02-governance-lock-screen-delay.md`

## Executive Summary

The governance lock screen exhibits two distinct hydration delays caused by **treating static configuration data as dynamic state**. Users see placeholder values ("Target zone", HR 60) for ~1 second before real values appear.

| Gap | Duration | What's Missing | Root Cause |
|-----|----------|----------------|------------|
| **Gap 1** | 389ms | User rows don't appear | Roster waits for TreasureBox zone snapshot |
| **Gap 2** | 353ms | Zone labels show placeholders | Requirements not pre-populated from config |
| **Total** | ~1116ms | Full hydration | Multiple sources of truth, render waterfall |

---

## Empirical Evidence

### Test Results (30ms Rapid Polling)

**Test file:** `tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs`
**Commit:** dfedd190

#### Captured Hydration Sequence

| Timestamp | Phase | Rows | Target Zone | Target HR |
|-----------|-------|------|-------------|-----------|
| T+1040ms | `NO_OVERLAY` | - | - | - |
| T+1429ms | `HR_PRESENT_ZONES_PENDING` | 2 | "Target zone" | 60 |
| T+1803ms | `HR_PRESENT_ZONES_PENDING` | 3 | "Target zone" | 60 |
| T+2156ms | `FULLY_HYDRATED` | 3 | "Active" | 100/120/125 |

#### Placeholder vs Real Values

| Field | Placeholder | Real Value | Source |
|-------|-------------|------------|--------|
| Target zone | "Target zone" | "Active" | `zoneInfoMap[zoneId].name` |
| Target HR | 60 | 100, 120, 125 | User-specific from config |
| Message | "Loading unlock rules..." | "Meet these conditions..." | Governance state |

The **60 BPM placeholder** is particularly problematic - it's a valid-looking number that doesn't match any user's actual target, causing confusion.

---

## Code Evidence

### Gap 1: Participant Roster Hydration (389ms)

#### The Blocking Dependency Chain

```
ParticipantRoster.getRoster()
  └─ _buildZoneLookup()
     └─ TreasureBox.getUserZoneSnapshot() ← BLOCKS until first HR reading
```

#### Evidence: ParticipantRoster.js:263-285

```javascript
_buildZoneLookup() {
  const zoneLookup = new Map();
  if (!this._treasureBox) return zoneLookup;  // Returns empty if no TreasureBox

  const zoneSnapshot = typeof this._treasureBox.getUserZoneSnapshot === 'function'
    ? this._treasureBox.getUserZoneSnapshot()  // BLOCKS: Empty until HR arrives
    : [];

  if (!Array.isArray(zoneSnapshot)) return zoneLookup;

  zoneSnapshot.forEach((entry) => {
    if (entry && entry.participantId) {
      zoneLookup.set(entry.participantId, entry);
    }
  });

  return zoneLookup;  // Empty on first render → no roster entries
}
```

**Problem:** The zone lookup returns empty until TreasureBox has processed HR data, even though participant *identity* (name, device ID) is available immediately from DeviceManager.

#### Evidence: FitnessContext.jsx:1297-1322

```javascript
const participantRoster = React.useMemo(() => {
  const roster = fitnessSessionRef.current?.roster || [];
  if (!roster || roster.length === 0) {
    // Returns empty array until TreasureBox has zone data
    return emptyRosterRef.current;
  }
  // ... signature-based caching ...
  return rosterCacheRef.current.value;
}, [version]);  // Only updates when forceUpdate() increments version
```

**Problem:** `participantRoster` is empty on first render because `session.roster` depends on `_buildZoneLookup()` which depends on TreasureBox.

#### Evidence: TreasureBox Callback Registration (FitnessContext.jsx:558)

```javascript
box.setMutationCallback(forceUpdate);
```

The `forceUpdate()` is only called when TreasureBox mutates - which happens when HR data arrives and zone calculations complete.

### Gap 2: Zone Label Hydration (353ms)

#### The Fallback Chain

```
FitnessPlayerOverlay.buildTargetInfo()
  └─ requirement.zoneLabel      ← Missing on first render
     └─ zoneInfo?.name          ← Lookup fails
        └─ 'Target'             ← Fallback used
```

#### Evidence: FitnessPlayerOverlay.jsx:1020-1060

```javascript
const buildTargetInfo = (requirement) => {
  const zoneIdRaw = requirement?.zone ? String(requirement.zone) : null;
  const zoneId = zoneIdRaw
    ? zoneIdRaw.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    : null;

  // Attempt 1: Look up from zoneMetadata
  let zoneInfo = zoneId && zoneMetadata.map[zoneId]
    ? zoneMetadata.map[zoneId]
    : null;

  // Attempt 2: Find by label (fails if zoneLabel not set)
  if (!zoneInfo && requirement?.zoneLabel) {
    zoneInfo = findZoneByLabel(requirement.zoneLabel)
      || {
        id: zoneId || normalizeZoneIdForOverlay(requirement.zoneLabel),
        name: requirement.zoneLabel,
        color: null,
        min: null
      };
  }

  // Final fallback chain - ends at 'Target' if all else fails
  const label = requirement?.zoneLabel
    || zoneInfo?.name
    || zoneFromMetadata?.name
    || requirement?.ruleLabel
    || (targetZoneId ? targetZoneId.charAt(0).toUpperCase() + targetZoneId.slice(1) : null)
    || 'Target';  // ← This is what users see initially
};
```

**Problem:** `requirement.zoneLabel` is undefined on first render because GovernanceEngine hasn't evaluated with complete zone data yet.

#### Evidence: GovernanceEngine.js:1549-1563 (_evaluateZoneRequirement)

```javascript
_evaluateZoneRequirement(zoneKey, rule, activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount) {
  const zoneId = zoneKey ? String(zoneKey).toLowerCase() : null;
  if (!zoneId) return null;

  const requiredRank = zoneRankMap[zoneId];
  if (!Number.isFinite(requiredRank)) return null;  // Returns null if zone not in map

  // ... evaluation logic ...

  const zoneInfo = zoneInfoMap[zoneId];  // Lookup from zone map

  return {
    zone: zoneId,
    zoneLabel: zoneInfo?.name || zoneId,  // Falls back to raw ID like "active"
    // ...
  };
}
```

**Problem:** If `zoneInfoMap` is empty or incomplete when this runs, `zoneLabel` won't be set properly.

#### Evidence: Zone Map Seeding (GovernanceEngine.js:420-442)

```javascript
if (this.session?.snapshot?.zoneConfig) {
  const zoneConfig = this.session.snapshot.zoneConfig;
  const zoneRankMap = {};
  const zoneInfoMap = {};

  zoneConfig.forEach((z, idx) => {
    if (!z || z.id == null) return;
    const zid = normalizeZoneId(z.id);
    if (!zid) return;
    zoneRankMap[zid] = idx;
    zoneInfoMap[zid] = {
      id: zid,
      name: z.name || String(z.id),
      color: z.color || null
    };
  });

  this._latestInputs.zoneRankMap = zoneRankMap;
  this._latestInputs.zoneInfoMap = zoneInfoMap;
}
```

**Problem:** This seeding happens in `configure()`, but the `session.snapshot.zoneConfig` may not be fully populated yet due to the useEffect timing.

#### Evidence: Snapshot Update Race (FitnessContext.jsx:1869-1875)

```javascript
useEffect(() => {
  if (!session || typeof session.updateSnapshot !== 'function') return;
  try {
    session.updateSnapshot({
      users,
      devices: fitnessDevices,
      playQueue: fitnessPlayQueue,
      participantRoster,
      zoneConfig  // Updated from prop
    });
  } catch (error) {
    // ...
  }
}, [users, fitnessDevices, fitnessPlayQueue, participantRoster, zoneConfig]);
```

**Problem:** This runs AFTER render, so GovernanceEngine may be configured with an incomplete snapshot. The zone config is available as a prop immediately, but it's only synced to the session snapshot asynchronously.

---

## Antipatterns Identified

### 1. Static Data Treated as Async

**What:** Participant identity (name, device ID) and zone configuration are available at app startup, but the code treats them as if they require async fetching.

**Where:**
- `ParticipantRoster._buildZoneLookup()` blocks on TreasureBox
- `GovernanceEngine.configure()` waits for snapshot updates

**Evidence:**
```javascript
// ParticipantRoster.js:267 - Blocks on TreasureBox even though device info is available
const zoneSnapshot = this._treasureBox.getUserZoneSnapshot();
```

**Impact:** Gap 1 - Rows don't appear until HR data arrives

### 2. Multiple Sources of Truth

**What:** Zone configuration exists in 4+ places that can be out of sync:

| Source | Location | Updated When |
|--------|----------|--------------|
| `fitnessConfiguration.zoneConfig` | Prop | Immediate (app load) |
| `session.snapshot.zoneConfig` | Session | After useEffect |
| `GovernanceEngine._latestInputs.zoneInfoMap` | Engine | On configure() |
| `ZoneProfileStore` | Store | On user config load |

**Evidence:**
```javascript
// FitnessContext.jsx:1869 - Config synced AFTER render
useEffect(() => {
  session.updateSnapshot({ zoneConfig });  // Async update
}, [zoneConfig]);

// GovernanceEngine.js:420 - Uses potentially stale snapshot
if (this.session?.snapshot?.zoneConfig) {
  // May be empty if useEffect hasn't run yet
}
```

**Impact:** Gap 2 - Zone labels inconsistent until all sources sync

### 3. Render Waterfall

**What:** Multiple independent re-renders instead of batched updates.

**Sequence:**
```
Render 1: Mount → empty roster, "Target" placeholders
  ↓ useEffect: updateSnapshot()
Render 2: Snapshot updated → still empty roster
  ↓ WebSocket: HR data arrives
Render 3: TreasureBox callback → forceUpdate() → roster appears
  ↓ Governance: evaluate() completes
Render 4: Zone labels hydrate
```

**Evidence:**
```javascript
// FitnessContext.jsx:558 - TreasureBox triggers render
box.setMutationCallback(forceUpdate);

// FitnessContext.jsx:501-502 - Governance triggers separate renders
session.governanceEngine.setCallbacks({
  onPhaseChange: () => forceUpdate(),
  onPulse: () => forceUpdate()
});
```

**Impact:** Both gaps - each data source triggers independent re-render

### 4. Polling/Subscription Hybrid

**What:** Updates come from both polling (tick-based) and subscriptions (callbacks), with no coordination.

**Evidence:**
```javascript
// TreasureBox.js:727-737 - Callback disabled, now tick-driven
setGovernanceCallback(callback) {
  // No-op: Governance callback removed - now tick-driven via ZoneProfileStore
  if (callback) {
    getLogger().warn('treasurebox.governance_callback_deprecated');
  }
}
```

The TreasureBox callback was intentionally disabled, meaning governance only evaluates when React's tick cycle triggers it, not when data actually arrives.

**Impact:** Additional latency between data arrival and UI update

### 5. Prop Drilling Without Dependency Graph

**What:** Components receive data from context without explicit dependencies, making it unclear what data is needed when.

**Evidence:**
```javascript
// FitnessPlayerOverlay.jsx - Implicit dependencies
const overlay = useGovernanceOverlay(governanceState, participantRoster);
// overlay depends on:
//   - governanceState.requirements (needs zoneInfoMap)
//   - participantRoster (needs TreasureBox)
// But these are fetched independently with no synchronization
```

**Impact:** Requirements and roster hydrate at different times

---

## Data Flow Analysis

### Current (Broken) Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ T+0ms: Component Mount                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│ FitnessProvider renders                                                 │
│   └─ GovernanceEngine.configure() called                                │
│      └─ session.snapshot.zoneConfig may be empty (useEffect not run)   │
│      └─ zoneInfoMap seeded with incomplete/empty data                   │
│      └─ evaluate() returns requirements with missing zoneLabel          │
│   └─ participantRoster = [] (TreasureBox has no zone snapshot)          │
│   └─ Lock screen renders with "Target zone", HR 60 placeholders         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ T+10ms: useEffect Runs                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│ session.updateSnapshot({ zoneConfig })                                  │
│   └─ Snapshot now has zone config                                       │
│   └─ But GovernanceEngine already configured with old data              │
│   └─ No re-evaluation triggered                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ T+50-389ms: WebSocket Data Arrives                                      │
├─────────────────────────────────────────────────────────────────────────┤
│ FitnessSession.ingestData() receives HR readings                        │
│   └─ DeviceManager updates device states                                │
│   └─ TreasureBox.tick() processes HR values                             │
│   └─ Zone calculations complete                                         │
│   └─ TreasureBox.mutationCallback() → forceUpdate()                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ T+389ms: Render 2 (Gap 1 Closes)                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ participantRoster now populated (TreasureBox has zone snapshot)         │
│   └─ User rows appear in lock screen                                    │
│   └─ But zone labels still show "Target zone" (evaluate not re-run)     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ T+389-742ms: Governance Re-evaluation                                   │
├─────────────────────────────────────────────────────────────────────────┤
│ GovernanceEngine.evaluate() runs with complete data                     │
│   └─ zoneInfoMap now populated from updated snapshot                    │
│   └─ Requirements rebuilt with proper zoneLabel                         │
│   └─ onPhaseChange/onPulse → forceUpdate()                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ T+742ms: Render 3 (Gap 2 Closes)                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ Lock screen fully hydrated                                              │
│   └─ Zone labels show "Active"                                          │
│   └─ Target HRs show user-specific values (100, 120, 125)               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Ideal Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ T+0ms: Component Mount                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│ FitnessProvider renders                                                 │
│   └─ zoneConfig available immediately from props                        │
│   └─ GovernanceEngine.configure() seeds zoneInfoMap SYNCHRONOUSLY       │
│   └─ requirementSummary pre-populated with zone labels                  │
│   └─ Identity roster built from DeviceManager (no TreasureBox needed)   │
│   └─ Lock screen renders with:                                          │
│      ├─ User rows (names from device config)                            │
│      ├─ Zone labels ("Active") from zoneInfoMap                         │
│      ├─ Target HRs (100, 120, 125) from user config                     │
│      └─ Current HR: "--" (waiting for data)                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ T+Xms: HR Data Arrives                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│ Single coalesced update:                                                │
│   └─ Current HR values populate                                         │
│   └─ Current zone calculated                                            │
│   └─ Progress indicators update                                         │
│   └─ One render with all vitals                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Recommendations

### Fix 1: Pre-populate Requirements in configure()

**Location:** `GovernanceEngine.js:configure()`

**Change:** Build requirement shell with zone labels BEFORE first evaluate():

```javascript
configure(config, policies, { subscribeToAppEvent } = {}) {
  this.config = config || {};
  this.policies = this._normalizePolicies(config.policies || policies);

  // MUST seed zone maps SYNCHRONOUSLY from props, not snapshot
  const zoneConfig = config.zoneConfig || this.session?.snapshot?.zoneConfig || [];
  this._seedZoneMaps(zoneConfig);

  // Pre-populate requirements with zone labels
  const activePolicy = this._chooseActivePolicy(0);
  if (activePolicy) {
    this.requirementSummary = {
      policyId: activePolicy.id,
      requirements: this._buildRequirementShell(
        activePolicy.baseRequirement,
        this._latestInputs.zoneRankMap,
        this._latestInputs.zoneInfoMap
      ),
      allSatisfied: false,
      satisfiedOnce: false
    };
  }

  this.evaluate();
}
```

**Impact:** Eliminates Gap 2 - zone labels available on first render

### Fix 2: Separate Identity Roster from Vitals

**Location:** `ParticipantRoster.js`

**Change:** Build identity roster without TreasureBox dependency:

```javascript
getRoster() {
  // Stage 1: Identity (static, available immediately)
  const identityRoster = this._buildIdentityRoster();

  // Stage 2: Vitals (dynamic, requires TreasureBox)
  if (this._treasureBox) {
    return this._enrichWithVitals(identityRoster);
  }

  return identityRoster;  // Return identity-only roster immediately
}

_buildIdentityRoster() {
  const roster = [];
  const heartRateDevices = this._deviceManager.getAllDevices()
    .filter(d => d.type === 'heart_rate');

  heartRateDevices.forEach((device) => {
    const user = this._userManager.getUserForDevice(device.id);
    roster.push({
      participantId: user?.id || device.id,
      name: user?.name || device.name || 'Unknown',
      deviceId: device.id,
      // Zone data will be null until vitals enrich
      currentZone: null,
      currentHR: null
    });
  });

  return roster;
}
```

**Impact:** Eliminates Gap 1 - user rows appear immediately

### Fix 3: Pass zoneConfig Directly to configure()

**Location:** `FitnessContext.jsx`

**Change:** Don't rely on snapshot for zone config:

```javascript
// When configuring governance, pass zoneConfig directly
session.governanceEngine.configure(
  {
    ...governanceConfig,
    zoneConfig  // Pass directly from props, not snapshot
  },
  policies
);
```

**Impact:** Eliminates race condition between snapshot update and configure()

### Fix 4: Coalesce Update Sources

**Location:** `FitnessContext.jsx`

**Change:** Batch updates from multiple sources:

```javascript
const pendingUpdateRef = useRef(false);

const scheduleUpdate = useCallback(() => {
  if (pendingUpdateRef.current) return;
  pendingUpdateRef.current = true;

  requestAnimationFrame(() => {
    pendingUpdateRef.current = false;
    forceUpdate();
  });
}, [forceUpdate]);

// Use single callback for all sources
box.setMutationCallback(scheduleUpdate);
session.governanceEngine.setCallbacks({
  onPhaseChange: scheduleUpdate,
  onPulse: scheduleUpdate
});
```

**Impact:** Reduces render count, smoother hydration

---

## Verification Checklist

After implementing fixes:

- [ ] Lock screen shows user rows immediately (no 389ms gap)
- [ ] Zone labels show "Active" on first render (no "Target zone" placeholder)
- [ ] Target HRs show user-specific values immediately (no "60" placeholder)
- [ ] Only current HR/zone update when data arrives
- [ ] No console warnings about missing zone data
- [ ] Existing governance behavior unchanged (grace period, challenges)

---

## Related Files

| File | Role | Issues |
|------|------|--------|
| `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx` | Lock screen UI | Fallback chain ends at "Target" |
| `frontend/src/hooks/fitness/GovernanceEngine.js` | Governance logic | Zone maps not pre-seeded |
| `frontend/src/context/FitnessContext.jsx` | State management | Snapshot race, multiple forceUpdate sources |
| `frontend/src/modules/Fitness/ParticipantRoster.js` | Roster builder | Blocks on TreasureBox |
| `frontend/src/modules/Fitness/TreasureBox.js` | Zone calculations | Callback disabled |

---

## Test Coverage

**Existing test:** `tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs`
- Captures hydration phases with 30ms polling
- Documents placeholder → real value transitions
- Run: `npx playwright test tests/live/flow/fitness/governance-lockscreen-monitor.runtime.test.mjs`

**Proposed regression tests:**
1. Lock screen renders with zone labels on first frame
2. User rows appear before HR data arrives
3. No "Target zone" or "60" placeholders visible
4. Single render when HR data arrives (not multiple)
