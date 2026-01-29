# Port Interface Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move port interfaces from application layer (`#apps/*/ports/`) to domain layer (`#domains/*/ports/`) to fix DDD dependency violations.

**Architecture:** Port interfaces define contracts that adapters implement. In DDD, ports belong in the domain layer since domains own the contracts. Adapters and applications import from domains, not the reverse. This migration moves ~50 interface files across 14 domains.

**Tech Stack:** Node.js ES modules with import aliases (`#domains/*`, `#apps/*`, `#adapters/*`)

---

## Phase 1: Simple Domains (1 interface each)

### Task 1: Migrate scheduling/IJobDatastore

**Files:**
- Create: `backend/src/1_domains/scheduling/ports/IJobDatastore.mjs`
- Create: `backend/src/1_domains/scheduling/ports/index.mjs`
- Modify: `backend/src/1_domains/scheduling/index.mjs`
- Modify: `backend/src/2_adapters/scheduling/YamlJobDatastore.mjs`
- Delete: `backend/src/3_applications/scheduling/ports/IJobDatastore.mjs` (after verification)

**Step 1: Create domain ports directory**

```bash
mkdir -p backend/src/1_domains/scheduling/ports
```

**Step 2: Copy interface to domain**

Copy `backend/src/3_applications/scheduling/ports/IJobDatastore.mjs` to `backend/src/1_domains/scheduling/ports/IJobDatastore.mjs`

Update the JSDoc import path in the new file - change:
```javascript
@returns {Promise<import('../entities/Job.mjs').Job[]>}
```
to:
```javascript
@returns {Promise<import('../entities/Job.mjs').Job[]>}
```
(path stays same since entities are in same domain)

**Step 3: Create ports/index.mjs barrel**

```javascript
// backend/src/1_domains/scheduling/ports/index.mjs
export { IJobDatastore } from './IJobDatastore.mjs';
export { IStateDatastore } from './IStateDatastore.mjs';
```

**Step 4: Update domain index.mjs**

Change `backend/src/1_domains/scheduling/index.mjs` from:
```javascript
// Ports moved to application layer - re-export for backward compatibility
export { IJobDatastore } from '#apps/scheduling/ports/IJobDatastore.mjs';
export { IStateDatastore } from '#apps/scheduling/ports/IStateDatastore.mjs';
```
to:
```javascript
// Ports - domain owns these contracts
export { IJobDatastore } from './ports/IJobDatastore.mjs';
export { IStateDatastore } from './ports/IStateDatastore.mjs';
```

**Step 5: Update adapter import**

Change `backend/src/2_adapters/scheduling/YamlJobDatastore.mjs` from:
```javascript
import { IJobDatastore } from '#apps/scheduling/ports/IJobDatastore.mjs';
```
to:
```javascript
import { IJobDatastore } from '#domains/scheduling';
```

**Step 6: Verify imports work**

```bash
node -e "import('#domains/scheduling').then(m => console.log('IJobDatastore:', typeof m.IJobDatastore))"
```
Expected: `IJobDatastore: function`

**Step 7: Commit**

```bash
git add backend/src/1_domains/scheduling/ports/
git add backend/src/1_domains/scheduling/index.mjs
git add backend/src/2_adapters/scheduling/YamlJobDatastore.mjs
git commit -m "refactor(scheduling): move IJobDatastore to domain layer"
```

---

### Task 2: Migrate scheduling/IStateDatastore

**Files:**
- Create: `backend/src/1_domains/scheduling/ports/IStateDatastore.mjs`
- Modify: `backend/src/2_adapters/scheduling/YamlStateDatastore.mjs`

**Step 1: Copy interface to domain**

Copy `backend/src/3_applications/scheduling/ports/IStateDatastore.mjs` to `backend/src/1_domains/scheduling/ports/IStateDatastore.mjs`

**Step 2: Update adapter import**

Change `backend/src/2_adapters/scheduling/YamlStateDatastore.mjs` from:
```javascript
import { IStateDatastore } from '#apps/scheduling/ports/IStateDatastore.mjs';
```
to:
```javascript
import { IStateDatastore } from '#domains/scheduling';
```

**Step 3: Verify imports work**

