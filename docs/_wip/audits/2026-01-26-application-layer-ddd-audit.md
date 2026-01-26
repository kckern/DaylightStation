# Application Layer DDD Audit

> **Date:** 2026-01-26
> **Scope:** `backend/src/3_applications/`
> **Reference:** `docs/reference/core/application-layer-guidelines.md`

---

## Executive Summary

**47 total violations found** across 7 applications. The most severe issues involve:
- Direct adapter imports breaking dependency inversion
- Vendor-specific naming throughout code and comments
- Silent catch blocks hiding errors
- Vendor error parsing creating tight coupling

| Severity | Count |
|----------|-------|
| HIGH     | 7     |
| MEDIUM   | 29    |
| LOW      | 11    |

---

## Priority 1: HIGH Severity (Fix Immediately)

### H1. Direct Adapter Imports

**Principle violated:** Application layer must never import from `2_adapters/`

| File | Line | Import |
|------|------|--------|
| `journalist/JournalistContainer.mjs` | 40 | `import { LoggingAIGateway } from '../../2_adapters/journalist/LoggingAIGateway.mjs'` |
| `journalist/JournalistContainer.mjs` | 41 | `import { DebriefRepository } from '../../2_adapters/journalist/DebriefRepository.mjs'` |
| `nutribot/config/NutriBotConfig.mjs` | 14 | `import { TelegramChatRef } from '../../../2_adapters/telegram/TelegramChatRef.mjs'` |

**Fix:** Inject adapters via constructor; define port interfaces in `3_applications/{app}/ports/`.

---

### H2. Vendor Names in Code (Variables/Methods)

**Principle violated:** Application layer code must use generic names

| File | Line | Violation |
|------|------|-----------|
| `finance/PayrollSyncService.mjs` | 14 | `#buxferAdapter` field name |
| `finance/PayrollSyncService.mjs` | 27 | `buxferAdapter` constructor param |
| `finance/PayrollSyncService.mjs` | 162 | `#uploadToBuxfer()` method name |
| `nutribot/config/NutriBotConfig.mjs` | 149 | `telegramBotId` getter |
| `nutribot/config/NutriBotConfig.mjs` | 50-52 | `config.telegram.botId` access |
| `nutribot/usecases/LogFoodFromVoice.mjs` | 112 | `isTelegramError` variable |

**Fix:** Rename to abstract terms:
- `#buxferAdapter` → `#transactionGateway`
- `#uploadToBuxfer()` → `#uploadTransactions()`
- `telegramBotId` → `messagingBotId`
- `isTelegramError` → `isTransportError`

---

### H3. Vendor Error Parsing

**Principle violated:** No vendor-specific error handling in application layer

**File:** `nutribot/usecases/LogFoodFromVoice.mjs:112-115`
```javascript
const isTelegramError = error.message?.includes('Telegram error') ||
  error.code === 'ETIMEDOUT' ||
  error.code === 'EAI_AGAIN' ||
  error.code === 'ECONNRESET';
```

**Fix:** Use error codes or `isTransient` flag from gateway:
```javascript
const isTransportError = error.code === 'ETIMEDOUT' ||
  error.code === 'ECONNRESET' ||
  error.isTransient === true;
```

---

### H4. Config Structure Knowledge

**Principle violated:** Application receives values, doesn't know where they came from

**File:** `finance/PayrollSyncService.mjs:42-54`
```javascript
#getPayrollConfig() {
  const auth = this.#configService.getUserAuth?.('payroll') || {};
  return {
    baseUrl: auth.base_url || auth.base,
    authKey: auth.cookie_name || auth.authkey,
    authCookie: auth.auth_cookie || auth.auth,
    // ... 4 more nested accesses
  };
}
```

**Fix:** Inject pre-resolved `payrollConfig` object via constructor.

---

## Priority 2: MEDIUM Severity (Fix This Sprint)

### M1. Path Construction in Application Layer

**Principle violated:** Application layer never builds file paths

**File:** `journalist/JournalistContainer.mjs:191`
```javascript
const dataPath = `${dataDir}/users/${configUsername}/lifelog/journalist`;
```

**Fix:** Delegate to ConfigService or repository:
```javascript
const dataPath = this.#configService.getUserDataPath(configUsername, 'journalist');
```

---

### M2. Silent Catch Blocks (11 instances)

**Principle violated:** Log silent degradation

| File | Lines |
|------|-------|
| `nutribot/usecases/LogFoodFromImage.mjs` | 99, 101, 174, 189 |
| `nutribot/usecases/LogFoodFromText.mjs` | 136 |
| `nutribot/usecases/GenerateDailyReport.mjs` | 88, 113, 172, 278, 378 |
| `nutribot/usecases/LogFoodFromUPC.mjs` | 206 |

**Example violation:**
```javascript
catch (e) {}
```

**Fix:** Add logging:
```javascript
catch (e) {
  this.#logger.warn?.('operation.failed', { error: e.message });
}
```

---

