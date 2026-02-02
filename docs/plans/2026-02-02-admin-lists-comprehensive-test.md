# Admin Lists Comprehensive Test - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create runtime tests that validate all admin content lists render items with proper 2-line cards (title + type/parent) and thumbnails.

**Architecture:** Fixture loader reads baseline from data mount YAML files. Test uses API discovery then UI navigation to iterate all lists. Each item's content display is validated for proper card structure. Unresolved items trigger test failure with clear messaging.

**Tech Stack:** Playwright, dotenv, js-yaml, Mantine components

**Design Document:** `docs/plans/2026-02-02-admin-lists-comprehensive-test-design.md`

---

## Task 1: Create Fixture Loader Helper

**Files:**
- Create: `tests/_lib/listFixtureLoader.mjs`

**Step 1: Create the fixture loader module**

```javascript
// tests/_lib/listFixtureLoader.mjs
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const BASE_PATH = process.env.DAYLIGHT_BASE_PATH;
if (!BASE_PATH) {
  throw new Error('DAYLIGHT_BASE_PATH not set in environment');
}

const LISTS_PATH = path.join(BASE_PATH, 'data/household/config/lists');

/**
 * List YAML files in a directory (without extension)
 */
function listYamlFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.yml'))
    .map(f => f.replace('.yml', ''));
}

/**
 * Get all expected lists from data mount
 * @returns {{ menus: string[], programs: string[], watchlists: string[] }}
 */
export function getExpectedLists() {
  return {
    menus: listYamlFiles(path.join(LISTS_PATH, 'menus')),
    programs: listYamlFiles(path.join(LISTS_PATH, 'programs')),
    watchlists: listYamlFiles(path.join(LISTS_PATH, 'watchlists'))
  };
}

/**
 * Get items from a specific list
 * @param {string} type - List type (menus, programs, watchlists)
 * @param {string} name - List name (without .yml)
 * @returns {Array} List items
 */
export function getListItems(type, name) {
  const filePath = path.join(LISTS_PATH, type, `${name}.yml`);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = yaml.load(content);
  return data?.items || [];
}

/**
 * Sample random items from array
 * @param {Array} items - Items to sample from
 * @param {number} count - Max items to return
 * @returns {Array} Sampled items with original indices
 */
export function sampleItems(items, count = 20) {
  if (!items || items.length === 0) return [];
  if (items.length <= count) {
    return items.map((item, idx) => ({ ...item, originalIndex: idx }));
  }

  // Fisher-Yates shuffle to get random sample
  const indices = items.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices.slice(0, count)
    .sort((a, b) => a - b) // Keep in original order for easier debugging
    .map(idx => ({ ...items[idx], originalIndex: idx }));
}

/**
 * Get the lists path for debugging
 */
export function getListsPath() {
  return LISTS_PATH;
}
```

**Step 2: Verify file exists and can load**

Run: `node -e "import('./tests/_lib/listFixtureLoader.mjs').then(m => console.log(m.getExpectedLists()))"`
Expected: Output showing menus, programs, watchlists arrays

**Step 3: Commit**

```bash
git add tests/_lib/listFixtureLoader.mjs
git commit -m "test: add list fixture loader for admin tests"
```

---

## Task 2: Add Unresolved Content Fallback to ListsItemRow

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

**Step 1: Add IconAlertTriangle import**

Find the imports section (around line 4-10) and add `IconAlertTriangle`:

```javascript
import {
  IconGripVertical, IconTrash, IconCopy, IconDotsVertical, IconPlus,
  IconMusic, IconDeviceTv, IconMovie, IconDeviceTvOld, IconStack2,
  IconUser, IconDisc, IconPhoto, IconPlaylist, IconFile, IconBook,
  IconChevronRight, IconChevronLeft, IconHome, IconInfoCircle,
  IconEye, IconEyeOff, IconPlayerPlay, IconExternalLink,
  IconAlertTriangle
} from '@tabler/icons-react';
```

**Step 2: Add parseSource helper function**

