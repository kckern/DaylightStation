# ContentSearchCombobox UX Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 12 behavioral issues from the [2026-02-06 audit](../\_wip/audits/2026-02-06-content-search-combobox-behavior-audit.md) to achieve best-in-class keyboard navigation, scroll centering, and selection UX in the content search combobox.

**Architecture:** All changes are in the inline `ContentSearchCombobox` function inside `ListsItemRow.jsx` (line 644+) and its SCSS in `ContentLists.scss`. The component uses a custom `highlightedIdx` state for keyboard navigation layered on top of Mantine's `useCombobox`. We fix the keyboard handler, replace the scroll effect, add missing key handlers, and fix the blur race condition. No new files, no API changes, no new dependencies.

**Tech Stack:** React 18, Mantine v7 (`useCombobox`, `Combobox.*`), vanilla DOM scrolling

**Audit:** `docs/_wip/audits/2026-02-06-content-search-combobox-behavior-audit.md`

---

## File Reference

All changes are in these two files:

| File | Role |
|------|------|
| `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` | Production combobox — keyboard handler, scroll effect, blur handler |
| `frontend/src/modules/Admin/ContentLists/ContentLists.scss` | CSS for highlighted/current/checkmark states |

---

### Task 1: Add pac-man wrap-around on ArrowUp/ArrowDown

**Audit ref:** Issue #1 (High severity)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:1415-1420`

**Step 1: Modify the ArrowDown/ArrowUp handlers to use modulo wrapping**

In `handleKeyDown` (line 1411), replace the clamped min/max with modulo arithmetic:

```javascript
// BEFORE (lines 1415-1420):
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx(prev => Math.min(prev + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx(prev => Math.max(prev - 1, 0));

// AFTER:
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx(prev => (prev + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx(prev => (prev - 1 + items.length) % items.length);
```

**Step 2: Manual test**

Open the admin content editor, click a content cell to enter edit mode. Browse into a container with 5+ items.
- Press ArrowDown repeatedly past the last item — should wrap to first
- Press ArrowUp from the first item — should wrap to last

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix: add pac-man wrap-around for combobox arrow navigation"
```

---

### Task 2: Smart ArrowLeft/ArrowRight — respect text cursor position

**Audit ref:** Issues #2 (Medium) and #3 (Low)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:1421-1429`

**Step 1: Update ArrowRight to only preventDefault when the item is a container**

The `e.preventDefault()` currently fires unconditionally on ArrowRight, blocking cursor movement in the input. Also, ArrowLeft unconditionally triggers `goUp()` even during text editing.

Replace lines 1421-1429 with:

```javascript
    } else if (e.key === 'ArrowRight') {
      const item = items[highlightedIdx];
      if (item && isContainerItem(item)) {
        e.preventDefault();
        await drillDown(item);
      }
      // If not a container, let default cursor movement happen
    } else if (e.key === 'ArrowLeft') {
      // Only navigate up when cursor is at position 0 (or in browse mode)
      const cursorAtStart = e.target.selectionStart === 0;
      if (cursorAtStart || !isActiveSearch) {
        e.preventDefault();
        await goUp();
      }
      // Otherwise, let default cursor movement happen
```

Note: `isActiveSearch` is already defined at line 1393. `isContainerItem` is already defined at line 413.

**Step 2: Manual test**

1. Open content editor, type a search query like "batman"
2. Press ArrowLeft — cursor should move left within the text (not navigate up)
3. Move cursor to position 0, then press ArrowLeft — should trigger `goUp()`
4. Browse into a container, highlight a non-container item, press ArrowRight — cursor should move right in input
5. Highlight a container item, press ArrowRight — should drill down into it

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix: arrow left/right respect text cursor position in combobox"
```

---

### Task 3: Add Escape and Tab key handling

**Audit ref:** Issues #9 (Low) and #10 (Low)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:1430-1445`

**Step 1: Add Escape and Tab handlers after the Enter block**

Insert these cases after the Enter handler (after line 1444):

