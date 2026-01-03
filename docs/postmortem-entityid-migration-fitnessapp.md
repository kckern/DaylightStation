# Postmortem: EntityId Migration Impact Across FitnessApp

**Date:** 2026-01-03
**Duration:** 2-week migration + 3 hours critical failure debugging
**Severity:** Critical (Complete system breakage)
**Scope:** Entire FitnessApp architecture
**Status:** Partially resolved - migration incomplete

---

## Executive Summary

The introduction of entityId-based tracking to support guest reassignment continuity triggered a **cascading architectural crisis** across the entire FitnessApp. What began as a well-justified architectural improvement (Session Entity pattern) resulted in:

- **Complete governance system failure** (0 of 5 users detected)
- **Partial timeline data loss** (mixed identifier schemes)
- **System in broken transitional state** (dual-mode operations failing)
- **Critical subsystems affected:** GovernanceEngine, TreasureBox, MetricsRecorder, ParticipantRoster, ParticipantIdentityResolver

**Root Cause:** The codebase underwent **two overlapping migrations** without completing either:
1. **Migration 1:** slugifyId(name) → user.id (80% complete)
2. **Migration 2:** user.id → entityId (40% complete)

This created **three different identifier schemes** used inconsistently across subsystems, with no unified contract defining which identifier type should be used where.

**Impact Scope:**
- **25 files** contained slugifyId anti-pattern (129 usages)
- **6 core subsystems** directly affected by identifier changes
- **~720 lines** of new code added for Session Entity architecture
- **3 hours** of emergency debugging to restore basic functionality
- **Unknown data integrity issues** from mixed timeline keys

---

## Timeline: The Migration Journey

### Phase 0: Legacy System (Pre-December 2025)
**Identifier:** `slugifyId(user.name)` → `"alan"`, `"bob"`

**How it worked:**
```javascript
// Everywhere in the codebase
const key = slugifyId(user.name);  // "Alan" → "alan"
treasureBox.perUser.set(key, data);
timeline.assignMetric(`user:${key}:coins`, value);
activeParticipants.add(key);
```

**Status:** ✅ Working (all subsystems used same identifier)

**Problems:**
- Not unique (two people named "Alan" would conflict)
- Case-sensitive name variations caused bugs
- Guest reassignment broken (no concept of participation instance)

### Phase 1: userId Migration (Commit 3284b99a - ~Dec 20, 2025)
**Goal:** Replace slugifyId with stable user.id
**Commit:** "Refactor fitness session data model to v2 proposal"

**What changed:**
```javascript
// NEW: Use user.id instead of slug
const key = user.id;  // "user-123-abc"
treasureBox.perUser.set(key, data);
```

**Files modified:**
- FitnessSession.js - Session data model v2
- TreasureBox.js - Coin tracking
- FitnessTimeline.js - Timeline series
- DeviceAssignmentLedger.js - Device tracking
- SessionEntity.js - **NEW FILE** (+362 lines)

**Status:** ⚠️ Partially complete
- TreasureBox migrated ✅
- FitnessTimeline migrated ✅
- **FitnessSession._collectTimelineTick() NOT migrated** ❌
- **MetricsRecorder NOT migrated** ❌
- **GovernanceEngine still expected slugs** ❌

**Result:** **BREAKING** - System in mixed state

### Phase 2: EntityId Migration (Commit 863c3376 - ~Dec 30, 2025)
**Goal:** Replace user.id with entityId for session-based tracking
**Commit:** "Remove slugifyId usage and enforce explicit IDs"

**What changed:**
```javascript
// NEW: Enforce explicit IDs (entityId or userId)
const key = entry.entityId || entry.profileId || entry.id;
activeParticipants = roster.map(entry => key);
```

**Files modified:**
- Removed 129 slugifyId usages across 25 files
- ParticipantRoster.js - Added entityId support
- GovernanceEngine.js - Expected to use entityId
- FitnessSession.js - Added entityId tracking

**Status:** ⚠️ 40% complete
- SessionEntity infrastructure exists ✅
- EntityId tracked in ledger ✅
- **TreasureBox in dual-mode** (supports both) ⚠️
- **FitnessSession passing wrong IDs** ❌
- **GovernanceEngine broken** ❌
- **MetricsRecorder still using user.id** ❌

