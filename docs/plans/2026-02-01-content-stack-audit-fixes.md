# Content Stack Audit Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the 3 critical bugs and 8 medium-severity antipatterns identified in the content stack audit.

**Architecture:** Prioritized fixes starting with runtime errors, then feature gaps, then code quality improvements. Each task is isolated and independently testable.

**Tech Stack:** Node.js, Express, React, Vitest, Playwright

---

## Task 1: Fix FilesystemAdapter Undefined Variable

**Files:**
- Modify: `backend/src/1_adapters/content/media/filesystem/FilesystemAdapter.mjs:280`
- Test: `tests/isolated/adapters/content/FilesystemAdapter.test.mjs` (verify no regression)

**Step 1: Read the existing code context**

The issue is on line 280 - `watchState` is referenced but never defined. Looking at lines 253-256, the correct variable is `progress`:
```javascript
const progress = this._getMediaProgress(localId);
const resumePosition = progress?.playhead || progress?.seconds || null;
```

**Step 2: Fix the undefined variable**

Change lines 279-282 from:
```javascript
// Include watch state fields in metadata for compatibility
percent: watchState?.percent || null,
playhead: resumePosition,
watchTime: watchState?.watchTime || null
```

To:
```javascript
// Include watch state fields in metadata for compatibility
percent: progress?.percent || null,
playhead: resumePosition,
watchTime: progress?.watchTime || null
```

**Step 3: Run existing tests to verify no regression**

Run: `npm test -- tests/isolated/adapters/content/FilesystemAdapter.test.mjs`
Expected: All existing tests pass

**Step 4: Commit**

```bash
git add backend/src/1_adapters/content/media/filesystem/FilesystemAdapter.mjs
git commit -m "fix(filesystem): use correct progress variable for watch state metadata"
```

---

## Task 2: Fix TVApp List Action Missing Config Modifiers

**Files:**
- Modify: `frontend/src/Apps/TVApp.jsx:186`
- Test: `tests/live/flow/` (manual verification via URL params)

**Step 1: Identify the issue**

Line 186 currently:
```javascript
list: (value) => ({ list: { [findKey(value)]: value } }),
```

Unlike all other action mappings (play, queue, display, read), `list` doesn't spread `...config`.

**Step 2: Fix by adding config spread**

Change line 186 from:
```javascript
list:      (value) => ({ list: { [findKey(value)]: value } }),
```

To:
```javascript
list:      (value) => ({ list: { [findKey(value)]: value, ...config } }),
```

**Step 3: Manual test verification**

Load TVApp with: `?list=12345&volume=0.5&shader=blackout`
Verify: Config modifiers are now included in the list action object

**Step 4: Commit**

```bash
git add frontend/src/Apps/TVApp.jsx
git commit -m "fix(tvapp): apply config modifiers to list action"
```

---

## Task 3: Integrate Range Parser into Content Query Pipeline

**Files:**
- Modify: `backend/src/4_api/v1/parsers/contentQueryParser.mjs`
- Test: `tests/isolated/api/parsers/contentQueryParser.test.mjs`

**Step 1: Write failing tests for range parsing integration**

Add to `tests/isolated/api/parsers/contentQueryParser.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseContentQuery } from '../../../../backend/src/4_api/v1/parsers/contentQueryParser.mjs';

describe('parseContentQuery - duration parsing', () => {
  it('parses simple duration to seconds', () => {
    const result = parseContentQuery({ duration: '3m' });
    expect(result.duration).toEqual({ value: 180 });
  });

  it('parses duration range to from/to seconds', () => {
    const result = parseContentQuery({ duration: '3m..10m' });
    expect(result.duration).toEqual({ from: 180, to: 600 });
  });

  it('parses open-ended duration range', () => {
    const result = parseContentQuery({ duration: '..5m' });
    expect(result.duration).toEqual({ from: null, to: 300 });
  });
});

describe('parseContentQuery - time parsing', () => {
  it('parses year to date range', () => {
    const result = parseContentQuery({ time: '2025' });
    expect(result.time).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('parses year-month to date range', () => {
    const result = parseContentQuery({ time: '2025-06' });
    expect(result.time).toEqual({ from: '2025-06-01', to: '2025-06-30' });
  });

  it('parses year range', () => {
    const result = parseContentQuery({ time: '2024..2025' });
    expect(result.time).toEqual({ from: '2024-01-01', to: '2025-12-31' });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- tests/isolated/api/parsers/contentQueryParser.test.mjs`
Expected: FAIL - duration and time are returned as raw strings

**Step 3: Implement range parsing integration**

Modify `backend/src/4_api/v1/parsers/contentQueryParser.mjs`:

Add import at top:
```javascript
import { parseDuration, parseTime } from './rangeParser.mjs';
```

In `parseContentQuery()`, after the canonical keys loop (after line 107), add parsing:
```javascript
  // Parse duration if present
  if (query.duration) {
    const parsed = parseDuration(query.duration);
    if (parsed) query.duration = parsed;
  }

  // Parse time if present
  if (query.time) {
    const parsed = parseTime(query.time);
    if (parsed) query.time = parsed;
  }
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- tests/isolated/api/parsers/contentQueryParser.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/parsers/contentQueryParser.mjs tests/isolated/api/parsers/contentQueryParser.test.mjs
git commit -m "feat(query): integrate range parser for duration and time values"
```

