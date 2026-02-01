# Nutribot Use Case Wiring Audit

**Date:** 2026-01-25
**Scope:** `/backend/src/3_applications/nutribot/usecases/`
**Focus:** Store method signature mismatches, missing userId parameters, state management issues

---

## Fixes Applied

| Issue | File | Fix |
|-------|------|-----|
| ✅ Missing userId in updateItems | `ProcessRevisionInput.mjs:98` | Added userId parameter |
| ✅ Missing userId in findByUuid | `LogFoodFromText.mjs:440` | Added userId parameter |
| ✅ State key mismatch | `GenerateThresholdCoaching.mjs:46` | Changed `flowState` to `data` |
| ✅ Missing constructor validation | `ConfirmAllPending.mjs:16` | Added required checks |

---

## Summary of Issues Found

| Severity | Count | Description |
|----------|-------|-------------|
| HIGH | 4 | `foodLogStore.findByUuid()` parameter order mismatch |
| HIGH | 1 | Missing `userId` parameter in `findByUuid()` call |
| MEDIUM | 1 | Inconsistent state key usage (`data` vs `flowState`) |
| LOW | 2 | Optional dependency usage without fallback (potential runtime errors) |

---

## Critical Issues

### 1. `foodLogStore.findByUuid()` Parameter Order Mismatch (HIGH)

**Store Signature:**
```javascript
// YamlFoodLogStore.mjs:478
async findByUuid(uuid, userId = null)  // uuid FIRST, userId SECOND (optional)
```

**Incorrect Calls (passing parameters in WRONG order):**

| File | Line | Call |
|------|------|------|
| `SelectUPCPortion.mjs` | 84 | `findByUuid(logUuid, userId)` |
| `ProcessRevisionInput.mjs` | 77 | `findByUuid(logUuid, userId)` |
| `ReviseFoodLog.mjs` | 75 | `findByUuid(logUuid, userId)` |
| `AcceptFoodLog.mjs` | 67 | `findByUuid(logUuid, userId)` |

**Impact:** These calls work accidentally because the store implementation just calls `findById(userId, uuid)` when userId is provided. However, the semantics are inverted - the code is passing `(uuid, userId)` but the callers think they're passing `(logUuid, userId)`. This is confusing and error-prone.

**Root Cause:** The `YamlFoodLogStore.findByUuid` signature differs from `YamlNutriListStore.findByUuid`:
- `YamlFoodLogStore.findByUuid(uuid, userId)` - uuid first
- `YamlNutriListStore.findByUuid(userId, uuid)` - userId first

**Recommended Fix:** Standardize all store interfaces to use `(userId, identifier)` order for consistency with the rest of the codebase. Update `YamlFoodLogStore.findByUuid` signature to match `YamlNutriListStore.findByUuid`.

---

### 2. Missing `userId` in `findByUuid()` Call (HIGH)

**File:** `LogFoodFromText.mjs`
**Line:** 440

```javascript
targetLog = await this.#foodLogStore.findByUuid(pendingLogUuid);
// Missing userId parameter!
```

**Impact:** Since `userId` is null, `findByUuid` returns null (line 482: "Without userId, we can't efficiently search"). This causes the revision fallback to silently fail.

**Recommended Fix:**
```javascript
targetLog = await this.#foodLogStore.findByUuid(pendingLogUuid, userId);
```

---

## Medium Issues

### 3. Inconsistent State Key Usage (MEDIUM)

**File:** `GenerateThresholdCoaching.mjs`
**Lines:** 46-47, 69-72

The coaching check uses `state.flowState[coachingKey]`:
```javascript
if (state?.flowState?.[coachingKey]) { ... }
```

But the save uses `state.data[coachingKey]`:
```javascript
await this.#conversationStateStore.set(conversationId, {
  ...currentState,
  data: { ...(currentState.data || {}), [coachingKey]: true },
});
```

**Impact:** The check looks in `flowState` but saves to `data`. This means the "already given" check will never find the key, potentially sending duplicate coaching messages.

**Recommended Fix:** Use consistent key (`flowState` or `data`) for both read and write.

---

## Low Issues / Code Quality

### 4. Optional Dependencies Without Graceful Fallback

**File:** `ConfirmAllPending.mjs`
**Issue:** No null check for `foodLogStore` before calling `findPending`:
```javascript
// Line 35 - no null check
const pendingLogs = await this.#foodLogStore.findPending(userId);
```

If `foodLogStore` is not provided, this will throw a runtime error.

**Recommendation:** Add constructor validation:
```javascript
if (!deps.foodLogStore) throw new Error('foodLogStore is required');
```

---

### 5. Potential Null Access in DeleteListItem

**File:** `DeleteListItem.mjs`
**Lines:** 65-71

```javascript
const listItem = await this.#nutriListStore.findByUuid(userId, itemId);
const logId = listItem?.logId || listItem?.log_uuid || state?.flowState?.logId;
// ...
const log = logId ? await this.#foodLogStore.findById(userId, logId) : null;
```

If `listItem` is null and there's no `logId` in state, the deletion proceeds without proper context. The code handles this gracefully with the fallback to `deleteById`, but the logic flow could be clearer.

