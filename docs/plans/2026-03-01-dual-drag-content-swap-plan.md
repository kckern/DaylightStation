# Dual-Drag Content Swap Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split ListsItemRow into two draggable zones — left handle reorders whole rows, right handle swaps content payloads between rows across sections.

**Architecture:** Single global `DndContext` with ID-based routing replaces per-section `DndContext`s. Row-reorder IDs use prefix `row-{si}-{idx}`, content-swap IDs use `content-{si}-{idx}`. Custom collision detection filters targets by active drag type. `SortableContext` per section handles row reorder; `useDraggable`/`useDroppable` handle content swap.

**Tech Stack:** React, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, Mantine, SCSS

**Design doc:** `docs/plans/2026-03-01-dual-drag-content-swap-design.md`

---

### Task 1: Add CONTENT_PAYLOAD_FIELDS and swapContentPayloads to listConstants.js

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/listConstants.js:49` (after KNOWN_ITEM_FIELDS)
- Test: `tests/isolated/modules/Admin/contentSwap.test.mjs` (new)

**Step 1: Write the test**

Create `tests/isolated/modules/Admin/contentSwap.test.mjs`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_PAYLOAD_FIELDS,
  IDENTITY_FIELDS,
  swapContentPayloads,
  ITEM_DEFAULTS
} from '../../../../frontend/src/modules/Admin/ContentLists/listConstants.js';

describe('CONTENT_PAYLOAD_FIELDS', () => {
  it('should not overlap with IDENTITY_FIELDS', () => {
    const overlap = CONTENT_PAYLOAD_FIELDS.filter(f => IDENTITY_FIELDS.includes(f));
    assert.deepStrictEqual(overlap, [], `Fields overlap: ${overlap.join(', ')}`);
  });

  it('should include input and action', () => {
    assert.ok(CONTENT_PAYLOAD_FIELDS.includes('input'));
    assert.ok(CONTENT_PAYLOAD_FIELDS.includes('action'));
  });

  it('should include all playback fields', () => {
    for (const field of ['shuffle', 'continuous', 'loop', 'fixedOrder', 'volume', 'playbackRate']) {
      assert.ok(CONTENT_PAYLOAD_FIELDS.includes(field), `Missing: ${field}`);
    }
  });
});

describe('swapContentPayloads', () => {
  it('should swap content fields between two items', () => {
    const itemA = { label: 'Morning', image: '/img/a.jpg', uid: 'uid-a', active: true, input: 'plex:123', action: 'Play', shuffle: true, volume: 80 };
    const itemB = { label: 'Evening', image: '/img/b.jpg', uid: 'uid-b', active: false, input: 'abs:456', action: 'Queue', shuffle: false, volume: 100 };

    const { updatesForA, updatesForB } = swapContentPayloads(itemA, itemB);

    // A gets B's content
    assert.equal(updatesForA.input, 'abs:456');
    assert.equal(updatesForA.action, 'Queue');
    assert.equal(updatesForA.shuffle, false);
    assert.equal(updatesForA.volume, 100);

    // B gets A's content
    assert.equal(updatesForB.input, 'plex:123');
    assert.equal(updatesForB.action, 'Play');
    assert.equal(updatesForB.shuffle, true);
    assert.equal(updatesForB.volume, 80);
  });

  it('should not include identity fields in swap', () => {
    const itemA = { label: 'A', image: '/a.jpg', uid: 'a', active: true, input: 'plex:1', action: 'Play' };
    const itemB = { label: 'B', image: '/b.jpg', uid: 'b', active: false, input: 'plex:2', action: 'List' };

    const { updatesForA, updatesForB } = swapContentPayloads(itemA, itemB);

    assert.equal(updatesForA.label, undefined);
    assert.equal(updatesForA.image, undefined);
    assert.equal(updatesForA.uid, undefined);
    assert.equal(updatesForA.active, undefined);
    assert.equal(updatesForB.label, undefined);
    assert.equal(updatesForB.image, undefined);
  });

  it('should handle undefined fields by using ITEM_DEFAULTS', () => {
    const itemA = { label: 'A', input: 'plex:1', action: 'Play' };
    const itemB = { label: 'B', input: 'plex:2', action: 'List', shuffle: true };

    const { updatesForA } = swapContentPayloads(itemA, itemB);
    // B has shuffle=true, so A should get it
    assert.equal(updatesForA.shuffle, true);

    const { updatesForB } = swapContentPayloads(itemA, itemB);
    // A has no shuffle, so B should get the default (false)
    assert.equal(updatesForB.shuffle, ITEM_DEFAULTS.shuffle);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `node --test tests/isolated/modules/Admin/contentSwap.test.mjs`
Expected: FAIL — module not found or exports not found

**Step 3: Add constants and function to listConstants.js**

Add after `KNOWN_ITEM_FIELDS` (line 49) in `frontend/src/modules/Admin/ContentLists/listConstants.js`:

```js
// Fields that travel with content during a content-swap drag
// Everything except identity fields (label, image, uid, active)
export const CONTENT_PAYLOAD_FIELDS = [
  'input', 'action',
  'shuffle', 'continuous', 'loop', 'fixedOrder', 'volume', 'playbackRate',
  'days', 'snooze', 'waitUntil',
  'shader', 'composite', 'playable',
  'progress', 'watched',
];