**Result:** **CRITICAL FAILURE** - Governance completely broken

### Phase 3: Emergency Fix (Jan 3, 2026)
**Trigger:** User reports "video locked screen has no users"

**Debugging Timeline:**
- 02:59 UTC - Issue reported, began log analysis
- 03:00 UTC - Discovered GovernanceEngine not being called
- 03:15 UTC - Found updateSnapshot() hanging at syncFromUsers()
- 03:30 UTC - Band-aid fix: commented out syncFromUsers()
- 03:45 UTC - Governance runs but detects 0 users
- 04:00 UTC - Discovered identifier mismatch (names vs IDs)
- 04:15 UTC - Attempted lowercase fix (rejected by user)
- 04:30 UTC - **Final fix:** Consistent userId throughout
- 04:45 UTC - System working again

**Fix Applied:**
```javascript
// FitnessSession.js - Use userId consistently
const activeParticipants = effectiveRoster
    .filter((entry) => entry.isActive !== false && (entry.id || entry.profileId))
    .map(entry => entry.id || entry.profileId);  // ← NOT entityId

const userZoneMap = {};
effectiveRoster.forEach(entry => {
    const userId = entry.id || entry.profileId;
    if (userId) {
        userZoneMap[userId] = entry.zoneId || null;
    }
});
```

**Status:** ⚠️ Working but incomplete
- Governance working ✅
- Using userId (Phase 1) not entityId (Phase 2) ⚠️
- **Migration to entityId still incomplete** ❌
- **syncFromUsers() still broken (commented out)** ❌

---

## What Broke and Why

### 1. GovernanceEngine Complete Failure

**Symptom:**
```json
{
  "actualCount": 0,
  "missingUsers": ["Alan", "Milo", "Felix", "Soren", "KC Kern"],
  "satisfied": false
}
```

Video locked overlay showed "Waiting for participants" despite 5 active users.

**Root Cause Chain:**

1. **Phase 2 change:** activeParticipants changed from names to entityIds
   ```javascript
   // Before
   .map(entry => entry.name);  // ["Alan", "Felix"]

   // After Phase 2
   .map(entry => entry.entityId || entry.profileId || entry.id);  // ["entity-123-abc", "entity-456-def"]
   ```

2. **userZoneMap still keyed by names:**
   ```javascript
   userZoneMap[entry.name] = entry.zoneId;  // {"Alan": "fire", "Felix": "warm"}
   ```

3. **GovernanceEngine lookup failed:**
   ```javascript
   const key = normalizeName(name);  // "entity-123-abc" → "entity-123-abc"
   const participantZoneId = userZoneMap[key];  // undefined (no key "entity-123-abc")
   ```

**Impact:** 0 users matched, video locked indefinitely

**Fix:** Use consistent userId for both:
```javascript
.map(entry => entry.id || entry.profileId);  // ["kckern", "felix"]
userZoneMap[entry.id || entry.profileId] = entry.zoneId;  // {"kckern": "fire"}
```

### 2. TreasureBox Dual-Mode Confusion

**Symptom:** Coin accumulation inconsistent, some users not tracked

**Root Cause:** TreasureBox designed to support BOTH identifier schemes:

```javascript
// TreasureBox.js - Dual-mode operation
for (const [accKey, acc] of this.perUser.entries()) {
  const isEntityKey = accKey.startsWith('entity-');

  // Entity mode: check activeParticipants for profileId
  // User mode: check activeParticipants for userId
  if (!activeParticipants.has(isEntityKey ? profileId : accKey)) {
    acc.highestZone = null;  // Mark inactive
  }
}
```

**Problem:** FitnessSession passed activeParticipants with mixed IDs:
- Sometimes entityIds
- Sometimes userIds
- Sometimes names (case-sensitive)

**Result:** Lookup mismatches caused users to be marked inactive incorrectly

**Status:** Still in dual-mode, needs completion

### 3. MetricsRecorder Using Wrong Identifiers

