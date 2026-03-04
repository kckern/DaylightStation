# Content DnD Collision Detection Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix content drag-and-drop so dragging toward an adjacent row correctly highlights that row, not a random distant row.

**Architecture:** The root cause is `display: 'contents'` on the content droppable wrapper in `ListsItemRow.jsx`. Elements with `display: 'contents'` have no box model — `getBoundingClientRect()` returns a zero-size rect at `(0,0)`. When `closestCenter` computes distances from the pointer to each droppable's center, all droppables appear at `(0,0)`, so the "closest" is essentially random. The fix replaces `display: 'contents'` with a proper flex wrapper that participates in layout, giving dnd-kit accurate bounding rects.

**Tech Stack:** React, @dnd-kit/core (`closestCenter`, `useDroppable`), CSS Flexbox

**Bug doc:** `docs/_wip/bugs/2026-03-02-content-dnd-collision-detection-wrong-target.md`

---

### Task 1: Write failing test for collision detection accuracy

**Files:**
- Create: `tests/isolated/ui/admin/contentDndCollision.test.mjs`

This is a pure-logic test that verifies the `dualCollisionDetection` function returns the correct target when droppable containers have proper bounding rects. We'll extract the function to make it testable.

**Step 1: Write the failing test**

```javascript
import { describe, it, expect } from 'vitest';
import { closestCenter } from '@dnd-kit/core';

/**
 * Replicate the dualCollisionDetection logic from ListsFolder.jsx
 * to verify it selects the geometrically closest content target.
 */
function dualCollisionDetection(args) {
  const activeId = String(args.active.id);
  if (activeId.startsWith('content-')) {
    const filtered = args.droppableContainers.filter(
      c => String(c.id).startsWith('content-') && c.id !== args.active.id
    );
    return closestCenter({ ...args, droppableContainers: filtered });
  }
  return closestCenter(args);
}

/**
 * Create a mock droppable container with the given bounding rect.
 * dnd-kit's closestCenter reads `container.rect.current` for each container.
 */
function makeContainer(id, rect) {
  return {
    id,
    node: { current: null },
    rect: { current: { ...rect, toJSON: () => rect } },
    data: { current: null },
    disabled: false,
  };
}

describe('dualCollisionDetection', () => {
  // Each row is 44px tall. In a list of rows, row 0 is at y=0, row 1 at y=44, etc.
  const ROW_HEIGHT = 44;
  const CONTENT_X = 300; // content zone starts at x=300
  const CONTENT_WIDTH = 600;

  function makeContentContainers(count) {
    return Array.from({ length: count }, (_, i) => makeContainer(
      `content-0-${i}`,
      {
        left: CONTENT_X,
        top: i * ROW_HEIGHT,
        right: CONTENT_X + CONTENT_WIDTH,
        bottom: (i + 1) * ROW_HEIGHT,
        width: CONTENT_WIDTH,
        height: ROW_HEIGHT,
      }
    ));
  }

  it('should select adjacent row 4 when dragging from row 5 upward', () => {
    const containers = makeContentContainers(6); // rows 0-5
    const activeId = 'content-0-4'; // dragging row 5 (index 4)
    // Pointer is between row 4 and row 5 — closer to row 4
    const pointerY = 3 * ROW_HEIGHT + ROW_HEIGHT / 2; // center of row index 3
    const pointerX = CONTENT_X + CONTENT_WIDTH / 2;

    const collisions = dualCollisionDetection({
      active: { id: activeId },
      collisionRect: {
        left: pointerX - 1,
        top: pointerY - 1,
        right: pointerX + 1,
        bottom: pointerY + 1,
        width: 2,
        height: 2,
      },
      droppableRects: new Map(containers.map(c => [c.id, c.rect.current])),
      droppableContainers: containers,
    });

    expect(collisions.length).toBeGreaterThan(0);
    // The closest target should be row index 3 (adjacent), NOT index 0
    expect(collisions[0].id).toBe('content-0-3');
  });

  it('should NOT select row 0 when dragging between rows 4 and 5', () => {
    const containers = makeContentContainers(6);
    const activeId = 'content-0-4';
    // Pointer near the boundary between row 3 and row 4
    const pointerY = 3 * ROW_HEIGHT + ROW_HEIGHT - 5;
    const pointerX = CONTENT_X + CONTENT_WIDTH / 2;

    const collisions = dualCollisionDetection({
      active: { id: activeId },
      collisionRect: {
        left: pointerX - 1,
        top: pointerY - 1,
        right: pointerX + 1,
        bottom: pointerY + 1,
        width: 2,
        height: 2,
      },
      droppableRects: new Map(containers.map(c => [c.id, c.rect.current])),
      droppableContainers: containers,
    });

    expect(collisions.length).toBeGreaterThan(0);
    expect(collisions[0].id).not.toBe('content-0-0');
  });

  it('filters out non-content containers during content drag', () => {
    const contentContainers = makeContentContainers(3);
    const rowContainer = makeContainer('row-0-1', {
      left: 0, top: ROW_HEIGHT, right: 900, bottom: 2 * ROW_HEIGHT,
      width: 900, height: ROW_HEIGHT,
    });
    const all = [...contentContainers, rowContainer];

    const collisions = dualCollisionDetection({
      active: { id: 'content-0-0' },
      collisionRect: {
        left: 449, top: ROW_HEIGHT + 21, right: 451, bottom: ROW_HEIGHT + 23,
        width: 2, height: 2,
      },
      droppableRects: new Map(all.map(c => [c.id, c.rect.current])),
      droppableContainers: all,
    });

    // Should only return content containers, never row containers
    for (const collision of collisions) {
      expect(String(collision.id).startsWith('content-')).toBe(true);
    }
  });

  it('demonstrates the bug: zero-size rects give wrong results', () => {
    // Simulate what happens with display:contents — all rects at (0,0) with zero size
    const containers = Array.from({ length: 6 }, (_, i) => makeContainer(
      `content-0-${i}`,
      { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    ));
    const activeId = 'content-0-4';
    // Pointer near where row 3 SHOULD be
    const pointerY = 3 * ROW_HEIGHT + ROW_HEIGHT / 2;
    const pointerX = CONTENT_X + CONTENT_WIDTH / 2;

    const collisions = dualCollisionDetection({
      active: { id: activeId },
      collisionRect: {
        left: pointerX - 1, top: pointerY - 1,
        right: pointerX + 1, bottom: pointerY + 1,
        width: 2, height: 2,
      },
      droppableRects: new Map(containers.map(c => [c.id, c.rect.current])),
      droppableContainers: containers,
    });

    // With all rects at (0,0), the result is NOT row 3 — this is the bug
    // All have the same distance from (0,0), so result is arbitrary (usually index 0)
    if (collisions.length > 0) {
      // The first result is unlikely to be the correct target
      // This test documents the broken behavior — it passes because
      // we're asserting that broken rects DON'T give the right answer
      const firstId = collisions[0].id;
      // With zero rects, all distances are equal; closestCenter returns them in input order
      // The first non-active content container (index 0) wins — demonstrating the bug
      expect(firstId).toBe('content-0-0'); // BUG: should be content-0-3
    }
  });
});
```

