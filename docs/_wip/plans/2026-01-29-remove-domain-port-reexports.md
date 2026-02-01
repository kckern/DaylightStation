# Remove Domain Port Re-exports Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove port interface re-exports from domain `index.mjs` files to enforce pure domain layer (no application dependencies).

**Architecture:** Domains contain pure business logic only. Ports (interfaces for external services) belong in `3_applications/`. The current re-exports in domain barrels violate dependency direction rules and must be removed.

**Tech Stack:** Node.js ES modules with import aliases (`#domains/*`, `#apps/*`)

---

## Phase 1: Identify Consumers

### Task 1: Find all imports of ports from domains

**Step 1: Search for consumers**

```bash
grep -r "from '#domains/.*'" backend/src --include="*.mjs" | grep -v "index.mjs" | head -50
```

This finds code importing from domains. We need to identify which are importing ports (that will break) vs entities (that will still work).

**Step 2: Document affected files**

Create a list of files that import ports from domain barrels. These will need updating to import from `#apps/*/ports/` instead.

**Deliverable:** List of files needing import updates.

---

## Phase 2: Update Domain Barrels

### Task 2: Clean scheduling domain index.mjs

**File:** `backend/src/1_domains/scheduling/index.mjs`

**Remove these lines:**
```javascript
// Ports moved to application layer - re-export for backward compatibility
export { IJobDatastore } from '#apps/scheduling/ports/IJobDatastore.mjs';
export { IStateDatastore } from '#apps/scheduling/ports/IStateDatastore.mjs';
```

**Keep:** Entity and service exports only.

**Commit:** `refactor(scheduling): remove port re-exports from domain barrel`

---

### Task 3: Clean health domain index.mjs

**File:** `backend/src/1_domains/health/index.mjs`

**Remove:** `export { IHealthDataDatastore } from '#apps/health/ports/...'`

**Commit:** `refactor(health): remove port re-exports from domain barrel`

---

### Task 4: Clean gratitude domain index.mjs

**File:** `backend/src/1_domains/gratitude/index.mjs`

**Remove:** Port re-exports for `IGratitudeDatastore`, `isGratitudeDatastore`

**Commit:** `refactor(gratitude): remove port re-exports from domain barrel`

---

### Task 5: Clean journaling domain index.mjs

**File:** `backend/src/1_domains/journaling/index.mjs`

**Remove:** `export { IJournalDatastore } from '#apps/journaling/ports/...'`

**Commit:** `refactor(journaling): remove port re-exports from domain barrel`

---

### Task 6: Clean home-automation domain index.mjs

**File:** `backend/src/1_domains/home-automation/index.mjs`

**Remove:** Port re-exports for `IHomeAutomationGateway`

**Commit:** `refactor(home-automation): remove port re-exports from domain barrel`

---

### Task 7: Clean finance domain index.mjs

**File:** `backend/src/1_domains/finance/index.mjs`

**Remove:** `export { ITransactionSource } from '#apps/finance/ports/...'`

**Commit:** `refactor(finance): remove port re-exports from domain barrel`

---

### Task 8: Clean entropy domain index.mjs

**File:** `backend/src/1_domains/entropy/index.mjs`

**Remove:** `export * from '#apps/entropy/ports/index.mjs'`

**Commit:** `refactor(entropy): remove port re-exports from domain barrel`

---

### Task 9: Clean content domain index.mjs

**File:** `backend/src/1_domains/content/index.mjs`

**Remove:** Port re-exports for `validateAdapter`, `ContentSourceBase`, `IContentSource`

**Commit:** `refactor(content): remove port re-exports from domain barrel`

---

### Task 10: Clean fitness domain index.mjs

**File:** `backend/src/1_domains/fitness/index.mjs`

**Remove:** `export { ISessionDatastore } from '#apps/fitness/ports/...'`

**Commit:** `refactor(fitness): remove port re-exports from domain barrel`

---

### Task 11: Clean nutrition domain index.mjs

**File:** `backend/src/1_domains/nutrition/index.mjs`

**Remove:** All port re-exports from `#apps/nutribot/ports/...`:
- `IFoodLogDatastore`
- `INutriListDatastore`
- `INutriCoachDatastore`

**Commit:** `refactor(nutrition): remove port re-exports from domain barrel`

---

### Task 12: Clean messaging domain index.mjs

**File:** `backend/src/1_domains/messaging/index.mjs`

**Remove:** All port re-exports from `#apps/shared/ports/...`:
- `IAIGateway`
- `IMessagingGateway`
- `ITranscriptionService`
- `IConversationStateDatastore`
- etc.

**Commit:** `refactor(messaging): remove port re-exports from domain barrel`

---

## Phase 3: Fix Broken Imports

### Task 13: Update consumers to import ports from apps

For each file identified in Task 1 that imports ports from domains:

**Change from:**
```javascript
import { SomeEntity, ISomePort } from '#domains/someDomain/index.mjs';
```

**To:**
```javascript
import { SomeEntity } from '#domains/someDomain/index.mjs';
import { ISomePort } from '#apps/someDomain/ports/ISomePort.mjs';
```

**Commit:** `refactor: update port imports to use application layer`

---

## Phase 4: Cleanup

### Task 14: Fix bootstrap.mjs relative imports

**File:** `backend/src/0_system/bootstrap.mjs`

Change relative router imports to use aliases:
```javascript
// From
import { createContentRouter } from '../4_api/v1/routers/content.mjs';
// To
import { createContentRouter } from '#api/v1/routers/content.mjs';
```

**Commit:** `refactor(bootstrap): use import aliases instead of relative paths`

---

### Task 15: Fix explicit index.mjs imports

Change imports like `#adapters/nutribot/index.mjs` to `#adapters/nutribot`.

**Commit:** `refactor: remove explicit index.mjs from imports`

---

### Task 16: Add missing default export to BaseInputRouter

**File:** `backend/src/2_adapters/BaseInputRouter.mjs`

Add: `export default BaseInputRouter;`

**Commit:** `fix(adapters): add default export to BaseInputRouter`

---

### Task 17: Final audit verification

```bash
node cli/audit/index.mjs --json
```

**Expected:** 0 `domain-imports-application` violations.

**Commit:** None (verification only)

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1 | Identify consumers |
| 2 | 2-12 | Remove re-exports from 11 domain barrels |
| 3 | 13 | Fix broken imports |
| 4 | 14-17 | Cleanup and verify |

**Total:** ~17 tasks, much simpler than moving files.
