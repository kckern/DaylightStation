# Launchable Content Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the gaps found during live API testing of the RetroArch game launcher — game items need a `launch` action in the API response, and the adapter needs a centralized prefix-stripping helper.

**Architecture:** Two categories of fixes: (1) the list API `toListItem()` function must emit `launch: { contentId }` for LaunchableItem entities so the frontend can dispatch them; (2) the RetroArchAdapter should use a centralized `#stripPrefix()` helper (matching AudiobookshelfAdapter/KomgaAdapter patterns) for consistency and safety.

**Tech Stack:** Node.js/ESM backend, Jest for tests

**Key context for implementer:**
- The list router (`backend/src/4_api/v1/routers/list.mjs`) calls adapters with **compound IDs** like `retroarch:n64` — adapters must strip the source prefix before processing.
- The `toListItem()` function in that same file transforms domain Item entities into API response objects. It computes `play`/`queue`/`list` actions but currently has **no concept of `launch`**.
- The frontend `MenuStack.jsx` checks `selection.launch` to dispatch game launches — if the list API doesn't include `launch`, clicking a game does nothing.
- `LaunchableItem` has `isLaunchable()` returning `true` and a `launchIntent` property, but the adapter's `#listGames()` returns plain `Item` objects (not `LaunchableItem`), so the list items don't carry launch info.
- Pattern reference: `AudiobookshelfAdapter` and `KomgaAdapter` use a `#stripPrefix()` private helper — this is the codebase's best practice.

---

## Task 1: Add `launch` action to `toListItem()` in list router

The `toListItem()` function (line 64 of `list.mjs`) computes default actions for items. It checks `item.actions?.open` and `item.actions?.display` but has no handling for `launch`. Items from the RetroArchAdapter are games that should be launched, not played.

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs:64-106`
- Test: `tests/unit/suite/api/list-toListItem.test.mjs` (create)

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/api/list-toListItem.test.mjs
import { describe, it, expect } from '@jest/globals';
import { toListItem } from '#api/v1/routers/list.mjs';

describe('toListItem', () => {
  it('emits launch action for items with actions.launch', () => {
    const item = {
      id: 'retroarch:n64/mario-kart-64',
      localId: 'n64/mario-kart-64',
      title: 'Mario Kart 64',
      type: 'game',
      metadata: { type: 'game', console: 'n64' },
      actions: {
        launch: { contentId: 'retroarch:n64/mario-kart-64' }
      }
    };

    const result = toListItem(item);

    expect(result.launch).toEqual({ contentId: 'retroarch:n64/mario-kart-64' });
    // Should NOT have play/queue/list since it's a launch item
    expect(result.play).toBeUndefined();
  });

  it('computes launch action for LaunchableItem-shaped items', () => {
    // When an item has isLaunchable() or launchIntent, toListItem should
    // compute a launch action even without explicit actions.launch
    const item = {
      id: 'retroarch:n64/mario-kart-64',
      localId: 'n64/mario-kart-64',
      title: 'Mario Kart 64',
      type: 'game',
      metadata: { type: 'game', console: 'n64' },
      launchIntent: { target: 'com.retroarch/Activity', params: {} }
    };

    const result = toListItem(item);

    expect(result.launch).toEqual({ contentId: 'retroarch:n64/mario-kart-64' });
  });

  it('does NOT add launch for normal playable items', () => {
    const item = {
      id: 'plex:12345',
      localId: '12345',
      title: 'Some Movie',
      type: 'movie',
      metadata: { type: 'movie' },
      mediaUrl: '/some/url'
    };

    const result = toListItem(item);

    expect(result.launch).toBeUndefined();
    expect(result.play).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/api/list-toListItem.test.mjs --no-coverage`
Expected: FAIL — `launch` is undefined on the result

**Step 3: Add launch action handling to `toListItem()`**

In `backend/src/4_api/v1/routers/list.mjs`, add two things after the existing `if (item.actions?.display)` block (around line 105):

