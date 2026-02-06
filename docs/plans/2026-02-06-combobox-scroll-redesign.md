# Combobox Scroll & Selection Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current scroll logic in the inline combobox (`ListsItemRow.jsx`) with VS Code file-picker-style behavior: minimal edge-snap with ease animation, instant wrap with flash.

**Architecture:** Single `useEffect` on `highlightedIdx` + a `prevIdxRef` to detect wraps. One rAF animation helper. One CSS keyframe for wrap flash. No debounce timers, no centering logic.

**Tech Stack:** React `useEffect`, `useRef`, `requestAnimationFrame`, CSS `@keyframes`

---

## Behavior Spec

### Normal navigation (ArrowUp / ArrowDown)

1. Highlight moves instantly to the next/prev item.
2. If the newly highlighted item is **fully visible** in the scroll container → **no scroll**. The viewport stays perfectly still.
3. If the newly highlighted item is **partially or fully off-screen**:
   - Navigating **down**: ease-animate `scrollTop` so the item's bottom edge aligns with the container's bottom edge.
   - Navigating **up**: ease-animate `scrollTop` so the item's top edge aligns with the container's top edge.
   - Animation: manual rAF loop, ease-out quadratic, ~120ms duration.
   - Each keystroke **cancels** any in-progress animation and starts fresh from the current `scrollTop`.

### Pac-man wrap (down on last → first, up on first → last)

1. **Instant scroll jump** (no animation) to position the wrapped-to item:
   - Wrap to first: `scrollTop = 0` (item at top)
   - Wrap to last: `scrollTop = scrollHeight - clientHeight` (item at bottom)
2. **CSS flash**: Add `.wrap-flash` class to the highlighted `Combobox.Option` for ~400ms. Keyframe animates from bright highlight (`--mantine-color-blue-5`) to normal highlight (`--mantine-color-blue-7`). Class is auto-removed after animation ends.

### Wrap detection

A wrap is detected by comparing `prevIdxRef.current` with the new `highlightedIdx`:
- `prevIdx === items.length - 1 && newIdx === 0` → wrapped down
- `prevIdx === 0 && newIdx === items.length - 1` → wrapped up

`prevIdxRef` is updated at the end of every effect run.

### Initial dropdown open / drill-down

The existing `scrollOptionIntoView` helper (rAF + centering) is used for context changes (opening the dropdown, drilling into a container). This is separate from keyboard navigation and remains unchanged.

---

## Task 1: Replace scroll useEffect

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx` (scroll effect, ~lines 1436-1453)

**Step 1:** Add `prevIdxRef` alongside existing refs:

```javascript
const prevIdxRef = useRef(-1);
```

**Step 2:** Replace the current scroll `useEffect` with:

```javascript
const scrollAnimRef = useRef(null); // rAF id for cancellation

useEffect(() => {
  // Cancel any in-progress animation
  if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);

  if (highlightedIdx < 0 || !optionsRef.current) {
    prevIdxRef.current = highlightedIdx;
    return;
  }

  const container = optionsRef.current;
  const opts = container.querySelectorAll('[data-value]');
  const option = opts[highlightedIdx];
  if (!option) {
    prevIdxRef.current = highlightedIdx;
    return;
  }

  const prevIdx = prevIdxRef.current;
  const itemCount = opts.length;

  // Detect pac-man wrap
  const isWrap = (prevIdx === itemCount - 1 && highlightedIdx === 0)
              || (prevIdx === 0 && highlightedIdx === itemCount - 1);

  if (isWrap) {
    // Instant jump — no animation
    if (highlightedIdx === 0) {
      container.scrollTop = 0;
    } else {
      container.scrollTop = container.scrollHeight - container.clientHeight;
    }
    // Trigger flash
    option.classList.add('wrap-flash');
    const onEnd = () => { option.classList.remove('wrap-flash'); option.removeEventListener('animationend', onEnd); };
    option.addEventListener('animationend', onEnd);
  } else {
    // Normal navigation — ease-snap if off-screen
    const optTop = option.offsetTop;
    const optBot = optTop + option.offsetHeight;
    const visTop = container.scrollTop;
    const visBot = visTop + container.clientHeight;

    let target = null;
    if (optTop < visTop) {
      target = optTop; // align top edge
    } else if (optBot > visBot) {
      target = optBot - container.clientHeight; // align bottom edge
    }

    if (target !== null) {
      const start = container.scrollTop;
      const delta = target - start;
      const duration = 120;
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min((now - t0) / duration, 1);
        const ease = 1 - (1 - p) * (1 - p); // ease-out quad
        container.scrollTop = start + delta * ease;
        if (p < 1) scrollAnimRef.current = requestAnimationFrame(step);
      };
      scrollAnimRef.current = requestAnimationFrame(step);
    }
  }

  prevIdxRef.current = highlightedIdx;
}, [highlightedIdx, displayItems.length]);
```

**Step 3:** Verify the `scrollAnimRef` is cleaned up. Add cleanup return:

```javascript
// Add inside the useEffect, at the end:
return () => {
  if (scrollAnimRef.current) cancelAnimationFrame(scrollAnimRef.current);
};
```

**Step 4:** Run dev server and verify:
- Arrow down through a long list → no scroll until highlight reaches bottom, then smooth snap
- Arrow up through list → no scroll until highlight reaches top, then smooth snap
- Down on last item → instant jump to top + flash
- Up on first item → instant jump to bottom + flash

**Step 5:** Commit

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "refactor: replace combobox scroll with VS Code file-picker edge-snap"
```

---

## Task 2: Add wrap-flash CSS keyframe

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentLists.scss` (add keyframe + class)

**Step 1:** Add the flash keyframe and class inside the `.mantine-Combobox-option.content-option` block:

```scss
// Wrap-around flash — draws eye to new position after pac-man wrap
&.wrap-flash {
  animation: wrap-flash 400ms ease-out;
}

@keyframes wrap-flash {
  0% {
    background: var(--mantine-color-blue-5) !important;
    box-shadow: 0 0 8px rgba(59, 130, 246, 0.4);
  }
  100% {
    background: var(--mantine-color-blue-7) !important;
    box-shadow: none;
  }
}
```

**Step 2:** Verify visually: pac-man wrap shows a brief bright-to-normal blue pulse.

**Step 3:** Commit

```bash
git add frontend/src/modules/Admin/ContentLists/ContentLists.scss
git commit -m "feat: add wrap-flash CSS animation for pac-man wrap visual feedback"
```

---

## Task 3: Clean up dead code

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

**Step 1:** Remove any leftover refs/variables from previous scroll implementations:
- Remove old `scrollAnimRef` if it held `{ timer, raf }` shape (replaced by simple rAF id)
- Remove any `blurTimeoutRef` cleanup that's no longer needed (verify it IS still needed for blur fix before removing)
- Verify no unused imports (`setTimeout` patterns, etc.)

**Step 2:** Run dev server, test all combobox interactions end-to-end.

**Step 3:** Commit

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "chore: remove dead scroll code from combobox"
```