// Fields that stay with the row position (identity)
export const IDENTITY_FIELDS = ['label', 'image', 'uid', 'active'];

/**
 * Extract content payloads from two items and return crossed updates.
 * Identity fields (label, image, uid, active) are NOT included.
 * Missing fields fall back to ITEM_DEFAULTS.
 */
export function swapContentPayloads(itemA, itemB) {
  const updatesForA = {};
  const updatesForB = {};
  for (const field of CONTENT_PAYLOAD_FIELDS) {
    updatesForA[field] = itemB[field] ?? ITEM_DEFAULTS[field] ?? null;
    updatesForB[field] = itemA[field] ?? ITEM_DEFAULTS[field] ?? null;
  }
  return { updatesForA, updatesForB };
}
```

**Step 4: Run test to verify it passes**

Run: `node --test tests/isolated/modules/Admin/contentSwap.test.mjs`
Expected: PASS — all 5 assertions pass

**Step 5: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/listConstants.js tests/isolated/modules/Admin/contentSwap.test.mjs
git commit -m "feat(admin): add CONTENT_PAYLOAD_FIELDS and swapContentPayloads utility"
```

---

### Task 2: Add CSS for divider column, content-drag handle, and drag feedback

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentLists.scss`

**Step 1: Add col-divider and col-content-drag to table-header**

In `.table-header` (after `.col-label` at line 51), add:

```scss
    .col-divider { width: 1px; flex-shrink: 0; flex-grow: 0; }
    .col-content-drag { width: 24px; flex-shrink: 0; flex-grow: 0; }
```

**Step 2: Add col-divider styling in .item-row**

After `.col-label` block (after line 159), add:

```scss
    .col-divider {
      width: 1px;
      flex-shrink: 0;
      flex-grow: 0;
      align-self: stretch;
      margin: 6px 0;
      background: var(--ds-border);
      opacity: 0.4;
      transition: opacity var(--ds-transition-fast), background var(--ds-transition-fast);
    }

    &:hover .col-divider {
      opacity: 1;
      background: var(--ds-text-muted);
      width: 2px;
    }
```

**Step 3: Add col-content-drag styling in .item-row**

After the new `.col-divider` block, add:

```scss
    .col-content-drag {
      width: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      color: var(--ds-text-muted);
      flex-shrink: 0;
      flex-grow: 0;
      opacity: 0;
      transition: opacity var(--ds-transition-fast), color var(--ds-transition-fast);

      &:active {
        cursor: grabbing;
      }

      &:hover {
        color: var(--ds-text-secondary);
      }
    }

    &:hover .col-content-drag {
      opacity: 1;
    }
```

**Step 4: Add content-drag feedback styles**

At the end of `.item-row` (before the `.empty-row` block at line 268), add:

```scss
    // Content zone during active content drag (source row)
    &.content-dragging {
      .col-action, .col-preview, .col-input, .col-progress, .col-config, .col-menu, .col-content-drag {
        opacity: 0.3;
        border: 1px dashed var(--ds-border);
        border-radius: 4px;
      }
    }

    // Content zone drop target (row being hovered during content drag)
    &.content-drop-target {
      .col-action, .col-preview, .col-input, .col-progress, .col-config {
        outline: 2px solid var(--ds-accent);
        outline-offset: -2px;
        border-radius: 4px;
      }
    }

    // Swap confirmation flash
    &.swap-flash {
      animation: swap-confirm 300ms ease-out;
    }
```

**Step 5: Add swap-confirm keyframes and drag overlay styles**

After the `.item-row` block (after line ~279), add:

```scss
  @keyframes swap-confirm {
    0% { background: var(--ds-accent); }
    100% { background: transparent; }
  }

  // Content drag overlay (floating ghost)
  .content-drag-overlay {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--ds-bg-elevated);
    border: 1px solid var(--ds-accent);
    border-radius: 6px;
    box-shadow: var(--ds-shadow-elevated);
    opacity: 0.9;
    max-width: 300px;
    height: 36px;
    pointer-events: none;
  }
