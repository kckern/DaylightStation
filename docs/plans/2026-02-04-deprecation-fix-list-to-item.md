# Deprecation Fix: /api/v1/list → /api/v1/item Migration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all deprecated `/api/v1/list/` endpoint calls to `/api/v1/item/` across frontend and tests.

**Architecture:** The backend already supports both endpoints but logs deprecation warnings for `/api/v1/list/`. This is a find-and-replace migration across frontend components and test files. The backend deprecation warning code remains until all consumers are migrated.

**Tech Stack:** React (frontend), Vitest/Playwright (tests), Express (backend)

---

## Task 1: Migrate ContentSearchCombobox.jsx

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx`

**Step 1: Open the file and locate deprecated endpoints**

The file has 5 instances of `/api/v1/list/` that need to change to `/api/v1/item/`:
- Line 156
- Line 175
- Line 200
- Line 227
- Line 269

**Step 2: Replace all instances**

Find and replace in the file:
- Find: `/api/v1/list/`
- Replace: `/api/v1/item/`

**Step 3: Verify the changes**

Run: `grep -n "/api/v1/list/" frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx`
Expected: No output (no matches)

Run: `grep -n "/api/v1/item/" frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx`
Expected: 5 matches

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ContentSearchCombobox.jsx
git commit -m "fix: migrate ContentSearchCombobox from /api/v1/list to /api/v1/item"
```

---

## Task 2: Migrate ListsItemRow.jsx

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

**Step 1: Locate deprecated endpoints**

The file has 4 remaining instances of `/api/v1/list/` (other lines already use `/api/v1/item/`):
- Line 868: `/api/v1/list/list/${source}:`
- Line 879: `/api/v1/list/filesystem/video/news`
- Line 890: `/api/v1/list/local-content/talk:`
- Line 904: `/api/v1/list/${source}/${parentPath}`

**Step 2: Replace all instances**

Find and replace in the file:
- Find: `/api/v1/list/`
- Replace: `/api/v1/item/`

**Step 3: Verify the changes**