```javascript
  // Launch action from Item (check item.actions for launch)
  if (item.actions?.launch) base.launch = item.actions.launch;

  // Compute launch action for LaunchableItem entities (have launchIntent but no explicit actions)
  if (!base.launch && item.launchIntent) {
    base.launch = { contentId: item.id };
  }
```

This mirrors the existing pattern for `open` and `display` at lines 104-105, and adds a computed fallback for LaunchableItem entities (same pattern as computed `play`/`queue`/`list` at lines 74-82).

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/api/list-toListItem.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/list.mjs tests/unit/suite/api/list-toListItem.test.mjs
git commit -m "fix(api): emit launch action in toListItem for LaunchableItem entities"
```

---

## Task 2: Make `#listGames()` return items with `launch` action

The `RetroArchAdapter.#listGames()` method returns plain `Item` objects with no actions. Game items need an `actions.launch` property so `toListItem()` (fixed in Task 1) can include it in the API response. The frontend `MenuStack.jsx` checks `selection.launch` to dispatch the launch flow.

**Files:**
- Modify: `backend/src/1_adapters/content/retroarch/RetroArchAdapter.mjs:146-168`
- Modify: `tests/unit/suite/adapters/RetroArchAdapter.test.mjs`

**Step 1: Write the failing test**

Add a test to the existing `getList` describe block:

```javascript
    it('returns game items with launch action', async () => {
      const list = await adapter.getList('retroarch:n64');
      expect(list).toHaveLength(2);
      // Each game item should have actions.launch with its compound contentId
      expect(list[0].actions).toEqual({
        launch: { contentId: 'retroarch:n64/mario-kart-64' }
      });
      expect(list[1].actions).toEqual({
        launch: { contentId: 'retroarch:n64/star-fox-64' }
      });
    });
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/adapters/RetroArchAdapter.test.mjs --no-coverage`
Expected: FAIL — `list[0].actions` is null

**Step 3: Add `actions.launch` to `#listGames()` items**

In `RetroArchAdapter.mjs`, modify `#listGames()` to include the launch action. Change the `new Item({...})` call (line 158) to include `actions`:

```javascript
      .map(game => {
        const overrides = this.#catalog.overrides?.[`${consoleId}/${game.id}`] || {};
        const compoundId = `retroarch:${consoleId}/${game.id}`;
        return new Item({
          id: compoundId,
          source: 'retroarch',
          localId: `${consoleId}/${game.id}`,
          title: overrides.title || game.title,
          type: 'game',
          thumbnail: game.thumbnail ? `/api/v1/proxy/retroarch/thumbnail/${game.thumbnail}` : null,
          metadata: { type: 'game', console: consoleId, parentTitle: consoleConfig.label },
          actions: { launch: { contentId: compoundId } }
        });
      });
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/adapters/RetroArchAdapter.test.mjs --no-coverage`
Expected: PASS (12 tests including the new one)

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/retroarch/RetroArchAdapter.mjs tests/unit/suite/adapters/RetroArchAdapter.test.mjs
git commit -m "fix(retroarch): add launch action to game list items"
```

---

## Task 3: Add `#listConsoles()` list action for drill-down

The `#listConsoles()` method returns console items with no actions. When the frontend displays the console list, clicking a console should navigate into it (like any container). Console items need `actions.list` so `toListItem()` emits a `list` property and the frontend's `MenuStack.handleSelect` dispatches the drill-down.

**Files:**
- Modify: `backend/src/1_adapters/content/retroarch/RetroArchAdapter.mjs:129-142`
- Modify: `tests/unit/suite/adapters/RetroArchAdapter.test.mjs`

**Step 1: Write the failing test**

Add to the `getList` describe block:

```javascript
    it('returns console items with list action for drill-down', async () => {
      const list = await adapter.getList('retroarch:');
      expect(list[0].actions).toEqual({
        list: { contentId: 'retroarch:n64' }
      });
    });
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/suite/adapters/RetroArchAdapter.test.mjs --no-coverage`
Expected: FAIL — `list[0].actions` is null