```javascript
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSearchQuery('');
      setIsEditing(false);
      setBrowseItems([]);
      setNavStack([]);
      setCurrentParent(null);
      setHighlightedIdx(-1);
      combobox.closeDropdown();
    } else if (e.key === 'Tab') {
      // Tab: close dropdown without selecting, let natural focus move happen
      setSearchQuery('');
      setIsEditing(false);
      setBrowseItems([]);
      setNavStack([]);
      setCurrentParent(null);
      setHighlightedIdx(-1);
      combobox.closeDropdown();
      // Don't preventDefault — allow Tab to move focus naturally
    }
```

**Step 2: Manual test**

1. Open content editor, enter edit mode on a content cell
2. Press Escape — should revert to display mode, dropdown closes
3. Re-enter edit mode, press Tab — should close dropdown and move focus to next cell

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat: add Escape and Tab key handling to content combobox"
```

---

### Task 4: Replace edge-following scroll with centered scroll

**Audit ref:** Issues #6 (Medium) and #7 (Low)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:1448-1473`

**Step 1: Replace the scroll useEffect with centered scrolling**

Replace lines 1448-1473 with:

```javascript
  // Scroll highlighted item to vertical center of the options container
  useEffect(() => {
    if (highlightedIdx >= 0 && optionsRef.current) {
      const container = optionsRef.current;
      const options = container.querySelectorAll('[data-value]');
      const option = options[highlightedIdx];
      if (option) {
        // Center the highlighted option vertically in the scroll container
        const optionCenter = option.offsetTop + option.offsetHeight / 2;
        const containerCenter = container.clientHeight / 2;
        container.scrollTop = optionCenter - containerCenter;
      }
    }
  }, [highlightedIdx, displayItems.length]);
```

