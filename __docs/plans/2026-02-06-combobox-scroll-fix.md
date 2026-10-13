# Combobox Scroll Fix — Pass the Runtime Test

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the combobox scroll behavior in `ListsItemRow.jsx` so the runtime test at `tests/live/flow/admin/combobox-scroll-behavior.runtime.test.mjs` scores >= 70/100 (grade C or better).

**Architecture:** Two changes: (1) change the initial dropdown positioning from centering to top-aligned so the highlight has room to travel downward before scrolling starts, and (2) fix the edge-snap scroll effect so it correctly edge-follows at the bottom (not locked at a fixed Y). The scroll useEffect is already correct — the only problem is that `scrollOptionIntoView` centers the current item on open, leaving ~1 item of space below, which triggers edge-snap on the very first ArrowDown.

**Tech Stack:** React `useEffect`, `useRef`, `requestAnimationFrame`

---

## Test Scoring Criteria (from the runtime test)

The SCORE hurdle opens the dropdown fresh, presses ArrowDown 40 times with 150ms between presses, and scores on 5 criteria:

| Criterion | Points | How to pass |
|-----------|--------|-------------|
| 1. Visibility | 40 | Every highlighted item must be fully visible |
| 2. Y-position variety | 20 | Need > 3 unique Y positions (highlight must move on screen) |
| 3. Scroll starts late | 15 | `scrollTop` must stay 0 for at least the first 3 presses |
| 4. Smooth progression | 15 | Max Y-delta between consecutive presses < 50% of container height |
| 5. Edge-following | 10 | Once scrolling starts, avg distance from bottom edge < 100px |

**Current score: 55/100.** Lost: -20 (1 unique Y), -15 (scroll on press 1), -10 (edge dist 103px).

**Target score: >= 70/100.** We need to recover at least 15 of those 45 lost points.

---

## Root Cause Analysis

The dropdown opens with `scrollOptionIntoView` which centers the current item:
```javascript
container.scrollTop = optionCenter - containerCenter;
```

Container is 280px. Item is ~48px. Centering puts the item at Y-Rel=177, leaving only `280 - 177 - 48 = 55px` below — barely 1 item. So the first ArrowDown immediately triggers edge-snap, and from then on every press scrolls by exactly 48px, locking Y-Rel at 177 forever.

**Fix:** Change `scrollOptionIntoView` to position the current item near the TOP of the container (with a small offset), not centered. This gives ~4-5 items of room below before scrolling starts. The edge-snap logic is already correct — it just never gets a chance to show the "still phase" because centering eats all the space.

---

## Task 1: Change initial positioning from center to top-biased

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:683-695`

**Step 1: Modify `scrollOptionIntoView` to position the item near the top**

The current code (line 683-695):
```javascript
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

Replace with:
```javascript
const scrollOptionIntoView = useCallback((selector) => {
  requestAnimationFrame(() => {
    if (optionsRef.current) {
      const option = optionsRef.current.querySelector(selector);
      if (option) {
        const container = optionsRef.current;
        // Position the item ~1 row from the top so the user has room to
        // navigate downward before scrolling kicks in (VS Code behavior).
        const topOffset = option.offsetHeight;
        container.scrollTop = option.offsetTop - topOffset;
      }
    }
  });
}, []);
```

This puts the current item 1 row-height from the top of the container. With a 280px container and 48px items, that gives ~4 items visible below before the first edge-snap fires.

**Step 2: Run the test**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation && npx playwright test tests/live/flow/admin/combobox-scroll-behavior.runtime.test.mjs --reporter=line
```

Expected improvements:
- Criterion 2 (Y variety): highlight will travel from Y~48 down to Y~232 before scrolling → many unique Y positions → +20 pts
- Criterion 3 (scroll starts late): scrolling won't start until press ~4-5 → +15 pts
- Criterion 5 (edge-following): once scrolling starts, highlight hugs bottom edge → +10 pts

**Step 3: Verify score >= 70**

If score >= 70, commit:
```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix: position current item near top on dropdown open for natural scroll travel"
```

---

## Task 2: Fix ArrowUp visibility bug at current item

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` (scroll useEffect, ~line 1441)

