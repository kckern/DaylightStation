# NutriBot UPC UserId Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete remediation for the UPC portion selection bug that saved food items to wrong user directories, including validation to prevent recurrence.

**Architecture:** Add input validation to `saveMany()` to reject invalid userIds (containing `:` or `/`), add comprehensive tests for the fix and validation, create a data migration script to rescue orphaned data.

**Tech Stack:** Node.js/ES modules, Jest for testing, YAML file operations

---

## Background

The fix has already been applied to `SelectUPCPortion.mjs` (line 137: `userId: userId`). This plan covers:
1. Adding a regression test to prove the fix works
2. Adding userId validation to `saveMany()` to prevent invalid paths
3. Creating a data migration script to move orphaned data

---

### Task 1: Add Regression Test for userId in saveMany

**Files:**
- Modify: `tests/unit/suite/applications/nutribot/SelectUPCPortion.test.mjs`

**Step 1: Write the failing test (it should pass since fix is applied)**

Add this test to verify `saveMany` is called with correct userId:

```javascript
it('passes userId (not conversationId) to nutriListStore.saveMany', async () => {
  let savedItems = null;
  mockNutriListStore.saveMany = jest.fn().mockImplementation((items) => {
    savedItems = items;
    return Promise.resolve();
  });

  await useCase.execute({
    userId: 'kckern',
    conversationId: 'telegram:b6898194425_c575596036',
    logUuid: 'abc123',
    portionFactor: 1,
    messageId: '50',
  });

  expect(savedItems).not.toBeNull();
  expect(savedItems.length).toBeGreaterThan(0);
  expect(savedItems[0].userId).toBe('kckern');
  expect(savedItems[0].chatId).toBe('telegram:b6898194425_c575596036');
});
```

**Step 2: Run test to verify it passes**

Run: `node tests/unit/harness.mjs --pattern=SelectUPCPortion`
Expected: PASS (fix already applied)

**Step 3: Commit**

