# Adapter Layer DDD Audit Report

> Comprehensive audit of `/backend/src/2_adapters/` against adapter-layer-guidelines.md
> Date: 2026-01-26

---

## Executive Summary

**Total violations: 130+ instances across 60+ files**

The adapter layer has widespread violations, with raw I/O imports being the most pervasive issue. Nearly every datastore imports `path` directly, many gateway adapters use raw `fetch()` instead of a system HttpClient, and the "Store" naming convention needs migration to "Datastore". Most adapters also lack proper port interface implementations.

### Severity Breakdown

| Severity | Count | Categories |
|----------|-------|------------|
| **CRITICAL** | 35+ | Raw fetch/axios, raw fs imports |
| **HIGH** | 60+ | Raw path imports, Store naming, missing port extends |
| **MEDIUM** | 35+ | Vendor errors leaking, ConfigService injection, business logic |

---

## Priority 1: Critical Violations

### 1.1 Raw HTTP Client Usage

**Impact:** Adapters should not know about axios vs fetch. System layer should provide HttpClient.

| File | Line | Usage |
|------|------|-------|
| `telegram/TelegramMessagingAdapter.mjs` | 21, 153 | `await fetch(...)` |
| `ai/OpenAIFoodParserAdapter.mjs` | 27 | `await fetch(...)` |
| `ai/OpenAIAdapter.mjs` | 250 | `this.httpClient.fetch(...)` (partial fix) |
| `ai/AnthropicAdapter.mjs` | 116 | `this.httpClient.fetch(...)` (partial fix) |
| `messaging/TelegramVoiceTranscriptionService.mjs` | 75 | `await fetch(...)` |
| `content/media/plex/PlexClient.mjs` | 44 | `await fetch(...)` |
| `content/media/plex/PlexAdapter.mjs` | 602 | `await fetch(...)` |
| `home-automation/homeassistant/HomeAssistantAdapter.mjs` | 300 | `await fetch(...)` |
| `nutribot/UPCGateway.mjs` | 63 | `await fetch(...)` |
| `nutrition/NutritionixAdapter.mjs` | 36 | `await fetch(...)` |
| `hardware/tts/TTSAdapter.mjs` | 13 | `import axios from 'axios'` |

**Fix:** Create `#system/services/HttpClient` and inject via constructor.

---

### 1.2 Raw File System Imports

**Impact:** File I/O mechanics belong in system layer, not adapters.

| File | Line | Import |
|------|------|--------|
| `home-automation/remote-exec/RemoteExecAdapter.mjs` | 12 | `import fs from 'fs'` |
| `hardware/thermal-printer/ThermalPrinterAdapter.mjs` | 18 | `import fs from 'fs'` |
| `nutribot/rendering/NutriReportRenderer.mjs` | 11 | `import fs from 'fs'` |

**Fix:** Use `#system/utils/FileIO` for all file operations.

---

## Priority 2: High-Severity Violations

### 2.1 Raw Path Imports

**Impact:** Path construction should use system utilities or receive resolved paths via config.

21 files import `path` directly:

| Domain | Files |
|--------|-------|
| `persistence/yaml/` | `YamlFinanceStore`, `YamlConversationStore`, `YamlJournalEntryRepository`, `YamlJournalStore`, `YamlFoodLogStore`, `YamlNutriCoachStore`, `YamlGratitudeStore`, `YamlWeatherStore`, `YamlSessionStore`, `YamlNutriListStore`, `YamlWatchStateStore` |
| `scheduling/` | `YamlStateStore`, `YamlJobStore` |
| `messaging/` | `YamlConversationStateStore` |
| `journalist/` | `DebriefRepository` |
| `content/` | `LocalContentAdapter`, `FilesystemAdapter`, `PlexAdapter`, `FolderAdapter` |
| `home-automation/` | `RemoteExecAdapter` |
| `nutribot/` | `NutriReportRenderer` |

**Fix:** Either use `#system/utils/FileIO` path helpers or receive fully-resolved paths via constructor config.

---

### 2.2 Store → Datastore Naming

**Impact:** "Store" naming is ambiguous (e-commerce connotation). Guidelines specify "Datastore".

**Adapter classes to rename (17):**

| Current Name | New Name |
|--------------|----------|
| `YamlStateStore` | `YamlStateDatastore` |
| `YamlJobStore` | `YamlJobDatastore` |
| `YamlConversationStateStore` | `YamlConversationStateDatastore` |
| `YamlFinanceStore` | `YamlFinanceDatastore` |
| `YamlConversationStore` | `YamlConversationDatastore` |
| `YamlHealthStore` | `YamlHealthDatastore` |
| `YamlJournalStore` | `YamlJournalDatastore` |
| `YamlFoodLogStore` | `YamlFoodLogDatastore` |
| `YamlNutriCoachStore` | `YamlNutriCoachDatastore` |
| `YamlGratitudeStore` | `YamlGratitudeDatastore` |
| `YamlWeatherStore` | `YamlWeatherDatastore` |
| `YamlSessionStore` | `YamlSessionDatastore` |
| `YamlNutriListStore` | `YamlNutriListDatastore` |
| `YamlWatchStateStore` | `YamlWatchStateDatastore` |
| `YamlNutriLogStore` | `YamlNutriLogDatastore` |
| `YamlAuthStore` | `YamlAuthDatastore` |
| `YamlLifelogStore` | `YamlLifelogDatastore` |

