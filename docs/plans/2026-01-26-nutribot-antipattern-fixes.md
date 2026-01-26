# Nutribot Antipattern Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix critical, high, and medium severity antipatterns in the nutribot application identified in the audit.

**Architecture:** Apply the same defensive patterns used in journalist fixes - constructor validation for required dependencies, proper responseContext propagation, and logging for silent failures.

**Tech Stack:** Node.js ES Modules, Jest for testing

---

## Task 1: Fix ConfirmAllPending Constructor/Container Mismatch

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/ConfirmAllPending.mjs:16-23`
- Modify: `backend/src/3_applications/nutribot/NutribotContainer.mjs:482-494`

**Problem:** Container passes 6 parameters (`messagingGateway`, `foodLogStore`, `nutriListStore`, `generateDailyReport`, `config`, `logger`) but use case only accepts 3. The extra params are silently ignored.

**Step 1: Update ConfirmAllPending constructor to accept all dependencies**

```javascript
constructor(deps) {
  if (!deps.foodLogStore) throw new Error('foodLogStore is required');
  if (!deps.nutriListStore) throw new Error('nutriListStore is required');

  this.#foodLogStore = deps.foodLogStore;
  this.#nutriListStore = deps.nutriListStore;
  this.#generateDailyReport = deps.generateDailyReport;
  this.#config = deps.config;
  this.#logger = deps.logger || console;
}
```

**Step 2: Add private fields for new dependencies**

Add after line 14:
```javascript
#generateDailyReport;
#config;
```

**Step 3: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/usecases/ConfirmAllPending.mjs`
Expected: No output (success)

**Step 4: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/ConfirmAllPending.mjs
git commit -m "fix(nutribot): align ConfirmAllPending constructor with container wiring

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Fix LogFoodFromVoice Error Handler ResponseContext

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromVoice.mjs:109-137`

**Problem:** Error handler falls back to bare `#messagingGateway` instead of using `responseContext`. This violates DDD compliance.

**Step 1: Refactor error handler to use messaging variable**

Replace lines 109-137:

```javascript
    } catch (error) {
      this.#logger.error?.('logVoice.error', { conversationId, error: error.message });

      const isTelegramError = error.message?.includes('Telegram error') ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'EAI_AGAIN' ||
        error.code === 'ECONNRESET';

      try {
        const errorMessage = isTelegramError
          ? `⚠️ Network issue while updating the message. Your food may have been logged.\n\nPlease check your recent entries or try again.\n\n_Error: ${error.message || 'Connection issue'}_`
          : `⚠️ Sorry, I couldn't process your voice message. Please try again or type what you ate.\n\n_Error: ${error.message || 'Unknown error'}_`;

        await messaging.sendMessage(errorMessage, { parse_mode: 'Markdown' });
      } catch (sendError) {
        this.#logger.error?.('logVoice.errorNotification.failed', {
          conversationId,
          originalError: error.message,
          sendError: sendError.message,
        });
      }

      throw error; // Re-throw instead of returning {success: false}
    }
```

**Step 2: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/usecases/LogFoodFromVoice.mjs`
Expected: No output (success)

**Step 3: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromVoice.mjs
git commit -m "fix(nutribot): use responseContext in LogFoodFromVoice error handler

- Use messaging variable instead of bare gateway
- Re-throw error instead of returning {success: false}

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Logging for Silent Classification Errors in LogFoodFromUPC

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs:98-111`

**Problem:** Empty catch blocks swallow classification errors without any logging.

**Step 1: Add logging to empty catch blocks**

Replace lines 98-111:

```javascript
      // 4. Classify product if AI available
      let classification = { icon: 'default', noomColor: 'yellow' };
      if (this.#aiGateway) {
        try {
          classification = await this.#classifyProduct(product);
        } catch (e) {
          this.#logger.warn?.('upc.classify.failed', { upc, error: e.message });
        }

        if (!classification?.icon || classification.icon === 'default') {
          try {
            const icon = await this.#selectIconFromList(product);
            classification.icon = icon || 'default';
          } catch (e) {
            this.#logger.warn?.('upc.iconSelect.failed', { upc, error: e.message });
          }
        }
      }
```

**Step 2: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs`
Expected: No output (success)

**Step 3: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs
git commit -m "fix(nutribot): log classification errors in LogFoodFromUPC

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Make Container Getters Consistent with Validation

**Files:**
- Modify: `backend/src/3_applications/nutribot/NutribotContainer.mjs:141-167`

**Problem:** Only `messagingGateway` and `aiGateway` validate; other getters return null silently.

**Step 1: Add validation to critical store getters**

Replace lines 149-167:

```javascript
  getFoodLogStore() {
    if (!this.#foodLogStore) {
      throw new Error('foodLogStore not configured');
    }
    return this.#foodLogStore;
  }

  getNutriListStore() {
    if (!this.#nutriListStore) {
      throw new Error('nutriListStore not configured');
    }
    return this.#nutriListStore;
  }

  getNutriCoachStore() {
    return this.#nutriCoachStore; // Optional - coach features degrade gracefully
  }

  getConversationStateStore() {
    return this.#conversationStateStore; // Optional - state features degrade gracefully
  }

  getReportRenderer() {
    return this.#reportRenderer; // Optional - reports degrade to text-only
  }
```