### M3. Vendor Names in JSDoc/Comments (29 instances)

**Principle violated:** Comments must not reference specific vendors

| File | Lines | Vendor Referenced |
|------|-------|-------------------|
| `homebot/HomeBotContainer.mjs` | 29-30 | TelegramAdapter, OpenAIAdapter |
| `homebot/bot/HomeBotEventRouter.mjs` | 2, 5, 17 | Telegram |
| `journalist/ports/IMessageQueueRepository.mjs` | 34 | "Telegram message ID" |
| `journalist/usecases/SendMorningDebrief.mjs` | 5, 33, 63, 218 | Telegram |
| `journalist/usecases/HandleSlashCommand.mjs` | 89 | Telegram |
| `journalist/usecases/HandleCategorySelection.mjs` | 18, 45 | Telegram |
| `journalist/usecases/HandleSourceSelection.mjs` | 6, 22, 49, 85 | strava, Telegram |
| `journalist/usecases/HandleDebriefResponse.mjs` | 27, 60 | Telegram |
| `journalist/usecases/ProcessVoiceEntry.mjs` | 82 | Telegram |
| `finance/FinanceHarvestService.mjs` | 5, 12, 29, 240, 256 | Buxfer |
| `finance/PayrollSyncService.mjs` | 4, 22, 140, 159, 204, 216 | Buxfer |
| `harvester/HarvesterService.mjs` | 93 | strava, lastfm |
| `harvester/HarvesterJobExecutor.mjs` | 50 | strava, lastfm |
| `nutribot/ports/IMessagingGateway.mjs` | 4 | Telegram-agnostic (ok but mentions it) |
| `nutribot/config/NutriBotConfig.mjs` | 50-52, 147, 360-361 | Telegram |
| `nutribot/usecases/LogFoodFromUPC.mjs` | 162 | Telegram |

**Fix examples:**
- `// TelegramAdapter instance` → `// Messaging gateway for sending messages`
- `// Fetches transactions from Buxfer` → `// Fetches transactions from external source`
- `// Telegram conversation ID` → `// Conversation ID`

---

## Priority 3: LOW Severity (Technical Debt)

### L1. Vendor Names as Examples in Harvester

**Files:** `harvester/HarvesterService.mjs:93`, `harvester/HarvesterJobExecutor.mjs:50`
```javascript
@param {string} serviceId - The harvester service ID (e.g., 'strava', 'lastfm')
```

This is borderline acceptable as documentation examples, but could use generic terms like `'fitness-tracker'`, `'music-service'`.

---

### L2. NutriBotConfig Telegram Field Access

**File:** `nutribot/config/NutriBotConfig.mjs:50-52`
```javascript
if (!config.telegram?.botId) errors.push('telegram.botId is required');
if (!config.telegram?.botToken) errors.push('telegram.botToken is required');
```

The NutriBotConfig is a boundary class that transforms raw config into domain values. This is acceptable if confined to config layer, but the `telegram` key names should be abstracted to `messaging`.

---

## Summary by Application

| Application | HIGH | MEDIUM | LOW | Status |
|-------------|------|--------|-----|--------|
| **nutribot** | 2 | 16 | 1 | Needs significant cleanup |
| **journalist** | 2 | 10 | 0 | Adapter imports, many comment violations |
| **finance** | 2 | 7 | 0 | Config knowledge, vendor naming |
| **homebot** | 0 | 3 | 0 | Comment violations only |
| **harvester** | 0 | 0 | 2 | Minor example mentions |
| **fitness** | 0 | 0 | 0 | Clean |
| **media** | 0 | 0 | 0 | Clean |

---

## Recommended Fix Order

### Week 1 (HIGH priority)
1. **JournalistContainer adapter imports** - Move adapter instantiation to bootstrap
2. **NutriBotConfig adapter import** - Create domain value object for chat refs
3. **PayrollSyncService** - Inject resolved config, rename vendor methods
4. **LogFoodFromVoice** - Remove vendor error parsing

### Week 2 (MEDIUM priority)
1. **Silent catch blocks in nutribot** - Add logging to all 11 instances
2. **Path construction in JournalistContainer** - Use ConfigService
3. **Comment cleanup** - Systematic find/replace across all files

### Ongoing
- Add pre-commit lint rule to detect `2_adapters` imports in `3_applications`
- Add lint rule to flag vendor names in application layer

---

## Appendix: Grep Commands Used

```bash
# Find adapter imports
grep -rn "from ['\"'].*2_adapters" backend/src/3_applications/

# Find vendor names
grep -rni "telegram\|plex\|openai\|buxfer\|strava" backend/src/3_applications/

# Find silent catches
grep -rn "catch\s*([^)]*)\s*{\s*}" backend/src/3_applications/

# Find path construction
grep -rn '\${.*Dir}' backend/src/3_applications/

# Find config knowledge
grep -rn "\.getUserAuth\|config\.[a-z]\+\.[a-z]\+\.[a-z]\+" backend/src/3_applications/
```