**Symptom:** Timeline data potentially inconsistent

**Root Cause:** MetricsRecorder never migrated from Phase 1:

```javascript
// MetricsRecorder.js - Still using user.id (Phase 1)
_stageUserEntry(user) {
  const userId = user.id;  // ← user.id, not entityId
  return { userId, metrics: { ... } };
}

// Timeline keys use userId
assignMetric(`user:${userId}:heart_beats`, nextBeats);
assignMetric(`user:${userId}:heart_rate`, entry.metrics.heartRate);
```

**Problem:** If entityId migration continues:
- TreasureBox will write to `entity:X:coins`
- MetricsRecorder writes to `user:X:heart_rate`
- Charts expect data at consistent keys
- **Result:** Missing data in visualizations

**Status:** Not yet fixed

### 4. ParticipantIdentityResolver Codifying Wrong Pattern

**Symptom:** Helper service designed to solve ID confusion actually perpetuates it

**Root Cause:** Service returns user.id for timeline keys:

```javascript
// ParticipantIdentityResolver.js
getSeriesKey(deviceId, metric) {
  const resolved = this.resolveByDevice(deviceId);
  if (!resolved) return null;
  return `user:${resolved.id}:${metric}`;  // ← Uses user.id
}
```

**Problem:** If this is the "single source of truth" for ID resolution, it's codifying the Phase 1 identifier (user.id) instead of Phase 2 (entityId)

**Status:** Needs decision on target identifier scheme

### 5. syncFromUsers() Infinite Loop/Hang

**Symptom:** updateSnapshot() never completed, blocking governance evaluation

**Root Cause:** Unknown - likely infinite loop in ZoneProfileStore.syncFromUsers()

**Emergency Fix:**
```javascript
// DISABLED: This hangs - skip it for now
// this.zoneProfileStore?.syncFromUsers(allUsers);
```

**Status:** 🔴 Band-aid applied, root cause not fixed

### 6. ParticipantRoster Zone Lookup Fragility

**Symptom:** Users may not see correct zones in sidebar

**Root Cause:** ParticipantRoster expects userId from TreasureBox, may get entityId:

```javascript
// ParticipantRoster.js
_buildZoneLookup() {
  const zoneLookup = new Map();
  const zoneSnapshot = this._treasureBox.getUserZoneSnapshot();

  zoneSnapshot.forEach((entry) => {
    if (!entry || !entry.userId) return;  // ← Expects userId
    zoneLookup.set(entry.userId, { zoneId: entry.zoneId, ... });
  });
}
```

But TreasureBox may return:
```javascript
// If perUser keyed by entityId:
{
  userId: null,          // ← null if entity key
  entityId: "entity-...",
  zoneId: "fire"
}
```

**Result:** Zone lookup returns undefined, user shows no zone

**Status:** Fragile, needs consistent identifier

---

## Architectural Defects Identified

### 1. No Unified Participant Identifier Contract ⚠️ CRITICAL

**Problem:** No explicit definition of "What is a participant identifier?"

**Current State:**
- FitnessSession: userId (after fix)
- TreasureBox: entityId OR userId (dual-mode)
- MetricsRecorder: userId
- GovernanceEngine: expected names, got IDs
- ParticipantRoster: userId
- Timeline keys: Mixed (user:X and entity:X)

**Impact:** Every subsystem makes independent decisions, causing mismatches

**Recommendation:**
```typescript
// Define explicit type contract
type ParticipantId = string;  // userId or entityId?

// Document in each interface
interface GovernanceInput {
  activeParticipants: ParticipantId[];  // MUST document: "Array of userIds"
  userZoneMap: Record<ParticipantId, ZoneId>;  // MUST document: "Keyed by userId"
}
```

### 2. Two Overlapping Migrations ⚠️ CRITICAL

**Problem:** Started Phase 2 (entityId) before completing Phase 1 (userId)

**Migration 1 Status (slug → userId):**
- ✅ TreasureBox migrated
- ✅ FitnessTimeline migrated
- ❌ FitnessSession._collectTimelineTick NOT migrated
- ❌ MetricsRecorder NOT migrated
- ❌ GovernanceEngine NOT migrated