**Step 2: Run test to verify it passes (this is a characterization test)**

Run: `npx vitest run tests/isolated/ui/admin/contentDndCollision.test.mjs`
Expected: All 4 tests PASS (including the bug-demonstration test that asserts current broken behavior)

**Step 3: Commit**

```bash
git add tests/isolated/ui/admin/contentDndCollision.test.mjs
git commit -m "test: add collision detection characterization tests for DnD bug"
```

---

### Task 2: Fix the drop zone wrapper — remove `display: contents`

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx:2692`
- Modify: `frontend/src/modules/Admin/ContentLists/ContentLists.scss:322-328`

The root cause: the droppable wrapper `<div ref={setContentDropRef} style={{ display: 'contents' }}>` produces a DOM element with no box model. dnd-kit calls `getBoundingClientRect()` on it and gets `{x:0, y:0, width:0, height:0}`. This makes all content droppables appear at the same point to `closestCenter`, so it picks the first one (index 0) instead of the nearest.

**Step 1: Change the wrapper from `display: contents` to a proper flex container**

In `ListsItemRow.jsx`, find line 2692:

```jsx
// BEFORE (broken):
<div ref={setContentDropRef} style={{ display: 'contents' }}>
```

Replace with:

```jsx
// AFTER (fixed):
<div ref={setContentDropRef} className="content-drop-zone">
```

**Step 2: Add the CSS class for the new wrapper**

In `ContentLists.scss`, add a new rule inside `.item-row { ... }` (after the `.col-content-drag` rules, around line 199):

```scss
    // Content drop zone wrapper — must have box model for dnd-kit collision detection.
    // display:contents would zero-out getBoundingClientRect(), breaking closestCenter.
    .content-drop-zone {
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 0;
    }