Key changes:
- Centering logic instead of edge-following
- Added `displayItems.length` to deps so scroll recalculates when streaming results arrive (Issue #5)
- For short lists where all items fit, browser clamps `scrollTop` at 0 — no visual weirdness

**Step 2: Manual test**

1. Browse into a container with 15+ items
2. Press ArrowDown repeatedly — highlighted item should stay centered, with equal items visible above and below
3. Press ArrowUp repeatedly — same centered behavior going up
4. Arrow down past last item (pac-man wraps to top) — should center on first item, not jar to top

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat: center highlighted item vertically during keyboard navigation"
```

---

### Task 5: Replace setTimeout scroll-into-view with requestAnimationFrame

**Audit ref:** Issue from audit section 5, "Initial dropdown open doesn't guarantee scroll-into-view"

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` — 6 occurrences of `setTimeout(() => { ... scrollIntoView ... }, 50)`

**Step 1: Create a helper function and replace all 6 occurrences**

Add a helper near the top of the `ContentSearchCombobox` function (after `const optionsRef = useRef(null);` at line 665):

```javascript
  // Scroll a specific item into view using rAF for reliable post-render timing
  const scrollOptionIntoView = useCallback((selector) => {
    requestAnimationFrame(() => {
      if (optionsRef.current) {
        const option = optionsRef.current.querySelector(selector);
        if (option) {
          const container = optionsRef.current;
          const optionCenter = option.offsetTop + option.offsetHeight / 2;
          const containerCenter = container.clientHeight / 2;
          container.scrollTop = optionCenter - containerCenter;
        }
      }
    });
  }, []);
```

Then replace each of the 6 `setTimeout` blocks. Each currently looks like:

```javascript
// BEFORE (pattern repeated at ~lines 935-942, 1016-1023, 1114-1121, 1162-1169, 1307-1313, 1340-1346, 1358-1364):
        setTimeout(() => {
          if (optionsRef.current) {
            const currentOption = optionsRef.current.querySelector(`[data-value="${normalizedVal}"]`);
            if (currentOption) {
              currentOption.scrollIntoView({ block: 'center' });
            }
          }
        }, 50);

// AFTER:
        scrollOptionIntoView(`[data-value="${normalizedVal}"]`);
```

Search for all occurrences with: `setTimeout.*scrollIntoView` — replace each one. The selector string varies by call site (`normalizedVal`, `normalizedContextId`, `${source}:${parentKey}`), so match each individually.

**Step 2: Verify no remaining setTimeout+scrollIntoView patterns**

Search the file for `setTimeout` near `scrollIntoView` to ensure all are replaced:

```bash
grep -n 'setTimeout.*scrollIntoView\|scrollIntoView.*setTimeout' frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
```

Expected: no matches.

**Step 3: Manual test**

1. Click a content cell that already has a value — siblings should load with the current item centered (no 50ms delay jank)
2. Navigate with ArrowLeft to go up a level — parent item should be centered immediately

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "refactor: replace setTimeout scroll-into-view with rAF for reliability"
```

---

### Task 6: Fix onBlur race condition with cancellable timeout

**Audit ref:** Issue #11 (Medium)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:645,665,1374-1385,1639-1641`

**Step 1: Add a ref for the blur timeout**

After `const optionsRef = useRef(null);` (line 665), add:

```javascript
  const blurTimeoutRef = useRef(null);
```

**Step 2: Update handleBlur to store the timeout ID**

Replace lines 1374-1385:

```javascript
// BEFORE:
  const handleBlur = () => {
    // Delay to allow click events on dropdown to fire first
    setTimeout(() => {
      combobox.closeDropdown();
      setSearchQuery('');
      setIsEditing(false);
      setBrowseItems([]);
      setNavStack([]);
      setCurrentParent(null);
      setHighlightedIdx(-1);
    }, 150);
  };

// AFTER:
  const handleBlur = () => {
    // Delay to allow click events on dropdown to fire first
    blurTimeoutRef.current = setTimeout(() => {
      combobox.closeDropdown();
      setSearchQuery('');
      setIsEditing(false);
      setBrowseItems([]);
      setNavStack([]);
      setCurrentParent(null);
      setHighlightedIdx(-1);
    }, 150);
  };
```

**Step 3: Cancel the blur timeout when user re-focuses**

In the `onFocus` handler on the InputBase (line ~1640), add a cancel:

```javascript
// BEFORE:
          onFocus={() => combobox.openDropdown()}

// AFTER:
          onFocus={() => {
            if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
            combobox.openDropdown();
          }}
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix: cancel combobox blur timeout when user re-focuses input"
```

---

### Task 7: Guard highlightedIdx against stale values after failed fetches

**Audit ref:** Issue #8 (Low)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:830-834`

**Step 1: Reset highlightedIdx in the catch block of fetchContainerChildren**

Find the catch block in `fetchContainerChildren` (~line 830):

```javascript
// BEFORE:
    } catch (err) {
      console.error('Failed to fetch container children:', err);
    } finally {
      setLoadingBrowse(false);
    }

// AFTER:
    } catch (err) {
      console.error('Failed to fetch container children:', err);
      setHighlightedIdx(0);
    } finally {
      setLoadingBrowse(false);
    }
```

Also add the same guard in the catch blocks of `loadParentLevel` (~line 1025) and `loadLibraryLevel` (~line 944):

```javascript
// In loadLibraryLevel catch (~line 944):
    } catch (err) {
      console.error('Failed to load library level:', err);
      setHighlightedIdx(0);
    }

// In loadParentLevel catch (~line 1025):
    } catch (err) {
      console.error('Failed to load parent level:', err);
      setHighlightedIdx(0);
    }
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix: reset highlightedIdx on failed container fetch to prevent stale index"
```

---

### Task 8: Add checkmark indicator for "current + highlighted" item

**Audit ref:** Issue from audit section 3 (Minor gap)

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:424-478` (ContentItemDisplay)
- Modify: `frontend/src/modules/Admin/ContentLists/ContentLists.scss:291-316`

**Step 1: Add a checkmark icon to ContentItemDisplay when isCurrent is true**

At line 424, the `ContentItemDisplay` function already receives `isCurrent`. Add a small checkmark after the title when `isCurrent`:

```javascript
// In ContentItemDisplay, after the title Text element (~line 440-442):
// BEFORE:
          <Text size="xs" truncate fw={isCurrent ? 600 : undefined}>
            {item.title}
          </Text>

// AFTER:
          <Text size="xs" truncate fw={isCurrent ? 600 : undefined}>
            {item.title}
          </Text>
          {isCurrent && (
            <IconCheck size={12} style={{ flexShrink: 0, opacity: 0.7 }} />
          )}
```

Add `IconCheck` to the imports at the top of the file (line ~8). It should already be available from `@tabler/icons-react`. Check the existing import line:

```javascript
// Find the existing @tabler/icons-react import (~line 8) and add IconCheck:
import { IconCheck, /* ...existing imports */ } from '@tabler/icons-react';
```

**Step 2: Update CSS so the checkmark is visible on blue highlight background**

In `ContentLists.scss`, inside the `.highlighted` block (~line 292), the white text color already applies to all children, so the checkmark's SVG will inherit `color: white` via the existing `svg { color: rgba(255, 255, 255, 0.9) !important; }` rule. No CSS change needed.

**Step 3: Manual test**

1. Open a content cell that has a value
2. The current value's item should show a small checkmark after the title
3. Arrow to a different item — checkmark stays on the original item, blue highlight moves
4. Arrow back to the current item — checkmark + blue highlight both visible

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat: add checkmark indicator for currently-selected item in combobox"
```

---

### Task 9: Final integration test and cleanup

**Files:**
- Review: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`
- Review: `frontend/src/modules/Admin/ContentLists/ContentLists.scss`
- Modify: `docs/_wip/audits/2026-02-06-content-search-combobox-behavior-audit.md` (mark resolved)

**Step 1: Run any existing test suites that touch the combobox**

```bash
npx playwright test tests/live/flow/admin/ --reporter=line
```

Review results. If tests fail, investigate before moving on.

**Step 2: Manual smoke test checklist**

Run through this complete checklist in the browser:

| # | Action | Expected |
|---|--------|----------|
| 1 | Click content cell to edit | Dropdown opens, siblings loaded, current item centered + checkmark |
| 2 | ArrowDown to last item | Wraps to first item (pac-man) |
| 3 | ArrowUp from first item | Wraps to last item (pac-man) |
| 4 | ArrowDown through long list | Highlighted item stays centered vertically |
| 5 | ArrowUp through long list | Highlighted item stays centered vertically |
| 6 | Type search text, ArrowLeft mid-text | Cursor moves left in text (no navigation) |
| 7 | Cursor at position 0, ArrowLeft | Navigates up to parent |
| 8 | ArrowRight on non-container | Cursor moves right in text |
| 9 | ArrowRight on container | Drills down into container |
| 10 | Escape | Closes dropdown, reverts to display mode |
| 11 | Tab | Closes dropdown, focus moves to next field |
| 12 | Current item visible with checkmark icon | Checkmark shows on saved item, not others |
| 13 | Rapid blur/refocus | No state corruption from cancelled timeout |

**Step 3: Update audit doc**

Add a "Resolution" section to the audit document noting all 12 issues are addressed.

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx frontend/src/modules/Admin/ContentLists/ContentLists.scss docs/_wip/audits/2026-02-06-content-search-combobox-behavior-audit.md
git commit -m "docs: mark combobox behavior audit issues as resolved"
```

---

## Task Dependency Graph

```
Task 1 (pac-man)          ──┐
Task 2 (smart arrows)     ──┤
Task 3 (Escape/Tab)       ──┤── All independent, can run in any order
Task 4 (centered scroll)  ──┤
Task 5 (rAF scroll)       ──┤   (Task 4 and 5 both touch scroll logic;
Task 6 (blur fix)         ──┤    do Task 4 before Task 5 since Task 5
Task 7 (stale index)      ──┤    replaces the same pattern Task 4 creates)
Task 8 (checkmark)        ──┤
                           ──┘
Task 9 (integration test)  ── depends on ALL above
```

Recommended order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
