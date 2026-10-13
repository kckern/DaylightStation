# ContentSearchCombobox Behavior Audit

**Date:** 2026-02-06
**Scope:** `ListsItemRow.jsx` inline combobox (the production implementation) and `ContentSearchCombobox.jsx` (the original, simpler version)
**Goal:** Best-in-class UX for keyboard navigation, selection consistency, scroll behavior, and drill-down

---

## Executive Summary

The **inline combobox in `ListsItemRow.jsx`** (lines ~700–1735) is the real production component. `ContentSearchCombobox.jsx` is an older, simpler version that delegates keyboard handling entirely to Mantine's `useCombobox`. This audit focuses on the production implementation.

**Overall:** The component has solid bones — custom keyboard navigation, breadcrumb drill-down, and smart sibling loading. But there are **7 behavioral bugs and 5 UX gaps** preventing best-in-class status.

---

## 1. Selected (Blue) Consistency

### What works
- CSS is well-structured: `.highlighted` class = blue background (`--mantine-color-blue-7`), `.current` class = gray background with gray left border (lines 282–324, `ContentLists.scss`).
- Mantine's built-in `data-combobox-selected` and `data-combobox-active` are explicitly overridden to `transparent` (line 287), preventing double-blue conflicts.
- `isCurrent` vs `isHighlighted` are independently tracked: `isCurrent` compares `normalizeValue(item.value) === normalizedValue`, while `isHighlighted` uses `idx === highlightedIdx`.

### BUG: Dual highlight state conflict
**Severity: Medium**

The component runs two independent highlight systems simultaneously:
1. **Custom `highlightedIdx`** — managed by `handleKeyDown` (lines 1411–1446)
2. **Mantine's internal `selectedOptionIndex`** — managed by `useCombobox`

When `onOptionSubmit` fires (line 1622), Mantine internally tracks which option was submitted via its own index. But `handleKeyDown` uses the custom `highlightedIdx` for Enter (line 1432). These can drift apart.

**Symptom:** If the user clicks an item (Mantine updates its internal index), then uses arrow keys (custom index updates), the two systems are out of sync. A subsequent mouse hover + keyboard Enter could select the wrong item.