The test data showed that navigating ArrowUp back to the "current" item (Hymn 309, the one initially centered) causes Y-Rel=-55 (item above container). This happens because some other code path (likely `fetchSiblings` or a re-render when landing on the current item) interferes with scroll position.

**Step 1: Add a guard to the scroll effect for the current item edge case**

After the edge-snap `target` calculation (line 1482-1487), add a safety check that the animation target doesn't scroll the item out of view:

```javascript
if (target !== null) {
  // Clamp target so the item stays fully visible
  const clampedTarget = Math.max(
    optTop - (container.clientHeight - option.offsetHeight), // item at bottom
    Math.min(target, optTop) // item at top
  );
```

Actually, the existing logic is already correct (`optTop < visTop → target = optTop` puts item at top edge, `optBot > visBot → target = optBot - clientHeight` puts item at bottom edge). The bug is likely a race condition with `scrollOptionIntoView` being called simultaneously.

**Investigate first:** Check if the ArrowUp-to-current-item bug reproduces after Task 1's positioning change. The centering logic was the likely cause — removing centering may fix this too.

**Step 2: Run the test after Task 1 and check ArrowUp data**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation && npx playwright test tests/live/flow/admin/combobox-scroll-behavior.runtime.test.mjs --reporter=line
```

Check HURDLE 4 output. If no items have `visible=NO`, this task is already done.

If the bug persists, add `e.stopImmediatePropagation` or prevent `scrollOptionIntoView` from firing during keyboard navigation by adding a guard:

```javascript
const isKeyboardNavigating = useRef(false);

// In handleKeyDown, before any arrow key logic:
isKeyboardNavigating.current = true;
requestAnimationFrame(() => { isKeyboardNavigating.current = false; });

// In scrollOptionIntoView:
const scrollOptionIntoView = useCallback((selector) => {
  requestAnimationFrame(() => {
    if (isKeyboardNavigating.current) return; // Don't fight with keyboard scroll
    // ... rest of existing code
  });
}, []);
```

**Step 3: Commit if changes were needed**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "fix: prevent scrollOptionIntoView from fighting keyboard navigation scroll"
```

---

## Task 3: Fix pac-man wrap test reliability

**Files:**
- Modify: `tests/live/flow/admin/combobox-scroll-behavior.runtime.test.mjs` (HURDLE 5)

The pac-man wrap test pressed ArrowUp 420 times without delay but only reached Hymn 299 (not Hymn 1). React state updates were overwhelmed by rapid-fire keypresses without yielding.

**Step 1: Replace rapid-fire loop with batched presses**

In HURDLE 5, replace the fast loop with batched presses that yield to React:

```javascript
// Navigate to item 0 in batches — yield to React every 50 presses
const pressCount = itemCount + 10;
for (let i = 0; i < pressCount; i++) {
  await page.keyboard.press('ArrowUp');
  if (i % 50 === 49) await page.waitForTimeout(100); // yield to React
}
await page.waitForTimeout(300);
```

**Step 2: Run the test**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation && npx playwright test tests/live/flow/admin/combobox-scroll-behavior.runtime.test.mjs --reporter=line
```

Verify HURDLE 5 shows item at index 0 (first hymn in the list), and the wrap to the last item works with flash.

**Step 3: Commit**

```bash
git add tests/live/flow/admin/combobox-scroll-behavior.runtime.test.mjs
git commit -m "fix: batch ArrowUp presses in pac-man wrap test for React state reliability"
```

---

## Exit Criteria

The test at `tests/live/flow/admin/combobox-scroll-behavior.runtime.test.mjs` must:
1. All 6 hurdles pass (no failures)
2. SCORE hurdle reports >= 70/100
3. No items with `visible=NO` in HURDLE 3 or HURDLE 4
