# Freeform Commit Bugfix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the bug where pressing Enter in the inline ContentSearchCombobox (ListsItemRow.jsx) selects the first browse/search result instead of committing the user's freeform text.

**Architecture:** Add a `userNavigatedRef` to distinguish between auto-highlight (set on every keystroke) and explicit user navigation (ArrowUp/ArrowDown). On Enter/Tab, only select the highlighted item if the user explicitly navigated to it with arrow keys; otherwise commit freeform text.

**Tech Stack:** React (useRef), existing ListsItemRow.jsx inline ContentSearchCombobox

**Bug Reference:** `docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md`

---

### The Bug

In `ListsItemRow.jsx`'s inline `ContentSearchCombobox`:

1. **Line 1852:** `setHighlightedIdx(0)` fires on every keystroke in the `onChange` handler
2. **Line 1524:** `const item = items[highlightedIdx]` — when `highlightedIdx === 0` and `displayItems[0]` exists (browse items or search results), `item` is truthy
3. **Line 1525-1527:** `if (item)` → `handleOptionSelect(item.value)` — selects the first result instead of the user's typed text
4. The freeform path at **line 1528-1529** (`else if (searchQuery) commitFreeformText('enter')`) is never reached when items exist

**Same bug on Tab** at lines 1537-1543.

**Blur path is safe** — `handleBlur` unconditionally commits freeform text.

### The Fix

Add a `userNavigatedRef` (useRef) that tracks whether the highlight was set by explicit arrow-key navigation:

- Set `false` on every keystroke (onChange)
- Set `true` on ArrowDown/ArrowUp
- In Enter/Tab handlers: if `!userNavigatedRef.current`, treat as freeform commit (don't use highlighted item)

---

### Task 1: Add `userNavigatedRef` and Wire It Up

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

**Step 1: Add the ref declaration**

Find the existing ref declarations near the top of the `ContentSearchCombobox` component (around line 714-728). After the existing refs/state, add:

```javascript
const userNavigatedRef = useRef(false);
```

Find the `useRef` import — it should already be imported from React at the top of the file. Verify this.

**Step 2: Set `userNavigatedRef = false` on every keystroke**

Find the `onChange` handler on the `<InputBase>` (around line 1848-1854). Add `userNavigatedRef.current = false;` after `setSearchQuery(val)`:

```javascript
onChange={(e) => {
  const val = e.currentTarget.value;
  log.debug('input.change', { value: val, prevValue: searchQuery });
  setSearchQuery(val);
  userNavigatedRef.current = false;
  setHighlightedIdx(0);
  combobox.openDropdown();
}}
```

**Step 3: Set `userNavigatedRef = true` on ArrowDown/ArrowUp**

Find the ArrowDown handler (around line 1555-1559). Add `userNavigatedRef.current = true;` after `setHighlightedIdx(newIdx)`:

```javascript
if (e.key === 'ArrowDown') {
  e.preventDefault();
  const newIdx = (highlightedIdx + 1) % items.length;
  log.debug('key.arrow_down', { from: highlightedIdx, to: newIdx, itemTitle: items[newIdx]?.title });
  setHighlightedIdx(newIdx);
  userNavigatedRef.current = true;
}
```

Find the ArrowUp handler (around line 1560-1564). Add the same:

```javascript
} else if (e.key === 'ArrowUp') {
  e.preventDefault();
  const newIdx = highlightedIdx <= 0 ? items.length - 1 : highlightedIdx - 1;
  log.debug('key.arrow_up', { from: highlightedIdx, to: newIdx, itemTitle: items[newIdx]?.title });
  setHighlightedIdx(newIdx);
  userNavigatedRef.current = true;
}
```

**Step 4: Gate Enter selection on `userNavigatedRef`**

Find the Enter handler (around line 1522-1531). Change the logic to check `userNavigatedRef.current`:

Before:
```javascript
if (e.key === 'Enter') {
  e.preventDefault();
  const item = items[highlightedIdx];
  if (item) {
    log.info('key.enter.select', { value: item.value, title: item.title });
    handleOptionSelect(item.value);
  } else if (searchQuery) {
    commitFreeformText('enter');
  }
  return;
}
```

After:
```javascript
if (e.key === 'Enter') {
  e.preventDefault();
  const item = userNavigatedRef.current ? items[highlightedIdx] : null;
  if (item) {
    log.info('key.enter.select', { value: item.value, title: item.title });
    handleOptionSelect(item.value);
  } else if (searchQuery) {
    commitFreeformText('enter');
  }
  return;
}
```

The only change: `const item = items[highlightedIdx]` → `const item = userNavigatedRef.current ? items[highlightedIdx] : null`.

**Step 5: Gate Tab selection the same way**

Find the Tab handler (around line 1537-1549). Apply the same change:

Before:
```javascript
} else if (e.key === 'Tab') {
  const item = items[highlightedIdx];
  if (item) {
```

After:
```javascript
} else if (e.key === 'Tab') {
  const item = userNavigatedRef.current ? items[highlightedIdx] : null;
  if (item) {
```

**Step 6: Reset `userNavigatedRef` in `resetComboboxState`**

Find the `resetComboboxState` function (search for it — it resets editing state). Add `userNavigatedRef.current = false;` inside it. This ensures the flag is clean when re-entering edit mode.

**Step 7: Verify no regressions**

The following behaviors must still work:
- Blur with typed text → commits freeform (unchanged — blur doesn't use `highlightedIdx`)
- ArrowDown → Enter → selects highlighted item (`userNavigatedRef = true`)
- ArrowDown → type more text → Enter → commits freeform (`onChange` resets ref to `false`)
- No text typed, just ArrowDown through browse items → Enter → selects item (`userNavigatedRef = true`)
- Type text, no results, Enter → commits freeform (`item` is null regardless)

**Step 8: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix(admin): freeform Enter/Tab must commit typed text, not auto-highlighted item

On every keystroke, setHighlightedIdx(0) auto-highlights the first
browse/search result. This caused Enter/Tab to select items[0] instead
of committing the user's freeform text.

Add userNavigatedRef to distinguish auto-highlight (typing) from
explicit navigation (ArrowUp/Down). Enter/Tab only selects the
highlighted item when the user explicitly arrow-navigated to it.

Ref: docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md"
```

---

### Task 2: Update the Bug Document Resolution

**Files:**
- Modify: `docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md`

**Step 1: Update the resolution section**

The resolution section was previously added noting "invariant confirmed already holding." Update it to reflect the actual bug fix:

Replace the existing `## Resolution` section with:

```markdown
## Resolution

- **Root cause:** In `ListsItemRow.jsx`'s inline combobox, `setHighlightedIdx(0)` on every
  keystroke (line 1852) caused Enter/Tab to select `displayItems[0]` instead of committing
  freeform text. The highlight was auto-set, not user-navigated.
- **Fix:** Added `userNavigatedRef` to distinguish auto-highlight (typing) from explicit
  navigation (ArrowUp/Down). Enter/Tab only selects highlighted item when user arrow-navigated.
- Regression tests: `tests/live/flow/admin/content-search-combobox/12-freeform-commit.runtime.test.mjs`
- Defensive comments in both `ContentSearchCombobox.jsx` and `ListsItemRow.jsx`
- Status: **Fixed**
```

**Step 2: Commit**

```bash
git add docs/_wip/bugs/2026-03-01-admin-freeform-commit-must-always-save.md
git commit -m "docs: update freeform commit bug resolution with root cause"
```
