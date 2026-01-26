# DDD Application Layer Antipattern Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 47 DDD violations in `backend/src/3_applications/` to achieve proper abstraction boundaries.

**Architecture:** The application layer orchestrates business workflows without knowing implementation details. Adapters are injected via constructors, not imported directly. All vendor-specific names must be abstract.

**Tech Stack:** Node.js ES modules, DDD pattern with ports/adapters

---

## Task 1: Fix JournalistContainer Direct Adapter Imports

**Files:**
- Modify: `backend/src/3_applications/journalist/JournalistContainer.mjs:40-41, 148-156, 179-198`

**Step 1: Remove adapter imports and add constructor injection**

Remove these imports (lines 40-41):
```javascript
// DELETE THESE LINES
import { LoggingAIGateway } from '../../2_adapters/journalist/LoggingAIGateway.mjs';
import { DebriefRepository } from '../../2_adapters/journalist/DebriefRepository.mjs';
```

**Step 2: Add new constructor parameters**

In the constructor JSDoc (around line 113), add:
```javascript
   * @param {Object} [options.loggingAIGatewayFactory] - Factory to create logging AI gateway wrapper
   * @param {Object} [options.debriefRepository] - Debrief repository instance
```

In constructor body (around line 130), add:
```javascript
    this.#loggingAIGatewayFactory = options.loggingAIGatewayFactory;
    this.#debriefRepository = options.debriefRepository;
```

**Step 3: Add private field declaration**

After line 54, add:
```javascript
  #loggingAIGatewayFactory;
```

**Step 4: Update getAIGateway() method**

Replace lines 142-157 with:
```javascript
  getAIGateway() {
    if (!this.#aiGateway) {
      throw new Error('aiGateway not configured');
    }

    // Wrap AI gateway with logging wrapper (lazy initialization)
    if (!this.#wrappedAIGateway) {
      if (this.#loggingAIGatewayFactory) {
        this.#wrappedAIGateway = this.#loggingAIGatewayFactory({
          aiGateway: this.#aiGateway,
          username: this.#config.username || 'unknown',
          logger: this.#logger,
        });
      } else {
        // Fallback: use unwrapped gateway if no factory provided
        this.#wrappedAIGateway = this.#aiGateway;
      }
    }

    return this.#wrappedAIGateway;
  }
```

**Step 5: Update getDebriefRepository() method**

Replace lines 179-199 with:
```javascript
  getDebriefRepository() {
    if (!this.#debriefRepository) {
      throw new Error('debriefRepository not configured - must be injected via constructor');
    }
    return this.#debriefRepository;
  }
```

**Step 6: Verify the file still parses**

Run: `node --check backend/src/3_applications/journalist/JournalistContainer.mjs`
Expected: No output (success)

**Step 7: Commit**

```bash
git add backend/src/3_applications/journalist/JournalistContainer.mjs
git commit -m "$(cat <<'EOF'
fix(journalist): remove direct adapter imports from JournalistContainer

- Remove imports of LoggingAIGateway and DebriefRepository from 2_adapters
- Accept loggingAIGatewayFactory and debriefRepository via constructor injection
- Fail fast if debriefRepository not provided (no path construction in app layer)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Fix NutriBotConfig Adapter Import

**Files:**
- Modify: `backend/src/3_applications/nutribot/config/NutriBotConfig.mjs:14, 149-151, 360-371`

**Step 1: Remove TelegramChatRef import**

Delete line 14:
```javascript
// DELETE THIS LINE
import { TelegramChatRef } from '../../../2_adapters/telegram/TelegramChatRef.mjs';
```

**Step 2: Rename telegramBotId getter to messagingBotId**

Replace lines 146-151:
```javascript
  /**
   * Get messaging bot ID
   */
  get messagingBotId() {
    return this.#config.telegram?.botId || this.#config.messaging?.botId;
  }
```

**Step 3: Update getLegacyPath to use plain object**

Replace lines 359-371:
```javascript
  /**
   * Get the legacy path for a messaging chat
   * @param {Object} chatRef - { botId, chatId }
   * @returns {string|null}
   */
  getLegacyPath(chatRef) {
    if (!this.#config.storage.legacy?.enabled) {
      return null;
    }

    const pattern = this.#config.storage.legacy.pattern;
    return pattern.replace('{botId}', chatRef.botId).replace('{chatId}', chatRef.chatId);
  }