```bash
node -e "import('#domains/scheduling').then(m => console.log('IStateDatastore:', typeof m.IStateDatastore))"
```

**Step 4: Delete old app ports (both files)**

```bash
rm backend/src/3_applications/scheduling/ports/IJobDatastore.mjs
rm backend/src/3_applications/scheduling/ports/IStateDatastore.mjs
rm backend/src/3_applications/scheduling/ports/index.mjs
rmdir backend/src/3_applications/scheduling/ports
```

**Step 5: Run audit to verify**

```bash
node cli/audit/index.mjs scheduling --json | grep -c "domain-imports-application"
```
Expected: `0` (no violations for scheduling domain)

**Step 6: Commit**

```bash
git add -A backend/src/1_domains/scheduling/
git add -A backend/src/2_adapters/scheduling/
git add -A backend/src/3_applications/scheduling/
git commit -m "refactor(scheduling): complete port migration to domain layer"
```

---

### Task 3: Migrate health/IHealthDataDatastore

**Files:**
- Create: `backend/src/1_domains/health/ports/IHealthDataDatastore.mjs`
- Create: `backend/src/1_domains/health/ports/index.mjs`
- Modify: `backend/src/1_domains/health/index.mjs`
- Modify: `backend/src/2_adapters/persistence/yaml/YamlHealthDatastore.mjs`
- Delete: `backend/src/3_applications/health/ports/` (after verification)

**Step 1: Create domain ports directory and copy interface**

```bash
mkdir -p backend/src/1_domains/health/ports
```

Copy `backend/src/3_applications/health/ports/IHealthDataDatastore.mjs` to `backend/src/1_domains/health/ports/IHealthDataDatastore.mjs`

**Step 2: Create ports/index.mjs barrel**

```javascript
// backend/src/1_domains/health/ports/index.mjs
export { IHealthDataDatastore } from './IHealthDataDatastore.mjs';
```

**Step 3: Update domain index.mjs**

Change `backend/src/1_domains/health/index.mjs` export from:
```javascript
export { IHealthDataDatastore } from '#apps/health/ports/IHealthDataDatastore.mjs';
```
to:
```javascript
export { IHealthDataDatastore } from './ports/IHealthDataDatastore.mjs';
```

**Step 4: Update adapter import**

Change `backend/src/2_adapters/persistence/yaml/YamlHealthDatastore.mjs` from:
```javascript
import { IHealthDataDatastore } from '#apps/health/ports/IHealthDataDatastore.mjs';
```
to:
```javascript
import { IHealthDataDatastore } from '#domains/health';
```

**Step 5: Delete old app ports and verify**

```bash
rm -rf backend/src/3_applications/health/ports/
node cli/audit/index.mjs health --json | grep -c "domain-imports-application"
```
Expected: `0`

**Step 6: Commit**

```bash
git add -A backend/src/1_domains/health/
git add -A backend/src/2_adapters/persistence/yaml/YamlHealthDatastore.mjs
git add -A backend/src/3_applications/health/
git commit -m "refactor(health): move IHealthDataDatastore to domain layer"
```

---

### Task 4: Migrate gratitude/IGratitudeDatastore

**Files:**
- Create: `backend/src/1_domains/gratitude/ports/IGratitudeDatastore.mjs`
- Create: `backend/src/1_domains/gratitude/ports/index.mjs`
- Modify: `backend/src/1_domains/gratitude/index.mjs`
- Modify: `backend/src/2_adapters/persistence/yaml/YamlGratitudeDatastore.mjs`
- Delete: `backend/src/3_applications/gratitude/ports/`

**Step 1: Create domain ports directory and copy interface**

```bash
mkdir -p backend/src/1_domains/gratitude/ports
```

Copy `backend/src/3_applications/gratitude/ports/IGratitudeDatastore.mjs` to `backend/src/1_domains/gratitude/ports/IGratitudeDatastore.mjs`

**Step 2: Create ports/index.mjs barrel**

```javascript
// backend/src/1_domains/gratitude/ports/index.mjs
export { IGratitudeDatastore, isGratitudeDatastore } from './IGratitudeDatastore.mjs';
```

**Step 3: Update domain index.mjs**

Update export in `backend/src/1_domains/gratitude/index.mjs` to use local path.

