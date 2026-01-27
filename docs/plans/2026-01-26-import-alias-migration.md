# Import Alias Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all relative imports to `0_system` with the `#system` path alias across the backend codebase.

**Architecture:** The codebase uses Node.js subpath imports defined in `package.json`. The `#system/*` alias maps to `./src/0_system/*`. All files using relative paths like `../../0_system/` should use `#system/` instead.

**Tech Stack:** Node.js ES modules, subpath imports

---

## Summary

**Files affected:** 55 files with ~90 import statements
**Pattern to fix:** `../[../]*/0_system/` → `#system/`

The replacement is mechanical - replace the relative path prefix with `#system/` while keeping the rest of the path intact.

---

### Task 1: Fix 2_adapters/telegram imports

**Files:**
- Modify: `backend/src/2_adapters/telegram/TelegramChatRef.mjs:11`

**Step 1: Apply fix**

Replace:
```javascript
import { ValidationError } from '../../0_system/utils/errors/index.mjs';
```

With:
```javascript
import { ValidationError } from '#system/utils/errors/index.mjs';
```

**Step 2: Verify syntax**

Run: `node --check backend/src/2_adapters/telegram/TelegramChatRef.mjs`
Expected: No output (syntax OK)

---

### Task 2: Fix 2_adapters/scheduling imports

**Files:**
- Modify: `backend/src/2_adapters/scheduling/YamlStateDatastore.mjs:11`
- Modify: `backend/src/2_adapters/scheduling/YamlJobDatastore.mjs:15`

**Step 1: Apply fixes**

In `YamlStateDatastore.mjs`, replace:
```javascript
import { loadYaml, saveYaml } from '../../0_system/utils/FileIO.mjs';
```
With:
```javascript
import { loadYaml, saveYaml } from '#system/utils/FileIO.mjs';
```

In `YamlJobDatastore.mjs`, replace:
```javascript
import { loadYaml } from '../../0_system/utils/FileIO.mjs';
```
With:
```javascript
import { loadYaml } from '#system/utils/FileIO.mjs';
```

**Step 2: Verify syntax**

Run: `node --check backend/src/2_adapters/scheduling/YamlStateDatastore.mjs && node --check backend/src/2_adapters/scheduling/YamlJobDatastore.mjs`

---

### Task 3: Fix 2_adapters/messaging imports

**Files:**
- Modify: `backend/src/2_adapters/messaging/GmailAdapter.mjs:6`
- Modify: `backend/src/2_adapters/messaging/TelegramAdapter.mjs:6`
- Modify: `backend/src/2_adapters/messaging/YamlConversationStateDatastore.mjs:30-31`

**Step 1: Apply fixes**

In `GmailAdapter.mjs`:
```javascript
// FROM:
import { nowTs24, nowDate } from '../../0_system/utils/index.mjs';
// TO:
import { nowTs24, nowDate } from '#system/utils/index.mjs';
```

In `TelegramAdapter.mjs`:
```javascript
// FROM:
import { readBinary, getBasename, fileExists } from '../../0_system/utils/FileIO.mjs';
// TO:
import { readBinary, getBasename, fileExists } from '#system/utils/FileIO.mjs';
```

In `YamlConversationStateDatastore.mjs` (two imports):
```javascript
// FROM:
} from '../../0_system/utils/FileIO.mjs';
import { nowTs24 } from '../../0_system/utils/index.mjs';
// TO:
} from '#system/utils/FileIO.mjs';
import { nowTs24 } from '#system/utils/index.mjs';
```

---

### Task 4: Fix 2_adapters/journalist imports

**Files:**
- Modify: `backend/src/2_adapters/journalist/LoggingAIGateway.mjs:9`
- Modify: `backend/src/2_adapters/journalist/DebriefRepository.mjs:14-15`

**Step 1: Apply fixes**

Replace all `../../0_system/` with `#system/`:
- `LoggingAIGateway.mjs`: `import { nowTs24 } from '#system/utils/index.mjs';`
- `DebriefRepository.mjs`: Two imports from `#system/utils/FileIO.mjs` and `#system/utils/index.mjs`

---

### Task 5: Fix 2_adapters/content imports

**Files:**
- Modify: `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs:15`
- Modify: `backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs:15`
- Modify: `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs:11`
- Modify: `backend/src/2_adapters/content/folder/FolderAdapter.mjs:10`

**Step 1: Apply fixes**

Replace all relative `0_system` paths with `#system/`:
```javascript
// All should become:
import { ... } from '#system/utils/FileIO.mjs';
```

---

### Task 6: Fix 2_adapters/persistence/yaml imports

**Files:** (12 files)
- `YamlWeatherDatastore.mjs`
- `YamlGratitudeDatastore.mjs`
- `YamlConversationDatastore.mjs`
- `YamlWatchStateDatastore.mjs`
- `YamlJournalEntryRepository.mjs`
- `YamlSessionDatastore.mjs`
- `YamlMessageQueueRepository.mjs`
- `YamlNutriLogDatastore.mjs`
- `YamlJournalDatastore.mjs`
- `YamlFinanceDatastore.mjs`
- `YamlNutriListDatastore.mjs`
- `YamlNutriCoachDatastore.mjs`
- `YamlFoodLogDatastore.mjs`

**Step 1: Apply fixes**

Replace all `../../../0_system/` with `#system/` in all files.

---

### Task 7: Fix 2_adapters/proxy imports

**Files:**
- `ImmichProxyAdapter.mjs`
- `FreshRSSProxyAdapter.mjs`
- `AudiobookshelfProxyAdapter.mjs`
- `PlexProxyAdapter.mjs`