```

**Step 3: Update the `.content-drop-target` selector**

The existing CSS at line 322-328 targets `.item-row.content-drop-target` and styles `.col-action`, `.col-preview`, etc. This still works because those child classes are still present — the only change is they're now inside `.content-drop-zone` instead of directly under `.item-row`. No change needed here because the CSS selector `.item-row.content-drop-target .col-action` still matches descendants regardless of nesting depth.

**Step 4: Verify the fix visually**

Start the dev server and navigate to any content list in the admin panel. Drag a content handle from one row to an adjacent row. The correct adjacent row should highlight as the drop target.

Run: `lsof -i :3112` (check if dev server is running, start if not)

**Step 5: Run the collision detection tests again**

Run: `npx vitest run tests/isolated/ui/admin/contentDndCollision.test.mjs`
Expected: Tests 1-3 PASS, test 4 still PASS (it tests the broken rect scenario which is independent of the DOM fix)

**Step 6: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx frontend/src/modules/Admin/ContentLists/ContentLists.scss
git commit -m "fix(admin): replace display:contents on content drop zone wrapper

display:contents zeroes out getBoundingClientRect(), causing dnd-kit's
closestCenter to resolve all content droppables as equidistant at (0,0).
Replace with a flex wrapper that has a real box model.

Fixes: content DnD snapping to wrong target row."
```

---

### Task 3: Add structured DnD logging for collision debugging

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx:46-55`

Add debug logging to `dualCollisionDetection` so future collision issues are diagnosable from session logs.

**Step 1: Add collision result logging**

Replace the `dualCollisionDetection` function (lines 46-55) with:

```javascript
function dualCollisionDetection(args) {
  const activeId = String(args.active.id);
  if (activeId.startsWith('content-')) {
    const filtered = args.droppableContainers.filter(
      c => String(c.id).startsWith('content-') && c.id !== args.active.id
    );
    const result = closestCenter({ ...args, droppableContainers: filtered });
    if (result.length > 0) {
      const top = result[0];
      const rect = args.droppableRects?.get(top.id);
      if (rect && rect.width === 0 && rect.height === 0) {
        dndLog().warn('collision.zero-rect', { targetId: top.id, activeId });
      }
    }
    return result;
  }
  return closestCenter(args);
}
```

**Step 2: Verify no regressions**

Run: `npx vitest run tests/isolated/ui/admin/contentDndCollision.test.mjs`
Expected: PASS

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "feat(admin): add zero-rect warning to content collision detection"
```

---

### Task 4: Close the bug document

**Files:**
- Modify: `docs/_wip/bugs/2026-03-02-content-dnd-collision-detection-wrong-target.md`

**Step 1: Update the bug doc status**

Add a resolution section at the bottom:

```markdown
## Resolution

**Root Cause:** The content droppable wrapper `<div>` used `display: 'contents'`, which removes the element from the box model. `getBoundingClientRect()` returns `{0,0,0,0}` for such elements. dnd-kit's `closestCenter` then computed all droppables as equidistant from the pointer (all centered at origin), causing it to return the first container in DOM order (index 0) instead of the geometrically nearest.

**Fix:** Replaced `display: 'contents'` with a `.content-drop-zone` flex wrapper (`display: flex; flex: 1; align-items: center; min-width: 0`). This gives the wrapper a real bounding rect spanning its content columns, so `closestCenter` correctly identifies the nearest row.

**Files Changed:**
- `ListsItemRow.jsx:2692` — wrapper class change
- `ContentLists.scss` — new `.content-drop-zone` rule
- `ListsFolder.jsx` — zero-rect warning in collision detection

**Status:** Fixed
```

**Step 2: Commit**

```bash
git add docs/_wip/bugs/2026-03-02-content-dnd-collision-detection-wrong-target.md
git commit -m "docs: close content DnD collision bug — root cause and fix documented"
```