**Step 4: Update adapter import**

Change `backend/src/2_adapters/persistence/yaml/YamlGratitudeDatastore.mjs` to import from `#domains/gratitude`.

**Step 5: Delete old app ports and verify**

```bash
rm -rf backend/src/3_applications/gratitude/ports/
node cli/audit/index.mjs gratitude --json | grep -c "domain-imports-application"
```

**Step 6: Commit**

```bash
git add -A backend/src/1_domains/gratitude/ backend/src/2_adapters/persistence/yaml/YamlGratitudeDatastore.mjs backend/src/3_applications/gratitude/
git commit -m "refactor(gratitude): move IGratitudeDatastore to domain layer"
```

---

### Task 5: Migrate journaling/IJournalDatastore

**Files:**
- Create: `backend/src/1_domains/journaling/ports/IJournalDatastore.mjs`
- Create: `backend/src/1_domains/journaling/ports/index.mjs`
- Modify: `backend/src/1_domains/journaling/index.mjs`
- Modify: `backend/src/2_adapters/persistence/yaml/YamlJournalDatastore.mjs`
- Delete: `backend/src/3_applications/journaling/ports/`

Follow same pattern as Task 4.

**Commit message:** `refactor(journaling): move IJournalDatastore to domain layer`

---

### Task 6: Migrate home-automation/IHomeAutomationGateway

**Files:**
- Create: `backend/src/1_domains/home-automation/ports/IHomeAutomationGateway.mjs`
- Create: `backend/src/1_domains/home-automation/ports/index.mjs`
- Modify: `backend/src/1_domains/home-automation/index.mjs`
- Delete: `backend/src/3_applications/home-automation/ports/`

Follow same pattern. Note: Check for adapter imports - may not have one.

**Commit message:** `refactor(home-automation): move IHomeAutomationGateway to domain layer`

---

### Task 7: Migrate finance/ITransactionSource

**Files:**
- Create: `backend/src/1_domains/finance/ports/ITransactionSource.mjs`
- Create: `backend/src/1_domains/finance/ports/index.mjs`
- Modify: `backend/src/1_domains/finance/index.mjs`
- Delete: `backend/src/3_applications/finance/ports/`

Follow same pattern.

**Commit message:** `refactor(finance): move ITransactionSource to domain layer`

---

### Task 8: Migrate entropy/IEntropyReader

**Files:**
- Create: `backend/src/1_domains/entropy/ports/IEntropyReader.mjs`
- Create: `backend/src/1_domains/entropy/ports/index.mjs`
- Modify: `backend/src/1_domains/entropy/index.mjs`
- Modify: `backend/src/1_domains/entropy/services/index.mjs` (if it imports from apps)
- Delete: `backend/src/3_applications/entropy/ports/`

Note: Domain currently has `export * from '#apps/entropy/ports/index.mjs'` - change to local.

**Commit message:** `refactor(entropy): move IEntropyReader to domain layer`

---

## Phase 2: Medium Domains (2-3 interfaces)

### Task 9: Migrate content ports

**Interfaces:**
- `IContentSource.mjs` (includes `validateAdapter`, `ContentSourceBase`)
- `IMediaProgressMemory.mjs`

**Files:**
- Create: `backend/src/1_domains/content/ports/IContentSource.mjs`
- Create: `backend/src/1_domains/content/ports/IMediaProgressMemory.mjs`
- Create: `backend/src/1_domains/content/ports/index.mjs`
- Modify: `backend/src/1_domains/content/index.mjs`
- Modify: `backend/src/1_domains/content/services/ContentSourceRegistry.mjs`
- Modify: `backend/src/2_adapters/persistence/yaml/YamlMediaProgressMemory.mjs`
- Delete: `backend/src/3_applications/content/ports/`

**Commit message:** `refactor(content): move port interfaces to domain layer`

---

### Task 10: Migrate fitness ports

**Interfaces:**
- `ISessionDatastore.mjs`
- `IFitnessSyncerGateway.mjs`
- `IZoneLedController.mjs`

**Files:**
- Create: `backend/src/1_domains/fitness/ports/*.mjs`
- Create: `backend/src/1_domains/fitness/ports/index.mjs`
- Modify: `backend/src/1_domains/fitness/index.mjs`
- Modify: `backend/src/2_adapters/persistence/yaml/YamlSessionDatastore.mjs`
- Delete: `backend/src/3_applications/fitness/ports/`