**Fix:** Either fully own keyboard navigation (suppress Mantine's built-in ArrowUp/ArrowDown handling) or fully delegate to Mantine. The current hybrid is the worst of both worlds.

### BUG: `updateSelectedOptionIndex()` never called after results change
**Severity: Low**

Line 1636 calls `combobox.openDropdown()` on text change but never calls `combobox.updateSelectedOptionIndex()`. Mantine docs explicitly require this for searchable comboboxes when the options list changes. Currently harmless because custom `highlightedIdx` takes precedence, but if Mantine's internal state is ever consulted (e.g., for accessibility announcements), it will be stale.

---

## 2. Pac-Man Handling (Wrap-Around)

### BUG: No wrap-around — dead ends at boundaries
**Severity: High (UX regression)**

```javascript
// Line 1417
setHighlightedIdx(prev => Math.min(prev + 1, items.length - 1));
// Line 1420
setHighlightedIdx(prev => Math.max(prev - 1, 0));
```

Arrow-down on the last item does nothing. Arrow-up on the first item does nothing. This creates a "dead end" that feels broken to power users.

**Expected (best-in-class):** Down on last item → wraps to index 0. Up on first item → wraps to `items.length - 1`. Mantine's built-in `useCombobox` has `loop: true` by default — this custom implementation discards that behavior.

**Fix:**
```javascript
// ArrowDown
setHighlightedIdx(prev => (prev + 1) % items.length);
// ArrowUp
setHighlightedIdx(prev => (prev - 1 + items.length) % items.length);
```

---

## 3. Highlighted vs Bold Coupling

### Current behavior
- **Bold (fw={600}):** Applied when `isCurrent` is true (line 440 in `ContentItemDisplay`). This marks the "originally selected" item — the one already saved as the row's value.
- **Highlighted (blue background):** Applied when `isHighlighted` is true (line 486 in `ContentOption`). This marks the keyboard-focused item.

### Assessment: Correctly decoupled — good
Bold and highlight are independent axes. An item can be:
- Bold + highlighted (current item under keyboard focus)
- Bold + not highlighted (current item, keyboard focus elsewhere)
- Not bold + highlighted (different item under keyboard focus)
- Not bold + not highlighted (regular item)

### MINOR GAP: No visual distinction for "current + highlighted"
When the highlighted item IS the current item, you get blue background + bold text. But there's no additional indicator (like a checkmark icon or double border) to signal "this is both what you have AND what you're pointing at." Users in a long list may not remember which item was bold before highlight turned everything white-on-blue.

---

## 4. Drill-Down / Drill-Up Behavior

### What works well
- **Right arrow** drills into containers (line 1421–1426): calls `drillDown(item)` which pushes to `navStack` and fetches children.
- **Left arrow** goes up (line 1427–1429): calls `goUp()` which pops `navStack` or climbs to parent/library level.
- **Breadcrumb navigation** (lines 1659–1682): clickable trail with home icon, shows full path.
- **Navigation hint** (lines 1685–1689): displays `↑↓ navigate • ← back/up • → drill down • Enter select`.
- Multi-level ascent works: `goUp()` handles navStack pop → parentKey → libraryId → ceiling.

### BUG: Right arrow on non-container items is silently swallowed
**Severity: Low**

Line 1421–1426:
```javascript
} else if (e.key === 'ArrowRight') {
  e.preventDefault();
  const item = items[highlightedIdx];
  if (item) {
    await drillDown(item);
  }
}
```

`drillDown()` checks `isContainerItem(item)` and returns `false` if not a container (line 840–842). But the `ArrowRight` `e.preventDefault()` fires unconditionally, blocking the browser's default right-arrow behavior (cursor movement in the input). If the user is trying to move the cursor within their search text, right arrow will do nothing when an item is highlighted.

**Fix:** Only `preventDefault()` if the item is actually a container.

### BUG: `highlightedIdx` not reset after drill-down completes
**Severity: Medium**

When `drillDown()` calls `fetchContainerChildren()`, line 827 sets `setHighlightedIdx(0)`. This is correct. But when `goUp()` calls `fetchSiblings()` (line 876) or `loadParentLevel()`, the highlighted index is set to the item we came from (good), but if that item isn't found, it falls back to 0. When going back from search mode to browse mode (line 1036), `fetchSiblings()` sets the index to the current value's position.

**Edge case:** If `fetchContainerChildren` fails (catch block, line 830), `highlightedIdx` is never updated, potentially pointing at an index that no longer exists in the new (empty) results array.

### BUG: Left arrow during active search mode
**Severity: Medium**

When `isActiveSearch` is true (user is typing a search query), pressing left arrow triggers `goUp()` (line 1428), which clears `searchQuery` (line 863) and navigates away. The user likely intended to move the text cursor left within the input. The `e.preventDefault()` on line 1428 blocks cursor movement unconditionally.

**Fix:** Only intercept ArrowLeft when in browse mode (`!isActiveSearch`), or when cursor is at position 0 in the input.

---

## 5. Keeping Selected/Highlighted Item in Scroll View — AT ALL TIMES

### Current implementation (lines 1448–1473)

```javascript
useEffect(() => {
  if (highlightedIdx >= 0 && optionsRef.current) {
    const container = optionsRef.current;
    const options = container.querySelectorAll('[data-value]');
    const option = options[highlightedIdx];
    if (option) {
      const optionTop = option.offsetTop;
      const optionBottom = optionTop + option.offsetHeight;
      const containerScrollTop = container.scrollTop;
      const containerVisibleBottom = containerScrollTop + container.clientHeight;

      if (optionTop < containerScrollTop) {
        container.scrollTop = optionTop;
      } else if (optionBottom > containerVisibleBottom) {
        container.scrollTop = optionBottom - container.clientHeight;
      }
    }
  }
}, [highlightedIdx]);
```

### Assessment: Functional but not robust

**What works:** Highlighted item is scrolled into view on every `highlightedIdx` change.

### GAP: No scroll-into-view when results change underneath the highlight

The `useEffect` only triggers on `[highlightedIdx]` changes. If streaming search results arrive (via `useStreamingSearch`) and push the highlighted item out of view, the scroll position won't adjust because `highlightedIdx` didn't change — only the list length did.

**Fix:** Add `displayItems.length` to the dependency array:
```javascript
}, [highlightedIdx, displayItems.length]);
```

### GAP: Initial dropdown open doesn't guarantee scroll-into-view

When the dropdown opens and `fetchSiblings()` completes, the scroll-into-view uses `setTimeout(() => { ... scrollIntoView({ block: 'center' }) }, 50)` (lines 934–942, 1016–1023, 1114–1121, 1162–1169). The 50ms timeout is a race condition — if the DOM hasn't finished rendering by then, the scroll misses. React's `useLayoutEffect` or a `requestAnimationFrame` chain would be more reliable.

### GAP: Highlighted item NOT kept in view during mouse scroll

If the user scrolls the dropdown with the mouse wheel, the highlighted item can scroll completely out of view. Pressing ArrowDown/ArrowUp will then cause a jarring jump. Best-in-class would either:
- Clear the highlight when the user scrolls (reset to -1)
- Or keep the highlight but update it to the nearest visible item

---

## 6. Centering the Highlighted Item (Smart Panning)

### Current behavior: Edge-following, not centering

The scroll logic (lines 1448–1473) uses **minimal scroll** — it only scrolls when the item is off-screen, and only by the minimum amount to bring it into view. This means:

- Scrolling **down**: The highlighted item hugs the **bottom** edge of the viewport
- Scrolling **up**: The highlighted item hugs the **top** edge of the viewport

### What best-in-class looks like: Centered scrolling

VS Code's command palette, Spotlight, and Alfred all keep the highlighted item **centered vertically** as you navigate. This gives equal context above and below, making it easier to find your place.

The initial load already uses `scrollIntoView({ block: 'center' })` (lines 939, 1021, 1118, 1167), but the keyboard navigation effect (lines 1448–1473) uses minimal scroll. These two strategies are inconsistent.

### Recommendation: Hybrid centering

Replace the `useEffect` scroll logic with centered scrolling for keyboard navigation:

```javascript
useEffect(() => {
  if (highlightedIdx >= 0 && optionsRef.current) {
    const container = optionsRef.current;
    const options = container.querySelectorAll('[data-value]');
    const option = options[highlightedIdx];
    if (option) {
      const optionCenter = option.offsetTop + option.offsetHeight / 2;
      const containerCenter = container.clientHeight / 2;
      container.scrollTop = optionCenter - containerCenter;
    }
  }
}, [highlightedIdx]);
```

This keeps the highlighted item centered at all times. For short lists (fewer items than fill the viewport), the browser clamps `scrollTop` at 0, so there's no visual weirdness.

---

## 7. Additional Issues Found

### ISSUE: `ContentSearchCombobox.jsx` is orphaned
The original `ContentSearchCombobox.jsx` uses Mantine's built-in keyboard handling (no custom `onKeyDown`), uses `ScrollArea.Autosize` instead of direct `overflowY: auto`, and has no custom highlight tracking. It appears to be an older version that was superseded by the inline implementation in `ListsItemRow.jsx`. It should either be deleted or clearly marked as deprecated to avoid confusion.

### ISSUE: `onBlur` 150ms timeout race condition
**Severity: Medium**

```javascript
const handleBlur = () => {
  setTimeout(() => {
    combobox.closeDropdown();
    setIsEditing(false);
    // ...cleanup
  }, 150);
};
```

The 150ms delay exists to let click events on dropdown items fire before blur closes things. But if the user blurs and then rapidly focuses something else, the 150ms timer fires and clears state that might have been re-initialized. There's no cancellation mechanism (no `clearTimeout`).

### ISSUE: Escape key not handled
**Severity: Low**

The `handleKeyDown` function handles ArrowUp, ArrowDown, ArrowLeft, ArrowRight, and Enter. But **Escape** is not handled. Pressing Escape should close the dropdown and revert to display mode. Currently, the only way to dismiss without selecting is to click elsewhere (triggering `onBlur`).

### ISSUE: Tab key not handled
**Severity: Low**

Pressing Tab should ideally either select the currently highlighted item (like Enter) or close the dropdown and move focus to the next field. Currently, Tab triggers `onBlur` which closes after 150ms, but the highlighted selection is lost.

---

## Summary of Findings

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | No wrap-around (pac-man) at list boundaries | High | Keyboard Nav |
| 2 | Left arrow intercepts cursor movement during search | Medium | Keyboard Nav |
| 3 | Right arrow `preventDefault` on non-containers blocks cursor | Low | Keyboard Nav |
| 4 | Dual highlight state (custom vs Mantine internal) | Medium | Selection |
| 5 | Scroll not updated when results change under fixed index | Medium | Scroll |
| 6 | Edge-following scroll instead of centered scroll | Medium | Scroll/UX |
| 7 | Inconsistent scroll strategy (center on load, edge on nav) | Low | Scroll |
| 8 | `highlightedIdx` stale after failed fetch | Low | State |
| 9 | Escape key not handled | Low | Keyboard Nav |
| 10 | Tab key not handled | Low | Keyboard Nav |
| 11 | `onBlur` timeout not cancellable | Medium | State |
| 12 | `ContentSearchCombobox.jsx` is orphaned/redundant | Low | Maintenance |

---

## Priority Fixes for Best-in-Class

### Must-fix (blocks best-in-class)
1. **Add pac-man wrapping** — modulo arithmetic on ArrowUp/ArrowDown
2. **Smart ArrowLeft/ArrowRight** — only intercept when cursor is at boundary (pos 0 for left, pos end for right) or when not actively searching
3. **Centered scroll on keyboard nav** — replace minimal-scroll with `block: 'center'` strategy
4. **Add Escape handling** — close dropdown, revert to display mode

### Should-fix (polish)
5. Cancel `onBlur` timeout if user re-focuses
6. Handle Tab key (select + advance focus)
7. Add `displayItems.length` to scroll effect dependencies
8. Use `requestAnimationFrame` instead of `setTimeout(50)` for initial scroll-into-view

### Consider
9. Add checkmark or visual indicator for "current item" when it's also highlighted
10. Clear highlight when user mouse-scrolls the dropdown
11. Archive or delete `ContentSearchCombobox.jsx`

---

## Resolution (2026-02-06)

All 12 issues addressed in `ListsItemRow.jsx`:

| # | Issue | Resolution |
|---|-------|-----------|
| 1 | No pac-man wrap-around | Fixed: modulo arithmetic on ArrowDown, `prev <= 0 ? last : prev-1` on ArrowUp |
| 2 | Left arrow intercepts cursor | Fixed: only goUp() when `selectionStart === 0` or browse mode |
| 3 | Right arrow blocks cursor | Fixed: only preventDefault when `isContainerItem(item)` |
| 4 | Dual highlight state | Accepted: Mantine's internal state is overridden to transparent via CSS, custom state wins |
| 5 | Scroll not updated on results change | Fixed: added `displayItems.length` to scroll effect deps |
| 6 | Edge-following scroll | Fixed: replaced with centering math (`optionCenter - containerCenter`) |
| 7 | Inconsistent scroll strategy | Fixed: both rAF helper and useEffect use identical centering logic |
| 8 | Stale highlightedIdx after failed fetch | Fixed: `setHighlightedIdx(0)` in 3 catch blocks |
| 9 | Escape key not handled | Fixed: Escape calls `resetComboboxState()` |
| 10 | Tab key not handled | Fixed: Tab calls `resetComboboxState()` without preventDefault |
| 11 | onBlur timeout not cancellable | Fixed: `blurTimeoutRef` stored + cleared on focus + cleanup on unmount |
| 12 | ContentSearchCombobox.jsx orphaned | Deferred: still exists for potential modal use, not blocking |

Additional improvements from code review:
- Extracted `resetComboboxState()` helper (DRY: used in 4 places)
- Added `useEffect` cleanup for `blurTimeoutRef` on unmount
- Fixed ArrowUp from `highlightedIdx === -1` landing on N-2 instead of N-1