---

## Task 4: Add "local" Prefix Alias to FolderAdapter

**Files:**
- Modify: `backend/src/1_adapters/content/folder/FolderAdapter.mjs`
- Test: `tests/isolated/adapters/content/FolderAdapter.test.mjs`

**Step 1: Write failing test for local prefix**

Add to FolderAdapter tests:

```javascript
describe('FolderAdapter prefixes', () => {
  it('includes local as prefix alias', () => {
    const adapter = new FolderAdapter({ basePath: '/test' });
    const prefixes = adapter.prefixes;
    expect(prefixes.map(p => p.prefix)).toContain('local');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/adapters/content/FolderAdapter.test.mjs`
Expected: FAIL - 'local' not in prefixes

**Step 3: Add local prefix**

In `FolderAdapter.mjs`, find the `get prefixes()` getter and add 'local':

From:
```javascript
get prefixes() {
  return [{ prefix: 'folder' }];
}
```

To:
```javascript
get prefixes() {
  return [
    { prefix: 'folder' },
    { prefix: 'local' }
  ];
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/adapters/content/FolderAdapter.test.mjs`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/content/folder/FolderAdapter.mjs tests/isolated/adapters/content/FolderAdapter.test.mjs
git commit -m "feat(folder): add 'local' prefix alias for FolderAdapter"
```

---

## Task 5: Extract parseModifiers to Shared Utility (DRY)

**Files:**
- Create: `backend/src/4_api/v1/utils/modifierParser.mjs`
- Modify: `backend/src/4_api/v1/routers/item.mjs`
- Modify: `backend/src/4_api/v1/routers/list.mjs`
- Modify: `backend/src/4_api/v1/routers/play.mjs`
- Test: `tests/isolated/api/utils/modifierParser.test.mjs`

**Step 1: Write test for shared utility**

Create `tests/isolated/api/utils/modifierParser.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseModifiers } from '../../../../backend/src/4_api/v1/utils/modifierParser.mjs';

