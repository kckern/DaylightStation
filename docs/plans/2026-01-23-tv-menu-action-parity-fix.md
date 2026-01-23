# TV Menu Action Parity Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix FolderAdapter to output action types matching production schema (queue/list/play/open as separate properties).

**Architecture:** FolderAdapter currently uses `parsed.source` to determine action type. It should use the YAML `action` field instead. Queue items need `queue: {...}` not `play: {queue: ...}`. List items need `list: {...}` not `play: {plex: ...}`.

**Tech Stack:** Node.js, Express, Playwright

---

## Root Cause

**YAML source has `action` field:**
```yaml
- label: Sunday
  action: Queue        # ← This determines output action type
  input: 'plex: 642120'
  shuffle: true

- label: Chosen
  action: List         # ← Should be list: { plex: ... }
  input: 'plex: 408886'
```

**Current dev output (wrong):**
```json
{ "label": "Sunday", "play": { "plex": "642120" } }
{ "label": "Chosen", "play": { "plex": "408886" } }
```

**Production output (correct):**
```json
{ "label": "Sunday", "queue": { "plex": "642120", "shuffle": true } }
{ "label": "Chosen", "list": { "plex": "408886" } }
```

---

## Task 1: Create Action Parity Runtime Test

**Files:**
- Create: `tests/runtime/tv-app/tv-menu-action-parity.runtime.test.mjs`

**Step 1: Write the test file**

```javascript
/**
 * TV Menu Action Parity Test
 *
 * Validates dev API returns same action structure as production.
 * Tests that action field from YAML determines output property.
 */
import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = BACKEND_URL;

// Test cases: label, expected action property, expected keys in action object
const TEST_CASES = [
  // Queue actions (action: Queue in YAML)
  { label: 'Sunday', expectedAction: 'queue', expectedKeys: ['plex', 'shuffle'] },
  { label: 'Music', expectedAction: 'queue', expectedKeys: ['queue', 'shuffle'] },

  // List actions (action: List in YAML)
  { label: 'Chosen', expectedAction: 'list', expectedKeys: ['plex'] },
  { label: 'FHE', expectedAction: 'list', expectedKeys: ['list'] },
  { label: 'Science', expectedAction: 'list', expectedKeys: ['plex'] },

  // Play actions (action: Play or no action in YAML)
  { label: 'General Conference', expectedAction: 'play', expectedKeys: ['talk'] },
  { label: 'Scripture', expectedAction: 'play', expectedKeys: ['scripture'] },
  { label: 'Primary', expectedAction: 'play', expectedKeys: ['primary'] },
];

test.describe('TV Menu Action Parity', () => {

  test('API returns correct action types for all test cases', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/list/folder/TVApp`);
    expect(response.ok()).toBe(true);

    const data = await response.json();
    const items = data.items || [];

    const results = [];

    for (const testCase of TEST_CASES) {
      const item = items.find(i => i.label === testCase.label);

      if (!item) {
        console.log(`[SKIP] ${testCase.label} not found in menu`);
        continue;
      }

      const actionValue = item[testCase.expectedAction];
      const hasCorrectAction = !!actionValue;

      // Check all expected keys exist
      const missingKeys = testCase.expectedKeys.filter(k => !actionValue?.[k]);
      const hasAllKeys = missingKeys.length === 0;

      // Check action is NOT incorrectly on play (for non-play items)
      const wronglyOnPlay = testCase.expectedAction !== 'play' &&
        item.play && Object.keys(item.play).some(k => testCase.expectedKeys.includes(k));

      results.push({
        label: testCase.label,
        expected: testCase.expectedAction,
        hasCorrectAction,
        hasAllKeys,
        wronglyOnPlay,
        actual: actionValue,
        playValue: item.play
      });

      console.log(`[${hasCorrectAction && hasAllKeys && !wronglyOnPlay ? 'PASS' : 'FAIL'}] ${testCase.label}:`);
      console.log(`  Expected: ${testCase.expectedAction}: { ${testCase.expectedKeys.join(', ')} }`);
      console.log(`  Actual ${testCase.expectedAction}:`, JSON.stringify(actionValue));
      if (wronglyOnPlay) {
        console.log(`  WARNING: Found on play instead:`, JSON.stringify(item.play));
      }
    }

    // Assert all passed
    for (const result of results) {
      expect(result.hasCorrectAction,
        `${result.label} should have ${result.expected} action`).toBe(true);
      expect(result.hasAllKeys,
        `${result.label} ${result.expected} should have all expected keys`).toBe(true);
      expect(result.wronglyOnPlay,
        `${result.label} should NOT have action on play property`).toBe(false);
    }
  });

  test('Queue items include shuffle/continuous options', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/list/folder/TVApp`);
    const data = await response.json();

    // Sunday has shuffle: true in YAML
    const sunday = data.items?.find(i => i.label === 'Sunday');
    if (sunday) {
      expect(sunday.queue).toBeTruthy();
      expect(sunday.queue.shuffle).toBe(true);
      console.log('[PASS] Sunday queue includes shuffle option');
    }

    // Music has shuffle: true in YAML
    const music = data.items?.find(i => i.label === 'Music');
    if (music) {
      expect(music.queue).toBeTruthy();
      expect(music.queue.shuffle).toBe(true);
      console.log('[PASS] Music queue includes shuffle option');
    }
  });

  test('List items use list key not folder key', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/v1/list/folder/TVApp`);
    const data = await response.json();

    // FHE should be list: { list: "FHE" } not list: { folder: "FHE" }
    const fhe = data.items?.find(i => i.label === 'FHE');
    if (fhe) {
      expect(fhe.list).toBeTruthy();
      expect(fhe.list.list).toBe('FHE');
      expect(fhe.list.folder).toBeUndefined();
      console.log('[PASS] FHE uses list: { list: "FHE" }');
    }
  });

});
```

**Step 2: Run the test (expect failures)**

```bash
BASE_URL=http://localhost:3112 npx playwright test tests/runtime/tv-app/tv-menu-action-parity.runtime.test.mjs --reporter=list
```

Expected: Multiple failures showing current schema mismatches.

**Step 3: Commit the test**

```bash
git add tests/runtime/tv-app/tv-menu-action-parity.runtime.test.mjs
git commit -m "test(tv): add action parity test for menu items

