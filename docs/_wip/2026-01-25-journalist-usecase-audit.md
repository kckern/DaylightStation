# Journalist Use Case Audit Report

**Date:** 2026-01-25
**Audited Directory:** `/backend/src/3_applications/journalist/usecases/`

## Fixes Applied

| Issue | File | Fix |
|-------|------|-----|
| ✅ Missing nowDate import | `ExportJournalMarkdown.mjs` | Added import |
| ✅ Missing nowDate import | `ReviewJournalEntries.mjs` | Added import |
| ✅ Missing nowDate import | `RecordQuizAnswer.mjs` | Added import |
| ✅ deleteMessage → delete | `HandleDebriefResponse.mjs:284-287` | Fixed method name and param order |
| ✅ Missing null check | `HandleCategorySelection.mjs:87` | Added optional chaining |

---

## Summary

This audit examined 20 use case files for wiring issues against the store interfaces in the adapters layer. Several issues were found, ranging from critical bugs that would cause runtime errors to state management inconsistencies that could lead to undefined behavior.

### Issue Count by Severity

| Severity | Count |
|----------|-------|
| Critical (runtime error) | 2 |
| High (incorrect behavior) | 3 |
| Medium (potential issues) | 2 |

---

## Critical Issues

### 1. Missing `nowDate()` Import - Runtime Error

**Files affected:**
- `ExportJournalMarkdown.mjs` (line 38)
- `ReviewJournalEntries.mjs` (line 54)
- `RecordQuizAnswer.mjs` (line 54)

**Issue:** These files call `nowDate()` but never import it. The function exists in `/backend/src/0_infrastructure/utils/time.mjs` but is not imported.

**Code examples:**
```javascript
// ExportJournalMarkdown.mjs:38
const endDate = nowDate();  // ReferenceError: nowDate is not defined

// ReviewJournalEntries.mjs:54
const end = endDate || nowDate();  // ReferenceError: nowDate is not defined

// RecordQuizAnswer.mjs:54
date: date || nowDate(),  // ReferenceError: nowDate is not defined
```

**Fix:** Add import at top of each file:
```javascript
import { nowDate } from '../../../0_infrastructure/utils/time.mjs';
```

---

### 2. Method Signature Mismatch - `deleteMessage()` vs `delete()`

**Files affected:**
- `HandleDebriefResponse.mjs` (lines 284, 287)

**Issue:** The code calls `journalEntryRepository.deleteMessage(conversationId, messageId)` but `YamlJournalEntryRepository` only has `delete(uuid, conversationId)`. The method name and parameter order are both wrong.

**Code:**
```javascript
// HandleDebriefResponse.mjs:284-287
await this.#journalEntryRepository.deleteMessage(conversationId, state.messageId);
await this.#journalEntryRepository.deleteMessage(conversationId, state.detailsMessageId);
```

**Expected interface from YamlJournalEntryRepository:**
```javascript
async delete(uuid, conversationId)  // Note: parameters are reversed
```

**Fix:**
```javascript
await this.#journalEntryRepository.delete(state.messageId, conversationId);
await this.#journalEntryRepository.delete(state.detailsMessageId, conversationId);
```

---

## High Severity Issues

### 3. State Key Mismatch - `debrief` vs `flowState.debrief`

**Files affected:**
- `SendMorningDebrief.mjs` (stores at root)
- `InitiateDebriefInterview.mjs` (expects in `flowState`)
- `HandleDebriefResponse.mjs` (reads from root)
- `HandleCategorySelection.mjs` (reads from root)
- `HandleSourceSelection.mjs` (reads from root)
- `HandleSpecialStart.mjs` (reads from `flowState`)

**Issue:** Inconsistent state structure across use cases. `SendMorningDebrief` stores debrief data at the root level:
```javascript
// SendMorningDebrief.mjs:140-150
await this.#conversationStateStore.set(conversationId, {
  activeFlow: 'morning_debrief',
  debrief: { date, summary, questions, ... },
  messageId: result.messageId,
});
```

But `InitiateDebriefInterview` stores and reads from a nested `flowState`:
```javascript
// InitiateDebriefInterview.mjs:162-170
await this.#conversationStateStore.set(conversationId, {
  activeFlow: 'morning_debrief',
  flowState: {
    lastQuestion: question,
    askedQuestions: updatedQuestions,
    lastMessageId: messageId,
    debrief: currentState?.flowState?.debrief,  // Tries to preserve but never set here!
  },
});
```

And `HandleSpecialStart` reads from `flowState`:
```javascript
// HandleSpecialStart.mjs:105
const previousQuestion = state?.flowState?.lastQuestion || null;
```

**Impact:** When `InitiateDebriefInterview` runs after `SendMorningDebrief`, it overwrites the state structure, potentially losing the debrief data that was stored at root level. The line `debrief: currentState?.flowState?.debrief` will be undefined since the debrief was stored at `currentState.debrief`, not `currentState.flowState.debrief`.