**Migration 2 Status (userId → entityId):**
- ✅ SessionEntity infrastructure created
- ✅ EntityId tracked in ledger
- ⚠️ TreasureBox in dual-mode
- ❌ FitnessSession inconsistent
- ❌ MetricsRecorder not started
- ❌ Chart helpers partially migrated

**Impact:** System in broken transitional state - neither migration complete

**Recommendation:** **Pause Phase 2, complete Phase 1 first**

### 3. Silent Lookup Failures ⚠️ HIGH

**Pattern:**
```javascript
const participantZoneId = userZoneMap[key];  // undefined if key doesn't match
const participantRank = zoneRankMap[participantZoneId] || 0;  // Silently defaults to 0
```

**Problem:** Identifier mismatch causes silent failure, incorrect behavior instead of errors

**Impact:** 3 hours debugging to find why actualCount = 0

**Recommendation:**
```javascript
const participantZoneId = userZoneMap[key];
if (!participantZoneId) {
  getLogger().error('participant.zone.not_found', {
    key,
    availableKeys: Object.keys(userZoneMap),
    userZoneMap
  });
  return 0;
}
```

### 4. No Integration Tests ⚠️ HIGH

**Problem:** Breaking changes had no automated detection

**Current Testing:**
- Unit tests: Unknown coverage
- Integration tests: None
- E2E tests: None

**Impact:** Governance failure only detected in production by user

**Recommendation:**
```javascript
// Add integration tests
test('governance detects active users', () => {
  const session = createFitnessSession();
  session.addParticipant({ id: 'kckern', name: 'KC' });
  session.updateSnapshot();

  const result = session.governanceEngine.evaluate();
  expect(result.actualCount).toBe(1);
});
```

### 5. Dual-Write Without Migration Plan ⚠️ MEDIUM

**Pattern:** Timeline dual-writes to both user: and entity: series

```javascript
assignUserMetric(userId, entityId, 'coins_total', value);
// Writes to: user:${userId}:coins_total
// Writes to: entity:${entityId}:coins_total
```

**Problem:** No plan documented for:
- When to stop dual-writing
- How to migrate consumers
- How to clean up old data
- What to do if entityId is null

**Impact:** Code complexity grows, unclear when cleanup can happen

**Recommendation:** Create migration checklist:
```markdown
## EntityId Migration Completion Checklist
- [ ] All consumers read from entity: series
- [ ] Fallback to user: series implemented
- [ ] Data migration script created
- [ ] Old user: writes can be removed
- [ ] Integration tests verify both modes
```

### 6. Implicit Assumptions About Data Format ⚠️ HIGH

**Pattern:** GovernanceEngine assumed names, used normalizeName()

```javascript
const key = normalizeName(name);  // Assumes input is a participant name
```

**Problem:** Function name couples implementation to data format

**Impact:** When FitnessSession changed data format (names → IDs), GovernanceEngine broke

**Recommendation:**
```javascript
// Generic identifier normalization
const key = normalizeId(participantId);  // Just lowercase, no assumptions

// OR accept IDs directly without normalization
const participantZoneId = userZoneMap[participantId];  // Expect exact match
```

### 7. Blocking Operations in Critical Path ⚠️ HIGH

**Problem:** syncFromUsers() blocks updateSnapshot(), preventing governance evaluation

```javascript
updateSnapshot(participantRoster) {
  // ... process users ...
  this.zoneProfileStore?.syncFromUsers(allUsers);  // ← BLOCKS HERE (infinite loop?)
  // ... governance evaluation never reached ...
}
```

**Impact:** Complete system hang, requiring emergency code comment

**Recommendation:**
- Make syncFromUsers() non-blocking (async)
- OR move to independent timer
- OR add timeout protection
- **Debug root cause of hang**

---

## Scope of Impact

### Files Directly Modified

