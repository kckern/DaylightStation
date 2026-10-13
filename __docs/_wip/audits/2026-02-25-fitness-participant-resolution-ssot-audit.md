# Fitness Participant Resolution — SSoT/DRY Audit

**Date:** 2026-02-25
**Trigger:** Lock screen "Waiting for participant data..." despite roster having users. Fix required a display-layer fallback (`useGovernanceDisplay`) to paper over GovernanceEngine not resolving participants during startup. This is the latest symptom of fragmented participant resolution across the fitness module.

---

## Summary

"Who is participating and what zone are they in?" is answered by **6 independent resolution paths** across 5 files. Each builds its own participant list, zone lookup, and fallback chain from the same underlying sources (DeviceManager, UserManager, TreasureBox, ZoneProfileStore). The result: bugs surface when one path resolves data that another can't, and fixes require adding fallback layers on top of fallback layers.

---

## Resolution Paths

### Path 1: `FitnessSession.roster` getter (legacy)
**File:** `FitnessSession.js:1114-1188`

Builds roster by iterating `deviceManager.getAllDevices()`, resolving users via `userManager`, and looking up zones from `treasureBox.getUserZoneSnapshot()` with fallback to `mappedUser.currentData.zone`. Hardcodes `isActive: true` for all entries.

### Path 2: `ParticipantRoster.getRoster()`
**File:** `ParticipantRoster.js:108-147`

**Near-identical** to Path 1. Same device iteration, same user/guest resolution, same TreasureBox zone lookup — but adds a second zone tier from `zoneProfileStore.getZoneState()` and uses `device.inactiveSince` for activity status instead of hardcoding true. Declares itself SSOT for active status (line 404).

### Path 3: `FitnessSession.getParticipantProfile()`
**File:** `FitnessSession.js:2515-2557`

Zone/HR resolution only (not a participant list). Three-layer fallback: ZoneProfileStore → ParticipantRoster.findParticipant → legacy `this.roster` find. Added during this session's bug fix work.

### Path 4: `GovernanceEngine.evaluate()`
**File:** `GovernanceEngine.js:1282-1388`

When called without args (`_triggerPulse`), rebuilds `activeParticipants[]` from `session.roster`, pre-populates `userZoneMap` from roster entries, then supplements `userZoneMap` again via `session.getParticipantProfile()`. Ghost-filters anyone without zone data.

### Path 5: `buildParticipantDisplayMap()`
**File:** `participantDisplayMap.js:17-90`

Builds display Map from roster (primary) enriched by ZoneProfileStore profiles, plus orphan profiles not in the roster. Single `buildEntry()` merges both sources.

### Path 6: `resolveGovernanceDisplay()`
**File:** `useGovernanceDisplay.js:12-129`