describe('parseModifiers', () => {
  it('returns empty object for no modifiers', () => {
    expect(parseModifiers('')).toEqual({});
  });

  it('parses single modifier', () => {
    expect(parseModifiers('shuffle')).toEqual({ shuffle: true });
  });

  it('parses comma-separated modifiers', () => {
    expect(parseModifiers('shuffle,playable')).toEqual({ shuffle: true, playable: true });
  });

  it('parses slash-separated modifiers', () => {
    expect(parseModifiers('shuffle/playable')).toEqual({ shuffle: true, playable: true });
  });

  it('handles undefined input', () => {
    expect(parseModifiers(undefined)).toEqual({});
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/isolated/api/utils/modifierParser.test.mjs`
Expected: FAIL - module not found

**Step 3: Create shared utility**

Create `backend/src/4_api/v1/utils/modifierParser.mjs`:

```javascript
/**
 * Parse URL path modifiers into an object.
 * Supports comma-separated (shuffle,playable) or slash-separated (shuffle/playable) formats.
 *
 * @param {string|undefined} modifierString - The modifier portion of the URL path
 * @returns {Object} Object with modifier flags set to true
 */
export function parseModifiers(modifierString) {
  if (!modifierString) return {};

  const modifiers = {};
  // Support both comma and slash separators
  const parts = modifierString.split(/[,\/]/).filter(Boolean);

  for (const part of parts) {
    modifiers[part.trim()] = true;
  }

  return modifiers;
}

export default { parseModifiers };
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/isolated/api/utils/modifierParser.test.mjs`
Expected: PASS

**Step 5: Update item.mjs to use shared utility**

In `backend/src/4_api/v1/routers/item.mjs`:

Add import:
```javascript
import { parseModifiers } from '../utils/modifierParser.mjs';
```

Remove the local `parseModifiers` function (lines 12-41 approximately).

**Step 6: Update list.mjs to use shared utility**

Same pattern - add import, remove local function.

**Step 7: Update play.mjs to use shared utility**

Same pattern - add import, remove local function.

**Step 8: Run all router tests**

Run: `npm test -- tests/isolated/api/routers/`
Expected: PASS

**Step 9: Commit**

```bash
git add backend/src/4_api/v1/utils/modifierParser.mjs \
        backend/src/4_api/v1/routers/item.mjs \
        backend/src/4_api/v1/routers/list.mjs \
        backend/src/4_api/v1/routers/play.mjs \
        tests/isolated/api/utils/modifierParser.test.mjs
git commit -m "refactor(api): extract parseModifiers to shared utility"
```

---

## Task 6: Fix ContentSourceRegistry resolve() to Use Private Entries

**Files:**
- Modify: `backend/src/2_domains/content/services/ContentSourceRegistry.mjs:198`
- Test: `tests/isolated/domains/content/ContentSourceRegistry.test.mjs`

**Step 1: Verify existing tests pass**

Run: `npm test -- tests/isolated/domains/content/ContentSourceRegistry.test.mjs`
Expected: PASS (baseline)

**Step 2: Fix resolve() to use private entries**

In `ContentSourceRegistry.mjs`, change line 198 from:
```javascript
const adapter = this.adapters.get(source);
```

To:
```javascript
const adapter = this.#adapterEntries.get(source)?.adapter;
```

**Step 3: Run tests to verify no regression**

Run: `npm test -- tests/isolated/domains/content/ContentSourceRegistry.test.mjs`
Expected: PASS

**Step 4: Commit**

```bash
git add backend/src/2_domains/content/services/ContentSourceRegistry.mjs
git commit -m "fix(registry): use private adapterEntries in resolve() for consistency"
```

---

## Task 7: Remove Legacy .show Field from API Responses

**Files:**
- Modify: `backend/src/4_api/v1/routers/play.mjs:111`
- Modify: `backend/src/4_api/v1/routers/content.mjs:607`
- Test: Manual API response verification

**Step 1: Remove .show from play.mjs**

In `backend/src/4_api/v1/routers/play.mjs`, remove line 111:
```javascript
if (item.metadata.grandparentTitle) response.show = item.metadata.grandparentTitle;
```

Consumers should use `grandparentTitle` directly from item metadata.

**Step 2: Remove .show alias from content.mjs**

In `backend/src/4_api/v1/routers/content.mjs`, line 607, change from:
```javascript
show: item.metadata?.show || item.metadata?.grandparentTitle || null,
```

To:
```javascript
grandparentTitle: item.metadata?.grandparentTitle || null,
```

**Step 3: Search for frontend consumers of .show field**

Run: `grep -r "\.show" frontend/src/`

Update any components that reference `.show` to use `.grandparentTitle` instead.

**Step 4: Run frontend tests**

Run: `npx playwright test tests/live/flow/`
Expected: PASS (or update selectors if needed)

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/play.mjs \
        backend/src/4_api/v1/routers/content.mjs
git commit -m "refactor(api): remove legacy .show field, use canonical grandparentTitle"
```

---

## Task 8: Remove parentThumb/grandparentThumb from Top-Level Responses

**Files:**
- Modify: `backend/src/4_api/v1/routers/list.mjs:148-149`
- Modify: `backend/src/4_api/v1/routers/item.mjs:203`
- Test: API response verification

**Step 1: Review the reference spec**

Per the content-stack-reference.md, thumbnails should be accessed via `parents[parentId].thumbnail`, not as top-level `parentThumb` fields.

**Step 2: Remove from list.mjs**

In `backend/src/4_api/v1/routers/list.mjs`, remove lines 148-149:
```javascript
if (parentThumb !== undefined) base.parentThumb = parentThumb;
if (grandparentThumb !== undefined) base.grandparentThumb = grandparentThumb;
```

**Step 3: Remove from item.mjs**

In `backend/src/4_api/v1/routers/item.mjs`, line 203, remove `parentThumb` and `grandparentThumb` from the extracted metadata fields if present.

**Step 4: Verify parents map has thumbnail**

Ensure the `parents` map structure includes `thumbnail` field (should already be there per existing code).

**Step 5: Run tests**

Run: `npm test && npx playwright test tests/live/flow/fitness/`
Expected: PASS (FitnessShow uses parents map correctly)

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/list.mjs \
        backend/src/4_api/v1/routers/item.mjs
git commit -m "refactor(api): remove parentThumb/grandparentThumb from top-level responses"
```

---

## Task 9: Update Reference Spec to Resolve Contradictions

**Files:**
- Modify: `docs/reference/content/content-stack-reference.md`

**Step 1: Remove parentThumb/grandparentThumb from table**

Lines 450-454: Remove `parentThumb` and `grandparentThumb` from the canonical hierarchy fields table since they're not in the canonical response format.

**Step 2: Verify JSON example matches table**

Lines 459-477: Confirm the JSON example only includes fields that are in the table.

**Step 3: Add clarifying note**

Add a note that thumbnails are accessed via `parents[parentId].thumbnail` lookup, not as top-level fields on items.

**Step 4: Commit**

```bash
git add docs/reference/content/content-stack-reference.md
git commit -m "docs: clarify hierarchy field naming - thumbnail via parents map only"
```

---

## Summary

| Task | Type | Severity | Status |
|------|------|----------|--------|
| 1 | Bug fix | 🔴 Critical | FilesystemAdapter undefined variable |
| 2 | Bug fix | 🔴 Critical | TVApp list action missing config |
| 3 | Feature | 🔴 Critical | Range parser integration |
| 4 | Feature | 🟡 Medium | FolderAdapter local prefix |
| 5 | Refactor | 🟡 Medium | Extract parseModifiers utility |
| 6 | Bug fix | 🟡 Medium | ContentSourceRegistry resolve() |
| 7 | Refactor | 🟡 Medium | Remove legacy .show field |
| 8 | Refactor | 🟡 Medium | Remove parentThumb from responses |
| 9 | Docs | 🟢 Low | Fix spec contradictions |

**Estimated commits:** 9
**Testing approach:** TDD for new code, regression testing for fixes