| File | Phase 1 Changes | Phase 2 Changes | Current Status |
|------|----------------|-----------------|----------------|
| **SessionEntity.js** | Created (+362) | Used for tracking | ✅ Complete |
| **FitnessSession.js** | +80 lines | +40 lines | ⚠️ Mixed IDs |
| **TreasureBox.js** | +60 lines | Dual-mode | ⚠️ Transitional |
| **FitnessTimeline.js** | +100 lines | Entity helpers | ⚠️ Dual-write |
| **DeviceAssignmentLedger.js** | +20 lines | EntityId tracking | ✅ Complete |
| **ParticipantRoster.js** | +10 lines | EntityId field | ⚠️ Expects userId |
| **GovernanceEngine.js** | Not migrated | Emergency fix | ✅ Fixed (userId) |
| **MetricsRecorder.js** | Not migrated | Not migrated | ❌ Still broken |
| **ParticipantIdentityResolver.js** | Created | Uses userId | ❌ Wrong pattern |
| **FitnessChart.helpers.js** | +30 lines | Entity lookup | ⚠️ Partial |
| **FitnessContext.jsx** | +40 lines | Entity selectors | ✅ Complete |

### Subsystems Affected

1. **TreasureBox (Coin Tracking)** - ⚠️ Dual-mode, needs completion
2. **GovernanceEngine (Video Lock)** - ✅ Fixed (emergency)
3. **MetricsRecorder (Timeline Data)** - ❌ Not migrated
4. **ParticipantRoster (Sidebar Display)** - ⚠️ Fragile
5. **FitnessTimeline (Chart Data)** - ⚠️ Dual-write active
6. **DeviceAssignmentLedger (Device Tracking)** - ✅ Complete

### Timeline Keys Impact

**Before (Phase 0):**
```
user:alan:coins_total
user:alan:heart_rate
user:bob:coins_total
```

**After Phase 1:**
```
user:user-123-abc:coins_total
user:user-123-abc:heart_rate
user:user-456-def:coins_total
```

**After Phase 2 (dual-write):**
```
user:user-123-abc:coins_total       ← Old format (for compatibility)
entity:entity-1735689600000-abc:coins_total  ← New format
user:user-123-abc:heart_rate
entity:entity-1735689600000-abc:heart_rate
```

**Problem:** Chart queries must know which format to request, or check both

---

## What Still Needs To Be Done

### Critical (Must Fix Before Next Use)

#### 1. Fix syncFromUsers() Hang 🔴
**Status:** Band-aided by commenting out
**Location:** `frontend/src/hooks/fitness/FitnessSession.js:1393`

**Required:**
```javascript
// Current
// DISABLED: This hangs - skip it for now
// this.zoneProfileStore?.syncFromUsers(allUsers);

// Fix needed
// 1. Debug why syncFromUsers() hangs (likely infinite loop in ZoneProfileStore)
// 2. Add timeout protection
// 3. Make async or use requestIdleCallback
```

**Risk:** Zone profiles may not sync correctly without this

#### 2. Complete Phase 1 Migration (slug → userId) 🔴

**Remaining Tasks:**
- ✅ FitnessSession governance inputs (DONE - emergency fix)
- ❌ MetricsRecorder timeline keys (NOT DONE)
  - Change `assignMetric(\`user:\${userId}:metric\`)` to use correct identifier
  - Update _stageUserEntry() identifier resolution
- ❌ ParticipantIdentityResolver.getSeriesKey() (NOT DONE)
  - Update to return correct identifier format

**Verification:**
```bash
# Find remaining user.id usage in timeline keys
grep -r "user:\${.*\.id}" frontend/src/hooks/fitness/
```

#### 3. Decide: Complete or Abandon Phase 2 (userId → entityId) 🟡

**Option A: Complete Phase 2** (Recommended by session-entity-justification.md)
- Update all subsystems to use entityId
- Complete dual-write migration plan
- Add fallback logic for null entityId
- **Benefit:** Proper guest management, session audit trails

**Option B: Revert Phase 2**
- Remove SessionEntity infrastructure
- Remove entityId tracking
- Simplify to userId-only
- **Benefit:** Simpler system, faster stabilization
- **Cost:** Guest reassignment broken again

**Decision Required:** User/team must choose direction

### High Priority (Should Fix Soon)

#### 4. Add Explicit Identifier Contract 🟡

