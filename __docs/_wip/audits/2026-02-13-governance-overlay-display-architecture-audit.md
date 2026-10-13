# Governance Overlay Display Architecture Audit

**Date:** 2026-02-13
**Scope:** Fitness governance lock screen, warning overlay, and underlying zone display data flow
**Goal:** Identify SSoT violations, separation-of-concerns failures, and DRY violations in the governance display pipeline. Design a refactor based on clean architecture principles.

---

## Architecture As-Is

Five layers participate in getting zone data onto screen:

| Layer | File | Responsibility | Problem |
|-------|------|---------------|---------|
| **ZoneProfileStore** | `frontend/src/hooks/fitness/ZoneProfileStore.js` | Stabilized zone state per user (hysteresis: 5s cooldown + 3s stability) | Clean — no issues |
| **GovernanceEngine** | `frontend/src/hooks/fitness/GovernanceEngine.js` | Lock/unlock decisions based on zone requirements | Re-derives zone display data (zoneColor, zoneName, participantZones) that ZoneProfileStore already provides |
| **FitnessContext** | `frontend/src/context/FitnessContext.jsx` | React bridge — exposes engine state, store profiles, merged vitals | Merges 4 data sources into `getUserVitals()`: vitalsMap, roster, zone profiles, raw device data |
| **useGovernanceOverlay** | `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx` | Transforms engine state into overlay display model | Re-normalizes requirements already normalized by `_composeState()`. Passed empty requirements for warnings. |
| **FitnessPlayerOverlay** | `frontend/src/modules/Fitness/FitnessPlayerOverlay.jsx` | `warningOffenders` and `lockRows` useMemos | ~170 lines of re-derivation: re-queries zones, vitals, progress, avatars, thresholds from 6 different sources |

### Data Flow (Current)

```
WebSocket HR data
    |
    v
FitnessSession.ingestData()
    |
    v
ZoneProfileStore.syncFromUsers()       <-- applies hysteresis
    |  (if changed)
    v
GovernanceEngine.notifyZoneChange()     <-- 100ms debounce
    |
    v
GovernanceEngine.evaluate()
    |-- reads ZoneProfileStore.getProfile() for each user's zone
    |-- evaluates requirements against zone ranks
    |-- sets phase (pending/unlocked/warning/locked)
    |-- embeds display data (zoneColor, participantZones) into state  <-- VIOLATION
    |-- calls onPhaseChange/onPulse callbacks
    |
    v
FitnessContext forceUpdate()            <-- triggers React re-render
    |
    v
useGovernanceOverlay(governanceState)
    |-- re-normalizes requirements                                    <-- VIOLATION
    |-- determines category/status/show
    |
    v
FitnessPlayerOverlay
    |-- warningOffenders: resolves vitals, zones, progress per user   <-- VIOLATION
    |-- lockRows: resolves vitals, zones, progress, gradients         <-- VIOLATION
    |-- queries 6 sources per participant                             <-- VIOLATION
    |
    v
GovernanceStateOverlay
    |-- renders lock screen or warning banner from resolved data
```

---

## Violations Found

### Violation 1: Zone metadata computed 3 times

`zoneConfig` (the zone *system* — what zones exist, their colors, thresholds, ranks) is independently computed in:

1. **GovernanceEngine** — `_getZoneInfo(zoneId)` and `_getZoneRank(zoneId)` from `_latestInputs.zoneInfoMap/zoneRankMap`
2. **FitnessContext** — `zoneInfoMap` and `zoneRankMap` memos (~lines 1276-1317)
3. **FitnessPlayerOverlay** — `zoneMetadata` with `.map`, `.list`, `.ranked` (~line 409)

Same input, same output, three copies.

### Violation 2: No single owner for "how to display a participant"

To render one participant (name, avatar, HR, zone, color, progress), the overlay queries 6 sources:

1. `participantMap` — roster indexed by normalized name
2. `resolveParticipantVitals()` — calls `getUserVitals` (itself a 4-layer merge)
3. `getParticipantZone()` — ZoneProfileStore lookup with 4-level fallback chain
4. `getProgressEntry()` — from `userZoneProgress` via FitnessContext
5. `getUserZoneThreshold()` — per-user zone threshold from context
6. `overlay.participantZones` — governance snapshot (evaluation-time frozen copy)

There is no single "here's how to render user X" object.