After the `SOURCE_COLORS` constant (around line 47), add:

```javascript
/**
 * Parse source prefix from raw input value
 * @param {string} input - Raw input like "plex:12345"
 * @returns {string} Source name uppercase or "UNKNOWN"
 */
function parseSource(input) {
  if (!input) return 'UNKNOWN';
  const match = input.match(/^([a-z]+):/i);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}
```

**Step 3: Modify fetchContentMetadata to return unresolved flag**

Update the catch block and error handling in `fetchContentMetadata` (around line 248-289) to explicitly mark unresolved items:

```javascript
async function fetchContentMetadata(value) {
  if (!value) return null;

  // Check cache first
  if (contentInfoCache.has(value)) {
    return contentInfoCache.get(value);
  }

  // Parse source:id format (trim whitespace from parts)
  const match = value.match(/^([^:]+):\s*(.+)$/);
  if (!match) {
    // Can't parse format - mark as unresolved
    const unresolved = {
      value,
      title: value,
      source: 'unknown',
      type: null,
      thumbnail: null,
      unresolved: true
    };
    contentInfoCache.set(value, unresolved);
    return unresolved;
  }

  const [, source, localId] = [null, match[1].trim(), match[2].trim()];

  try {
    const response = await fetch(`/api/v1/content/item/${source}/${localId}`);
    if (response.ok) {
      const data = await response.json();
      const info = {
        value: value,
        title: data.title || localId,
        source: source,
        type: data.metadata?.type || data.type || null,
        thumbnail: data.thumbnail,
        grandparent: data.metadata?.grandparentTitle,
        parent: data.metadata?.parentTitle,
        library: data.metadata?.librarySectionTitle,
        itemCount: data.metadata?.childCount ?? data.metadata?.leafCount ?? null,
        unresolved: false
      };
      contentInfoCache.set(value, info);
      return info;
    } else {
      // API returned error status - mark as unresolved
      console.warn(`Content API returned ${response.status} for ${value}`);
      const unresolved = {
        value,
        title: localId,
        source,
        type: null,
        thumbnail: null,
        unresolved: true
      };
      contentInfoCache.set(value, unresolved);
      return unresolved;
    }
  } catch (err) {
    console.error('Failed to fetch content info:', err);
    // Network/parse failure - mark as unresolved
    const unresolved = {
      value,
      title: localId,
      source,
      type: null,
      thumbnail: null,
      unresolved: true
    };
    contentInfoCache.set(value, unresolved);
    return unresolved;
  }
}
```

**Step 4: Add UnresolvedContentDisplay component**

After the `ContentDisplay` component (around line 243), add:

```javascript
/**
 * Display for unresolved content - warning state
 */
function UnresolvedContentDisplay({ item, onClick }) {
  const source = parseSource(item.value);

  return (
    <div
      onClick={onClick}
      className="content-display content-display--unresolved"
      style={{ cursor: 'pointer' }}
    >
      <Group gap={6} wrap="nowrap" style={{ flex: 1 }}>
        <Avatar size={36} radius="sm" color="yellow">
          <IconAlertTriangle size={16} />
        </Avatar>
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" truncate fw={500}>
              {item.value}
            </Text>
            <Box style={{ flex: 1 }} />
            <Badge size="xs" variant="light" color="yellow" style={{ flexShrink: 0 }}>
              {source}
            </Badge>
          </Group>
          <Group gap={4} wrap="nowrap">
            <IconAlertTriangle size={14} color="var(--mantine-color-yellow-6)" />
            <Text size="xs" c="yellow">
              Unknown • Unresolved
            </Text>
          </Group>
        </Box>
      </Group>
    </div>
  );
}
```

**Step 5: Update ContentSearchCombobox to use UnresolvedContentDisplay**

In `ContentSearchCombobox` (around line 857), update the section that renders when we have content info to check for unresolved:

```javascript
  // Not editing - show display mode
  if (!isEditing) {
    // Loading state
    if (loadingInfo) {
      return (
        <Group gap="xs" onClick={handleStartEditing} className="content-display">
          <Loader size={16} />
          <Text size="xs" c="dimmed">{value || 'Loading...'}</Text>
        </Group>
      );
    }

    // Have content info - check if unresolved
    if (contentInfo) {
      if (contentInfo.unresolved) {
        return (
          <UnresolvedContentDisplay item={contentInfo} onClick={handleStartEditing} />
        );
      }
      return (
        <ContentDisplay item={contentInfo} onClick={handleStartEditing} />
      );
    }

    // No value - show placeholder with avatar footprint
    if (!value) {
      return (
        <Group gap={6} wrap="nowrap" onClick={handleStartEditing} className="content-display">
          <Avatar size={36} radius="sm" color="dark">
            <IconPhoto size={16} />
          </Avatar>
          <Text size="xs" c="dimmed">Click to select content...</Text>
        </Group>
      );
    }

    // Fallback - raw value (shouldn't normally reach here)
    return (
      <Text size="xs" c="dimmed" onClick={handleStartEditing} className="content-display">
        {value}
      </Text>
    );
  }
```

**Step 6: Verify build succeeds**

Run: `cd frontend && npm run build`
Expected: Build completes without errors

**Step 7: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat(admin): add unresolved content fallback display"
```

---

## Task 3: Create Test File - API Discovery Test

**Files:**
- Create: `tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs`

**Step 1: Create test file with API discovery test**

```javascript
/**
 * Admin Lists Comprehensive Test
 *
 * Validates all admin content lists (menus, programs, watchlists) render
 * items with proper 2-line cards (title + type/parent) and thumbnails.
 *
 * Uses API discovery + UI navigation with baselines from data mount.
 */

import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';
import { getExpectedLists, getListItems, sampleItems } from '#testlib/listFixtureLoader.mjs';

const BASE_URL = BACKEND_URL;
const SAMPLE_SIZE = 20;

// Load expected lists from data mount
const expectedLists = getExpectedLists();

test.describe('Admin Lists Comprehensive', () => {
  test.setTimeout(300000); // 5 minutes for full suite

  test('API returns all expected list types', async ({ request }) => {
    const types = ['menus', 'programs', 'watchlists'];

    for (const type of types) {
      const response = await request.get(`${BASE_URL}/api/v1/admin/content/lists/${type}`);
      expect(response.ok()).toBe(true);

      const data = await response.json();
      const apiLists = (data.lists || []).map(l => l.name);
      const expectedNames = expectedLists[type];

      console.log(`${type}: API has ${apiLists.length}, expected ${expectedNames.length}`);

      // All expected lists should be in API response
      for (const expected of expectedNames) {
        expect(apiLists, `Missing ${type}/${expected} from API`).toContain(expected);
      }
    }
  });
});
```

**Step 2: Run test to verify API connectivity**

Run: `npx playwright test tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs --grep "API returns"`
Expected: PASS - API returns expected lists

**Step 3: Commit**

```bash
git add tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs
git commit -m "test: add admin lists comprehensive - API discovery"
```

---

## Task 4: Add Card Validation Helper

**Files:**
- Modify: `tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs`

**Step 1: Add card validation helper function after imports**

```javascript
/**
 * Validate a content display card has proper structure
 * @param {import('@playwright/test').Locator} row - The item row locator
 * @param {number} rowIndex - Row index for error messages
 * @param {string} listPath - List path for error messages (e.g., "menus/ambient")
 * @returns {Promise<{valid: boolean, error?: string, unresolved?: boolean}>}
 */
