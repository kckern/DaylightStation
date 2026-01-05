# Postmortem: Governance Detection Failure After EntityId Migration

**Date:** 2026-01-03
**Duration:** ~3 hours of debugging
**Severity:** High (Complete governance system failure)
**Status:** Resolved

---

## Executive Summary

The introduction of entityId-based tracking in the fitness system caused a **complete failure of the governance detection system**. The video lock overlay showed "Waiting for participants" despite 5 active users with heart rate data visible in the sidebar. The root cause was a **fundamental architectural inconsistency**: different parts of the codebase used different identifier schemes (names, userIds, entityIds) as dictionary keys, with no unified contract.

---

## Timeline

### Before EntityId Migration (Working State)
- **Identifier scheme:** Participant names (e.g., "Alan", "Felix")
- **activeParticipants:** `["Alan", "Felix", "Soren", ...]`
- **userZoneMap:** `{"Alan": "fire", "Felix": "warm", ...}`
- **Governance lookup:** Normalized names to lowercase for matching
- **Status:** ✅ Working

### EntityId Migration (Breaking Change)
- **Goal:** Track participants by entityId for guest reassignment continuity
- **Change:** `activeParticipants.map(entry => entry.entityId || entry.profileId || entry.id)`
- **Impact:** activeParticipants changed from names to IDs, but userZoneMap still keyed by names
- **Result:** ❌ Governance broken

### Attempted Fix #1: Revert to Names
- **Change:** Reverted to `entry.name` for backwards compatibility
- **Issue:** Case mismatch - userZoneMap keys were "Alan" but GovernanceEngine normalized to "alan"
- **Result:** ❌ Still broken (0 users matched)

### Attempted Fix #2: Lowercase Names
- **Change:** `userZoneMap[entry.name.toLowerCase()]`
- **Issue:** Addressed symptom, not root cause
- **User feedback:** "Don't lowercase. Use userId/entityId!"
- **Result:** ❌ Wrong approach

### Final Fix: Consistent userId Usage
- **Change:** Both activeParticipants and userZoneMap use `entry.id || entry.profileId`
- **Result:** ✅ **Governance working**

---

## Root Cause Analysis

### Primary Cause: Inconsistent Identifier Schemes

The codebase had **three different identifier schemes** used interchangeably:

1. **Names** (`"Alan"`, `"Felix"`) - Human-readable, case-sensitive
2. **UserIds** (`"kckern"`, `"felix"`) - Stable, lowercase
3. **EntityIds** (`"entity-1735689600000-abc"`) - Session-specific, for guest tracking

**No single source of truth** defined which identifier type should be used where.

### Contributing Factors

#### 1. **Implicit Contracts, Not Explicit Interfaces**

```javascript
// FitnessSession.js - What does this expect?
this.governanceEngine.evaluate({
  activeParticipants,  // Names? UserIds? EntityIds? 🤷
  userZoneMap          // Keyed by what? 🤷
});
```

**Problem:** No type definitions or documentation specified the expected identifier format.

#### 2. **Silent Failures via Normalization**

```javascript
// GovernanceEngine.js
const key = normalizeName(name);  // Assumes "name" is a participant name
const participantZoneId = userZoneMap[key];  // Silently returns undefined if key doesn't exist
```

**Problem:** No error thrown when lookup fails. `participantZoneId` becomes `undefined`, `participantRank` becomes `0`, user appears to not meet requirements.

#### 3. **Case Sensitivity Brittleness**

Mixing case-sensitive names with normalization created fragile matching:
- Input: `"Alan"` (capitalized name from roster)
- Normalized: `"alan"` (lowercased for lookup)
- Map key: `"Alan"` (original capitalization)
- Result: **Lookup fails silently**

#### 4. **Tight Coupling to Implementation Details**

GovernanceEngine assumed:
- activeParticipants are participant **names** (implementation detail)
- Names can be normalized (case-insensitive matching)

When FitnessSession changed to use IDs, GovernanceEngine broke because it was coupled to the old implementation.

---

## What Broke and Why

### 1. **updateSnapshot() Hangs**

```javascript
this.zoneProfileStore?.syncFromUsers(allUsers);
```

**Symptom:** updateSnapshot never completed, governance.evaluate() never called
**Root cause:** syncFromUsers() had an infinite loop or expensive operation
**Fix:** Commented out (band-aid solution - **still needs proper fix**)

### 2. **Zero Users Matched Despite Being Active**

**Symptom:**
```json
{
  "actualCount": 0,
  "missingUsers": ["Alan", "Milo", "Felix", "Soren", "KC Kern"],
  "satisfied": false
}
```

**Root cause:** Identifier mismatch
- activeParticipants: `["Alan", "Milo", ...]` (names, capitalized)
- GovernanceEngine lookup: `normalizeName("Alan")` → `"alan"`
- userZoneMap keys: `"Alan"` (capitalized)
- Result: `userZoneMap["alan"]` → `undefined`

**Fix:** Use consistent userId throughout

### 3. **Case Sensitivity Fragility**