```

**Step 6: Verify SCSS compiles**

Run: `cd /root/Code/DaylightStation && npx vite build --mode development 2>&1 | head -20`
Expected: No SCSS compilation errors

**Step 7: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ContentLists.scss
git commit -m "style(admin): add divider, content-drag column, and swap feedback CSS"
```

---

### Task 3: Refactor ListsFolder to single global DndContext with ID-based routing

**Context:** Currently each section has its own `DndContext`. We need one global `DndContext` so both row-reorder and content-swap share the same context. `SortableContext` per section still scopes row reorder.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx`

**Step 1: Update imports**

At line 12, add `DragOverlay` to the dnd-kit core import:

```js
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragOverlay
} from '@dnd-kit/core';
```

Add import for swap utility at line 18 (after ListsItemRow import):

```js
import { swapContentPayloads } from './listConstants.js';
```

**Step 2: Add custom collision detection function**

After the `TYPE_LABELS` constant (line 31), add:

```js
/**
 * Custom collision detection that filters targets based on active drag type.
 * Row drags (id starts with 'row-') collide with sortable items.
 * Content drags (id starts with 'content-') collide only with content drop zones.
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
```

**Step 3: Update SortableContext item IDs**

In `renderItems` (line 249), change the items prop from numeric indices to prefixed IDs:

```js
items={itemsToRender.map((_, i) => `row-${sectionIndex}-${i}`)}
```

**Step 4: Update handleDragEnd to parse prefixed IDs**

Replace `handleDragEnd` (lines 112-120) with:

```js
const handleDragEnd = async (event) => {
  const { active, over } = event;
  if (!over || active.id === over.id) return;

  const activeId = String(active.id);
  const overId = String(over.id);

  // Content swap
  if (activeId.startsWith('content-')) {
    if (!overId.startsWith('content-')) return;
    const [, srcSi, srcIdx] = activeId.split('-').map(Number);
    const [, dstSi, dstIdx] = overId.split('-').map(Number);
    const srcItem = sections[srcSi]?.items?.[srcIdx];
    const dstItem = sections[dstSi]?.items?.[dstIdx];
    if (!srcItem || !dstItem) return;

    const { updatesForA, updatesForB } = swapContentPayloads(srcItem, dstItem);
    try {
      await updateItem(dstSi, dstIdx, updatesForA);
      await updateItem(srcSi, srcIdx, updatesForB);
    } catch (err) {
      // updateItem refetches on success, so partial failure auto-corrects on next refetch
      console.error('Content swap failed:', err);
    }

    // Flash both rows
    requestAnimationFrame(() => {
      const srcRow = document.querySelector(`[data-testid="item-row-${srcIdx}"]`);
      const dstRow = document.querySelector(`[data-testid="item-row-${dstIdx}"]`);
      [srcRow, dstRow].forEach(row => {
        if (row) {
          row.classList.add('swap-flash');
          row.addEventListener('animationend', () => row.classList.remove('swap-flash'), { once: true });
        }
      });
    });
    setActiveContentDrag(null);
    return;
  }

  // Row reorder
  if (activeId.startsWith('row-') && overId.startsWith('row-')) {
    const [, activeSi, activeIdx] = activeId.split('-').map(Number);
    const [, overSi, overIdx] = overId.split('-').map(Number);
    // Only reorder within the same section
    if (activeSi !== overSi) return;
    const sectionItems = sections[activeSi]?.items || [];
    const reordered = arrayMove(sectionItems, activeIdx, overIdx);
    await reorderItems(activeSi, reordered);
  }
};
```

**Step 5: Add content drag state for DragOverlay**

After the `collapsedSections` state (line 47), add:

```js
const [activeContentDrag, setActiveContentDrag] = useState(null); // { sectionIndex, itemIndex, item }
```

Add a `handleDragStart` function after `handleDragEnd`:

```js
const handleDragStart = (event) => {
  const activeId = String(event.active.id);
  if (activeId.startsWith('content-')) {
    const [, si, idx] = activeId.split('-').map(Number);
    const item = sections[si]?.items?.[idx];
    if (item) {
      setActiveContentDrag({ sectionIndex: si, itemIndex: idx, item });
    }
  }
};
```

**Step 6: Restructure the JSX to use single global DndContext**

Replace the sections-scroll div content (lines 344-381). The new structure:

**Search mode** (line 345-349): Remove the DndContext wrapper — it will be handled by the global one. Change to just `{renderItems(filteredItems, 0)}`.

**Normal mode** (lines 352-380): Remove per-section DndContext wrappers. Change the section map to:

```jsx
{sections.map((section, si) => (
  <Box key={si} className="section-container">
    <SectionHeader ... />
    <Collapse in={!collapsedSections.has(si)}>
      {renderItems(section.items, si)}
    </Collapse>
  </Box>
))}
```

Wrap the entire `sections-scroll` div content with the global DndContext + DragOverlay:

```jsx
<DndContext
  sensors={sensors}
  collisionDetection={dualCollisionDetection}
  onDragStart={handleDragStart}
  onDragEnd={handleDragEnd}
>
  <div className="sections-scroll">
    {filteredItems ? (
      renderItems(filteredItems, 0)
    ) : (
      <Stack gap="md">
        {sections.map((section, si) => (
          <Box key={si} className="section-container">
            <SectionHeader
              section={section}
              sectionIndex={si}
              collapsed={collapsedSections.has(si)}
              onToggleCollapse={toggleCollapse}
              onUpdate={(idx, updates) => updates ? updateSection(idx, updates) : setSectionSettingsOpen(idx)}
              onDelete={deleteSection}
              onMoveUp={(idx) => handleMoveSection(idx, -1)}
              onMoveDown={(idx) => handleMoveSection(idx, 1)}
              isFirst={si === 0}
              isLast={si === sections.length - 1}
              itemCount={section.items.length}
            />
            <Collapse in={!collapsedSections.has(si)}>
              {renderItems(section.items, si)}
            </Collapse>
          </Box>
        ))}
        <Button variant="light" leftSection={<IconPlus size={16} />}
          onClick={() => addSection({ title: `Section ${sections.length + 1}` })}>
          Add Section
        </Button>
      </Stack>
    )}
  </div>

  <DragOverlay dropAnimation={null}>
    {activeContentDrag && (() => {
      const { item } = activeContentDrag;
      const info = contentInfoMap.get(item.input);
      return (
        <div className="content-drag-overlay">
          <Text size="xs" fw={500} truncate style={{ maxWidth: 200 }}>
            {info?.title || item.input || 'Content'}
          </Text>
          {info?.source && (
            <Text size="xs" c="dimmed">{info.source.toUpperCase()}</Text>
          )}
        </div>
      );
    })()}
  </DragOverlay>
</DndContext>
```

**Step 7: Pass new props to ListsItemRow for content drag**

In `renderItems`, add two new props to `ListsItemRow`:

```js
sectionIndex={sectionIndex}  // already exists
activeContentDrag={activeContentDrag}  // new: to style source/target rows
```

**Step 8: Verify app compiles and row drag still works**

Run: `cd /root/Code/DaylightStation && npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds. (Row drag behavior tested manually — the SortableContext items now use `row-{si}-{idx}` IDs.)

**Step 9: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "refactor(admin): single global DndContext with ID-based row/content routing"
```

---

### Task 4: Add content drag/drop hooks and zone split to ListsItemRow

**Context:** The row needs `useDraggable` on the right handle, `useDroppable` on the content zone, and visual split via the divider. The existing `useSortable` stays for row reorder.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

**Step 1: Update useSortable ID and add dnd-kit imports**

At line 19 (imports), add:

```js
import { useDraggable, useDroppable } from '@dnd-kit/core';
```

At line 2430, update the `useSortable` call to use prefixed ID:

```js
const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
  id: `row-${sectionIndex}-${item.index}`
});
```

**Step 2: Add useDraggable and useDroppable hooks**

After the `useSortable` call, add:

```js
const { attributes: contentDragAttrs, listeners: contentDragListeners, setNodeRef: setContentDragRef } = useDraggable({
  id: `content-${sectionIndex}-${item.index}`,
});

const { setNodeRef: setContentDropRef, isOver: isContentDropTarget } = useDroppable({
  id: `content-${sectionIndex}-${item.index}`,
});
```

**Step 3: Accept new prop**

Update the function signature (line 2428) to accept `activeContentDrag`:

```js
function ListsItemRow({ item, onUpdate, onDelete, onToggleActive, onDuplicate, isWatchlist, onEdit, onSplit, sectionIndex, sectionCount, sections, itemCount, onMoveItem, activeContentDrag }) {
```

**Step 4: Compute drag state CSS classes**

After the `style` object (line 2487), add:

```js
const isContentSource = activeContentDrag?.sectionIndex === sectionIndex && activeContentDrag?.itemIndex === item.index;
const rowClassName = [
  'item-row',
  isContentSource && 'content-dragging',
  isContentDropTarget && !isContentSource && 'content-drop-target',
].filter(Boolean).join(' ');
```

**Step 5: Update the row div className and add new columns**

Change the outer div (line 2563) from `className="item-row"` to `className={rowClassName}`.

After the `col-label` div (after line 2663), add:

```jsx
<div className="col-divider" />

<div
  className="col-content-drag"
  ref={setContentDragRef}
  {...contentDragAttrs}
  {...contentDragListeners}
>
  <IconGripVertical size={14} />
</div>
```

**Step 6: Add droppable ref to content zone**

Wrap the content-side columns (from `col-action` through `col-menu`) in a div with the droppable ref. Add after the new `col-content-drag`:

```jsx
<div ref={setContentDropRef} style={{ display: 'contents' }}>
```

And close it after the `col-menu` div (before the `ItemDetailsDrawer`). Using `display: contents` makes the wrapper transparent to flex layout.

**Step 7: Update EmptyItemRow to include divider column (visual consistency)**

In `EmptyItemRow` (line 2881), after `col-label`, add:

```jsx
<div className="col-divider" />
<div className="col-content-drag"></div>
```

**Step 8: Verify build**

Run: `cd /root/Code/DaylightStation && npx vite build --mode development 2>&1 | tail -5`
Expected: Build succeeds

**Step 9: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat(admin): add content drag/drop hooks and zone split divider to ListsItemRow"
```

---

### Task 5: Update table header to include new columns

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx` (table header section)

**Step 1: Add divider and content-drag header columns**

In the table header JSX (lines 327-341), after the `col-label` div (line 332), add:

```jsx
<div className="col-divider"></div>
<div className="col-content-drag"></div>
```

**Step 2: Verify visual alignment**

Run dev server and visually confirm header columns align with row columns. The divider and content-drag columns should be invisible in the header (just spacing).

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "feat(admin): add divider and content-drag columns to table header"
```

---

### Task 6: Manual integration testing

**No code changes — verification only.**

**Step 1: Start dev server**

Run: `cd /root/Code/DaylightStation && lsof -i :3111` to check if already running.
If not running: `npm run dev`

**Step 2: Open admin lists page**

Navigate to the admin content lists page in browser. Open any list with multiple items.

**Step 3: Verify visual layout**

- [ ] Subtle divider visible between label and action columns
- [ ] Divider becomes bolder on row hover
- [ ] Second drag handle appears on row hover (right of divider)
- [ ] Column alignment matches header to rows
- [ ] EmptyItemRow has correct spacing

**Step 4: Verify row reorder (existing behavior)**

- [ ] Left drag handle still reorders rows within a section
- [ ] Drag preview and drop animation work correctly
- [ ] Right-click drag menu still works (Move to Top/Bottom/Section)

**Step 5: Verify content swap (new behavior)**

- [ ] Right drag handle initiates content drag
- [ ] Drag overlay shows content info (title + source)
- [ ] Source row content zone fades during drag
- [ ] Target row shows blue outline on hover
- [ ] Dropping on another row swaps content between them
- [ ] Both rows flash briefly after swap
- [ ] Label, image, and active state stay with original rows
- [ ] Content (input, action, config) moves to the other row

**Step 6: Verify cross-section swap**

- [ ] Content can be dragged from one section to another
- [ ] Swap works correctly across sections

**Step 7: Verify edge cases**

- [ ] Dropping back on self = no-op
- [ ] Dropping on empty space = cancel (snap back)
- [ ] Row with no input can participate in swap
- [ ] Watchlist progress column doesn't break layout

**Step 8: Run existing tests**

Run: `node --test tests/isolated/modules/Admin/contentSwap.test.mjs`
Expected: All tests pass

**Step 9: Commit any fixes found during testing**

---

### Task 7: Final cleanup and documentation

**Files:**
- Modify: `docs/plans/2026-03-01-dual-drag-content-swap-design.md` (mark as implemented)

**Step 1: Update design doc status**

Change `**Status:** Approved` to `**Status:** Implemented`

Add implementation note about single DndContext vs. nested:

```markdown
**Implementation Note:** The design specified nested DndContexts, but dnd-kit registers hooks with the nearest parent context, making true nesting impractical. The implementation uses a single global `DndContext` with ID-prefixed routing (`row-*` for reorder, `content-*` for swap) and custom collision detection that filters targets by drag type. This achieves the same separation of concerns.
```

**Step 2: Commit**

```bash
git add docs/plans/2026-03-01-dual-drag-content-swap-design.md
git commit -m "docs: mark dual-drag design as implemented, add architecture note"
```