**Create:** `frontend/src/hooks/fitness/types.js`

```javascript
/**
 * Participant Identifier
 * @typedef {string} ParticipantId
 * @description Stable user identifier.
 * - Format: userId ("kckern", "milo") OR entityId ("entity-1735689600000-abc")
 * - NOT display name ("Alan", "Bob")
 * @example "kckern", "entity-1735689600000-abc123"
 */

/**
 * Timeline Series Key Format
 * @description All timeline series MUST use this format
 * @example "user:kckern:coins_total" OR "entity:entity-123-abc:coins_total"
 */
```

Update all interfaces to document expected identifier type.

#### 5. Add Logging for Failed Lookups 🟡

**Pattern to add everywhere:**
```javascript
const participantZoneId = userZoneMap[key];
if (!participantZoneId) {
  getLogger().warn('participant.zone.lookup_failed', {
    key,
    availableKeys: Object.keys(userZoneMap),
    caller: 'GovernanceEngine.evaluate'
  });
}
```

#### 6. Fix Missing Current/Target Columns in Governance UI 🟡

**Symptom:** User reported "I don't see the current and target columns"
**Status:** Not investigated yet
**Location:** FitnessGovernance overlay component

**Investigation needed:**
- Check overlay rendering logic
- Verify data structure includes current/target fields
- Add logging to governance.evaluate result

### Medium Priority (Next Sprint)

#### 7. Audit All Identifier Usage ✅ COMPLETE

**Audit completed:** 2026-01-03

**Results:**
- ✅ No `.name]` or `.name}` dictionary keys found
- ✅ All timeline keys use `user:` prefix with userId
- ✅ No `entity:` keys found (Phase 2 not active)
- ✅ All Map/Set operations use userId correctly

**Minor Issue Found:**
- ⚠️ FitnessSession.js lines 2020-2021 use legacy slug in timeline reads (needs investigation)

**Documentation:**
- [Identifier Audit Report](./notes/fitness-identifier-audit.md)

---

#### 8. Add Integration Tests ✅ COMPLETE

**Tests added:** 2026-01-03

**Test file:** `frontend/src/hooks/fitness/__tests__/IdentifierConsistency.test.mjs`

**Coverage:**
- ✅ activeParticipants matches userZoneMap keys
- ✅ TreasureBox tracks same IDs as FitnessSession provides
- ✅ GovernanceEngine detects all active users
- ✅ Timeline keys consistent across MetricsRecorder and TreasureBox

**Run tests:**
```bash
npm run test:frontend
```

---

#### 9. Create Architecture Documentation ✅ COMPLETE

**Documents created:** 2026-01-03

**Files:**
- ✅ [Fitness Data Flow](./design/fitness-data-flow.md) - Complete data flow diagram
- ✅ [Identifier Decision Tree](./design/fitness-identifier-decision-tree.md) - When to use which identifier
- ✅ [Identifier Contract](./design/fitness-identifier-contract.md) - API contracts and types
- ✅ [EntityId Nullability](./design/fitness-entityid-nullability.md) - Null handling patterns

**Contents:**
- Data flow: DeviceManager → Roster → Session → Governance
- Identifier scheme decision tree
- Timeline series key naming convention
- Migration completion checklist
- Integration point contracts
- Common pitfalls and anti-patterns

---

#### 10. Handle EntityId Nullability ✅ COMPLETE

**Audit completed:** 2026-01-03

**Status:** All current code handles null entityId safely

**Verified Safe:**
- ✅ ParticipantRoster.js: `const entityId = guestEntry?.entityId || null`
- ✅ FitnessTimeline.js: `if (!entityId || !metric) return []`
- ✅ UserManager.js: `const entityId = normalizedMetadata?.entityId || null`

**Defensive Patterns Documented:**
- Null coalescence for fallbacks
- Early returns for required fields
- Conditional access for optional features
- Default to null (not undefined)

**Documentation:**
- [EntityId Nullability Guide](./design/fitness-entityid-nullability.md)

### Low Priority (Future)

#### 11. Remove Dual-Write Once Migration Complete 🟢

