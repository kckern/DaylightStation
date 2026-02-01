# Nutribot User ID Resolution Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix user identity resolution so nutribot data writes to the correct user directory (e.g., `kckern/`) instead of fallback paths like `telegram:b6898194425_c575596036/` or `c575596036/`.

**Architecture:** User identity should be extracted ONCE at the webhook entry point from `from.id` (the actual user who triggered the action) and flow through as a parameter. Use cases must use the passed `userId` parameter, never re-derive it from `conversationId`.

**Tech Stack:** Node.js/ESM, Jest for testing

---

## Background

Two bugs cause user data to be written to wrong directories:

| Bug | Location | Symptom |
|-----|----------|---------|
| Bug 1 | `IInputEvent.mjs:48` | `platformUserId` prioritizes `telegramRef.platformUserId` (chat ID) over `from.id` (user ID) |
| Bug 2 | `LogFoodFromUPC.mjs:137`, `SelectUPCPortion.mjs:81` | Use cases ignore passed `userId` and extract incorrectly from `conversationId` |

**Data flow after fix:**
```
Webhook → Parser (extracts from.id) → toInputEvent (sets platformUserId=from.id)
        → Router (#resolveUserId) → UseCase (uses passed userId param)
```

---

### Task 1: Fix `toInputEvent` to prioritize `from.id`

**Files:**
- Modify: `backend/src/1_adapters/telegram/IInputEvent.mjs:48`
- Test: `tests/unit/suite/adapters/telegram/IInputEvent.test.mjs` (create)

**Step 1: Write the failing test**

Create test file:

```javascript
// tests/unit/suite/adapters/telegram/IInputEvent.test.mjs
import { describe, it, expect } from '@jest/globals';
import { toInputEvent } from '#adapters/telegram/IInputEvent.mjs';

describe('toInputEvent', () => {
  describe('platformUserId extraction', () => {
    it('uses from.id for platformUserId even when telegramRef is provided', () => {
      const parsed = {
        type: 'callback',
        userId: 'telegram:123_456',
        callbackData: 'test',
        messageId: '999',
        metadata: {
          from: { id: 575596036, first_name: 'Test', username: 'testuser' },
          chatType: 'private',
        },
      };

      // Mock telegramRef with different chatId
      const telegramRef = {
        toConversationId: () => ({ toString: () => 'telegram:b123_c999' }),
        platformUserId: '999', // This is the CHAT ID, not user ID
      };

      const event = toInputEvent(parsed, telegramRef);

      // Should use from.id (575596036), not telegramRef.platformUserId (999)
      expect(event.platformUserId).toBe('575596036');
    });

    it('uses from.id when telegramRef is null', () => {
      const parsed = {
        type: 'text',
        userId: 'telegram:123_575596036',
        text: 'hello',
        messageId: '100',
        metadata: {
          from: { id: 575596036 },
          chatType: 'private',
        },
      };

      const event = toInputEvent(parsed, null);

      expect(event.platformUserId).toBe('575596036');
    });

    it('returns null platformUserId when from.id is missing', () => {
      const parsed = {
        type: 'text',
        userId: 'telegram:123_456',
        text: 'hello',
        messageId: '100',
        metadata: {},
      };

      const event = toInputEvent(parsed, null);

      expect(event.platformUserId).toBeUndefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node tests/unit/harness.mjs --pattern=IInputEvent`

Expected: FAIL - first test expects `575596036` but gets `999`

**Step 3: Implement the fix**

In `backend/src/1_adapters/telegram/IInputEvent.mjs`, change line 48 from:

```javascript
platformUserId: telegramRef ? telegramRef.platformUserId : parsed.metadata?.from?.id?.toString(),
```

To:

```javascript
platformUserId: parsed.metadata?.from?.id?.toString(),
```

The `from.id` is always the actual user who triggered the action. The `telegramRef.platformUserId` (which is chat ID) should not be used for identity resolution.

**Step 4: Run test to verify it passes**

Run: `node tests/unit/harness.mjs --pattern=IInputEvent`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/suite/adapters/telegram/IInputEvent.test.mjs backend/src/1_adapters/telegram/IInputEvent.mjs
git commit -m "fix(telegram): use from.id for platformUserId in toInputEvent

The platformUserId should always be the actual user who triggered the
action (from.id), not the chat ID. This fixes user identity resolution
for nutribot data persistence.

Bug: Data was being written to telegram:b{botId}_c{chatId}/ instead of
the resolved username directory."
```

---

### Task 2: Fix `LogFoodFromUPC` to use passed `userId`

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs:137-141`
- Test: `tests/unit/suite/applications/nutribot/LogFoodFromUPC.test.mjs` (create)

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/nutribot/LogFoodFromUPC.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { LogFoodFromUPC } from '#applications/nutribot/usecases/LogFoodFromUPC.mjs';