```

**Step 4: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/config/NutriBotConfig.mjs`
Expected: No output (success)

**Step 5: Commit**

```bash
git add backend/src/3_applications/nutribot/config/NutriBotConfig.mjs
git commit -m "$(cat <<'EOF'
fix(nutribot): remove TelegramChatRef adapter import from NutriBotConfig

- Remove import from 2_adapters/telegram
- Rename telegramBotId to messagingBotId (vendor-agnostic)
- Change getLegacyPath parameter from TelegramChatRef to plain object { botId, chatId }

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Fix PayrollSyncService Vendor Naming and Config Knowledge

**Files:**
- Modify: `backend/src/3_applications/finance/PayrollSyncService.mjs:4, 14, 22, 27, 32, 42-54, 140-148, 158-162, 204-217, 232`

**Step 1: Rename buxferAdapter to transactionGateway**

Replace line 14:
```javascript
  #transactionGateway;
```

**Step 2: Update constructor JSDoc**

Replace line 22:
```javascript
   * @param {Object} config.transactionGateway - Gateway for transaction uploads
```

**Step 3: Update constructor parameter and assignment**

Replace line 27:
```javascript
  constructor({ httpClient, transactionGateway, financeStore, configService, payrollConfig, logger = console }) {
```

Replace line 32:
```javascript
    this.#transactionGateway = transactionGateway;
```

**Step 4: Add payrollConfig injection, remove config knowledge**

Add after line 35:
```javascript
    this.#payrollConfig = payrollConfig; // Pre-resolved payroll configuration
```

Add private field after line 17:
```javascript
  #payrollConfig;
```

**Step 5: Replace #getPayrollConfig method**

Replace lines 38-54:
```javascript
  /**
   * Get payroll configuration
   * @returns {Object} Payroll config
   */
  #getPayrollConfig() {
    // Prefer injected config (no config structure knowledge)
    if (this.#payrollConfig) {
      return this.#payrollConfig;
    }

    // Fallback for backwards compatibility (to be removed)
    const auth = this.#configService.getUserAuth?.('payroll') || {};
    return {
      baseUrl: auth.base_url || auth.base,
      authKey: auth.cookie_name || auth.authkey,
      authCookie: auth.auth_cookie || auth.auth,
      company: auth.company,
      employeeId: auth.employee_id || auth.employee,
      payrollAccountId: auth.payroll_account_id,
      directDepositAccountId: auth.direct_deposit_account_id,
    };
  }
```

**Step 6: Rename #uploadToBuxfer to #uploadTransactions**

Replace line 158-162:
```javascript
  /**
   * Upload payroll transactions to transaction gateway
   * @private
   */
  async #uploadTransactions(paychecks, { payrollAccountId, directDepositAccountId, householdId }) {