---

## Per-File Findings

### Files with No Issues Found

- `index.mjs` - Export only
- `LogFoodFromVoice.mjs` - Delegates to LogFoodFromText, no direct store calls
- `LogFoodFromImage.mjs` - Store calls look correct
- `LogFoodFromUPC.mjs` - Store calls look correct
- `DiscardFoodLog.mjs` - Uses `updateStatus(userId, logUuid, status)` correctly
- `StartAdjustmentFlow.mjs` - Delegates to SelectDateForAdjustment
- `ShowDateSelection.mjs` - No store calls
- `SelectDateForAdjustment.mjs` - Uses `findByDate(userId, date)` correctly
- `SelectItemForAdjustment.mjs` - Uses `findByUuid(userId, itemId)` correctly for nutriListStore
- `ApplyPortionAdjustment.mjs` - Uses `findByUuid(userId, itemId)` correctly for nutriListStore
- `MoveItemToDate.mjs` - Uses `findByUuid(userId, itemId)` correctly for nutriListStore
- `HandleHelpCommand.mjs` - No store calls
- `HandleReviewCommand.mjs` - Delegates only
- `GenerateDailyReport.mjs` - Store calls look correct
- `GetReportAsJSON.mjs` - Store calls look correct
- `GenerateOnDemandCoaching.mjs` - Store calls look correct
- `GenerateReportCoaching.mjs` - Store calls look correct

### Files with Issues

| File | Issue |
|------|-------|
| `LogFoodFromText.mjs` | Missing userId in findByUuid call (line 440) |
| `SelectUPCPortion.mjs` | findByUuid parameter order (line 84) |
| `ProcessRevisionInput.mjs` | findByUuid parameter order (line 77) |
| `ReviseFoodLog.mjs` | findByUuid parameter order (line 75) |
| `AcceptFoodLog.mjs` | findByUuid parameter order (line 67) |
| `GenerateThresholdCoaching.mjs` | Inconsistent state keys (lines 46-47, 69-72) |
| `ConfirmAllPending.mjs` | Missing constructor validation for foodLogStore |
| `DeleteListItem.mjs` | Logic flow could be clearer for null listItem case |

---

## Recommended Fixes (Priority Order)

### Priority 1: Fix Parameter Order Mismatch

Update `YamlFoodLogStore.findByUuid` to match the interface pattern:

```javascript
// BEFORE: async findByUuid(uuid, userId = null)
// AFTER:  async findByUuid(userId, uuid)
async findByUuid(userId, uuid) {
  return this.findById(userId, uuid);
}
```

This aligns with:
- `INutriListStore.findByUuid(userId, uuid)`
- `YamlNutriListStore.findByUuid(userId, uuid)`
- All existing usecase call sites

### Priority 2: Fix Missing userId in LogFoodFromText

```javascript
// Line 440
targetLog = await this.#foodLogStore.findByUuid(userId, pendingLogUuid);
```

### Priority 3: Fix State Key Inconsistency in GenerateThresholdCoaching

Either change the check to use `data`:
```javascript
if (state?.data?.[coachingKey]) { ... }
```

Or change the save to use `flowState`:
```javascript
flowState: { ...(currentState.flowState || {}), [coachingKey]: true },
```

### Priority 4: Add Constructor Validation

In `ConfirmAllPending.mjs`:
```javascript
constructor(deps) {
  if (!deps.foodLogStore) throw new Error('foodLogStore is required');
  if (!deps.nutriListStore) throw new Error('nutriListStore is required');
  // ...
}
```

---

## Interface Signature Reference

### IFoodLogStore Methods Used

| Method | Signature |
|--------|-----------|
| `save` | `save(nutriLog)` |
| `findById` | `findById(userId, id)` |
| `findByDate` | `findByDate(userId, date)` |
| `findPending` | `findPending(userId)` |
| `findAccepted` | `findAccepted(userId)` |
| `delete` | `delete(userId, id)` |
| `hardDelete` | `hardDelete(userId, id)` |
| `updateStatus` | `updateStatus(userId, id, newStatus)` |
| `updateItems` | `updateItems(userId, id, items)` |
| `getDailySummary` | `getDailySummary(userId, date)` |
| `findByUuid` | `findByUuid(uuid, userId)` **<-- INCONSISTENT** |

### INutriListStore Methods Used

| Method | Signature |
|--------|-----------|
| `syncFromLog` | `syncFromLog(nutriLog)` |
| `saveMany` | `saveMany(items)` |
| `findAll` | `findAll(userId, options)` |
| `findByDate` | `findByDate(userId, date)` |
| `findByUuid` | `findByUuid(userId, uuid)` |
| `update` | `update(userId, itemId, updates)` |
| `deleteById` | `deleteById(userId, uuid)` |

### IConversationStateStore Methods Used

| Method | Signature |
|--------|-----------|
| `get` | `get(conversationId, messageId?)` |
| `set` | `set(conversationId, state, messageId?)` |
| `clear` | `clear(conversationId)` |
| `delete` | `delete(conversationId, messageId?)` |