describe('LogFoodFromUPC', () => {
  let useCase;
  let mockMessaging;
  let mockUpcGateway;
  let mockFoodLogStore;
  let savedLog;

  beforeEach(() => {
    savedLog = null;
    mockMessaging = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: '100' }),
      sendPhoto: jest.fn().mockResolvedValue({ messageId: '101' }),
      updateMessage: jest.fn().mockResolvedValue({}),
      deleteMessage: jest.fn().mockResolvedValue({}),
    };
    mockUpcGateway = {
      lookup: jest.fn().mockResolvedValue({
        name: 'Test Product',
        brand: 'TestBrand',
        serving: { size: 100, unit: 'g' },
        nutrition: { calories: 200, protein: 10, carbs: 20, fat: 5 },
      }),
    };
    mockFoodLogStore = {
      save: jest.fn().mockImplementation((log) => {
        savedLog = log;
        return Promise.resolve();
      }),
    };

    useCase = new LogFoodFromUPC({
      messagingGateway: mockMessaging,
      upcGateway: mockUpcGateway,
      foodLogStore: mockFoodLogStore,
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  describe('userId handling', () => {
    it('uses the passed userId parameter, not extracted from conversationId', async () => {
      await useCase.execute({
        userId: 'kckern',  // This is the resolved username
        conversationId: 'telegram:b6898194425_c575596036',
        upc: '012345678901',
        messageId: '50',
      });

      // The saved log should have userId='kckern', not 'c575596036'
      expect(savedLog).not.toBeNull();
      expect(savedLog.userId).toBe('kckern');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node tests/unit/harness.mjs --pattern=LogFoodFromUPC`

Expected: FAIL - expects `userId` to be `kckern` but gets `c575596036`

**Step 3: Implement the fix**

In `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs`, change lines 137-141 from:

```javascript
// 6. Create NutriLog entity
const extractedUserId = conversationId.split('_').pop();
const timezone = this.#config?.getUserTimezone?.(extractedUserId) || 'America/Los_Angeles';
const now = new Date();
const nutriLog = NutriLog.create({
  userId: extractedUserId,
```

To:

```javascript
// 6. Create NutriLog entity
const timezone = this.#config?.getUserTimezone?.(userId) || 'America/Los_Angeles';
const now = new Date();
const nutriLog = NutriLog.create({
  userId,
```

**Step 4: Run test to verify it passes**

Run: `node tests/unit/harness.mjs --pattern=LogFoodFromUPC`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/suite/applications/nutribot/LogFoodFromUPC.test.mjs backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs
git commit -m "fix(nutribot): use passed userId in LogFoodFromUPC

Remove the hack that extracted userId from conversationId using
split('_').pop(). The userId is already resolved by the input router
and passed as a parameter - use it directly.

Bug: Data was being written to c575596036/ instead of kckern/."
```

---

### Task 3: Fix `SelectUPCPortion` to use passed `userId`

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/SelectUPCPortion.mjs:69,81`
- Test: `tests/unit/suite/applications/nutribot/SelectUPCPortion.test.mjs` (create)

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/nutribot/SelectUPCPortion.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { SelectUPCPortion } from '#applications/nutribot/usecases/SelectUPCPortion.mjs';

describe('SelectUPCPortion', () => {
  let useCase;
  let mockMessaging;
  let mockFoodLogStore;
  let mockNutriListStore;
  let findByUuidCalledWith;

  beforeEach(() => {
    findByUuidCalledWith = null;

    mockMessaging = {
      sendMessage: jest.fn().mockResolvedValue({ messageId: '100' }),
      updateMessage: jest.fn().mockResolvedValue({}),
      deleteMessage: jest.fn().mockResolvedValue({}),
    };

    mockFoodLogStore = {
      findByUuid: jest.fn().mockImplementation((uuid, userId) => {
        findByUuidCalledWith = { uuid, userId };
        return Promise.resolve({
          id: uuid,
          userId,
          status: 'pending',
          items: [{ label: 'Test Food', grams: 100, calories: 200 }],
          meal: { date: '2026-01-30' },
        });
      }),
      updateStatus: jest.fn().mockResolvedValue({}),
      findPending: jest.fn().mockResolvedValue([]),
    };

    mockNutriListStore = {
      saveMany: jest.fn().mockResolvedValue({}),
    };

    useCase = new SelectUPCPortion({
      messagingGateway: mockMessaging,
      foodLogStore: mockFoodLogStore,
      nutriListStore: mockNutriListStore,
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  describe('userId handling', () => {
    it('uses the passed userId parameter, not extracted from conversationId', async () => {
      await useCase.execute({
        userId: 'kckern',  // This is the resolved username
        conversationId: 'telegram:b6898194425_c575596036',
        logUuid: 'abc123',
        portionFactor: 1,
        messageId: '50',
      });

      // findByUuid should be called with 'kckern', not 'c575596036'
      expect(findByUuidCalledWith).not.toBeNull();
      expect(findByUuidCalledWith.userId).toBe('kckern');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node tests/unit/harness.mjs --pattern=SelectUPCPortion`

Expected: FAIL - expects `userId` to be `kckern` but gets `c575596036`

**Step 3: Implement the fix**

In `backend/src/3_applications/nutribot/usecases/SelectUPCPortion.mjs`:

Change line 69 from:
```javascript
const { conversationId, logUuid, portionFactor, messageId, responseContext } = input;
```

To:
```javascript
const { userId, conversationId, logUuid, portionFactor, messageId, responseContext } = input;
```

Delete lines 80-81:
```javascript
// Load the log (extract userId from conversationId)
const userId = conversationId.split('_').pop();
```

**Step 4: Run test to verify it passes**

Run: `node tests/unit/harness.mjs --pattern=SelectUPCPortion`

Expected: PASS

**Step 5: Commit**

```bash
git add tests/unit/suite/applications/nutribot/SelectUPCPortion.test.mjs backend/src/3_applications/nutribot/usecases/SelectUPCPortion.mjs
git commit -m "fix(nutribot): use passed userId in SelectUPCPortion

The userId was documented in JSDoc but not destructured from input.
Instead, a hack extracted it from conversationId. Now properly uses
the userId parameter that the input router already passes.

Bug: Data lookups used c575596036 instead of kckern."
```

---

### Task 4: Update `TelegramChatRef` documentation

**Files:**
- Modify: `backend/src/1_adapters/telegram/TelegramChatRef.mjs:73-80`

**Step 1: Update JSDoc to clarify semantics**

The `platformUserId` getter on `TelegramChatRef` is semantically misleading. While we can't remove it without breaking things, we should clarify its purpose.

Change the JSDoc at lines 73-80 from:

```javascript
/**
 * Get the platform user ID for identity resolution
 * This is the chat ID without bot context - used to look up system user
 * @returns {string}
 */
get platformUserId() {
  return this.#chatId;
}
```

To:

```javascript
/**
 * Get the chat ID for identity resolution fallback
 *
 * NOTE: For user identity resolution, prefer using `from.id` from the
 * parsed message metadata. This returns the chat ID, which equals the
 * user ID only in private chats. For groups, this is the group ID.
 *
 * @returns {string} The chat ID (not necessarily the user ID)
 * @deprecated Prefer using parsed.metadata.from.id for user identity
 */
get platformUserId() {
  return this.#chatId;
}
```

**Step 2: Commit**

```bash
git add backend/src/1_adapters/telegram/TelegramChatRef.mjs
git commit -m "docs(telegram): clarify platformUserId semantics in TelegramChatRef

Add deprecation notice and clarify that platformUserId returns the
chat ID, not necessarily the user ID. For identity resolution, use
from.id from the parsed message metadata instead."
```

---

### Task 5: Update audit document status

**Files:**
- Modify: `docs/_wip/2026-01-30-nutribot-userid-resolution-audit.md`

**Step 1: Update status checkboxes**

Change the status section at the end of the file to:

```markdown
## Status

- [x] Root cause identified
- [x] Fix implemented
- [ ] Fix tested (integration)
- [ ] Data migrated
- [ ] Cleanup completed

## Additional Findings

A second bug was discovered during implementation:
- `LogFoodFromUPC.mjs:137` and `SelectUPCPortion.mjs:81` were ignoring the passed `userId` parameter and extracting incorrectly from `conversationId` using `split('_').pop()`.
- This caused data to be written to `c575596036/` instead of `kckern/`.
- Both bugs have been fixed.
```

**Step 2: Commit**

```bash
git add docs/_wip/2026-01-30-nutribot-userid-resolution-audit.md
git commit -m "docs: update audit status after implementing fixes"
```

---

### Task 6: Run full test suite and verify

**Step 1: Run all unit tests**

Run: `node tests/unit/harness.mjs`

Expected: All tests pass, including the 3 new test files

**Step 2: Run integration tests if available**

Run: `node tests/integration/harness.mjs --pattern=nutribot`

Expected: Tests pass (or skip if no nutribot integration tests exist)

**Step 3: Create final commit if any adjustments needed**

If tests revealed issues, fix them and commit.

---

### Task 7: Data Migration (Manual)

After deployment, migrate existing data:

```bash
# 1. Verify the erroneous directories
ls -la /data/users/c575596036/
ls -la /data/users/telegram:b6898194425_c575596036/

# 2. Merge data into correct user directory
# (Review contents first - these are small files)
cat /data/users/c575596036/lifelog/nutrition/nutrilog.yml
cat /data/users/telegram:b6898194425_c575596036/lifelog/nutrition/nutriday.yml
cat /data/users/telegram:b6898194425_c575596036/lifelog/nutrition/nutrilist.yml

# 3. After verifying data is also in kckern/, remove erroneous directories
# (Only after confirming the fix works in production)
```

**Note:** This is a manual post-deployment step, not part of the code fix.

---

## Summary

| Task | Files Changed | Purpose |
|------|---------------|---------|
| 1 | `IInputEvent.mjs`, new test | Always use `from.id` for `platformUserId` |
| 2 | `LogFoodFromUPC.mjs`, new test | Use passed `userId` param |
| 3 | `SelectUPCPortion.mjs`, new test | Use passed `userId` param |
| 4 | `TelegramChatRef.mjs` | Clarify misleading getter |
| 5 | Audit doc | Update status |
| 6 | - | Verify all tests pass |
| 7 | Manual | Data migration post-deploy |
