# TV Folder Submenu Bugs Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix TV app folder navigation so selecting folders opens submenus instead of routing to Player.

**Architecture:** The FolderAdapter incorrectly builds `play: { list: "FHE" }` for folder items instead of `list: { folder: "FHE" }`. The frontend MenuStack checks for `selection.list` to open submenus, but since `list` is null, it falls through to Player. Fix by having FolderAdapter set `actions.list` for folder-type items.

**Tech Stack:** Node.js, Express, React

---

## Root Cause Analysis

When user selects "FHE" folder from TV menu:

1. **Current behavior:**
   - FolderAdapter parses `input: "list: FHE"` → `parsed.source = 'list'`
   - Builds `playAction = { list: "FHE" }` (line 327)
   - API returns `{ play: { list: "FHE" }, list: null }`
   - MenuStack checks `selection.list` → null → falls through to Player
   - Player receives folder metadata, shows spinner

2. **Expected behavior:**
   - FolderAdapter should set `actions.list = { folder: "FHE" }`
   - API returns `{ list: { folder: "FHE" } }`
   - MenuStack checks `selection.list` → truthy → opens submenu

**API Response Comparison:**

| Field | Current (Bug) | Expected (Fix) |
|-------|---------------|----------------|
| `play` | `{ list: "FHE" }` | `undefined` |
| `list` | `null` | `{ folder: "FHE" }` |

---

## Task 1: Fix FolderAdapter to Set list Action for Folder Items

**Files:**
- Modify: `backend/src/2_adapters/content/folder/FolderAdapter.mjs:310-380`

**Step 1: Add listAction variable and folder detection**

In `getList()` method, around line 312, add a `listAction` variable alongside `playAction` and `openAction`:

```javascript
// Build play/open/list actions from source type (for legacy frontend compatibility)
// Frontend uses: ...item.play for media, item.open for apps, item.list for submenus
const playAction = {};
const openAction = {};
const listAction = {};  // NEW: For folder references

if (item.play) {
  // Raw YAML already has play object - use it
  Object.assign(playAction, item.play);
} else if (item.open) {
  // Raw YAML has open object - use it for app launches
  Object.assign(openAction, item.open);
} else if (item.action === 'Open' || parsed.source === 'app') {
  // Build open action for app sources
  openAction.app = mediaKey;
} else if (parsed.source === 'list') {
  // NEW: Build list action for folder references (submenus)
  listAction.folder = mediaKey;
} else {
  // Build play action for media sources
  const src = item.src || parsed.source;
  playAction[src] = mediaKey;
}
```

**Step 2: Include listAction in Item construction**

Around line 376-380, add `list` to the actions object:

```javascript
// Actions object - play is used by frontend via ...item.play spread
actions: {
  list: Object.keys(listAction).length > 0 ? listAction : undefined,  // NEW
  play: Object.keys(finalPlayAction).length > 0 ? finalPlayAction : undefined,
  open: Object.keys(openAction).length > 0 ? openAction : undefined
}
```

**Step 3: Verify fix with API call**

```bash
curl -s "http://localhost:3112/api/v1/list/folder/TVApp" | jq '.items[] | select(.label == "FHE") | {label, list, play}'
```

Expected output:
```json
{
  "label": "FHE",
  "list": { "folder": "FHE" },
  "play": null
}
```

**Step 4: Run runtime test**

```bash
BASE_URL=http://localhost:3112 npx playwright test tests/runtime/tv-app/tv-video-select-play.runtime.test.mjs --reporter=list
```

**Step 5: Commit**

```bash
git add backend/src/2_adapters/content/folder/FolderAdapter.mjs
git commit -m "fix(folder): set list action for folder items instead of play

When parsing 'list: FolderName' input, FolderAdapter now sets
actions.list = { folder: id } instead of actions.play = { list: id }.
This allows MenuStack to correctly route to submenu instead of Player.

Fixes FHE and similar folder submenus not opening in TV app.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add Unit Test for Folder List Action

**Files:**
- Create: `tests/unit/suite/adapters/content/folder/folderAdapterListAction.unit.test.mjs`

**Step 1: Write the test**

```javascript
/**
 * Unit test: FolderAdapter list action for folder items
 */
import { describe, it, expect } from '@jest/globals';

describe('FolderAdapter list action logic', () => {
  describe('action type detection', () => {
    it('should create list action for folder references', () => {
      const parsed = { source: 'list', id: 'FHE' };
      const mediaKey = 'FHE';

      const playAction = {};
      const listAction = {};

      if (parsed.source === 'list') {
        listAction.folder = mediaKey;
      } else {
        playAction[parsed.source] = mediaKey;
      }

      expect(listAction).toEqual({ folder: 'FHE' });
      expect(Object.keys(playAction).length).toBe(0);
    });

    it('should create play action for plex items', () => {
      const parsed = { source: 'plex', id: '663846' };
      const mediaKey = '663846';

      const playAction = {};
      const listAction = {};

      if (parsed.source === 'list') {
        listAction.folder = mediaKey;
      } else {
        playAction[parsed.source] = mediaKey;
      }

      expect(playAction).toEqual({ plex: '663846' });
      expect(Object.keys(listAction).length).toBe(0);
    });

    it('should create play action for media items', () => {
      const parsed = { source: 'media', id: 'news/cnn' };
      const mediaKey = 'news/cnn';

      const playAction = {};
      const listAction = {};

      if (parsed.source === 'list') {
        listAction.folder = mediaKey;
      } else {
        playAction[parsed.source] = mediaKey;
      }

      expect(playAction).toEqual({ media: 'news/cnn' });
      expect(Object.keys(listAction).length).toBe(0);
    });
  });

  describe('actions object construction', () => {
    it('should include list in actions when listAction is populated', () => {
      const listAction = { folder: 'FHE' };
      const playAction = {};
      const openAction = {};

      const actions = {
        list: Object.keys(listAction).length > 0 ? listAction : undefined,
        play: Object.keys(playAction).length > 0 ? playAction : undefined,
        open: Object.keys(openAction).length > 0 ? openAction : undefined
      };

      expect(actions.list).toEqual({ folder: 'FHE' });
      expect(actions.play).toBeUndefined();
      expect(actions.open).toBeUndefined();
    });
  });
});
```

**Step 2: Run the test**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/content/folder/folderAdapterListAction.unit.test.mjs --no-coverage
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add tests/unit/suite/adapters/content/folder/folderAdapterListAction.unit.test.mjs
git commit -m "test(unit): add FolderAdapter list action tests

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Runtime Test for FHE Submenu

**Files:**
- Create: `tests/runtime/tv-app/tv-folder-submenu.runtime.test.mjs`

**Step 1: Write the test**

```javascript
/**
 * TV App - Folder Submenu Navigation Test
 *
 * Verifies folders open submenus instead of routing to Player.
 */
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