```bash
git add tests/unit/suite/applications/nutribot/SelectUPCPortion.test.mjs
git commit -m "test(nutribot): add regression test for userId in saveMany

Ensures SelectUPCPortion passes userId (not conversationId) to
nutriListStore.saveMany, preventing items from being saved to
wrong user directories.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Add Unit Tests for YamlNutriListDatastore

**Files:**
- Create: `tests/unit/suite/adapters/persistence/YamlNutriListDatastore.test.mjs`

**Step 1: Write the test file**

```javascript
// tests/unit/suite/adapters/persistence/YamlNutriListDatastore.test.mjs
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { YamlNutriListDatastore } from '#adapters/persistence/yaml/YamlNutriListDatastore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('YamlNutriListDatastore', () => {
  let datastore;
  let tempDir;
  let mockUserDataService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrilist-test-'));

    mockUserDataService = {
      getUserPath: jest.fn().mockImplementation((userId, subpath) => {
        return path.join(tempDir, 'users', userId, subpath);
      }),
    };

    datastore = new YamlNutriListDatastore({
      userDataService: mockUserDataService,
      logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('throws if userDataService is not provided', () => {
      expect(() => new YamlNutriListDatastore({}))
        .toThrow(InfrastructureError);
    });
  });

  describe('saveMany', () => {
    it('saves items to correct user directory', async () => {
      const items = [{
        userId: 'testuser',
        label: 'Test Food',
        calories: 200,
        date: '2026-01-31',
      }];

      await datastore.saveMany(items);

      expect(mockUserDataService.getUserPath).toHaveBeenCalledWith(
        'testuser',
        'lifelog/nutrition/nutrilist'
      );
    });

    it('uses userId over chatId when both provided', async () => {
      const items = [{
        userId: 'correctuser',
        chatId: 'telegram:wrongpath',
        label: 'Test Food',
        calories: 200,
        date: '2026-01-31',
      }];

      await datastore.saveMany(items);

      expect(mockUserDataService.getUserPath).toHaveBeenCalledWith(
        'correctuser',
        expect.any(String)
      );
    });
  });
});
```

**Step 2: Run test to verify it passes**

Run: `node tests/unit/harness.mjs --pattern=YamlNutriListDatastore`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/unit/suite/adapters/persistence/YamlNutriListDatastore.test.mjs
git commit -m "test(adapters): add unit tests for YamlNutriListDatastore

Covers constructor validation and saveMany userId resolution.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Add userId Validation to saveMany

**Files:**
- Modify: `backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs:171-175`
- Modify: `tests/unit/suite/adapters/persistence/YamlNutriListDatastore.test.mjs`

**Step 1: Write the failing test first**

Add to YamlNutriListDatastore.test.mjs:

```javascript
describe('userId validation', () => {
  it('throws InfrastructureError when userId contains colon', async () => {
    const items = [{
      userId: 'telegram:b6898194425_c575596036',
      label: 'Test Food',
      calories: 200,
      date: '2026-01-31',
    }];

    await expect(datastore.saveMany(items))
      .rejects.toThrow(InfrastructureError);
  });

  it('throws InfrastructureError when userId contains slash', async () => {
    const items = [{
      userId: 'path/traversal',
      label: 'Test Food',
      calories: 200,
      date: '2026-01-31',
    }];

    await expect(datastore.saveMany(items))
      .rejects.toThrow(InfrastructureError);
  });

  it('throws InfrastructureError when falling back to invalid chatId', async () => {
    const items = [{
      chatId: 'telegram:invalid',  // No userId, falls back to chatId
      label: 'Test Food',
      calories: 200,
      date: '2026-01-31',
    }];

    await expect(datastore.saveMany(items))
      .rejects.toThrow(InfrastructureError);
  });

  it('allows valid userId without special characters', async () => {
    const items = [{
      userId: 'kckern',
      label: 'Test Food',
      calories: 200,
      date: '2026-01-31',
    }];

    await expect(datastore.saveMany(items)).resolves.not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node tests/unit/harness.mjs --pattern=YamlNutriListDatastore`
Expected: FAIL - validation not yet implemented

**Step 3: Implement the validation**

In `YamlNutriListDatastore.mjs`, update the `saveMany` method (around line 171):

```javascript
async saveMany(newItems) {
  if (!newItems || newItems.length === 0) return;

  const userId = newItems[0].userId || newItems[0].chatId || 'cli-user';

  // Validate userId to prevent path traversal or invalid directories
  if (!userId || userId.includes(':') || userId.includes('/')) {
    throw new InfrastructureError('Invalid userId for nutrilist save', {
      code: 'INVALID_USER_ID',
      received: userId,
      hint: 'userId must not contain ":" or "/" characters'
    });
  }

  const filePath = this.#getPath(userId);
  // ... rest of method unchanged
```

**Step 4: Run test to verify it passes**

Run: `node tests/unit/harness.mjs --pattern=YamlNutriListDatastore`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/persistence/yaml/YamlNutriListDatastore.mjs
git add tests/unit/suite/adapters/persistence/YamlNutriListDatastore.test.mjs
git commit -m "fix(adapters): add userId validation in saveMany

Prevents saving items with invalid userIds that contain ':' or '/'
characters. This catches bugs like passing conversationId instead
of userId, which would create orphaned directories.

Closes: nutribot-upc-wrong-user-path bug

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Create Data Migration Script

**Files:**
- Create: `cli/migrations/migrate-orphaned-nutrilist.mjs`

**Step 1: Write the migration script**

```javascript
#!/usr/bin/env node
/**
 * Migration: Rescue orphaned nutrilist items from telegram:* directories
 *
 * Usage:
 *   node cli/migrations/migrate-orphaned-nutrilist.mjs --dry-run
 *   node cli/migrations/migrate-orphaned-nutrilist.mjs --execute
 *
 * This script finds user directories that start with "telegram:" and
 * attempts to match them to real users via the nutrilog files.
 */

import fs from 'fs';
import path from 'path';
import { loadYamlSafe, saveYaml, ensureDir } from '#system/utils/FileIO.mjs';

const DATA_PATH = process.env.DATA_PATH || '/usr/src/app/data';
const USERS_DIR = path.join(DATA_PATH, 'users');

function findOrphanedDirs() {
  if (!fs.existsSync(USERS_DIR)) {
    console.error(`Users directory not found: ${USERS_DIR}`);
    return [];
  }

  const dirs = fs.readdirSync(USERS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('telegram:'))
    .map(d => d.name);

  return dirs;
}

function loadNutrilist(userDir) {
  const nutrilistPath = path.join(USERS_DIR, userDir, 'lifelog/nutrition/nutrilist.yml');
  if (!fs.existsSync(nutrilistPath)) {
    return [];
  }
  return loadYamlSafe(nutrilistPath) || [];
}

function findRealUserFromNutrilog(logUuid) {
  // Search all user directories for a nutrilog with this UUID
  const userDirs = fs.readdirSync(USERS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('telegram:'))
    .map(d => d.name);

  for (const userDir of userDirs) {
    const nutrilogPath = path.join(USERS_DIR, userDir, 'lifelog/nutrition/nutrilog.yml');
    if (!fs.existsSync(nutrilogPath)) continue;

    const logs = loadYamlSafe(nutrilogPath) || [];
    const found = logs.find(log => log.uuid === logUuid || log.id === logUuid);
    if (found) {
      return userDir;
    }
  }
  return null;
}

function mergeItems(existingItems, newItems) {
  const existingUuids = new Set(existingItems.map(i => i.uuid || i.id));
  const uniqueNewItems = newItems.filter(i =>
    !existingUuids.has(i.uuid) && !existingUuids.has(i.id)
  );
  return [...existingItems, ...uniqueNewItems];
}

async function migrate(dryRun = true) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Orphaned Nutrilist Migration ${dryRun ? '(DRY RUN)' : '(EXECUTING)'}`);
  console.log(`${'='.repeat(60)}\n`);

  const orphanedDirs = findOrphanedDirs();

  if (orphanedDirs.length === 0) {
    console.log('✓ No orphaned directories found.');
    return;
  }

  console.log(`Found ${orphanedDirs.length} orphaned directory(ies):\n`);

  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const orphanDir of orphanedDirs) {
    console.log(`\n─── ${orphanDir} ───`);

    const items = loadNutrilist(orphanDir);
    if (items.length === 0) {
      console.log('  No items found, skipping.');
      continue;
    }

    console.log(`  Found ${items.length} item(s)`);

    // Group items by logUuid to find target user
    const itemsByLog = {};
    for (const item of items) {
      const logId = item.logId || item.log_uuid || item.logUuid || 'unknown';
      if (!itemsByLog[logId]) itemsByLog[logId] = [];
      itemsByLog[logId].push(item);
    }

    for (const [logId, logItems] of Object.entries(itemsByLog)) {
      const targetUser = findRealUserFromNutrilog(logId);

      if (!targetUser) {
        console.log(`  ⚠ Could not find owner for logId: ${logId} (${logItems.length} items)`);
        totalSkipped += logItems.length;
        continue;
      }

      console.log(`  → Migrating ${logItems.length} item(s) to user: ${targetUser}`);

      if (!dryRun) {
        const targetPath = path.join(USERS_DIR, targetUser, 'lifelog/nutrition/nutrilist.yml');
        ensureDir(path.dirname(targetPath));

        const existing = fs.existsSync(targetPath) ? loadYamlSafe(targetPath) || [] : [];
        const merged = mergeItems(existing, logItems);

        saveYaml(targetPath, merged);
        console.log(`    ✓ Saved to ${targetPath}`);
      }

      totalMigrated += logItems.length;
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Summary:`);
  console.log(`  Migrated: ${totalMigrated} item(s)`);
  console.log(`  Skipped:  ${totalSkipped} item(s) (owner not found)`);
  console.log(`${'='.repeat(60)}\n`);

  if (dryRun && totalMigrated > 0) {
    console.log('Run with --execute to perform the migration.\n');
  }
}

// Parse args
const args = process.argv.slice(2);
const dryRun = !args.includes('--execute');

migrate(dryRun).catch(console.error);
```

**Step 2: Test the script in dry-run mode**

Run: `node cli/migrations/migrate-orphaned-nutrilist.mjs --dry-run`
Expected: Lists orphaned directories and what would be migrated

**Step 3: Commit**

```bash
git add cli/migrations/migrate-orphaned-nutrilist.mjs
git commit -m "feat(cli): add migration script for orphaned nutrilist items

Finds user directories starting with 'telegram:' and migrates
nutrilist items back to their correct user directories by
matching logUuid to nutrilog entries.

Usage:
  --dry-run (default): Show what would be migrated
  --execute: Perform the actual migration

Related: nutribot-upc-wrong-user-path bug

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5: Run Full Test Suite

**Files:** None (verification only)

**Step 1: Run all unit tests**

Run: `node tests/unit/harness.mjs`
Expected: All tests pass

**Step 2: Run integration tests if available**

Run: `node tests/integration/harness.mjs --pattern=nutribot`
Expected: All tests pass (or skip if no nutribot integration tests)

**Step 3: Update bug report status**

Update `docs/_wip/bugs/2026-01-31-nutribot-upc-wrong-user-path.md` remediation section:

```markdown
## Remediation Steps

1. ✅ Apply fix to `SelectUPCPortion.mjs`
2. ✅ Add regression test for userId in saveMany
3. ✅ Add userId validation in YamlNutriListDatastore.saveMany()
4. ✅ Create data migration script
5. ⬜ Deploy fix to production
6. ⬜ Run migration script on production data
```

**Step 4: Commit**

```bash
git add docs/_wip/bugs/2026-01-31-nutribot-upc-wrong-user-path.md
git commit -m "docs: update bug report with remediation status

All code fixes and tests complete. Ready for production
deployment and data migration.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Deployment Checklist (Manual)

After all tasks complete:

1. [ ] Deploy to production
2. [ ] SSH to production and run: `node cli/migrations/migrate-orphaned-nutrilist.mjs --dry-run`
3. [ ] Review dry-run output
4. [ ] Run: `node cli/migrations/migrate-orphaned-nutrilist.mjs --execute`
5. [ ] Verify migrated data appears in user reports
6. [ ] (Optional) Remove orphaned `telegram:*` directories after confirming migration
