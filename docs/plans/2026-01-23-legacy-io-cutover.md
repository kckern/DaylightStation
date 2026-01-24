# Legacy IO Cutover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all legacy `_legacy/lib/io.mjs`, `_legacy/lib/config`, and `_legacy/lib/utils.mjs` imports in migrated DDD services with new infrastructure equivalents.

**Architecture:** Direct import replacements - the new infrastructure already provides all needed functionality:
- `UserDataService` provides `readUserData`/`writeUserData` (replaces `userLoadFile`/`userSaveFile`)
- `ConfigService` provides config access (replaces legacy `configService`)
- `strings.mjs` provides `slugify` (replaces `utils.mjs` import)

**Tech Stack:** ES modules, YAML file I/O, Node.js

---

## Task 1: Fix slugify import in MediaMemoryService

**Files:**
- Modify: `backend/src/1_domains/content/services/MediaMemoryService.mjs:17`

**Step 1: Update the import statement**

Change:
```javascript
import { slugify } from '../../../../_legacy/lib/utils.mjs';
```

To:
```javascript
import { slugify } from '../../../0_infrastructure/utils/strings.mjs';
```

**Step 2: Verify no runtime errors**

Run: `node -e "import('./backend/src/1_domains/content/services/MediaMemoryService.mjs').then(() => console.log('OK')).catch(e => console.error(e))"`

Expected: `OK`

**Step 3: Commit**

```bash
git add backend/src/1_domains/content/services/MediaMemoryService.mjs
git commit -m "refactor(content): use strings.mjs instead of legacy utils for slugify

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Fix configService import in EntropyService

**Files:**
- Modify: `backend/src/1_domains/entropy/services/EntropyService.mjs:215`

**Step 1: Update the dynamic import**

In the `createWithLegacyDependencies` function around line 215, change:
```javascript
const { configService } = await import('../../../../_legacy/lib/config/index.mjs');
```

To:
```javascript
const { configService } = await import('../../../0_infrastructure/config/index.mjs');
```

**Step 2: Verify no runtime errors**

Run: `node -e "import('./backend/src/1_domains/entropy/services/EntropyService.mjs').then(m => console.log('exports:', Object.keys(m))).catch(e => console.error(e))"`

Expected: Lists exports including `EntropyService` and `createWithLegacyDependencies`

**Step 3: Commit**

```bash
git add backend/src/1_domains/entropy/services/EntropyService.mjs
git commit -m "refactor(entropy): use new ConfigService instead of legacy config

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update ArchiveService to use UserDataService

**Files:**
- Modify: `backend/src/1_domains/content/services/ArchiveService.mjs:25`

**Step 1: Replace import**

Change line 25:
```javascript
import { userLoadFile, userSaveFile } from '../../../../_legacy/lib/io.mjs';
```

To:
```javascript
import { userDataService } from '../../../0_infrastructure/config/index.mjs';
```

**Step 2: Create adapter functions**

After the logger definition (around line 32), add adapter functions that map legacy function signatures to UserDataService:

```javascript
/**
 * Adapter: Load user lifelog file (wraps UserDataService)
 * @param {string} username
 * @param {string} service - e.g., 'fitness' or 'archives/lastfm/2024'
 * @returns {object|null}
 */
const userLoadFile = (username, service) => {
  return userDataService.readUserData(username, `lifelog/${service}`);
};

/**
 * Adapter: Save user lifelog file (wraps UserDataService)
 * @param {string} username
 * @param {string} service
 * @param {object} data
 * @returns {boolean}
 */
const userSaveFile = (username, service, data) => {
  return userDataService.writeUserData(username, `lifelog/${service}`, data);
};
```

**Step 3: Verify no runtime errors**

Run: `node -e "import('./backend/src/1_domains/content/services/ArchiveService.mjs').then(m => console.log('exports:', Object.keys(m))).catch(e => console.error(e))"`

Expected: Lists exports including `getHotData`, `saveToHot`, etc.

**Step 4: Commit**

```bash
git add backend/src/1_domains/content/services/ArchiveService.mjs
git commit -m "refactor(archive): use UserDataService instead of legacy io.mjs

Replaces direct legacy io.mjs imports with adapter functions
that wrap UserDataService methods.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Update EntropyService to use UserDataService

**Files:**
- Modify: `backend/src/1_domains/entropy/services/EntropyService.mjs:214-216`

**Step 1: Replace io.mjs import**

In the `createWithLegacyDependencies` function around line 214, change:
```javascript
const { userLoadFile, userLoadCurrent } = await import('../../../../_legacy/lib/io.mjs');
```

To:
```javascript
const { userDataService } = await import('../../../0_infrastructure/config/index.mjs');

// Adapter functions for YamlEntropyReader interface
const userLoadFile = (username, service) => userDataService.readUserData(username, `lifelog/${service}`);
const userLoadCurrent = (username, service) => userDataService.readUserData(username, `current/${service}`);
```

**Step 2: Update ArchiveService import to use migrated version**

Change line 216:
```javascript
const ArchiveServiceModule = await import('../../../../_legacy/lib/ArchiveService.mjs');
```

To:
```javascript
const ArchiveServiceModule = await import('../../content/services/ArchiveService.mjs');
```

**Step 3: Verify no runtime errors**

Run: `node -e "import('./backend/src/1_domains/entropy/services/EntropyService.mjs').then(m => m.createWithLegacyDependencies().then(() => console.log('OK'))).catch(e => console.error(e))"`

Expected: `OK` (or specific error about missing config, which is expected without full bootstrap)

**Step 4: Commit**

```bash
git add backend/src/1_domains/entropy/services/EntropyService.mjs
git commit -m "refactor(entropy): use UserDataService and migrated ArchiveService

Removes all legacy io.mjs and ArchiveService dependencies from
EntropyService. Uses adapter functions for io interface compatibility.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Verify no remaining legacy imports in migrated services

**Step 1: Run grep to confirm cleanup**

Run: `grep -r "_legacy/lib/io\|_legacy/lib/config\|_legacy/lib/utils" backend/src/`

Expected: No matches (empty output)

**Step 2: Run grep for any remaining _legacy imports in src**

Run: `grep -rn "from.*_legacy" backend/src/ | grep -v chatbots | grep -v "\.mjs:.*//"`

Expected: Only chatbot-related imports should remain (nutribot webhook infrastructure)

**Step 3: Document remaining legacy usage**

The following legacy imports are intentionally retained (chatbot infrastructure not yet migrated):
- `backend/src/4_api/routers/nutribot.mjs` - TelegramWebhookHandler
- `backend/src/3_applications/nutribot/config/NutriBotConfig.mjs` - chatbot infrastructure

**Step 4: Commit verification note (optional)**

If all checks pass, no commit needed. The audit is complete.

---

## Summary

After completing all tasks:
- ✅ `slugify` imports use `strings.mjs`
- ✅ `configService` imports use new `ConfigService`
- ✅ `userLoadFile`/`userSaveFile` replaced with `UserDataService` wrappers
- ✅ Migrated `ArchiveService` used instead of legacy
- ⏳ Chatbot infrastructure remains on legacy (future migration)