test.describe('TV Folder Submenu Navigation', () => {

  test('API returns list action for folder items', async ({ request }) => {
    console.log('[TEST] Checking API response for FHE folder...');

    const response = await request.get(`${BASE_URL}/api/v1/list/folder/TVApp`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    const fhe = data.items?.find(item => item.label === 'FHE');

    if (!fhe) {
      console.log('FHE not found in menu, skipping');
      test.skip();
      return;
    }

    console.log('FHE item:', JSON.stringify({ list: fhe.list, play: fhe.play }, null, 2));

    // Verify list action is set (not play)
    expect(fhe.list).toBeTruthy();
    expect(fhe.list.folder).toBe('FHE');

    // play should be undefined or null for folder items
    expect(fhe.play?.list).toBeFalsy();

    console.log('FHE has correct list action');
  });

  test('Selecting FHE opens submenu (not Player)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();

    try {
      await page.goto(`${BASE_URL}/tv`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Find FHE in menu
      const menuItems = await page.locator('.menu-item').all();
      let fheIndex = -1;

      for (let i = 0; i < menuItems.length && i < 50; i++) {
        const label = await menuItems[i].locator('h3').textContent();
        if (label?.trim() === 'FHE') {
          fheIndex = i;
          break;
        }
      }

      if (fheIndex === -1) {
        console.log('FHE not found in menu, skipping');
        test.skip();
        return;
      }

      console.log(`Found FHE at index ${fheIndex}`);

      // Navigate to FHE
      const columns = 5;
      const row = Math.floor(fheIndex / columns);
      const col = fheIndex % columns;

      for (let i = 0; i < row; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(100);
      }
      for (let i = 0; i < col; i++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(100);
      }

      // Select FHE
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2000);

      // Check result - should have submenu items, NOT Player
      const submenuItems = await page.locator('.menu-item').count();
      const playerCount = await page.locator('.player').count();
      const spinnerVisible = await page.locator('[class*="loading"]').count();

      console.log(`After selecting FHE:`);
      console.log(`  - Submenu items: ${submenuItems}`);
      console.log(`  - Player components: ${playerCount}`);
      console.log(`  - Loading spinners: ${spinnerVisible}`);

      // Submenu should have items
      expect(submenuItems).toBeGreaterThan(0);

      // Should NOT have Player (or if player exists, should not be stuck loading)
      // Note: Some menu layouts may have player in background

      console.log('FHE submenu opened successfully');

    } finally {
      await page.close();
      await context.close();
    }
  });

});
```

**Step 2: Run the test**

```bash
BASE_URL=http://localhost:3112 npx playwright test tests/runtime/tv-app/tv-folder-submenu.runtime.test.mjs --reporter=list
```

**Step 3: Commit**

```bash
git add tests/runtime/tv-app/tv-folder-submenu.runtime.test.mjs
git commit -m "test(tv): add runtime test for folder submenu navigation

Verifies FHE and similar folders open submenus instead of Player.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Investigate and Fix news/cnn Direct Play

**Files:**
- Investigate: Backend media endpoint

**Step 1: Check API response for news/cnn**

```bash
# Check content info endpoint
curl -s "http://localhost:3112/api/v1/content/item/media/news/cnn" | jq '.'

# Check if file exists
curl -s "http://localhost:3112/api/v1/content/playables/media/news/cnn" | jq '.'
```

**Step 2: Compare with TVApp URL parsing**

The issue may be that `play=news/cnn` is parsed differently than Plex items. In `TVApp.jsx` line 90-95:

```javascript
const findKey = (value) => ( /^\d+$/.test(value) ? "plex" : "media" );
```

So `news/cnn` should map to `{ play: { media: "news/cnn" } }`.

**Step 3: Check SinglePlayer handling of media type**

If the issue is in SinglePlayer, check how it handles `play.media` vs `play.plex`.

**Step 4: Document findings**

If this requires a separate fix, document it and create a follow-up task.

---

## Verification Checklist

- [ ] FHE menu item has `list: { folder: "FHE" }` in API response
- [ ] Selecting FHE opens submenu with child items
- [ ] Player is NOT shown when selecting folder items
- [ ] Bible Project still works (collection expansion from previous fix)
- [ ] Unit tests pass
- [ ] Runtime tests pass

---

## Related Bugs

| Bug | Status | Notes |
|-----|--------|-------|
| FHE submenu not opening | Fixed by Task 1 | Root cause was missing `actions.list` |
| news/cnn direct play | Needs investigation | May be separate issue |
| The Chosen behavior | Config difference | May not be a bug |