```

**Step 7: Update method calls to use new names**

Replace line 142-143:
```javascript
    if (this.#transactionGateway && payrollAccountId) {
      uploadedCount = await this.#uploadTransactions(paychecks, {
```

Replace line 210:
```javascript
      existingTransactions = await this.#transactionGateway.getTransactions({
```

Replace line 216:
```javascript
      this.#logger.warn?.('payroll.transaction.fetch.error', { error: error.message });
```

Replace line 232:
```javascript
        await this.#transactionGateway.addTransaction({
```

**Step 8: Update file docstring**

Replace lines 2-4:
```javascript
/**
 * PayrollSyncService
 *
 * Syncs payroll data from external payroll API and uploads transactions to finance gateway.
```

**Step 9: Verify syntax**

Run: `node --check backend/src/3_applications/finance/PayrollSyncService.mjs`
Expected: No output (success)

**Step 10: Commit**

```bash
git add backend/src/3_applications/finance/PayrollSyncService.mjs
git commit -m "$(cat <<'EOF'
fix(finance): remove vendor naming from PayrollSyncService

- Rename #buxferAdapter to #transactionGateway
- Rename #uploadToBuxfer to #uploadTransactions
- Add payrollConfig constructor param to avoid config structure knowledge
- Update all references and comments to use vendor-agnostic names

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Fix LogFoodFromVoice Vendor Error Parsing

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromVoice.mjs:112-120`

**Step 1: Remove vendor-specific error check**

Replace lines 112-120:
```javascript
      const isTransportError = error.code === 'ETIMEDOUT' ||
        error.code === 'EAI_AGAIN' ||
        error.code === 'ECONNRESET' ||
        error.isTransient === true;

      try {
        const errorMessage = isTransportError
          ? `⚠️ Network issue while updating the message. Your food may have been logged.\n\nPlease check your recent entries or try again.\n\n_Error: ${error.message || 'Connection issue'}_`
          : `⚠️ Sorry, I couldn't process your voice message. Please try again or type what you ate.\n\n_Error: ${error.message || 'Unknown error'}_`;
```

**Step 2: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/usecases/LogFoodFromVoice.mjs`
Expected: No output (success)

**Step 3: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromVoice.mjs
git commit -m "$(cat <<'EOF'
fix(nutribot): remove vendor error parsing from LogFoodFromVoice

- Remove 'Telegram error' string check
- Use generic transport error codes only (ETIMEDOUT, ECONNRESET, etc.)
- Add isTransient flag support for gateway-reported transient errors

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Fix Silent Catch Blocks in Nutribot Use Cases (Part 1)

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs:99, 101, 174, 189`

**Step 1: Fix line 99**

Replace:
```javascript
            } catch (e) {}
```
With:
```javascript
            } catch (e) {
              this.#logger.debug?.('logImage.deleteOldStatus.failed', { error: e.message });
            }
```

**Step 2: Fix line 101**

Replace:
```javascript
        } catch (e) {}
```
With:
```javascript
        } catch (e) {
          this.#logger.debug?.('logImage.cleanupState.failed', { error: e.message });
        }
```

**Step 3: Fix line 174**

Replace:
```javascript
      } catch (e) {}
```
With:
```javascript
      } catch (e) {
        this.#logger.debug?.('logImage.deleteStatus.failed', { error: e.message });
      }
```

**Step 4: Fix line 189**

Replace:
```javascript
        } catch (e) {}
```
With:
```javascript
        } catch (e) {
          this.#logger.debug?.('logImage.deleteUserMessage.failed', { error: e.message });
        }
```

**Step 5: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs`
Expected: No output (success)

**Step 6: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromImage.mjs
git commit -m "$(cat <<'EOF'
fix(nutribot): add logging to silent catch blocks in LogFoodFromImage

- Log debug messages for message deletion failures
- Log cleanup state failures

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Fix Silent Catch Blocks in Nutribot Use Cases (Part 2)

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs:136`

**Step 1: Fix line 136**

Replace:
```javascript
            } catch (e) {}
```
With:
```javascript
            } catch (e) {
              this.#logger.debug?.('logText.deleteStatus.failed', { error: e.message });
            }
```

**Step 2: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs`
Expected: No output (success)

**Step 3: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromText.mjs
git commit -m "$(cat <<'EOF'
fix(nutribot): add logging to silent catch block in LogFoodFromText

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Fix Silent Catch Blocks in GenerateDailyReport

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/GenerateDailyReport.mjs:88, 113, 172, 278, 378`

**Step 1: Fix line 88**

Replace:
```javascript
          } catch (e) {}
```
With:
```javascript
          } catch (e) {
            this.#logger.debug?.('report.deleteMessage.failed', { msgId, error: e.message });
          }
```

**Step 2: Fix line 113**

Replace:
```javascript
            } catch (e) {}
```
With:
```javascript
            } catch (e) {
              this.#logger.debug?.('report.sendPendingNotice.failed', { error: e.message });
            }
```

**Step 3: Fix line 172**

Replace:
```javascript
      } catch (e) {}
```
With:
```javascript
      } catch (e) {
        this.#logger.debug?.('report.deleteStatus.failed', { error: e.message });
      }
```

**Step 4: Fix line 278**

Replace:
```javascript
    } catch (e) {}
```
With:
```javascript
    } catch (e) {
      this.#logger.debug?.('report.getTimezone.failed', { error: e.message });
    }
```

**Step 5: Fix line 378**

Replace:
```javascript
          } catch (e) {}
```
With:
```javascript
          } catch (e) {
            this.#logger.debug?.('report.updateMessage.failed', { msgId, error: e.message });
          }
```

**Step 6: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/usecases/GenerateDailyReport.mjs`
Expected: No output (success)

**Step 7: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/GenerateDailyReport.mjs
git commit -m "$(cat <<'EOF'
fix(nutribot): add logging to silent catch blocks in GenerateDailyReport

- Log debug messages for all swallowed errors
- Covers message deletion, status updates, timezone lookup failures

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Fix Silent Catch Block in LogFoodFromUPC

**Files:**
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs:206`

**Step 1: Fix line 206**

Replace:
```javascript
        } catch (e) {}
```
With:
```javascript
        } catch (e) {
          this.#logger.debug?.('logUPC.updateError.failed', { error: e.message });
        }
```

**Step 2: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs`
Expected: No output (success)

**Step 3: Commit**

```bash
git add backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs
git commit -m "$(cat <<'EOF'
fix(nutribot): add logging to silent catch block in LogFoodFromUPC

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Fix Vendor Names in Comments - Finance

**Files:**
- Modify: `backend/src/3_applications/finance/FinanceHarvestService.mjs:5, 12, 29, 240, 256`

**Step 1: Fix lines 5, 12, 29**

Replace the JSDoc header (lines 1-30 area):
```javascript
/**
 * FinanceHarvestService - Orchestrates financial data harvesting
 *
 * Coordinates the harvesting of financial data from external sources:
 * - Fetches transactions from the transaction source for each budget period
 * - Aggregates transaction data
 * - Computes budget summaries
 *
 * This service is adapter-agnostic; external sources are injected as dependencies.
 *
 * Dependencies:
 * - transactionSource: External transaction gateway
 * - budgetStore: Budget persistence
 * - accountStore: Account persistence
```

Update line 29 JSDoc:
```javascript
   * @param {Object} deps.transactionSource - Transaction gateway instance
```

**Step 2: Fix line 240**

Replace comment:
```javascript
    // transactionSource.getTransactions returns raw transaction objects
```

**Step 3: Fix line 256**

Replace comment:
```javascript
    // Get accounts from transaction source
```

**Step 4: Verify syntax**

Run: `node --check backend/src/3_applications/finance/FinanceHarvestService.mjs`
Expected: No output (success)

**Step 5: Commit**

```bash
git add backend/src/3_applications/finance/FinanceHarvestService.mjs
git commit -m "$(cat <<'EOF'
docs(finance): remove vendor names from FinanceHarvestService comments

- Replace 'Buxfer' with 'transaction source' in all comments
- Update JSDoc to use generic terminology

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Fix Vendor Names in Comments - Homebot

**Files:**
- Modify: `backend/src/3_applications/homebot/HomeBotContainer.mjs:29-30`
- Modify: `backend/src/3_applications/homebot/bot/HomeBotEventRouter.mjs:2, 5, 17`

**Step 1: Fix HomeBotContainer JSDoc (lines 29-30)**

Replace:
```javascript
   * @param {Object} config.messagingGateway - TelegramAdapter instance
   * @param {Object} config.aiGateway - OpenAIAdapter instance
```
With:
```javascript
   * @param {Object} config.messagingGateway - Messaging gateway for sending messages
   * @param {Object} config.aiGateway - AI gateway for chat completions
```

**Step 2: Fix HomeBotEventRouter header (lines 2, 5, 17)**

Replace:
```javascript
/**
 * HomeBotEventRouter - Routes Telegram events to use cases
 *
 * ...
 * Handles incoming Telegram events (text, voice, callbacks, commands)
```
With:
```javascript
/**
 * HomeBotEventRouter - Routes messaging events to use cases
 *
 * ...
 * Handles incoming messaging events (text, voice, callbacks, commands)
```

And around line 17:
```javascript
 * HomeBotEventRouter - Routes messaging events to use cases
```

**Step 3: Verify syntax**

Run: `node --check backend/src/3_applications/homebot/HomeBotContainer.mjs && node --check backend/src/3_applications/homebot/bot/HomeBotEventRouter.mjs`
Expected: No output (success)

**Step 4: Commit**

```bash
git add backend/src/3_applications/homebot/
git commit -m "$(cat <<'EOF'
docs(homebot): remove vendor names from comments

- Replace 'TelegramAdapter' with 'Messaging gateway'
- Replace 'OpenAIAdapter' with 'AI gateway'
- Replace 'Telegram events' with 'messaging events'

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Fix Vendor Names in Comments - Journalist

**Files:**
- Modify: `backend/src/3_applications/journalist/ports/IMessageQueueRepository.mjs:34`
- Modify: `backend/src/3_applications/journalist/usecases/SendMorningDebrief.mjs:5, 33, 63, 218`
- Modify: `backend/src/3_applications/journalist/usecases/HandleSlashCommand.mjs:89`
- Modify: `backend/src/3_applications/journalist/usecases/HandleCategorySelection.mjs:18, 45`
- Modify: `backend/src/3_applications/journalist/usecases/ProcessVoiceEntry.mjs:82`
- Modify: `backend/src/3_applications/journalist/usecases/HandleSourceSelection.mjs:22, 49`
- Modify: `backend/src/3_applications/journalist/usecases/HandleDebriefResponse.mjs:27, 60`

**Step 1: Fix IMessageQueueRepository.mjs line 34**

Replace:
```javascript
 * @param {string} messageId - Telegram message ID
```
With:
```javascript
 * @param {string} messageId - Message ID from messaging platform
```

**Step 2: Fix SendMorningDebrief.mjs**

Line 5: Replace:
```javascript
 * Sends the generated debrief to the user via Telegram with reply keyboard
```
With:
```javascript
 * Sends the generated debrief to the user via messaging gateway with reply keyboard
```

Line 33: Replace:
```javascript
   * @param {Object} deps.messagingGateway - Telegram gateway
```
With:
```javascript
   * @param {Object} deps.messagingGateway - Messaging gateway for sending messages
```

Line 63: Replace:
```javascript
   * @param {string} input.conversationId - Telegram conversation ID
```
With:
```javascript
   * @param {string} input.conversationId - Conversation ID
```

Line 218: Replace:
```javascript
   * @returns {Object} Telegram inline keyboard markup
```
With:
```javascript
   * @returns {Object} Inline keyboard markup
```

**Step 3: Fix HandleSlashCommand.mjs line 89**

Replace:
```javascript
            // Step 2: Send to Telegram
```
With:
```javascript
            // Step 2: Send via messaging gateway
```

**Step 4: Fix HandleCategorySelection.mjs lines 18, 45**

Line 18: Replace:
```javascript
   * @param {Object} deps.messagingGateway - Telegram gateway
```
With:
```javascript
   * @param {Object} deps.messagingGateway - Messaging gateway for sending messages
```

Line 45: Replace:
```javascript
   * @param {string} input.conversationId - Telegram conversation ID
```
With:
```javascript
   * @param {string} input.conversationId - Conversation ID
```

**Step 5: Fix ProcessVoiceEntry.mjs line 82**

Replace:
```javascript
      // 2. Send transcription confirmation (split if too long for Telegram)
```
With:
```javascript
      // 2. Send transcription confirmation (split if too long for messaging platform)
```

**Step 6: Fix HandleSourceSelection.mjs lines 22, 49**

Line 22: Replace:
```javascript
   * @param {Object} deps.messagingGateway - Telegram gateway
```
With:
```javascript
   * @param {Object} deps.messagingGateway - Messaging gateway for sending messages
```

Line 49: Replace:
```javascript
   * @param {string} input.conversationId - Telegram conversation ID
```
With:
```javascript
   * @param {string} input.conversationId - Conversation ID
```

**Step 7: Fix HandleDebriefResponse.mjs lines 27, 60**

Line 27: Replace:
```javascript
   * @param {Object} deps.messagingGateway - Telegram gateway
```
With:
```javascript
   * @param {Object} deps.messagingGateway - Messaging gateway for sending messages
```

Line 60: Replace:
```javascript
   * @param {string} input.conversationId - Telegram conversation ID
```
With:
```javascript
   * @param {string} input.conversationId - Conversation ID
```

**Step 8: Verify syntax**

Run: `for f in backend/src/3_applications/journalist/ports/*.mjs backend/src/3_applications/journalist/usecases/*.mjs; do node --check "$f" || echo "FAIL: $f"; done`
Expected: No output (all pass)

**Step 9: Commit**

```bash
git add backend/src/3_applications/journalist/
git commit -m "$(cat <<'EOF'
docs(journalist): remove vendor names from comments

- Replace 'Telegram' with 'messaging gateway/platform' throughout
- Update JSDoc @param descriptions to use generic terminology
- Affects ports and 6 use case files

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Fix Vendor Names in Comments - Nutribot

**Files:**
- Modify: `backend/src/3_applications/nutribot/ports/IMessagingGateway.mjs:4`
- Modify: `backend/src/3_applications/nutribot/config/NutriBotConfig.mjs:50-52, 147`
- Modify: `backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs:162`

**Step 1: Fix IMessagingGateway.mjs line 4**

Replace:
```javascript
 * Port interface for messaging operations (Telegram-agnostic)
```
With:
```javascript
 * Port interface for messaging operations (platform-agnostic)
```

**Step 2: Fix NutriBotConfig.mjs validation comments (lines 50-52)**

These are acceptable as they reference config key names, not vendor code. Skip or optionally rename config keys in a future schema migration.

**Step 3: Fix NutriBotConfig.mjs line 147**

Replace:
```javascript
   * Get Telegram bot ID
```
With:
```javascript
   * Get messaging bot ID
```

**Step 4: Fix LogFoodFromUPC.mjs line 162**

Replace:
```javascript
      // 10. Send photo message (Telegram fetches remote URLs directly)
```
With:
```javascript
      // 10. Send photo message (messaging platform fetches remote URLs)
```

**Step 5: Verify syntax**

Run: `node --check backend/src/3_applications/nutribot/ports/IMessagingGateway.mjs && node --check backend/src/3_applications/nutribot/config/NutriBotConfig.mjs && node --check backend/src/3_applications/nutribot/usecases/LogFoodFromUPC.mjs`
Expected: No output (success)

**Step 6: Commit**

```bash
git add backend/src/3_applications/nutribot/
git commit -m "$(cat <<'EOF'
docs(nutribot): remove vendor names from comments

- Replace 'Telegram' references with platform-agnostic terminology
- Update port interface and config documentation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Final Verification

**Step 1: Run grep to verify no adapter imports remain**

Run: `grep -rn "from ['\"].*2_adapters" backend/src/3_applications/`
Expected: No output (no matches)

**Step 2: Run grep to verify vendor names reduced**

Run: `grep -rnic "telegram\|buxfer" backend/src/3_applications/ | grep -v ":0$" | wc -l`
Expected: Significantly fewer matches than before (original was ~50)

**Step 3: Run syntax check on all modified files**

Run: `for f in backend/src/3_applications/**/*.mjs; do node --check "$f" 2>/dev/null || echo "FAIL: $f"; done`
Expected: No failures

**Step 4: Commit final state**

No commit needed - verification only.

---

## Summary

| Task | Files | Violation Type | Severity |
|------|-------|----------------|----------|
| 1 | JournalistContainer | Direct adapter imports | HIGH |
| 2 | NutriBotConfig | Adapter import + vendor naming | HIGH |
| 3 | PayrollSyncService | Vendor naming + config knowledge | HIGH |
| 4 | LogFoodFromVoice | Vendor error parsing | HIGH |
| 5-8 | Nutribot use cases | Silent catch blocks | MEDIUM |
| 9 | FinanceHarvestService | Vendor comments | MEDIUM |
| 10 | Homebot | Vendor comments | MEDIUM |
| 11 | Journalist use cases | Vendor comments | MEDIUM |
| 12 | Nutribot | Vendor comments | MEDIUM |
| 13 | Verification | N/A | N/A |

**Total: 13 tasks, ~47 violations fixed**