**Step 2: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/NutribotContainer.mjs`
Expected: No output (success)

**Step 3: Commit**

```bash
git add backend/src/3_applications/nutribot/NutribotContainer.mjs
git commit -m "fix(nutribot): add validation to critical container getters

- foodLogStore and nutriListStore now throw if not configured
- Optional stores (coach, state, renderer) remain nullable

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Fix AcceptFoodLog Inconsistent Null Checks

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs:136-153`

**Problem:** Checks `foodLogStore?.findPending` but not `generateDailyReport?.execute`.

**Step 1: Make null checks consistent**

Replace lines 136-153:

```javascript
      // 7. If no pending logs remain, auto-generate today's report
      if (this.#foodLogStore?.findPending && this.#generateDailyReport?.execute) {
        try {
          const pending = await this.#foodLogStore.findPending(userId);
          this.#logger.debug?.('acceptLog.autoreport.pendingCheck', { userId, pendingCount: pending.length });
          if (pending.length === 0) {
            await new Promise(resolve => setTimeout(resolve, 300));
            await this.#generateDailyReport.execute({
              userId,
              conversationId,
              date: nutriLog.meal?.date || nutriLog.date,
              responseContext,
            });
          }
        } catch (e) {
          this.#logger.warn?.('acceptLog.autoreport.error', { error: e.message });
        }
      }
```

**Step 2: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs`
Expected: No output (success)

**Step 3: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs
git commit -m "fix(nutribot): consistent null checks in AcceptFoodLog autoreport

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Extract File I/O from GenerateDailyReport (DDD Fix)

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/GenerateDailyReport.mjs:9-11, 156-175`

**Problem:** Direct `fs.writeFile` in use case violates DDD - should go through adapter.

**Step 1: Remove fs/path/os imports**

Remove lines 9-11:
```javascript
// DELETE THESE LINES:
// import fs from 'fs/promises';
// import path from 'path';
// import os from 'os';
```

**Step 2: Refactor PNG generation to use reportRenderer's built-in temp file handling**

Replace lines 156-175:

```javascript
      // 7. Generate PNG report if renderer available
      let pngPath = null;
      if (this.#reportRenderer?.renderDailyReport) {
        try {
          // Renderer handles temp file creation internally and returns path
          pngPath = await this.#reportRenderer.renderDailyReport({
            date,
            totals,
            goals,
            items,
            history,
          });
        } catch (e) {
          this.#logger.error?.('report.png.failed', { error: e.message });
        }
      }
```

**Note:** This assumes reportRenderer already handles file I/O internally. If it returns a Buffer, the reportRenderer adapter needs to be updated to handle file storage. Check `backend/src/2_adapters/nutribot/` for the renderer implementation.

**Step 3: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/usecases/GenerateDailyReport.mjs`
Expected: No output (success)

**Step 4: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/GenerateDailyReport.mjs
git commit -m "fix(nutribot): remove direct file I/O from GenerateDailyReport

DDD compliance - file operations belong in adapters, not use cases.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Run All Tests and Verify

**Step 1: Run existing nutribot tests (if any)**

Run: `cd backend && npm test -- --testPathPattern="nutribot" 2>&1 || echo "No nutribot tests found"`

**Step 2: Run syntax check on all modified files**

```bash
cd /root/Code/DaylightStation && \
node --check backend/src/3_applications/nutribot/usecases/ConfirmAllPending.mjs && \
node --check backend/src/3_applications/nutribot/usecases/LogFoodFromVoice.mjs && \
node --check backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs && \
node --check backend/src/3_applications/nutribot/usecases/AcceptFoodLog.mjs && \
node --check backend/src/3_applications/nutribot/usecases/GenerateDailyReport.mjs && \
node --check backend/src/3_applications/nutribot/NutribotContainer.mjs && \
echo "All files valid"
```

Expected: "All files valid"

---

## Summary of Changes

| Task | File | Change | Severity Fixed |
|------|------|--------|----------------|
| 1 | ConfirmAllPending.mjs | Align constructor with container wiring | CRITICAL |
| 2 | LogFoodFromVoice.mjs | Use responseContext in error handler, re-throw | CRITICAL |
| 3 | LogFoodFromUPC.mjs | Log classification errors | MEDIUM |
| 4 | NutribotContainer.mjs | Validate critical store getters | MEDIUM |
| 5 | AcceptFoodLog.mjs | Consistent null checks | MEDIUM |
| 6 | GenerateDailyReport.mjs | Remove direct file I/O | HIGH |

---

## Notes

- Task 6 may require updating the reportRenderer adapter if it currently returns a Buffer instead of a file path. Check `backend/src/2_adapters/nutribot/ReportRenderer.mjs` if the syntax check fails.
- The `#getMessaging()` duplication across 20+ use cases is noted but not addressed here - that would be a larger refactoring to create a BaseUseCase class.