**Design flaw:** Using human-readable names as dictionary keys
- Names can be capitalized differently across the codebase
- Requires normalization, which is error-prone
- IDs are naturally lowercase and stable

---

## Architectural Defects

### 1. **No Unified Participant Identifier Contract** ⚠️ CRITICAL

**Current state:** Different subsystems use different identifiers
- FitnessSession: names, userIds, entityIds (inconsistent)
- TreasureBox: userIds (`"kckern"`, `"milo"`)
- GovernanceEngine: expected names, got IDs
- ParticipantRoster: has all three (name, id, entityId)

**Design defect:** No explicit contract defining "What is a participant identifier?"

**Recommendation:**
```typescript
// Define explicit type
type ParticipantId = string;  // userId (e.g., "kckern")

// Document in code
interface GovernanceInput {
  activeParticipants: ParticipantId[];  // Array of userIds
  userZoneMap: Record<ParticipantId, ZoneId>;  // Keyed by userId
}
```

### 2. **Silent Failures in Lookup Operations** ⚠️ HIGH

**Pattern:**
```javascript
const participantZoneId = userZoneMap[key];  // undefined if key doesn't exist
const participantRank = zoneRankMap[participantZoneId] || 0;  // Defaults to 0
```

**Problem:** Missing keys fail silently, causing incorrect behavior instead of errors

**Recommendation:**
```javascript
const participantZoneId = userZoneMap[key];
if (!participantZoneId) {
  getLogger().error('participant.zone.not_found', { key, availableKeys: Object.keys(userZoneMap) });
  return 0;  // Explicit fallback
}
```

### 3. **Using Names as Dictionary Keys** ⚠️ MEDIUM

**Current pattern:**
```javascript
userZoneMap["Alan"] = "fire";  // Case-sensitive, fragile
```

**Problems:**
- Case sensitivity issues
- Names can change or have variants
- Requires normalization
- Not unique (multiple people can have same name)

**Recommendation:** **Always use stable IDs (userId)**
```javascript
userZoneMap["kckern"] = "fire";  // Stable, lowercase, unique
```

### 4. **Lack of Data Flow Documentation** ⚠️ MEDIUM

**Current state:** Unclear how participant data flows through the system

**Actual flow (discovered through debugging):**
```
DeviceManager → ParticipantRoster → FitnessSession.roster → updateSnapshot() →
  buildActiveParticipants() → GovernanceEngine.evaluate()
```

**Problem:** No documentation, had to trace through code to understand flow

**Recommendation:** Create architecture diagram and data flow documentation

### 5. **Blocking Operations in updateSnapshot()** ⚠️ HIGH

**Issue:** `syncFromUsers()` blocks the main thread, preventing governance evaluation

**Problem:** updateSnapshot() does too much:
- Process users
- Process devices
- Sync zone profiles ← **BLOCKS HERE**
- Update timeline
- Evaluate governance

**Recommendation:**
- Make syncFromUsers() non-blocking (async or use requestIdleCallback)
- OR extract governance evaluation to independent timer (already implemented)

### 6. **GovernanceEngine Assumed Data Format** ⚠️ HIGH

**Problem:** GovernanceEngine expected names, used `normalizeName()` function

**Issue:** Function name implies it works on participant names specifically, not generic identifiers

**Recommendation:**
```javascript
// Before: Assumes names
const key = normalizeName(name);

// After: Generic identifier handling
const key = normalizeId(participantId);  // Just ensures lowercase
```

### 7. **No Type Safety** ⚠️ MEDIUM

**Current state:** No TypeScript, no JSDoc types, no runtime validation

**Impact:** Breaking changes (like entityId migration) have no compile-time checks

**Recommendation:** Add JSDoc types at minimum:
```javascript
/**
 * @param {Object} params
 * @param {string[]} params.activeParticipants - Array of userIds
 * @param {Record<string, string>} params.userZoneMap - Map userId -> zoneId
 */
evaluate({ activeParticipants, userZoneMap }) {
  // ...
}
```

---

## Lessons Learned

### 1. **Stable Identifiers Over Human-Readable Names**

✅ **Use:** userId (stable, unique, lowercase)
❌ **Avoid:** Participant names (case-sensitive, not unique)

### 2. **Explicit Contracts Prevent Cascading Failures**

When changing identifier schemes, explicit interfaces would have caught the mismatch immediately:
```typescript
interface ParticipantData {
  id: UserId;           // Required
  name: string;         // Display only
  entityId?: EntityId;  // Optional
}
```

### 3. **Fail Loudly, Not Silently**

Silent failures (undefined lookups) caused incorrect behavior instead of errors. Better to log warnings when lookups fail.

### 4. **Normalization Should Be Intentional, Not Implicit**

Don't normalize unless necessary. If identifiers are already consistent (lowercase userIds), don't add normalization that can fail.

### 5. **Document Data Flow**

Lack of documentation made debugging extremely difficult. A simple diagram would have saved hours.

### 6. **Test Cross-Module Integrations**