**Commit message:** `refactor(fitness): move port interfaces to domain layer`

---

## Phase 3: Complex Domains (4+ interfaces)

### Task 11: Migrate nutribot/nutrition ports

**Interfaces (7 files):**
- `IFoodLogDatastore.mjs`
- `INutriCoachDatastore.mjs`
- `INutriListDatastore.mjs`
- `INutriLogDatastore.mjs`
- `IFoodParser.mjs`
- `IResponseContext.mjs`
- `IMessagingGateway.mjs`

**Files:**
- Create: `backend/src/1_domains/nutrition/ports/*.mjs`
- Create: `backend/src/1_domains/nutrition/ports/index.mjs`
- Modify: `backend/src/1_domains/nutrition/index.mjs`
- Modify: Multiple adapters in `backend/src/2_adapters/persistence/yaml/`
- Modify: `backend/src/2_adapters/nutribot/NutribotInputRouter.mjs`
- Delete: `backend/src/3_applications/nutribot/ports/`

Note: Domain is `nutrition` but app is `nutribot` - keep interfaces in nutrition domain.

**Commit message:** `refactor(nutrition): move port interfaces to domain layer`

---

### Task 12: Migrate journalist ports

**Interfaces (4 files):**
- `IJournalEntryRepository.mjs`
- `IMessageQueueRepository.mjs`
- `IPromptTemplateRepository.mjs`
- `IQuizRepository.mjs`

**Files:**
- Create: `backend/src/1_domains/journalist/ports/*.mjs`
- Create: `backend/src/1_domains/journalist/ports/index.mjs`
- Modify: `backend/src/1_domains/journalist/index.mjs`
- Modify: `backend/src/2_adapters/journalist/JournalistInputRouter.mjs`
- Delete: `backend/src/3_applications/journalist/ports/`

**Commit message:** `refactor(journalist): move port interfaces to domain layer`

---

## Phase 4: Shared/Cross-Cutting Ports

### Task 13: Migrate shared ports to messaging domain

**Interfaces to move to `messaging` domain:**
- `IAIGateway.mjs`
- `IMessagingGateway.mjs`
- `INotificationChannel.mjs`
- `ITranscriptionService.mjs`
- `IConversationDatastore.mjs`
- `IConversationStateDatastore.mjs`

**Files:**
- Create: `backend/src/1_domains/messaging/ports/*.mjs`
- Create: `backend/src/1_domains/messaging/ports/index.mjs`
- Modify: `backend/src/1_domains/messaging/index.mjs`
- Modify: `backend/src/2_adapters/ai/AnthropicAdapter.mjs`
- Modify: `backend/src/2_adapters/ai/OpenAIAdapter.mjs`
- Modify: `backend/src/2_adapters/messaging/TelegramVoiceTranscriptionService.mjs`
- Modify: `backend/src/2_adapters/messaging/YamlConversationStateDatastore.mjs`
- Modify: `backend/src/2_adapters/persistence/yaml/YamlConversationDatastore.mjs`
- Modify: `backend/src/2_adapters/telegram/IInputEvent.mjs`
- Modify: `backend/src/2_adapters/homebot/HomeBotInputRouter.mjs`
- Delete: `backend/src/3_applications/shared/ports/`

Note: Also move `InputEventType.mjs` from `#apps/shared/` to `#domains/messaging/`.

**Commit message:** `refactor(messaging): consolidate shared ports into messaging domain`

---

### Task 14: Migrate devices ports

**Interfaces:**
- `IDeviceControl.mjs`
- `IOsControl.mjs`
- `IContentControl.mjs`

**Files:**
- Create: `backend/src/1_domains/devices/ports/*.mjs` (may need to create domain)
- Modify: `backend/src/2_adapters/devices/DeviceFactory.mjs`
- Modify: `backend/src/3_applications/devices/services/Device.mjs`
- Modify: `backend/src/3_applications/devices/services/DeviceService.mjs`
- Delete: `backend/src/3_applications/devices/ports/`

Note: May need to create `1_domains/devices/` if it doesn't exist.