**Port interfaces to rename (15):**

| Current Name | New Name |
|--------------|----------|
| `IWatchStateStore` | `IWatchStateDatastore` |
| `ISessionStore` | `ISessionDatastore` |
| `IGratitudeStore` | `IGratitudeDatastore` |
| `IHealthDataStore` | `IHealthDataDatastore` |
| `IJournalStore` | `IJournalDatastore` |
| `IConversationStateStore` | `IConversationStateDatastore` |
| `IConversationStore` | `IConversationDatastore` |
| `IFoodLogStore` | `IFoodLogDatastore` |
| `INutriCoachStore` | `INutriCoachDatastore` |
| `INutriListStore` | `INutriListDatastore` |
| `IJobStore` | `IJobDatastore` |
| `IStateStore` | `IStateDatastore` |
| `INutriLogStore` | `INutriLogDatastore` |
| `IMemoryStore` | `IMemoryDatastore` |

**Fix:** Batch rename with file renames and import updates.

---

### 2.3 Missing Port Interface Implementation

**Impact:** Adapters should explicitly extend their port interfaces for type safety and documentation.

**Datastores without `extends` (10):**

| File | Class |
|------|-------|
| `persistence/yaml/YamlFinanceStore.mjs` | `YamlFinanceStore` |
| `persistence/yaml/YamlConversationStore.mjs` | `YamlConversationStore` |
| `persistence/yaml/YamlJournalStore.mjs` | `YamlJournalStore` |
| `persistence/yaml/YamlGratitudeStore.mjs` | `YamlGratitudeStore` |
| `persistence/yaml/YamlWeatherStore.mjs` | `YamlWeatherStore` |
| `persistence/yaml/YamlSessionStore.mjs` | `YamlSessionStore` |
| `persistence/yaml/YamlWatchStateStore.mjs` | `YamlWatchStateStore` |
| `persistence/yaml/YamlNutriLogStore.mjs` | `YamlNutriLogStore` |
| `harvester/YamlAuthStore.mjs` | `YamlAuthStore` |
| `harvester/YamlLifelogStore.mjs` | `YamlLifelogStore` |

**Gateway adapters without `extends` (29):**

| Category | Adapters |
|----------|----------|
| **AI** | `OpenAIAdapter`, `AnthropicAdapter`, `OpenAIFoodParserAdapter` |
| **Messaging** | `TelegramMessagingAdapter`, `TelegramAdapter`, `GmailAdapter` |
| **Content** | `LocalContentAdapter`, `FilesystemAdapter`, `PlexAdapter`, `FolderAdapter` |
| **Home Automation** | `HomeAssistantAdapter`, `RemoteExecAdapter`, `KioskAdapter`, `TaskerAdapter`, `TVControlAdapter` |
| **Proxy** | `ImmichProxyAdapter`, `FreshRSSProxyAdapter`, `AudiobookshelfProxyAdapter`, `PlexProxyAdapter` |
| **Fitness** | `AmbientLedAdapter`, `StravaClientAdapter`, `FitnessSyncerAdapter` |
| **Finance** | `BuxferAdapter` |
| **Hardware** | `ThermalPrinterAdapter`, `TTSAdapter`, `MQTTSensorAdapter` |
| **Other** | `ConfigHouseholdAdapter`, `NutritionixAdapter`, `MastraAdapter` |

**Fix:** Add `extends I{PortName}` and import port interfaces.

---

## Priority 3: Medium-Severity Violations

### 3.1 Vendor Errors Leaking Upward

**Impact:** Application layer should not see vendor-specific error messages.

| File | Line | Error Message |
|------|------|---------------|
| `telegram/TelegramMessagingAdapter.mjs` | 34 | `Telegram API error: ${data.description}` |
| `ai/OpenAIFoodParserAdapter.mjs` | 46 | `OpenAI API error: ${data.error.message}` |
| `ai/AnthropicAdapter.mjs` | 286 | `Anthropic does not support audio transcription...` |
| `ai/AnthropicAdapter.mjs` | 294 | `Anthropic does not support embeddings...` |
| `messaging/TelegramAdapter.mjs` | 203 | `Telegram API error` |
| `content/media/plex/PlexClient.mjs` | 46 | `Plex API error: ${response.status}` |

**Fix:** Log vendor details internally, throw generic errors with `code` and `isTransient` properties.

---

### 3.2 Missing Error Code Pattern

**Impact:** Errors should have `code` property for programmatic handling.

Only 3 files set error codes (OpenAIAdapter, AnthropicAdapter for RATE_LIMIT only).