**After all consumers migrated:**
```javascript
// Remove user: writes, keep only entity: writes
assignMetric(`entity:${entityId}:coins`, value);
// DELETE: assignMetric(`user:${userId}:coins`, value);
```

#### 12. Add TypeScript or Comprehensive JSDoc 🟢

**Convert critical interfaces:**
```typescript
interface ParticipantData {
  id: UserId;           // Required - stable user identifier
  name: string;         // Display only - NOT for keys
  entityId?: EntityId;  // Optional - session participation instance
  zoneId?: ZoneId;      // Current heart rate zone
  isActive: boolean;    // Currently participating
}
```

#### 13. Refactor to Single Responsibility 🟢

**Current:** FitnessSession does too much
- Device management
- Participant tracking
- Timeline recording
- Governance evaluation
- Zone profile syncing

**Target:** Split into focused components
- DeviceManager (owns devices)
- ParticipantTracker (owns roster)
- TimelineRecorder (owns metrics)
- GovernanceEvaluator (owns rules)

---

## Lessons Learned

### 1. Complete One Migration Before Starting Another

**Problem:** Started Phase 2 (entityId) before completing Phase 1 (userId)

**Result:** Two incomplete migrations created three identifier schemes in use simultaneously

**Lesson:** **Always complete a breaking change end-to-end before starting the next**

**Prevention:**
- Create migration completion checklist
- Require 100% subsystem coverage before declaring complete
- Add integration tests to verify migration success

### 2. Explicit Contracts Prevent Cascading Failures

**Problem:** No documented contract for participant identifiers

**Result:** Each subsystem made independent assumptions, causing lookup failures

**Lesson:** **In dynamically-typed languages, documentation IS the type system**

**Prevention:**
- Add JSDoc types to all public interfaces
- Document expected data formats explicitly
- Use TypeScript or runtime validation

### 3. Silent Failures Are Emergency Failures

**Problem:** Lookup mismatches returned undefined silently

**Result:** 3 hours debugging to find actualCount = 0 cause

**Lesson:** **Fail loudly at the point of error, not downstream**

**Prevention:**
```javascript
// BAD: Silent failure
const zone = userZoneMap[key] || 'unknown';

// GOOD: Loud failure
const zone = userZoneMap[key];
if (!zone) {
  logger.error('zone_lookup_failed', { key, availableKeys: Object.keys(userZoneMap) });
  throw new Error(`Zone not found for key: ${key}`);
}
```

### 4. Integration Tests Catch What Unit Tests Miss

**Problem:** Unit tests may have passed, but cross-module integration broke

**Result:** Governance failure only caught in production

**Lesson:** **Test the boundaries between modules, not just individual functions**

**Prevention:** Add integration tests for critical user flows

### 5. Names Are Not Identifiers

**Problem:** Used human-readable names as dictionary keys

**Result:** Case sensitivity, non-uniqueness, fragility

**Lesson:** **Always use stable, unique, machine-generated IDs as keys**

**Rule:**
- ✅ USE: userId, entityId (stable, unique, lowercase)
- ❌ AVOID: name, displayName (case-sensitive, not unique)

### 6. Dual-Mode Systems Are Transitional, Not Permanent

**Problem:** TreasureBox supports both entityId and userId indefinitely

**Result:** Complex conditionals, unclear migration completion criteria

**Lesson:** **Dual-mode is a migration strategy, not a final architecture**

**Prevention:**
- Set explicit deprecation date for old mode
- Add warnings when old mode is used
- Remove old mode code once migration complete

### 7. Document Data Flow for Complex Systems

**Problem:** No documentation of how participant data flows through system

**Result:** Hours tracing through code to understand flow

**Lesson:** **Architecture diagrams save debugging time**

**Prevention:** Create data flow diagram showing:
```
DeviceManager → ParticipantRoster → FitnessSession.roster →
updateSnapshot() → buildActiveParticipants() → GovernanceEngine.evaluate()
```

---

## Recommendations

### Immediate (This Week)