**Step 1: Apply fixes**

Replace all `../../0_system/config/index.mjs` with `#system/config/index.mjs`.

---

### Task 8: Fix 2_adapters/fitness imports

**Files:**
- Modify: `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs:16`

**Step 1: Apply fix**

Replace `../../0_system/utils/index.mjs` with `#system/utils/index.mjs`.

---

### Task 9: Fix 2_adapters/home-automation imports

**Files:**
- `RemoteExecAdapter.mjs`
- `KioskAdapter.mjs`
- `HomeAssistantAdapter.mjs`
- `TaskerAdapter.mjs`

**Step 1: Apply fixes**

Replace all `../../../0_system/` with `#system/`.

---

### Task 10: Fix 2_adapters/finance imports

**Files:**
- Modify: `backend/src/2_adapters/finance/BuxferAdapter.mjs:8`

**Step 1: Apply fix**

Replace `../../0_system/utils/index.mjs` with `#system/utils/index.mjs`.

---

### Task 11: Fix 2_adapters/hardware imports

**Files:**
- `ThermalPrinterAdapter.mjs` (2 imports)
- `TTSAdapter.mjs`
- `MQTTSensorAdapter.mjs`

**Step 1: Apply fixes**

Replace all `../../../0_system/` with `#system/`.

---

### Task 12: Fix 2_adapters/harvester imports

**Files:** (13 files across social, other, productivity, fitness, finance, communication subdirs)
- `FoursquareHarvester.mjs`, `RedditHarvester.mjs`, `LastfmHarvester.mjs`
- `WeatherHarvester.mjs`
- `GitHubHarvester.mjs`, `ClickUpHarvester.mjs`, `TodoistHarvester.mjs`
- `FitnessSyncerAdapter.mjs`, `StravaHarvester.mjs`, `WithingsHarvester.mjs`
- `ShoppingHarvester.mjs`, `BuxferHarvester.mjs`
- `GmailHarvester.mjs`, `GCalHarvester.mjs`

**Step 1: Apply fixes**

Replace all `../../../0_system/` with `#system/`.

---

### Task 13: Fix 4_api/v1/handlers imports

**Files:**
- Modify: `backend/src/4_api/v1/handlers/nutribot/directInput.mjs:9`

**Step 1: Apply fix**

Replace `../../../../0_system/utils/index.mjs` with `#system/utils/index.mjs`.

---

### Task 14: Fix 4_api/v1/routers imports

**Files:** (13 files)
- `gratitude.mjs` (2 imports)
- `journaling.mjs`
- `homebot.mjs`
- `finance.mjs`
- `admin/eventbus.mjs`
- `item.mjs`
- `play.mjs`
- `nutribot.mjs`
- `messaging.mjs`
- `nutrition.mjs`
- `localContent.mjs` (2 imports)
- `journalist.mjs`
- `fitness.mjs`
- `content.mjs`
- `scheduling.mjs`

**Step 1: Apply fixes**

Replace all relative `0_system` imports with `#system/` equivalents.

---

### Task 15: Fix 4_api/middleware imports

**Files:**
- `legacyTracker.mjs`
- `cutoverFlags.mjs`

**Step 1: Apply fixes**

Replace `../../0_system/` with `#system/`.

---

### Task 16: Fix 3_applications imports

**Files:**
- `homebot/usecases/AssignItemToUser.mjs`
- `media/services/YouTubeDownloadService.mjs`
- `journalist/usecases/SendMorningDebrief.mjs`
- `journalist/usecases/RecordQuizAnswer.mjs`
- `journalist/usecases/ExportJournalMarkdown.mjs`
- `journalist/usecases/ProcessTextEntry.mjs`
- `journalist/usecases/ReviewJournalEntries.mjs`
- `journalist/usecases/SendQuizQuestion.mjs`
- `journalist/usecases/HandleDebriefResponse.mjs`
- `content/services/ArchiveService.mjs` (3 imports)
- `content/services/MediaMemoryService.mjs` (4 imports)
- `finance/FinanceHarvestService.mjs`
- `nutribot/config/NutriBotConfig.mjs` (4 imports)

**Step 1: Apply fixes**

Replace all relative `0_system` imports with `#system/` equivalents.

---

### Task 17: Fix 1_domains test imports

**Files:**
- `backend/src/1_domains/lifelog/services/__tests__/LifelogAggregator.test.mjs` (2 imports)

**Step 1: Apply fixes**

Replace `../../../../0_system/` with `#system/`.

---

### Task 18: Verify server starts

**Step 1: Stop any running dev server**

Run: `pkill -f 'node backend/index.js' || true`

**Step 2: Start server and verify no import errors**

Run: `cd /root/Code/DaylightStation && timeout 10 node backend/index.js 2>&1 | head -20`

Expected: Server starts without `ERR_MODULE_NOT_FOUND` errors

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: replace relative 0_system imports with #system alias

Migrates ~90 import statements across 55 files to use Node.js
subpath imports (#system/*) instead of relative paths to 0_system/.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Batch Execution Strategy

Since this is a mechanical find-and-replace task, all 17 file-modification tasks can be executed as a single sed/awk operation or via a script:

```bash
# Find all .mjs files with relative 0_system imports and fix them
find backend/src -name "*.mjs" -exec grep -l "from ['\"]\.\..*0_system" {} \; | while read f; do
  sed -i -E "s|from ['\"](\\.\\./)+0_system/|from '#system/|g" "$f"
done
```

This replaces any number of `../` followed by `0_system/` with `#system/`.