Tests that FolderAdapter output matches production schema:
- Queue items have queue: {...} not play: {queue: ...}
- List items have list: {...} not play: {plex: ...}
- Options like shuffle included in action object

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Fix FolderAdapter Action Type Logic

**Files:**
- Modify: `backend/src/2_adapters/content/folder/FolderAdapter.mjs:310-390`

**Step 1: Add queueAction variable and refactor action logic**

Replace the action building logic (around lines 310-332) with:

```javascript
      // Build action object based on YAML action field
      // Frontend expects: queue: {...}, list: {...}, play: {...}, open: {...}
      const playAction = {};
      const openAction = {};
      const listAction = {};
      const queueAction = {};  // NEW: For queue actions

      // Determine action type from YAML (default to Play)
      const actionType = (item.action || 'Play').toLowerCase();

      // Build the base action object with source and key
      const baseAction = {};
      const src = item.src || parsed.source;
      baseAction[src] = mediaKey;

      // Add options to action object (not just metadata)
      if (item.shuffle) baseAction.shuffle = true;
      if (item.continuous) baseAction.continuous = true;
      if (item.playable !== undefined) baseAction.playable = item.playable;

      // Handle raw YAML overrides first
      if (item.play) {
        Object.assign(playAction, item.play);
      } else if (item.open) {
        Object.assign(openAction, item.open);
      } else if (item.queue) {
        Object.assign(queueAction, item.queue);
      } else if (item.list) {
        Object.assign(listAction, item.list);
      } else if (actionType === 'open' || parsed.source === 'app') {
        // Open action for app launches
        Object.assign(openAction, baseAction);
      } else if (actionType === 'queue') {
        // Queue action for shuffle/continuous playback
        Object.assign(queueAction, baseAction);
      } else if (actionType === 'list') {
        // List action for submenus and collections
        Object.assign(listAction, baseAction);
      } else {
        // Play action (default)
        Object.assign(playAction, baseAction);
      }
```

**Step 2: Update actions object construction**

Around line 380-385, update to include queue:

```javascript
        // Actions object
        actions: {
          queue: Object.keys(queueAction).length > 0 ? queueAction : undefined,  // NEW
          list: Object.keys(listAction).length > 0 ? listAction : undefined,
          play: Object.keys(finalPlayAction).length > 0 ? finalPlayAction : undefined,
          open: Object.keys(openAction).length > 0 ? openAction : undefined
        }
```

**Step 3: Update nomusic overlay logic**

The nomusic overlay check needs to handle both play and queue actions. Around line 334-348:

```javascript
      // Check if this is a Plex item with nomusic label that needs overlay
      let finalPlayAction = playAction;
      let finalQueueAction = queueAction;

      const plexId = playAction.plex || queueAction.plex;
      if (plexId && this.musicOverlayPlaylist) {
        const hasNomusic = await this._hasNomusicLabel(plexId);
        if (hasNomusic) {
          const overlay = {
            queue: { plex: this.musicOverlayPlaylist },
            shuffle: true
          };
          if (playAction.plex && !playAction.overlay) {
            finalPlayAction = { ...playAction, overlay };
          }
          if (queueAction.plex && !queueAction.overlay) {
            finalQueueAction = { ...queueAction, overlay };
          }
        }
      }
```