Unit tests might have passed, but integration tests would have caught the identifier mismatch between FitnessSession and GovernanceEngine.

---

## Still-Pending Issues

### 1. **syncFromUsers() Blocking Issue** 🔴 CRITICAL

**Status:** Band-aided by commenting out the call
**Proper fix needed:** Investigate why syncFromUsers() hangs and make it non-blocking

```javascript
// DISABLED: This hangs - skip it for now
// this.zoneProfileStore?.syncFromUsers(allUsers);
```

**Recommendation:**
- Debug syncFromUsers() to find the infinite loop
- Make it async or throttled
- Add timeout protection

### 2. **Missing Current/Target Columns in Governance UI** 🟡 MEDIUM

**Symptom:** User reported "I don't see the current and target columns"
**Status:** Not investigated yet
**Location:** Governance overlay UI component

**Recommendation:** Check FitnessGovernance overlay rendering logic

### 3. **Inconsistent Identifier Usage Across Codebase** 🟡 MEDIUM

**Current state:** Some places still use names, others use IDs

**Recommendation:** Audit entire codebase for identifier usage:
```bash
# Find all places using .name as dict key
grep -r "\.name\]" frontend/src/hooks/fitness/
grep -r "\.name}" frontend/src/hooks/fitness/
```

Replace with userId-based keys

### 4. **No Participant Identifier Type Definition** 🟡 MEDIUM

**Recommendation:** Define explicit type in types.js:
```javascript
/**
 * Participant Identifier
 * @typedef {string} ParticipantId
 * @description Stable user identifier (userId, lowercase). NOT display name.
 * @example "kckern", "felix", "milo"
 */

/**
 * Zone Identifier
 * @typedef {string} ZoneId
 * @description Heart rate zone ID (lowercase)
 * @example "cool", "active", "warm", "hot", "fire"
 */
```

### 5. **EntityId Migration Incomplete** 🟢 LOW

**Status:** EntityId infrastructure exists but not fully utilized

**Original goal:** Track guest participants across device reassignments
**Current state:** Using userId fallback everywhere

**Recommendation:**
- Document when to use entityId vs userId
- Complete the migration OR remove entityId code if not needed

---

## Recommendations

### Immediate (Next Sprint)

1. ✅ **Fix syncFromUsers() blocking issue**
2. ✅ **Add JSDoc types to GovernanceEngine.evaluate()**
3. ✅ **Document participant identifier contract**
4. ✅ **Fix missing current/target columns in UI**

### Short-term (Next Month)

1. **Audit identifier usage across codebase**
   - Replace name-based keys with userId-based keys
   - Add logging for failed lookups
2. **Add integration tests for governance**
   - Test: Active users → governance passes
   - Test: Inactive users → governance blocks
   - Test: Mixed zones → correct evaluation
3. **Create architecture documentation**
   - Data flow diagram
   - Identifier scheme documentation
   - Component responsibilities

### Long-term (Next Quarter)

1. **Migrate to TypeScript** (or at minimum, comprehensive JSDoc)
2. **Establish coding standards**
   - Always use userId as dictionary keys
   - Never use display names as identifiers
   - Document function parameter expectations
3. **Refactor GovernanceEngine**
   - Decouple from FitnessSession
   - Make self-contained with clear interface
   - Add comprehensive unit tests

---

## Conclusion

The entityId migration exposed a **fundamental design flaw**: the lack of a unified participant identifier scheme. Different subsystems used different identifier types (names, userIds, entityIds) without explicit contracts, causing cascading failures when one subsystem changed.

The fix was simple—use userId consistently—but finding it took hours due to:
- Silent lookup failures
- No type safety
- Lack of documentation
- Implicit assumptions about data formats

**Key takeaway:** In a dynamically-typed language without explicit interfaces, **documentation and consistent conventions are critical**. The cost of this outage (3 hours debugging) far exceeds the time it would have taken to document the identifier contract upfront.

---

## Appendix: Code Changes

### Final Fix

```javascript
// FitnessSession.js - Build governance inputs
const activeParticipants = effectiveRoster
    .filter((entry) => entry.isActive !== false && (entry.id || entry.profileId))
    .map(entry => entry.id || entry.profileId);  // ← Use userId, not name

const userZoneMap = {};
effectiveRoster.forEach(entry => {
    const userId = entry.id || entry.profileId;  // ← Use userId as key
    if (userId) {
        userZoneMap[userId] = entry.zoneId || null;
    }
});

this.governanceEngine.evaluate({
    activeParticipants,  // ["kckern", "felix", "milo", ...]
    userZoneMap,         // {"kckern": "fire", "felix": "warm", ...}
    zoneRankMap,
    zoneInfoMap,
    totalCount: activeParticipants.length
});
```

### Temporary Workaround (Needs Proper Fix)

```javascript
// DISABLED: This hangs - skip it for now
// this.zoneProfileStore?.syncFromUsers(allUsers);
```

---

**Document owner:** Claude Code (Sonnet 4.5)
**Review date:** 2026-01-03
**Next review:** After implementing recommendations