### Violation 3: GovernanceEngine embeds display data it shouldn't own

The engine's `_composeState()` includes:
- `zoneColor` on requirement summaries (added in this session's Task 2)
- `zoneName`/`zoneLabel` on requirements
- `participantZones` map on lockRows with `{zoneId, zoneName, zoneColor}` per missing user (added in this session's Task 2)
- `lockRows` — a pre-computed, normalized display structure

These are display concerns leaking into a decision engine. The engine should say "user-1 needs zone `warm`", not "user-1 needs zone `warm` which is `#eab308`".

### Violation 4: Requirement normalization runs twice

`_composeState()` normalizes requirements into `lockRows` via `normalizeRequirements()`. Then `useGovernanceOverlay` calls `normalizeRequirements()` again for locked/pending states because it merges challenge requirements with base requirements using different logic per status.

### Violation 5: ~170 lines of re-derivation in the overlay

`warningOffenders` (~70 lines) and `lockRows` (~80 lines) each independently:
- Look up participants in the roster
- Call `resolveParticipantVitals()` to merge vitals from multiple sources
- Call `getParticipantZone()` to resolve zone with fallback chain
- Compute progress toward target zone
- Resolve avatar URLs
- Compute intermediate zone markers and gradients

This work should be done once by a shared display model.

---

## Critical Constraint

**Not all content is governed.** HR zones, colors, vitals display must NOT depend on governance. The governance overlay is an additional layer on top of the base fitness display system. The sidebar, zone cards, and vitals readouts must work for ungoverned content using the same data path.

---

## Proposed Architecture

Three distinct concerns, three distinct owners:

```
ZoneProfileStore          GovernanceEngine          ParticipantDisplayMap
(zone state SSoT)         (lock decisions SSoT)     (display resolution SSoT)

"user is in Active"       "content is locked"       "user renders as:
"stabilized via           "requirement: warm/all"    name, avatar, HR 130,
 hysteresis"              "missing: [user-1]"        zone Active, color #22c55e,
                          "phase: pending"            progress 65%"
```

### Component 1: ParticipantDisplayMap

A single `useMemo` in FitnessContext. Combines ZoneProfileStore profiles with roster metadata into one display-ready object per participant. Replaces the 4-layer `getUserVitals` merge and all overlay re-derivation.

```javascript
const participantDisplayMap = useMemo(() => {
  const map = new Map();
  const profiles = session?.zoneProfileStore?.getProfiles() || [];
  const roster = session?.roster || [];

  const rosterIndex = new Map();
  roster.forEach(r => rosterIndex.set(normalize(r.name || r.id), r));

  for (const profile of profiles) {
    const rosterEntry = rosterIndex.get(normalize(profile.id));
    map.set(normalize(profile.id), {
      id: profile.id,
      displayName: profile.displayName || profile.name,
      avatarSrc: resolveAvatar(rosterEntry, profile),
      heartRate: profile.heartRate,
      zoneId: profile.currentZoneId,
      zoneName: profile.currentZoneName,
      zoneColor: profile.currentZoneColor,
      progress: profile.progress,
      targetHeartRate: profile.targetHeartRate,
      zoneSequence: profile.zoneSequence,
      groupLabel: profile.groupLabel,
      source: profile.source,
      updatedAt: profile.updatedAt
    });
  }
  return map;
}, [session?.zoneProfileStore, session?.roster, version]);
```

**Replaces:** `getUserVitals()`, `getZoneProfile()`, `userZoneProgress`, `participantMap`, `resolveParticipantVitals()`, `getParticipantZone()`.

**Key property:** Works for ALL content — governed or not. Sidebar, zone cards, lock screen, and warning chips all read from this single map.

### Component 2: GovernanceEngine — decisions only

The engine sheds display data. Its state becomes pure decision output:

```javascript
// _composeState() — after refactor
{
  isGoverned: true,
  status: 'pending',
  policyId: 'default',

  requirements: [
    {
      zone: 'warm',              // zone ID only — no color, no label
      rule: 'all',
      requiredCount: 2,
      actualCount: 1,
      metUsers: ['user-2'],
      missingUsers: ['user-1'],
      satisfied: false
    }
  ],

  videoLocked: false,
  deadline: 1739456789000,       // absolute timestamp
  gracePeriodTotal: 30,

  challenge: {
    id: 'ch-1',
    status: 'active',
    zone: 'warm',
    requiredCount: 1,
    missingUsers: ['user-1'],
    remainingSeconds: 12
  },

  activeParticipants: ['user-1', 'user-2'],
  activeUserCount: 2
}
```

**Removed from engine state:**
- `zoneColor`, `zoneName`, `zoneLabel` on requirements
- `participantZones` map on lockRows
- `lockRows` entirely — the overlay derives rows from `requirements[].missingUsers` + `ParticipantDisplayMap`
- `zoneRankMap` exposure — internal evaluation detail

**Engine keeps doing:** Reading ZoneProfileStore for zone IDs during `evaluate()`, comparing zone ranks, managing phase transitions, grace period timers, challenge lifecycle. It produces IDs; consumers resolve IDs to display data.

### Component 3: Overlay becomes a thin join

`useGovernanceOverlay`, `warningOffenders`, and `lockRows` collapse into one small hook:

```javascript
const useGovernanceDisplay = (govState, displayMap, zoneMeta) => useMemo(() => {
  if (!govState?.isGoverned) return null;
  const { status, requirements, challenge, deadline, gracePeriodTotal } = govState;

  if (status === 'unlocked') return { show: false, status };

  const resolvedRows = (requirements || [])
    .filter(r => !r.satisfied)
    .flatMap(req => {
      const targetZone = zoneMeta.map[req.zone];
      return (req.missingUsers || []).map(userId => {
        const display = displayMap.get(normalize(userId));
        return {
          key: userId,
          displayName: display?.displayName || userId,
          avatarSrc: display?.avatarSrc || fallbackAvatar,
          heartRate: display?.heartRate ?? null,
          currentZone: display?.zoneId ? zoneMeta.map[display.zoneId] : null,
          targetZone,
          progress: computeProgress(display?.heartRate, targetZone?.min),
          zoneSequence: display?.zoneSequence
        };
      });
    });

  return { show: true, status, deadline, gracePeriodTotal, rows: resolvedRows };
}, [govState, displayMap, zoneMeta]);
```

**Replaces:** `useGovernanceOverlay` (~120 lines), `warningOffenders` useMemo (~70 lines), `lockRows` useMemo (~80 lines), `getParticipantZone` callback, `resolveParticipantVitals` callback.

**Key guarantee:** Every participant's zone, color, and HR comes from the same `ParticipantDisplayMap` snapshot. No timing gap, no dual-path fallbacks, no re-querying.

### Component 4: zoneMetadata hoisted to FitnessContext

Single computation, shared by all consumers:

```javascript
const zoneMetadata = useMemo(() => {
  const zones = fitnessConfig?.zones || [];
  const map = {};
  const ranked = [];
  zones.forEach((z, i) => {
    map[z.id] = { ...z, rank: i };
    ranked.push({ ...z, rank: i });
  });
  return { map, list: zones, ranked };
}, [fitnessConfig?.zones]);
```

**Replaces:** GovernanceEngine's internal `_getZoneInfo`/`_getZoneRank` lookup maps (for output paths only — evaluation still uses `_latestInputs`), FitnessContext's `zoneInfoMap`/`zoneRankMap` memos, FitnessPlayerOverlay's local `zoneMetadata` useMemo.

---

## Data Flow (After Refactor)

```
WebSocket HR data
    |
    v
FitnessSession.ingestData()
    |
    v
ZoneProfileStore.syncFromUsers()            <-- applies hysteresis (unchanged)
    |  (if changed)
    v
GovernanceEngine.notifyZoneChange()          <-- 100ms debounce (unchanged)
    |
    v
GovernanceEngine.evaluate()
    |-- reads ZoneProfileStore for zone IDs   (unchanged)
    |-- evaluates requirements                (unchanged)
    |-- produces decision state: phase, requirements (zone IDs + user IDs), deadline
    |-- NO display data in state              <-- CLEAN
    |
    v
FitnessContext forceUpdate()
    |
    +-- participantDisplayMap (single memo)   <-- NEW: one display model for all consumers
    |     combines ZoneProfileStore + roster
    |
    +-- zoneMetadata (single memo)            <-- HOISTED: one zone system definition
    |
    +-- governanceState (engine.state)        <-- SIMPLIFIED: decisions only
    |
    v
useGovernanceDisplay(govState, displayMap, zoneMeta)
    |-- joins decisions with display data     <-- THIN: ~30 lines
    |-- produces resolved rows
    |
    v
GovernanceStateOverlay
    |-- renders from resolved rows directly   <-- NO re-derivation
    |
Sidebar / Zone Cards
    |-- reads participantDisplayMap directly   <-- SAME source, no governance dependency
```

---

## Migration Path

Incremental steps. Each is independently shippable and verifiable against existing tests (310 unit + 3 runtime).

### Phase 1: Extract ParticipantDisplayMap (additive)

- Add `participantDisplayMap` memo to FitnessContext alongside existing exports
- Expose via context
- Write unit tests: entries resolve correctly, zone comes from ZoneProfileStore (stabilized), avatar resolves
- **No existing code changes** — existing consumers still use `getUserVitals`, `getZoneProfile`, etc.
- Commit and verify: 310 unit + 3 runtime pass

### Phase 2: Hoist zoneMetadata to FitnessContext (additive)

- Add `zoneMetadata` memo to FitnessContext
- Expose via context
- FitnessPlayerOverlay's local `zoneMetadata` still works — just redundant
- Write unit test: `zoneMetadata.map[zoneId]` matches what GovernanceEngine receives
- Commit and verify

### Phase 3: New overlay hook (parallel)

- Create `useGovernanceDisplay` alongside existing `useGovernanceOverlay`
- Wire it up in parallel — compute both, compare outputs in dev
- Write tests: rows resolve correctly for pending, warning, locked, challenge states
- Existing rendering still uses old path
- Commit and verify

### Phase 4: Wire GovernanceStateOverlay to new data (swap)

- GovernanceStateOverlay receives `governanceDisplay` instead of three separate props
- Delete the `overlay` + `lockRows` + `warningOffenders` three-prop interface
- Update GovernanceStateOverlay rendering to use `status` for lock vs warning dispatch (not `category`)
- Runtime tests validate: no "Waiting" flash, chip colors correct, hydration < 2s
- Commit and verify

### Phase 5: Delete dead code

- Remove `useGovernanceOverlay` hook
- Remove `warningOffenders` and `lockRows` useMemos
- Remove `getParticipantZone`, `resolveParticipantVitals`, `computeGovernanceProgress` from overlay
- Remove local `zoneMetadata` from overlay
- Remove `zoneColor`, `participantZones`, `lockRows` from GovernanceEngine `_composeState()`
- Remove `getUserVitals`, `getZoneProfile`, `userZoneProgress` from context IF no other consumers (grep first — sidebar may still use them)
- Deprecate `zoneInfoMap`/`zoneRankMap` memos from context (replaced by `zoneMetadata`)
- Commit and verify

### Phase 6: Sidebar migration (if applicable)

- Grep for remaining consumers of `getUserVitals`, `getZoneProfile`, `userZoneProgress`
- Migrate sidebar cards and zone display to `participantDisplayMap`
- Delete deprecated context exports
- Commit and verify

---

## Verification Checkpoints

Each phase must pass before proceeding:

| Check | Command | Expected |
|-------|---------|----------|
| Unit tests | `NODE_OPTIONS='--experimental-vm-modules' npx jest tests/isolated/domain/fitness/ --no-coverage --testPathIgnorePatterns='/\.worktrees/'` | 33+ suites, 310+ tests, 0 failures |
| Runtime tests | `npx playwright test tests/live/flow/fitness/governance-transition-tightness.runtime.test.mjs --reporter=line` | 3 pass |
| No "Waiting" flash | Runtime test 1 | No empty rows when device active |
| Chip color correct | Runtime test 2 | Border color matches user's current zone |
| Hydration < 2s | Runtime test 3 | Lock screen shows participant name within 2s |

---

## Summary of Wins

| Metric | Before | After |
|--------|--------|-------|
| Zone metadata computations | 3 | 1 |
| Sources queried per participant render | 6 | 1 (`participantDisplayMap`) |
| Overlay display derivation | ~170 lines across 3 useMemos | ~30 lines in 1 hook |
| Display data in GovernanceEngine | zoneColor, zoneName, participantZones, lockRows | None — IDs only |
| Governance dependency for zone display | Partial (participantZones snapshot) | None |
| Timing gap risk (store vs snapshot) | Dual-path fallback needed | Single snapshot, no gap |