Run: `grep -n "/api/v1/list/" frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`
Expected: No output (no matches)

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix: migrate ListsItemRow from /api/v1/list to /api/v1/item"
```

---

## Task 3: Migrate Test Fixture Loader

**Files:**
- Modify: `tests/_fixtures/combobox/dynamicFixtureLoader.mjs`

**Step 1: Locate deprecated endpoints**

- Line 57: `/api/v1/list/${source}/${encodeURIComponent(path)}`
- Line 58: `/api/v1/list/${source}/`

**Step 2: Replace all instances**

Find and replace in the file:
- Find: `/api/v1/list/`
- Replace: `/api/v1/item/`

**Step 3: Verify the changes**

Run: `grep -n "/api/v1/list/" tests/_fixtures/combobox/dynamicFixtureLoader.mjs`
Expected: No output

**Step 4: Commit**

```bash
git add tests/_fixtures/combobox/dynamicFixtureLoader.mjs
git commit -m "fix: migrate dynamicFixtureLoader from /api/v1/list to /api/v1/item"
```

---

## Task 4: Migrate API Parity Tests

**Files:**
- Modify: `tests/integrated/api/parity/v1-regression.test.mjs`
- Modify: `tests/integrated/api/parity/prod-v1.test.mjs`

**Step 1: Replace in v1-regression.test.mjs**

Instances:
- Line 228: `/api/v1/list/folder/FHE`
- Line 245: `/api/v1/list/folder/FHE/playable`
- Line 547: `/api/v1/list/folder/${id}`

Find and replace: `/api/v1/list/` → `/api/v1/item/`

**Step 2: Replace in prod-v1.test.mjs**

Instances:
- Line 48: `/api/v1/list/plex/671468`
- Line 54: `/api/v1/list/plex/662027/playable`
- Line 367: `/api/v1/list/plex/671468`
- Line 391: `/api/v1/list/plex/662027/playable`

Find and replace: `/api/v1/list/` → `/api/v1/item/`

**Step 3: Verify the changes**

Run: `grep -rn "/api/v1/list/" tests/integrated/api/parity/`
Expected: No output

**Step 4: Commit**

```bash
git add tests/integrated/api/parity/v1-regression.test.mjs tests/integrated/api/parity/prod-v1.test.mjs
git commit -m "fix: migrate API parity tests from /api/v1/list to /api/v1/item"
```

---

## Task 5: Migrate Combobox Preflight Test

**Files:**
- Modify: `tests/live/flow/admin/content-search-combobox/00-preflight.runtime.test.mjs`

**Step 1: Locate deprecated endpoints**

- Line 57: `/api/v1/list/media/`
- Line 63: `/api/v1/list/media/` (error message)

**Step 2: Replace all instances**

Find and replace: `/api/v1/list/` → `/api/v1/item/`

**Step 3: Verify the changes**

Run: `grep -n "/api/v1/list/" tests/live/flow/admin/content-search-combobox/00-preflight.runtime.test.mjs`
Expected: No output

**Step 4: Commit**

```bash
git add tests/live/flow/admin/content-search-combobox/00-preflight.runtime.test.mjs
git commit -m "fix: migrate combobox preflight test from /api/v1/list to /api/v1/item"
```

---

## Task 6: Migrate TV Flow Tests

**Files:**
- Modify: `tests/live/flow/tv/tv-composite-player.runtime.test.mjs`
- Modify: `tests/live/flow/tv/tv-folder-submenu.runtime.test.mjs`
- Modify: `tests/live/flow/tv/tv-menu-item-resolution.runtime.test.mjs`
- Modify: `tests/live/flow/tv/tv-chosen-season-list.runtime.test.mjs`
- Modify: `tests/live/flow/tv/tv-menu-action-parity.runtime.test.mjs`

**Step 1: Replace in all TV test files**

All use `/api/v1/list/folder/TVApp` pattern.

Find and replace in each file: `/api/v1/list/` → `/api/v1/item/`

**Step 2: Verify the changes**

Run: `grep -rn "/api/v1/list/" tests/live/flow/tv/`
Expected: No output

**Step 3: Commit**

```bash
git add tests/live/flow/tv/*.runtime.test.mjs
git commit -m "fix: migrate TV flow tests from /api/v1/list to /api/v1/item"
```

---

## Task 7: Migrate Remaining Flow Tests

**Files:**
- Modify: `tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs`
- Modify: `tests/live/flow/canvas/canvas-immich-display.runtime.test.mjs`

**Step 1: Replace in fitness test**

- Line 293: `/api/v1/list/plex/${collectionId}` → `/api/v1/item/plex/${collectionId}`

**Step 2: Replace in canvas test**

- Line 119: `/api/v1/list/immich/${localId}` → `/api/v1/item/immich/${localId}`

**Step 3: Verify the changes**

Run: `grep -rn "/api/v1/list/" tests/live/flow/fitness/ tests/live/flow/canvas/`
Expected: No output

**Step 4: Commit**

```bash
git add tests/live/flow/fitness/fitness-happy-path.runtime.test.mjs tests/live/flow/canvas/canvas-immich-display.runtime.test.mjs
git commit -m "fix: migrate fitness and canvas tests from /api/v1/list to /api/v1/item"
```

---

## Task 8: Migrate Test Library

**Files:**
- Modify: `tests/_lib/comboboxTestHarness.mjs`

**Step 1: Locate and replace deprecated endpoints**

- Line 95: Reference to `/api/v1/list/`

Find and replace: `/api/v1/list/` → `/api/v1/item/`

**Step 2: Verify the changes**

Run: `grep -n "/api/v1/list/" tests/_lib/comboboxTestHarness.mjs`
Expected: No output

**Step 3: Commit**

```bash
git add tests/_lib/comboboxTestHarness.mjs
git commit -m "fix: migrate comboboxTestHarness from /api/v1/list to /api/v1/item"
```

---

## Task 9: Update Documentation

**Files:**
- Modify: `docs/reference/content/content-stack-reference.md`
- Modify: `tests/live/flow/admin/content-search-combobox/README.md`

**Step 1: Update content-stack-reference.md**

Replace examples:
- Line 843: `/api/v1/list/media/sfx` → `/api/v1/item/media/sfx`
- Line 853: `/api/v1/list/list/watchlist:` → `/api/v1/item/list/watchlist:`
- Line 885: `/api/v1/list/list/${source}:` → `/api/v1/item/list/${source}:`

**Step 2: Update combobox README**

- Line 74: Update preflight endpoint reference

**Step 3: Verify the changes**

Run: `grep -rn "/api/v1/list/" docs/`
Expected: No output (or only historical/migration notes)

**Step 4: Commit**

```bash
git add docs/reference/content/content-stack-reference.md tests/live/flow/admin/content-search-combobox/README.md
git commit -m "docs: update API endpoint examples from /api/v1/list to /api/v1/item"
```

---

## Task 10: Verify No Deprecation Warnings

**Step 1: Start dev server if not running**

Run: `lsof -i :3111`
If no output, start: `npm run dev`

**Step 2: Open the admin page that triggered warnings**

Navigate to: `http://localhost:3111/admin/content/lists/programs/morning-program`

**Step 3: Check dev logs for deprecation warnings**

Run: `tail -50 dev.log | grep DEPRECATION`
Expected: No output (no deprecation warnings)

**Step 4: Final commit (if any stragglers found)**

If any missed, fix and commit.

---

## Task 11: Final Verification Sweep

**Step 1: Search entire codebase for remaining deprecated usage**

Run: `grep -rn "/api/v1/list/" --include="*.jsx" --include="*.js" --include="*.mjs" --include="*.ts" --include="*.tsx" frontend/ tests/ backend/`

Expected: Only the backend deprecation warning definition in `backend/src/4_api/v1/routers/list.mjs`

**Step 2: Confirm backend still has deprecation warning (for external consumers)**

The deprecation warning in `backend/src/4_api/v1/routers/list.mjs:267` should remain to warn any external or uncaught consumers.

**Step 3: Done**

All internal consumers migrated. Deprecation warning remains for backward compatibility with any external consumers.