**Step 3: Add `actions.list` to `#listConsoles()` items**

In `RetroArchAdapter.mjs`, modify `#listConsoles()` to include the list action. Update the `new Item({...})` call:

```javascript
  #listConsoles() {
    const consoles = this.#config.consoles || {};
    return Object.entries(consoles).map(([id, cfg]) => {
      const gameCount = (this.#catalog.games?.[id] || []).length;
      const compoundId = `retroarch:${id}`;
      return new Item({
        id: compoundId,
        source: 'retroarch',
        localId: id,
        title: cfg.label,
        type: 'console',
        metadata: { type: 'console', gameCount, menuStyle: cfg.menuStyle },
        actions: { list: { contentId: compoundId } }
      });
    });
  }
```

**Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/suite/adapters/RetroArchAdapter.test.mjs --no-coverage`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/retroarch/RetroArchAdapter.mjs tests/unit/suite/adapters/RetroArchAdapter.test.mjs
git commit -m "fix(retroarch): add list action to console items for menu drill-down"
```

---

## Task 4: Centralize prefix stripping with `#stripPrefix()` helper

The adapter currently uses inline `.replace(/^retroarch:/, '')` in `getList`, `getItem`, and `resolveSiblings`. Following the `AudiobookshelfAdapter` and `KomgaAdapter` codebase pattern, extract this to a single `#stripPrefix()` private method. This prevents future bugs from copy-paste inconsistency.

**Files:**
- Modify: `backend/src/1_adapters/content/retroarch/RetroArchAdapter.mjs`
- No new tests needed — existing tests already cover compound ID handling

**Step 1: Run existing tests to confirm they pass before refactoring**

Run: `npx jest tests/unit/suite/adapters/RetroArchAdapter.test.mjs --no-coverage`
Expected: PASS

**Step 2: Add `#stripPrefix()` helper and use it in all methods**

Add a private method and replace all inline `.replace()` calls:

```javascript
  // Add after constructor, before get source()
  #stripPrefix(id) {
    return id?.replace(/^retroarch:/, '') || '';
  }
```

Then replace:
- `getList`: `const localId = id?.replace(/^retroarch:/, '') || '';` → `const localId = this.#stripPrefix(id);`
- `getItem`: `const localId = id?.replace(/^retroarch:/, '') || '';` → `const localId = this.#stripPrefix(id);`
- `resolveSiblings`: `const localId = compoundId.replace(/^retroarch:/, '');` → `const localId = this.#stripPrefix(compoundId);`

**Step 3: Run tests to confirm refactoring is safe**

Run: `npx jest tests/unit/suite/adapters/RetroArchAdapter.test.mjs --no-coverage`
Expected: PASS (all 14 tests, no behavior change)

**Step 4: Commit**

```bash
git add backend/src/1_adapters/content/retroarch/RetroArchAdapter.mjs
git commit -m "refactor(retroarch): centralize prefix stripping with #stripPrefix() helper"
```

---

## Task 5: Run full test suite and verify live API

**Step 1: Run all new + existing tests**

Run: `npx jest --testPathPattern='tests/unit/suite/(adapters/RetroArch|api/list-toListItem|api/(launch|sync)|applications/(LaunchService|SyncService)|domains/LaunchableItem|applications/(IDeviceLauncher|ISyncSource)|adapters/AdbLauncher)' --no-coverage`

Expected: All tests pass (new count: ~48+ tests across 11 suites)

**Step 2: Verify live API on localhost**

```bash
# Console list should show 8 consoles with list actions
curl -s http://localhost:3111/api/v1/list/retroarch/recent_on_top | python3 -c "
import sys,json; d=json.load(sys.stdin)
for item in d['items'][:2]:
    print(f'{item[\"title\"]}: list={item.get(\"list\")}')"

# Expected output:
# Nintendo 64: list={'contentId': 'retroarch:n64'}
# Super Nintendo: list={'contentId': 'retroarch:snes'}
```

**Step 3: Commit any remaining fixes**