**No adapter sets `isTransient` flag** - 0 usages found.

**Fix:** Implement `#mapErrorCode()` and `#isTransient()` helpers in all gateway adapters.

---

### 3.3 ConfigService Injection

**Impact:** Adapters should receive resolved config values, not ConfigService instance.

| File | Issue |
|------|-------|
| `homebot/ConfigHouseholdAdapter.mjs` | Receives and stores `configService` instance, calls methods like `getHouseholdUsers()`, `getUserProfile()` |

**Fix:** Receive specific config values or create a dedicated config repository in system layer.

---

### 3.4 Cross-Adapter Imports

**Impact:** Adapters should not import from other adapters. Shared logic goes to system.

| File | Line | Import |
|------|------|--------|
| `messaging/TelegramAdapter.mjs` | 7 | `import { TelegramChatRef } from '../telegram/TelegramChatRef.mjs'` |
| `homebot/HomeBotInputRouter.mjs` | 3 | `import { InputEventType } from '../telegram/IInputEvent.mjs'` |
| `journalist/JournalistInputRouter.mjs` | 9 | `import { InputEventType } from '../telegram/IInputEvent.mjs'` |

**Fix:** Move `InputEventType` and `TelegramChatRef` to system layer or application ports if they're abstractions.

---

### 3.5 Use Case Import from Adapter

**Impact:** Adapters don't orchestrate - application layer calls adapters, not reverse.

| File | Line | Import |
|------|------|--------|
| `journalist/JournalistInputRouter.mjs` | 8 | `import { HandleSpecialStart } from '../../3_applications/journalist/usecases/HandleSpecialStart.mjs'` |

**Fix:** Inject use case via container, or have input router return parsed events for application layer to handle.

---

### 3.6 Business Logic in Adapters

**Impact:** Adapters translate, they don't make business decisions.

| File | Line | Logic |
|------|------|-------|
| `nutribot/UPCGateway.mjs` | 141-143 | Calorie color classification: `if (caloriesPerGram < 1.0) return 'green'` |
| `nutrition/NutritionixAdapter.mjs` | 67 | Calorie color logic: `if (!calories \|\| !grams) return 'yellow'` |

**Fix:** Move color classification to domain layer (nutrition domain service).

---

## Recommended Fix Order

### Phase 1: System Layer Prerequisites (Required First)

1. Create `#system/services/HttpClient` with standard interface
2. Verify `#system/utils/FileIO` has all needed path/file utilities
3. Move `InputEventType` to appropriate shared location

### Phase 2: Critical I/O Fixes (High Impact)

4. Replace all raw `fetch()` calls with injected HttpClient
5. Remove `axios` import from TTSAdapter
6. Replace `fs` imports with FileIO utilities
7. Replace `path` imports with FileIO path helpers or constructor config

### Phase 3: Naming Migration (Batch Operation)

8. Rename all `*Store.mjs` files to `*Datastore.mjs` in adapters
9. Rename all `I*Store.mjs` files to `I*Datastore.mjs` in application ports
10. Update all imports across codebase

### Phase 4: Port Implementation (Medium Impact)

11. Add `extends I{Port}` to all datastore classes
12. Add `extends I{Port}` to all gateway adapter classes
13. Create missing port interfaces where needed

### Phase 5: Error Handling Standardization (Medium Impact)

14. Add `#mapErrorCode()` to all gateway adapters
15. Add `#isTransient()` to all gateway adapters
16. Refactor error throws to use generic messages with codes

### Phase 6: Structural Cleanup (Low Impact)

17. Remove ConfigService injection from ConfigHouseholdAdapter
18. Remove cross-adapter imports
19. Remove use case import from JournalistInputRouter
20. Move business logic from UPCGateway and NutritionixAdapter to domain

---

## Appendix: Files by Violation Count

| File | Violations |
|------|------------|
| `persistence/yaml/YamlFoodLogStore.mjs` | 4 (path import, Store naming, missing extends, no error codes) |
| `telegram/TelegramMessagingAdapter.mjs` | 4 (raw fetch, missing extends, vendor error leak, no error codes) |
| `ai/OpenAIAdapter.mjs` | 3 (partial httpClient, missing extends, vendor in errors) |
| `content/media/plex/PlexAdapter.mjs` | 4 (raw fetch, path import, missing extends, vendor error leak) |
| `nutribot/UPCGateway.mjs` | 3 (raw fetch, business logic, no error codes) |
| `home-automation/homeassistant/HomeAssistantAdapter.mjs` | 3 (raw fetch, missing extends, no error codes) |
| `journalist/JournalistInputRouter.mjs` | 3 (cross-adapter import, use case import, InputEventType) |

---

## Related Documentation

- Guidelines: `docs/reference/core/adapter-layer-guidelines.md`
- Domain audit: `docs/_wip/audits/2026-01-26-domain-layer-ddd-audit.md`
- Application audit: `docs/_wip/audits/2026-01-26-application-layer-ddd-audit.md`