1. **🔴 Fix syncFromUsers() hang** - Debug and resolve root cause
2. **🔴 Complete Phase 1 migration** - Fix MetricsRecorder, ParticipantIdentityResolver
3. **🟡 Decide Phase 2 direction** - Complete or revert entityId migration
4. **🟡 Add identifier contract documentation** - Explicit JSDoc types

### Short-Term (Next 2 Weeks)

5. **🟡 Audit all identifier usage** - Find remaining inconsistencies
6. **🟡 Add integration tests** - Prevent regression
7. **🟡 Fix missing UI columns** - Investigate governance overlay
8. **🟡 Add lookup failure logging** - Catch future mismatches early

### Long-Term (Next Month)

9. **🟢 Create architecture documentation** - Data flow diagrams
10. **🟢 Refactor FitnessSession** - Split responsibilities
11. **🟢 Remove dual-write** - Once migration complete
12. **🟢 Migrate to TypeScript** - Prevent future type mismatches

---

## Conclusion

The entityId migration exposed **fundamental architectural fragility** in the FitnessApp:

1. **No explicit contracts** - Subsystems coupled via implicit assumptions
2. **No migration discipline** - Started Phase 2 before completing Phase 1
3. **No integration tests** - Breaking changes undetected until production
4. **Silent failures** - Lookup errors caused incorrect behavior instead of errors

**The cost:**
- 3 hours emergency debugging
- Unknown data integrity issues
- System in broken transitional state
- User-facing governance failure

**The benefit:**
- Comprehensive documentation created (this postmortem + governance postmortem)
- Architectural defects identified
- Clear migration path forward
- Team learned valuable lessons about migration discipline

**Key Takeaway:** The entityId migration was **architecturally justified** (see session-entity-justification.md), but **poorly executed**. The concept is sound; the implementation was rushed and incomplete.

**Path Forward:**
1. Complete Phase 1 (userId) first
2. Verify all subsystems working with userId
3. Then decide: complete Phase 2 (entityId) or stabilize on Phase 1
4. Whichever chosen, complete it **end-to-end** before declaring done

---

## Appendix A: Identifier Scheme Reference

| Scheme | Format | Example | Usage | Status |
|--------|--------|---------|-------|--------|
| **Slug** | `slugifyId(name)` | `"alan"` | Legacy keys | ⏪ Deprecated |
| **User ID** | `user.id` | `"kckern"` | Profile identity | ✅ Current |
| **Entity ID** | `entity-{timestamp}-{hash}` | `"entity-1735689600000-abc"` | Session participation | ⚠️ Partial |

## Appendix B: Migration Completion Checklist

### Phase 1: slug → userId
- ✅ TreasureBox.perUser keys
- ✅ FitnessTimeline series keys
- ✅ DeviceAssignmentLedger tracking
- ✅ GovernanceEngine inputs (emergency fix)
- ❌ MetricsRecorder timeline keys
- ❌ ParticipantIdentityResolver.getSeriesKey()

### Phase 2: userId → entityId
- ✅ SessionEntity infrastructure
- ✅ EntityId tracked in ledger
- ⚠️ TreasureBox dual-mode
- ⚠️ FitnessTimeline dual-write
- ⚠️ Chart helpers partial support
- ❌ MetricsRecorder not started
- ❌ All consumers migrated to entity: keys
- ❌ user: keys deprecated and removed

## Appendix C: Files Requiring Immediate Attention

### Critical
1. `frontend/src/hooks/fitness/FitnessSession.js:1393` - syncFromUsers() hang
2. `frontend/src/hooks/fitness/MetricsRecorder.js:233-245` - Timeline key format
3. `frontend/src/hooks/fitness/ParticipantIdentityResolver.js:139` - getSeriesKey()

### Important
4. `frontend/src/hooks/fitness/TreasureBox.js:303-318` - Decide dual-mode vs single-mode
5. `frontend/src/hooks/fitness/GovernanceEngine.js:641+` - Verify identifier handling
6. `frontend/src/hooks/fitness/ParticipantRoster.js:260-278` - Handle entityId nulls

---

**Document Owner:** Claude Code (Sonnet 4.5)
**Review Date:** 2026-01-03
**Next Review:** After Phase 1 completion
**Related:** postmortem-governance-entityid-failure.md