Builds lock/warning screen rows from `requirements[].missingUsers`. When `missingUsers` is empty (governance couldn't resolve participants), falls back to displayMap entries. Added during this session to fix the "Waiting for participant data..." bug.

---

## Identified Violations

### V1: Participant List Building (3 places)

| Location | What it does |
|----------|-------------|
| `FitnessSession.roster` (1123-1185) | Iterates HR devices → resolves user/guest → builds entry |
| `ParticipantRoster.getRoster()` (114-147) | **Same logic**, different file, with activity status enhancement |
| `GovernanceEngine.evaluate()` (1298-1313) | Reads from `session.roster` → extracts IDs + zones |

Path 1 and Path 2 are near-identical implementations. Path 4 reads from Path 1's output then re-extracts the same fields.

### V2: Zone Lookup Building (3 places)

| Location | Sources | Tier order |
|----------|---------|------------|
| `FitnessSession.roster` (1124-1135) | TreasureBox → User.currentData | 2-tier |
| `ParticipantRoster._buildZoneLookup()` (283-314) | TreasureBox → ZoneProfileStore → User.currentData | 3-tier |
| `GovernanceEngine.evaluate()` (1304-1311, 1355-1373) | Roster entry zones → getParticipantProfile | 2-pass |

Each consumer implements its own zone resolution with different fallback ordering. ZoneProfileStore overrides in Path 2 but supplements in Path 4.

### V3: Guest/Member Resolution (2 places)

Identical code in `FitnessSession.roster` (lines 1141-1169) and `ParticipantRoster._buildRosterEntry()` (lines 324-376):

```javascript
// Both files:
const guestEntry = userManager.assignmentLedger.get(deviceId);
const ledgerName = guestEntry?.occupantName || guestEntry?.metadata?.name;
const mappedUser = userManager.resolveUserForDevice(deviceId);
const participantName = ledgerName || mappedUser?.name;
```

Plus duplicated `baseUserName` dual-key fallback (`baseUserName || base_user_name`).

### V4: Active Status (2 contradictory definitions)

| Path | Definition | Source |
|------|-----------|--------|
| `FitnessSession.roster` (1183) | Always `true` | Hardcoded |
| `ParticipantRoster` (404) | `!device.inactiveSince` | Device data (declared SSOT) |
| `GovernanceEngine` (1301) | `entry.isActive !== false` | Trusts roster field |

Legacy path reports everyone as active. Modern path has real activity tracking. Governance reads from whichever `.roster` returns.

### V5: User ID Extraction (4 variations)

| Location | Pattern |
|----------|---------|
| `FitnessSession.roster` (1148) | `mappedUser?.id \|\| guestEntry?.occupantId \|\| metadata?.profileId` |
| `ParticipantRoster._buildRosterEntry()` (332) | Same 3-way chain |
| `GovernanceEngine.evaluate()` (1302) | `entry.id \|\| entry.profileId` |
| `buildParticipantDisplayMap()` (60-61) | `normalize(r.profileId \|\| r.id)` |

Four extraction patterns; if the wrong ID is picked upstream, downstream lookups fail silently.

### V6: Display-Layer Fallback Compensating for Engine-Layer Gap

The new `useGovernanceDisplay` fallback (lines 52-66) re-reads `displayMap` when governance produces no `missingUsers`. This compensates for GovernanceEngine ghost-filtering all participants when zone data isn't ready. The display layer shouldn't need to work around engine-layer resolution failures.

---

## Root Cause Pattern

The fundamental issue: **FitnessSession does not expose a single canonical method for "current participant state."** Instead, each consumer (governance, display, charts) reaches into raw sources (DeviceManager, TreasureBox, ZoneProfileStore) and builds its own view. When those sources aren't ready (startup discard, race conditions), some consumers fail while others don't — leading to inconsistent UI.

```
                DeviceManager    TreasureBox    ZoneProfileStore    UserManager
                     │                │                │                │
         ┌───────────┤    ┌───────────┤    ┌───────────┤    ┌───────────┤
         ↓           ↓    ↓           ↓    ↓           ↓    ↓           ↓
    roster getter  ParticipantRoster  GovernanceEngine  participantDisplayMap
         │              │                   │                    │
         └──────────────┴───────────────────┴────────────────────┘
                              ALL READ THE SAME SOURCES
                              EACH WITH DIFFERENT FALLBACKS
```

---

## Consolidation Approach

### Target Architecture

```
DeviceManager + UserManager + TreasureBox + ZoneProfileStore
                         │
                         ↓
              FitnessSession.getParticipantState()
              (SINGLE canonical method)
              Returns: { participants[], zoneMap, metadata }
                         │
          ┌──────────────┼──────────────────┐
          ↓              ↓                  ↓
   GovernanceEngine  displayMap builder   Chart/UI
   (consumes only)   (consumes only)      (consumes only)
```

### Priority Order

**P0 — Retire legacy `roster` getter**
Replace all internal callers with `ParticipantRoster.getRoster()`. The legacy getter exists only because `ParticipantRoster._deviceManager` is null during early startup (before `configure()`). Fix: configure ParticipantRoster earlier, or have the legacy getter delegate unconditionally.

**P1 — Extract shared resolution logic**
Guest/member resolution, user ID extraction, and HR fallback are copy-pasted between `FitnessSession.roster` and `ParticipantRoster._buildRosterEntry()`. Extract to a shared `resolveParticipantIdentity(deviceId, userManager)` function.

**P2 — Unify zone resolution**
Create a single `resolveZone(trackingId, { treasureBox, zoneProfileStore, userData })` that enforces tier order: ZoneProfileStore (committed/hysteresis) → TreasureBox (raw) → User.currentData (fallback). All three current zone lookups call this.

**P3 — GovernanceEngine stops building its own participant list**
`evaluate()` should call `session.getActiveParticipants()` (or equivalent canonical method) instead of reading `session.roster` and re-extracting IDs/zones. Eliminate the double-pass zone enrichment (roster zones + getParticipantProfile supplement).

**P4 — Remove display-layer governance fallback**
Once GovernanceEngine reliably resolves participants during startup (P3 eliminates ghost-filter removing everyone), the `useGovernanceDisplay` roster fallback (lines 52-66) becomes unnecessary.

---

## Files Affected

| File | Violations | Role in consolidation |
|------|-----------|----------------------|
| `FitnessSession.js` | V1, V2, V3, V5 | Retire legacy roster, expose canonical method |
| `ParticipantRoster.js` | V1, V2, V3, V4, V5 | Become SSOT for participant list |
| `GovernanceEngine.js` | V1, V2, V4, V5 | Stop rebuilding, consume from session |
| `participantDisplayMap.js` | V5, V6 | Consume from canonical method |
| `useGovernanceDisplay.js` | V6 | Remove roster fallback after P3 |