async function validateCardStructure(row, rowIndex, listPath) {
  const inputCol = row.locator('.col-input');
  const contentDisplay = inputCol.locator('.content-display');

  // Check content display exists
  const displayCount = await contentDisplay.count();
  if (displayCount === 0) {
    return { valid: false, error: `Row ${rowIndex}: No .content-display found` };
  }

  // Check for unresolved state
  const isUnresolved = await contentDisplay.locator('.content-display--unresolved').count() > 0 ||
                       await contentDisplay.locator('text=Unresolved').count() > 0;

  if (isUnresolved) {
    const rawValue = await contentDisplay.textContent();
    return {
      valid: false,
      unresolved: true,
      error: `Row ${rowIndex} in ${listPath}: Unresolved content - "${rawValue?.substring(0, 50)}..."`
    };
  }

  // Check for avatar (thumbnail)
  const avatar = contentDisplay.locator('.mantine-Avatar-root');
  const hasAvatar = await avatar.count() > 0;
  if (!hasAvatar) {
    return { valid: false, error: `Row ${rowIndex} in ${listPath}: No thumbnail avatar` };
  }

  // Check for title text (not empty, not raw ID)
  const text = await contentDisplay.textContent();
  if (!text || text.trim().length === 0) {
    return { valid: false, error: `Row ${rowIndex} in ${listPath}: Empty content display` };
  }

  // Check it's not just a raw ID (plex:12345 or just numbers)
  const isRawId = /^(plex|immich|abs|media):\s*\d+\s*$/i.test(text.trim()) ||
                  /^\d+$/.test(text.replace(/PLEX|IMMICH|ABS|MEDIA/gi, '').trim());
  if (isRawId) {
    return { valid: false, error: `Row ${rowIndex} in ${listPath}: Shows raw ID instead of title - "${text}"` };
  }

  // Check for type+parent line (contains bullet separator)
  const hasBullet = text.includes('•');
  if (!hasBullet) {
    // Might be OK for some items without parent, log warning but don't fail
    console.log(`  Note: Row ${rowIndex} in ${listPath} has no type•parent line`);
  }

  // Check for source badge
  const badge = contentDisplay.locator('.mantine-Badge-root');
  const hasBadge = await badge.count() > 0;
  if (!hasBadge) {
    return { valid: false, error: `Row ${rowIndex} in ${listPath}: No source badge` };
  }

  return { valid: true };
}
```

**Step 2: Commit**

```bash
git add tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs
git commit -m "test: add card validation helper"
```

---

## Task 5: Add List Type Test - Menus

**Files:**
- Modify: `tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs`

**Step 1: Add menus test after API test**

```javascript
  test('Menus: all items render with proper cards', async ({ page }) => {
    const type = 'menus';
    const lists = expectedLists[type];
    const errors = [];
    let totalItemsChecked = 0;

    console.log(`\nTesting ${lists.length} menus...`);

    for (const listName of lists) {
      console.log(`  Checking ${type}/${listName}...`);

      // Navigate to list
      await page.goto(`${BASE_URL}/admin/content/lists/${type}/${listName}`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Wait for items to load
      await page.waitForSelector('.item-row', { timeout: 10000 }).catch(() => null);

      // Wait for content info to load
      await page.waitForTimeout(3000);

      // Get all rows
      const rows = page.locator('.item-row');
      const rowCount = await rows.count();

      if (rowCount === 0) {
        console.log(`    No items in ${listName}`);
        continue;
      }

      // Get items from fixture for sampling
      const fixtureItems = getListItems(type, listName);
      const sampled = sampleItems(fixtureItems, SAMPLE_SIZE);

      console.log(`    ${rowCount} rows, sampling ${sampled.length} items`);

      // Validate sampled items
      for (const sampledItem of sampled) {
        const rowIdx = sampledItem.originalIndex;
        if (rowIdx >= rowCount) continue;

        const row = rows.nth(rowIdx);
        const result = await validateCardStructure(row, rowIdx, `${type}/${listName}`);

        if (!result.valid) {
          errors.push(result.error);
          if (result.unresolved) {
            console.log(`    ❌ ${result.error}`);
          }
        }
        totalItemsChecked++;
      }
    }

    console.log(`\nMenus: Checked ${totalItemsChecked} items across ${lists.length} lists`);

    if (errors.length > 0) {
      console.log(`\n❌ ${errors.length} errors found:`);
      errors.forEach(e => console.log(`  - ${e}`));
    }

    expect(errors, `Found ${errors.length} card rendering errors`).toHaveLength(0);
  });
```

**Step 2: Run menus test**

Run: `npx playwright test tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs --grep "Menus:"`
Expected: Test runs and reports any unresolved items

**Step 3: Commit**

```bash
git add tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs
git commit -m "test: add menus validation test"
```

---

## Task 6: Add Programs and Watchlists Tests

**Files:**
- Modify: `tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs`

**Step 1: Refactor to use shared test generator function**

Replace the menus test and add programs/watchlists tests by using a shared function:

```javascript
  /**
   * Generate test for a specific list type
   */
  async function testListType(page, type) {
    const lists = expectedLists[type];
    const errors = [];
    let totalItemsChecked = 0;

    console.log(`\nTesting ${lists.length} ${type}...`);

    for (const listName of lists) {
      console.log(`  Checking ${type}/${listName}...`);

      // Navigate to list
      await page.goto(`${BASE_URL}/admin/content/lists/${type}/${listName}`, {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      // Wait for items to load
      await page.waitForSelector('.item-row', { timeout: 10000 }).catch(() => null);

      // Wait for content info to load
      await page.waitForTimeout(3000);

      // Get all rows
      const rows = page.locator('.item-row');
      const rowCount = await rows.count();

      if (rowCount === 0) {
        console.log(`    No items in ${listName}`);
        continue;
      }

      // Get items from fixture for sampling
      const fixtureItems = getListItems(type, listName);
      const sampled = sampleItems(fixtureItems, SAMPLE_SIZE);

      console.log(`    ${rowCount} rows, sampling ${sampled.length} items`);

      // Validate sampled items
      for (const sampledItem of sampled) {
        const rowIdx = sampledItem.originalIndex;
        if (rowIdx >= rowCount) continue;

        const row = rows.nth(rowIdx);
        const result = await validateCardStructure(row, rowIdx, `${type}/${listName}`);

        if (!result.valid) {
          errors.push(result.error);
          if (result.unresolved) {
            console.log(`    ❌ ${result.error}`);
          }
        }
        totalItemsChecked++;
      }
    }

    console.log(`\n${type}: Checked ${totalItemsChecked} items across ${lists.length} lists`);

    if (errors.length > 0) {
      console.log(`\n❌ ${errors.length} errors found:`);
      errors.forEach(e => console.log(`  - ${e}`));
    }

    return errors;
  }

  test('Menus: all items render with proper cards', async ({ page }) => {
    const errors = await testListType(page, 'menus');
    expect(errors, `Found ${errors.length} card rendering errors in menus`).toHaveLength(0);
  });

  test('Programs: all items render with proper cards', async ({ page }) => {
    const errors = await testListType(page, 'programs');
    expect(errors, `Found ${errors.length} card rendering errors in programs`).toHaveLength(0);
  });

  test('Watchlists: all items render with proper cards', async ({ page }) => {
    const errors = await testListType(page, 'watchlists');
    expect(errors, `Found ${errors.length} card rendering errors in watchlists`).toHaveLength(0);
  });
```

**Step 2: Run full test suite**

Run: `npx playwright test tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs`
Expected: All tests run, reporting any issues found

**Step 3: Commit**

```bash
git add tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs
git commit -m "test: add programs and watchlists validation tests"
```

---

## Task 7: Add Summary Report Test

**Files:**
- Modify: `tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs`

**Step 1: Add final summary test**

```javascript
  test('Summary: all list types pass validation', async ({ page, request }) => {
    const allErrors = [];
    const summary = {
      menus: { lists: 0, items: 0, errors: 0 },
      programs: { lists: 0, items: 0, errors: 0 },
      watchlists: { lists: 0, items: 0, errors: 0 }
    };

    for (const type of ['menus', 'programs', 'watchlists']) {
      const lists = expectedLists[type];
      summary[type].lists = lists.length;

      for (const listName of lists) {
        await page.goto(`${BASE_URL}/admin/content/lists/${type}/${listName}`, {
          waitUntil: 'networkidle',
          timeout: 30000
        });

        await page.waitForSelector('.item-row', { timeout: 10000 }).catch(() => null);
        await page.waitForTimeout(2000);

        const rows = page.locator('.item-row');
        const rowCount = await rows.count();

        const fixtureItems = getListItems(type, listName);
        const sampled = sampleItems(fixtureItems, SAMPLE_SIZE);

        for (const sampledItem of sampled) {
          const rowIdx = sampledItem.originalIndex;
          if (rowIdx >= rowCount) continue;

          const row = rows.nth(rowIdx);
          const result = await validateCardStructure(row, rowIdx, `${type}/${listName}`);

          summary[type].items++;
          if (!result.valid) {
            summary[type].errors++;
            allErrors.push(result.error);
          }
        }
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('ADMIN LISTS COMPREHENSIVE TEST SUMMARY');
    console.log('='.repeat(60));

    for (const [type, stats] of Object.entries(summary)) {
      const status = stats.errors === 0 ? '✓' : '✗';
      console.log(`${status} ${type.padEnd(12)} | ${stats.lists} lists | ${stats.items} items checked | ${stats.errors} errors`);
    }

    const totalErrors = allErrors.length;
    console.log('-'.repeat(60));
    console.log(`Total: ${totalErrors} errors`);

    if (totalErrors > 0) {
      console.log('\nErrors:');
      allErrors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
    }

    console.log('='.repeat(60) + '\n');

    expect(totalErrors, `Found ${totalErrors} total card rendering errors`).toBe(0);
  });
```

**Step 2: Run summary test**

Run: `npx playwright test tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs --grep "Summary"`
Expected: Summary test runs with formatted output

**Step 3: Commit**

```bash
git add tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs
git commit -m "test: add comprehensive summary report test"
```

---

## Task 8: Add Test Import Path Alias

**Files:**
- Modify: `tests/_lib/listFixtureLoader.mjs` (if needed based on import resolution)

**Step 1: Verify import path alias works**

Check that the test can import from `#testlib/listFixtureLoader.mjs`. If this alias doesn't exist, the import should be:

```javascript
import { getExpectedLists, getListItems, sampleItems } from '../../_lib/listFixtureLoader.mjs';
```

**Step 2: Update test file imports if needed**

If the `#testlib` alias doesn't work, update the import in the test file:

```javascript
import { getExpectedLists, getListItems, sampleItems } from '../../_lib/listFixtureLoader.mjs';
```

**Step 3: Run full test to verify imports**

Run: `npx playwright test tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs --grep "API"`
Expected: Test runs without import errors

**Step 4: Commit if changes made**

```bash
git add tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs
git commit -m "fix: correct import paths for fixture loader"
```

---

## Task 9: Final Integration Test

**Step 1: Run the full test suite**

Run: `npx playwright test tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs --reporter=line`
Expected: All tests execute and report results

**Step 2: Review any failures**

If there are failures:
- Unresolved content items indicate implementation gaps (need content adapters)
- Missing cards indicate UI bugs
- Raw ID display indicates fetch failures

**Step 3: Create final commit**

```bash
git add -A
git commit -m "test: complete admin lists comprehensive test suite"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Fixture loader helper | `tests/_lib/listFixtureLoader.mjs` |
| 2 | Unresolved content fallback | `ListsItemRow.jsx` |
| 3 | API discovery test | Test file created |
| 4 | Card validation helper | Test helper added |
| 5 | Menus validation test | Test added |
| 6 | Programs/Watchlists tests | Tests added |
| 7 | Summary report test | Test added |
| 8 | Import path fixes | If needed |
| 9 | Final integration | Full suite run |

**Run Command:**
```bash
npx playwright test tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs
```

**Success Criteria:**
1. All lists from data mount appear in API
2. All sampled items render with proper 2-line cards
3. No unresolved content (or clear error messages identifying gaps)