**Commit message:** `refactor(devices): move port interfaces to domain layer`

---

### Task 15: Migrate agents ports

**Interfaces:**
- `IAgentRuntime.mjs`
- `ITool.mjs`
- `IMemoryDatastore.mjs`

**Files:**
- Create: `backend/src/1_domains/agents/ports/*.mjs` (may need to create domain)
- Modify: `backend/src/0_system/bootstrap.mjs`
- Delete: `backend/src/3_applications/agents/ports/`

**Commit message:** `refactor(agents): move port interfaces to domain layer`

---

### Task 16: Migrate homebot ports

**Interfaces:**
- `IHouseholdRepository.mjs`
- `IConversationStateDatastore.mjs` (may duplicate messaging - check)

**Files:**
- Create or merge into existing domain ports
- Delete: `backend/src/3_applications/homebot/ports/`

**Commit message:** `refactor(homebot): move port interfaces to domain layer`

---

### Task 17: Migrate media ports

**Interfaces:**
- `IVideoSourceGateway.mjs`
- `IMediaStorageRepository.mjs`

**Files:**
- Create: `backend/src/1_domains/media/ports/*.mjs`
- Delete: `backend/src/3_applications/media/ports/`

**Commit message:** `refactor(media): move port interfaces to domain layer`

---

## Phase 5: Cleanup

### Task 18: Fix bootstrap.mjs relative imports

**File:** `backend/src/0_system/bootstrap.mjs`

Change all relative router imports from:
```javascript
import { createContentRouter } from '../4_api/v1/routers/content.mjs';
```
to:
```javascript
import { createContentRouter } from '#api/v1/routers/content.mjs';
```

There are ~25 such imports to fix.

**Commit message:** `refactor(bootstrap): use import aliases instead of relative paths`

---

### Task 19: Fix explicit index.mjs imports

**Files with explicit `/index.mjs` imports:**
- `backend/src/2_adapters/BaseInputRouter.mjs`
- `backend/src/0_system/bootstrap.mjs`

Change imports like:
```javascript
import { X } from '#adapters/nutribot/index.mjs';
```
to:
```javascript
import { X } from '#adapters/nutribot';
```

**Commit message:** `refactor: remove explicit index.mjs from imports`

---

### Task 20: Add missing default export to BaseInputRouter

**File:** `backend/src/2_adapters/BaseInputRouter.mjs`

Add at end of file:
```javascript
export default BaseInputRouter;
```

**Commit message:** `fix(adapters): add default export to BaseInputRouter`

---

### Task 21: Final audit verification

**Step 1: Run full audit**

```bash
node cli/audit/index.mjs --json > /tmp/final-audit.json
```

**Step 2: Check for remaining violations**

```bash
cat /tmp/final-audit.json | node -e "
  const data = require('/tmp/final-audit.json');
  console.log('Total violations:', data.violations.length);
  console.log('By severity:');
  const bySeverity = {};
  data.violations.forEach(v => bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1);
  console.log(bySeverity);
"
```

Expected: 0 critical, 0 high violations for layer imports.

**Step 3: Run server to verify no runtime errors**

```bash
node backend/index.js &
sleep 3
curl http://localhost:3112/api/health
pkill -f 'node backend/index.js'
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "refactor: complete DDD port interface migration

- Moved all port interfaces from applications to domains
- Updated all adapter imports to use #domains/*
- Fixed bootstrap.mjs relative imports
- Fixed explicit index.mjs imports

Closes audit violations: domain-imports-application, adapter-imports-application"
```

---

## Summary

| Phase | Tasks | Interfaces | Estimated Commits |
|-------|-------|------------|-------------------|
| 1: Simple | 1-8 | 8 | 8 |
| 2: Medium | 9-10 | 5 | 2 |
| 3: Complex | 11-12 | 11 | 2 |
| 4: Shared | 13-17 | 14 | 5 |
| 5: Cleanup | 18-21 | - | 4 |
| **Total** | **21** | **~38** | **~21** |

## Rollback

If issues arise, revert the commits:
```bash
git log --oneline | head -20  # Find commit before migration
git revert HEAD~N..HEAD       # Revert N commits
```

Or restore from the app layer (files won't be deleted until verified).