**Fix:** Standardize on one state structure. The documented interface (`IConversationStateStore`) expects:
```javascript
{
  activeFlow: string,
  flowState: object,  // Flow-specific data goes here
  updatedAt: timestamp
}
```

All use cases should store custom data in `flowState`, not at root level.

---

### 4. Missing Null Check Before Property Access

**File:** `HandleCategorySelection.mjs` (line 87)

**Issue:** Accessing `.map()` on potentially null `state.debrief.categories`:
```javascript
// Line 64 has null check
if (!state || state.activeFlow !== 'morning_debrief' || !state.debrief) {
  return { success: false, reason: 'no_active_debrief' };
}

// But line 87 assumes categories exists and is an array
availableCategories: state.debrief.categories.map((c) => c.key),
```

**Impact:** If `state.debrief` exists but `state.debrief.categories` is undefined or not an array, this will throw a TypeError.

**Fix:**
```javascript
availableCategories: state.debrief.categories?.map((c) => c.key) || [],
```

---

### 5. Inconsistent Parameter Names - `chatId` vs `conversationId`

**Files affected:** Multiple files use both `chatId` and `conversationId` interchangeably

**Examples:**
- `SendMorningDebrief.mjs` uses `conversationId`
- `ProcessTextEntry.mjs` uses `chatId`
- `HandleDebriefResponse.mjs` uses `conversationId`
- `HandleCallbackResponse.mjs` uses `chatId`

**Issue:** While this works because both refer to the same concept, it creates confusion and potential bugs when copying code between files or when one use case calls another.

**Impact:** Low risk but contributes to maintenance burden and potential for parameter passing errors.

---

## Medium Severity Issues

### 6. Constructor Validation Inconsistency

**Files affected:** Most use case files

**Issue:** Some use cases throw on missing required dependencies, others silently allow null:

```javascript
// SendMorningDebrief.mjs - No validation, allows null
constructor(deps) {
  this.#messagingGateway = deps.messagingGateway;  // Could be undefined
  this.#conversationStateStore = deps.conversationStateStore;
  // ...
}

// ProcessTextEntry.mjs - Validates critical deps
constructor(deps) {
  if (!deps.messagingGateway) throw new Error('messagingGateway is required');
  if (!deps.aiGateway) throw new Error('aiGateway is required');
  // ...
}
```

**Impact:** Runtime errors that are harder to debug when optional dependencies that are actually required aren't validated.

**Files missing validation for critical dependencies:**
- `SendMorningDebrief.mjs` - should validate `messagingGateway`
- `HandleDebriefResponse.mjs` - should validate `messagingGateway`, `conversationStateStore`
- `HandleCategorySelection.mjs` - should validate `conversationStateStore`
- `HandleSourceSelection.mjs` - should validate `conversationStateStore`

---

### 7. Potential Memory Leak - Static Cache Without Cleanup

**File:** `GenerateMultipleChoices.mjs`

**Issue:** Module-level cache without size limits beyond 100 entries:
```javascript
const choiceCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Only cleans when size > 100
if (choiceCache.size > 100) {
  // cleanup logic
}
```

**Impact:** In long-running processes, if cleanup never triggers (size never exceeds 100), stale entries with expired TTL remain in memory. The TTL is only checked on read, not proactively.

---

## Files Audited - No Issues Found

The following files were audited and no wiring issues were found:

1. `GenerateMorningDebrief.mjs` - Clean DI, proper error handling
2. `HandleQuizAnswer.mjs` - Clean DI with validation
3. `HandleSlashCommand.mjs` - Clean DI, graceful fallbacks
4. `InitiateJournalPrompt.mjs` - Clean DI with validation
5. `GenerateTherapistAnalysis.mjs` - Clean DI with validation
6. `SendQuizQuestion.mjs` - Clean DI with validation
7. `AdvanceToNextQuizQuestion.mjs` - Clean DI with validation
8. `ProcessVoiceEntry.mjs` - Clean DI with validation
9. `index.mjs` - Barrel export only

---

## Recommended Fixes Priority

1. **Immediate** - Add `nowDate` imports to prevent runtime errors
2. **Immediate** - Fix `deleteMessage` -> `delete` method call
3. **High** - Standardize state structure across all debrief-related use cases
4. **Medium** - Add null checks for array operations
5. **Low** - Standardize parameter naming conventions
6. **Low** - Add constructor validation for critical dependencies

---

## Related Files

**Store interfaces referenced:**
- `/backend/src/2_adapters/messaging/YamlConversationStateStore.mjs`
- `/backend/src/2_adapters/persistence/yaml/YamlJournalEntryRepository.mjs`
- `/backend/src/2_adapters/persistence/yaml/YamlMessageQueueRepository.mjs`
- `/backend/src/1_domains/messaging/ports/IConversationStateStore.mjs`
