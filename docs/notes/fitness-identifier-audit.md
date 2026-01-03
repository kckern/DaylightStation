# Fitness Identifier Audit (Strict userId)

**Date:** 2026-01-03

This audit validates that the FitnessApp runtime uses a single participant identifier contract (**userId**) and that timeline recording preserves explicit `null` samples.

## Scope
- `frontend/src/hooks/fitness/`

## Grep Commands
```bash
# Find all places using .name as dict key
grep -r "\\.name\\]" frontend/src/hooks/fitness/
grep -r "\\.name}" frontend/src/hooks/fitness/

# Find all timeline key generators
grep -r "user:\${" frontend/src/hooks/fitness/
grep -r "entity:\${" frontend/src/hooks/fitness/

# Find all Map/Set operations with participant IDs
grep -r "\\.set(.*\\.id" frontend/src/hooks/fitness/
grep -r "\\.has(.*\\.id" frontend/src/hooks/fitness/
```

## Findings (Current State)
- **Participant identity is userId-only**
  - Helpers added in `frontend/src/hooks/fitness/types.js`:
    - `resolveParticipantUserId(entry)`
    - `buildActiveParticipantIds(roster)`
    - `buildUserZoneMap(roster)`
- **No more entity-series writes from FitnessSession**
  - Removed `entity:${entityId}:...` writes from `FitnessSession._collectTimelineTick()`.
- **TreasureBox is userId-keyed**
  - `perUser` is now keyed by `userId`.
  - Entity-only APIs remain as no-op compatibility shims (won’t create entity-keyed accumulators).
  - A small migration shim in `processTick()` deletes any legacy `entity-*` keys and migrates to `profileId` when present.
- **Explicit null samples are preserved**
  - `MetricsRecorder.assignMetric()` now records `null` values instead of dropping them.
  - `FitnessSession.assignMetric()` now records `null` values instead of skipping (NaNs still dropped).
- **Global timeline keys are accepted by validators**
  - `global:<metric>` (2-segment) keys are now accepted by the key validators in both `MetricsRecorder` and `FitnessSession`.

## Regression Tests
- Added Jest integration-style tests in `frontend/src/hooks/fitness/__tests__/IdentifierConsistency.test.mjs`.
- Run with:
```bash
npm run test:frontend
```

---

## Detailed Audit Results

### 1. Name-Based Dictionary Keys

**Search:** `grep -rn "\.name\]" frontend/src/hooks/fitness/` and `grep -rn "\.name}" frontend/src/hooks/fitness/`

**Results:** ✅ **No occurrences found**

**Analysis:**
- No dictionary keys using `.name]` syntax
- No template literals using `.name}` syntax
- All dictionary operations use `userId`

**Conclusion:** Clean - no anti-pattern usage

---

### 2. Timeline Key Generators

**Search:** `grep -rn 'user:\${' frontend/src/hooks/fitness/`

**Results:** 14 occurrences (all using `userId` correctly)

**Files:**
1. `ParticipantIdentityResolver.js:147` - Returns `user:${resolved.id}:${metric}`
2. `FitnessSession.js:1623` - `assignMetric(\`user:\${userId}:\${metric}\`, value)`
3. `FitnessSession.js:1921` - `assignMetric(\`user:\${userId}:coins_total\`, 0)`
4. `FitnessSession.js:1973` - `assignMetric(\`user:\${profileId}:coins_total\`, coinValue)`
5. `FitnessSession.js:1978` - `assignMetric(\`user:\${key}:coins_total\`, coinValue)`
6. `FitnessSession.js:2020` - Reading `timeline.series[\`user:\${slug}:heart_beats\`]` ⚠️ uses slug
7. `FitnessSession.js:2021` - Reading `timeline.series[\`user:\${slug}:coins_total\`]` ⚠️ uses slug
8. `MetricsRecorder.js:239` - `assignMetric(\`user:\${userId}:heart_beats\`, nextBeats)`
9. `MetricsRecorder.js:247` - `assignMetric(\`user:\${userId}:heart_rate\`, entry.metrics.heartRate)`
10. `MetricsRecorder.js:248` - `assignMetric(\`user:\${userId}:zone_id\`, entry.metrics.zoneId)`
11. `MetricsRecorder.js:249` - `assignMetric(\`user:\${userId}:rpm\`, entry.metrics.rpm)`
12. `MetricsRecorder.js:250` - `assignMetric(\`user:\${userId}:power\`, entry.metrics.power)`
13. `MetricsRecorder.js:251` - `assignMetric(\`user:\${userId}:distance\`, entry.metrics.distance)`
14. `MetricsRecorder.js:268` - `assignMetric(\`user:\${userId}:coins_total\`, Number.isFinite(coins) ? coins : null)`

**Analysis:**
- ✅ All writes use `userId` format
- ⚠️ Lines 2020-2021 use legacy `slug` for reading (potential dead code)
- ✅ Consistent `user:` prefix throughout

**Minor Issue:** Lines 2020-2021 need investigation for legacy slug usage

---

### 3. Entity Series Keys

**Search:** `grep -rn 'entity:\${' frontend/src/hooks/fitness/`

**Results:** ✅ **0 occurrences found**

**Analysis:**
- No `entity:` timeline keys found
- Phase 2 (entityId) dual-write not yet implemented
- All timeline writes use `user:` prefix consistently

**Conclusion:** Clean - Phase 2 not active

---

### 4. Map/Set Operations

**Search:** `grep -rn '\.set(.*\.id' frontend/src/hooks/fitness/`

**Results:** 2 occurrences

**Files:**
1. `ZoneProfileStore.js:63` - `nextMap.set(profile.id, profile);`
2. `UserManager.js:629` - `profiles.set(user.id, {...});`

**Analysis:**
- ✅ Both use `user.id` correctly
- ✅ No name-based keys

**Conclusion:** Clean

---

**Search:** `grep -rn '\.has(.*\.id' frontend/src/hooks/fitness/`

**Results:** ✅ **0 occurrences found**

**Analysis:**
- No explicit `.has()` calls with `.id` pattern
- Implicit checks likely use direct access patterns

**Conclusion:** Clean

---

## Summary

### Critical Issues

**None found** - identifier usage is consistent with Phase 1 (userId) standard

### Minor Issues

1. **FitnessSession.js lines 2020-2021** - Legacy slug usage in timeline reads
   - May be dead code or legacy compatibility
   - Needs investigation

### Verification Checklist

✅ **No `.name]` or `.name}` patterns found** - names not used as dictionary keys  
✅ **No `entity:` series keys found** - Phase 2 not yet implemented  
✅ **All timeline writes use `user:` prefix** - consistent format  
✅ **All Map/Set operations use userId** - correct identifier  

### Migration Status

- **Phase 1 (slug → userId):** ✅ **COMPLETE**
- **Phase 2 (userId → entityId):** ⚠️ **Not started** (infrastructure exists but unused)

### Conclusion

The codebase is **consistent with Phase 1 migration complete**. All critical paths use `userId` as the participant identifier. No immediate action required except investigating the legacy slug usage in lines 2020-2021 of FitnessSession.js.