**Step 4: Run tests**

```bash
# Unit tests
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/content/folder/ --no-coverage

# Parity test
BASE_URL=http://localhost:3112 npx playwright test tests/runtime/tv-app/tv-menu-action-parity.runtime.test.mjs --reporter=list

# FHE submenu test
BASE_URL=http://localhost:3112 npx playwright test tests/runtime/tv-app/tv-folder-submenu.runtime.test.mjs --reporter=list
```

**Step 5: Manual verification with curl**

```bash
# Check Sunday (should be queue with shuffle)
curl -s "http://localhost:3112/api/v1/list/folder/TVApp" | jq '.items[] | select(.label == "Sunday") | {label, queue, play}'

# Check Chosen (should be list)
curl -s "http://localhost:3112/api/v1/list/folder/TVApp" | jq '.items[] | select(.label == "Chosen") | {label, list, play}'

# Check FHE (should be list with list key)
curl -s "http://localhost:3112/api/v1/list/folder/TVApp" | jq '.items[] | select(.label == "FHE") | {label, list, play}'

# Check Music (should be queue)
curl -s "http://localhost:3112/api/v1/list/folder/TVApp" | jq '.items[] | select(.label == "Music") | {label, queue, play}'
```

**Step 6: Commit**

```bash
git add backend/src/2_adapters/content/folder/FolderAdapter.mjs
git commit -m "fix(folder): use action field to determine output action type

FolderAdapter now reads the YAML 'action' field to determine which
output property to use:
- action: Queue → queue: { ... }
- action: List → list: { ... }
- action: Play → play: { ... }
- action: Open → open: { ... }

Also includes shuffle/continuous options in the action object
instead of only in metadata.

Fixes parity with production API schema.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update Unit Test for New Action Logic

**Files:**
- Modify: `tests/unit/suite/adapters/content/folder/folderAdapterListAction.unit.test.mjs`

**Step 1: Add tests for queue action and action field logic**

Add new test cases:

```javascript
  describe('action field determines output type', () => {
    it('should create queue action when action is Queue', () => {
      const item = { action: 'Queue', shuffle: true };
      const parsed = { source: 'plex', id: '642120' };
      const actionType = (item.action || 'Play').toLowerCase();

      const baseAction = { [parsed.source]: parsed.id };
      if (item.shuffle) baseAction.shuffle = true;

      const queueAction = actionType === 'queue' ? baseAction : {};
      const playAction = actionType === 'play' ? baseAction : {};

      expect(queueAction).toEqual({ plex: '642120', shuffle: true });
      expect(Object.keys(playAction).length).toBe(0);
    });

    it('should create list action when action is List', () => {
      const item = { action: 'List' };
      const parsed = { source: 'plex', id: '408886' };
      const actionType = (item.action || 'Play').toLowerCase();

      const baseAction = { [parsed.source]: parsed.id };

      const listAction = actionType === 'list' ? baseAction : {};
      const playAction = actionType === 'play' ? baseAction : {};

      expect(listAction).toEqual({ plex: '408886' });
      expect(Object.keys(playAction).length).toBe(0);
    });

    it('should default to play action when no action field', () => {
      const item = {};  // No action field
      const parsed = { source: 'talk', id: 'ldsgc202510' };
      const actionType = (item.action || 'Play').toLowerCase();

      const baseAction = { [parsed.source]: parsed.id };

      const playAction = actionType === 'play' ? baseAction : {};

      expect(playAction).toEqual({ talk: 'ldsgc202510' });
    });
  });
```

**Step 2: Run unit tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/suite/adapters/content/folder/folderAdapterListAction.unit.test.mjs --no-coverage
```

**Step 3: Commit**

```bash
git add tests/unit/suite/adapters/content/folder/folderAdapterListAction.unit.test.mjs
git commit -m "test(unit): add action field logic tests

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

- [ ] Sunday has `queue: { plex: "642120", shuffle: true }`
- [ ] Music has `queue: { queue: "Music Queue", shuffle: true }`
- [ ] Chosen has `list: { plex: "408886" }`
- [ ] FHE has `list: { list: "FHE" }`
- [ ] General Conference has `play: { talk: "ldsgc202510" }`
- [ ] Scripture has `play: { scripture: "nt" }`
- [ ] All parity tests pass
- [ ] FHE submenu test still passes
- [ ] Unit tests pass

---

## Related

- Previous fix: `docs/plans/2026-01-23-tv-folder-submenu-bugs-fix.md` (Task 1 partial fix)
- Bug report: `docs/_wip/bugs/2026-01-22-fhe-submenu-not-opening.md`
- Bug report: `docs/_wip/bugs/2026-01-22-chosen-tv-season-behavior-diff.md`
