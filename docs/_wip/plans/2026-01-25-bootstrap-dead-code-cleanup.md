# Bootstrap Dead Code Cleanup Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove unused `InputRouter` instances from `createJournalistServices` and `createHomebotServices` bootstrap functions.

**Architecture:** Both `createJournalistServices` and `createHomebotServices` create InputRouter instances that are returned but never used. The actual InputRouters used for webhook handling are created inside `createJournalistRouter` and `createHomebotRouter` respectively, which are called by the `*ApiRouter` functions.

**Tech Stack:** Node.js ES modules, Express routers

---

## Background

The bootstrap functions create InputRouter instances:
- `createJournalistServices` creates `journalistInputRouter` (line 1189)
- `createHomebotServices` creates `homebotInputRouter` (line 1278)

These are returned in the services object but:
- `createJournalistApiRouter` passes `journalistServices.journalistContainer` to `createJournalistRouter`, which creates its own InputRouter
- `createHomebotApiRouter` passes `homebotServices.homebotContainer` to `createHomebotRouter`, which creates its own InputRouter

The returned InputRouters are dead code.

---

### Task 1: Remove Dead InputRouter from createJournalistServices

**Files:**
- Modify: `backend/src/0_infrastructure/bootstrap.mjs:1188-1199`

**Step 1: Remove journalistInputRouter creation and return**

In `createJournalistServices`, remove lines 1188-1192 and update the return statement at lines 1194-1199.

Before:
```javascript
  // Create input router for webhook handling
  const journalistInputRouter = new JournalistInputRouter(journalistContainer, {
    userResolver,
    logger
  });

  return {
    journalEntryRepository,
    messageQueueRepository,
    journalistContainer,
    journalistInputRouter
  };
```

After:
```javascript
  return {
    journalEntryRepository,
    messageQueueRepository,
    journalistContainer
  };
```

**Step 2: Verify no usages of journalistServices.journalistInputRouter**

Run: `grep -r "journalistServices\.journalistInputRouter" backend/src/`
Expected: No matches

**Step 3: Syntax check**

Run: `node --check backend/src/0_infrastructure/bootstrap.mjs`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/src/0_infrastructure/bootstrap.mjs
git commit -m "refactor: remove unused journalistInputRouter from createJournalistServices

The actual InputRouter is created inside createJournalistRouter,
making the one in createJournalistServices dead code."
```

---

### Task 2: Remove Dead InputRouter from createHomebotServices

**Files:**
- Modify: `backend/src/0_infrastructure/bootstrap.mjs:1277-1287`

**Step 1: Remove homebotInputRouter creation and return**

In `createHomebotServices`, remove lines 1277-1281 and update the return statement at lines 1283-1287.

Before:
```javascript
  // Create input router for webhook handling
  const homebotInputRouter = new HomeBotInputRouter({
    container: homebotContainer,
    logger
  });

  return {
    homebotContainer,
    homebotInputRouter,
    householdRepository
  };
```

After:
```javascript
  return {
    homebotContainer,
    householdRepository
  };
```

**Step 2: Verify no usages of homebotServices.homebotInputRouter**

Run: `grep -r "homebotServices\.homebotInputRouter" backend/src/`
Expected: No matches

**Step 3: Syntax check**

Run: `node --check backend/src/0_infrastructure/bootstrap.mjs`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/src/0_infrastructure/bootstrap.mjs
git commit -m "refactor: remove unused homebotInputRouter from createHomebotServices

The actual InputRouter is created inside createHomebotRouter,
making the one in createHomebotServices dead code."
```

---

### Task 3: Remove Unused Imports

**Files:**
- Modify: `backend/src/0_infrastructure/bootstrap.mjs:91-98`

**Step 1: Check if JournalistInputRouter import is still needed**

Run: `grep -E "new JournalistInputRouter|JournalistInputRouter\(" backend/src/0_infrastructure/bootstrap.mjs`
Expected: No matches after Task 1

**Step 2: Check if HomeBotInputRouter import is still needed**

Run: `grep -E "new HomeBotInputRouter|HomeBotInputRouter\(" backend/src/0_infrastructure/bootstrap.mjs`
Expected: No matches after Task 2

**Step 3: Remove unused imports if confirmed**

Remove from imports section (around lines 91-98):
```javascript
import { JournalistInputRouter } from '../2_adapters/journalist/index.mjs';
import { HomeBotInputRouter, ConfigHouseholdAdapter } from '../2_adapters/homebot/index.mjs';
```

Replace with:
```javascript
import { ConfigHouseholdAdapter } from '../2_adapters/homebot/index.mjs';
```

Note: Keep `ConfigHouseholdAdapter` as it's still used.

**Step 4: Syntax check**

Run: `node --check backend/src/0_infrastructure/bootstrap.mjs`
Expected: No errors

**Step 5: Commit**

```bash
git add backend/src/0_infrastructure/bootstrap.mjs
git commit -m "refactor: remove unused InputRouter imports from bootstrap"
```

---

### Task 4: Verify Server Starts

**Step 1: Start dev server and check for errors**

Run: `npm run dev` (or check dev.log)
Expected: Server starts without import/reference errors

**Step 2: Verify journalist and homebot routes still work**

Check dev.log for:
- `apiV1.mounted` includes `/journalist` and `/homebot`
- No errors related to journalist or homebot

---

## Summary

This cleanup removes ~15 lines of dead code and 1 unused import, making the bootstrap file cleaner and the data flow clearer. The InputRouters are now only created where they're actually used (in the router factory functions).
