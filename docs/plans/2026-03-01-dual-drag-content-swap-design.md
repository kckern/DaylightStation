# Dual-Drag Content Swap Design

**Date:** 2026-03-01
**Status:** Implemented

**Implementation Note:** The design specified nested DndContexts, but dnd-kit registers hooks with the nearest parent context, making true nesting impractical. The implementation uses a single global `DndContext` with ID-prefixed routing (`row-*` for reorder, `content-*` for swap) and custom collision detection that filters targets by drag type. This achieves the same separation of concerns.
**Component:** `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

## Problem

Currently, each list row is a single draggable unit. To reassign content to a different label, users must delete the row and recreate it, or manually edit both the source and target rows. This is tedious when reorganizing content assignments across a list.

## Solution

Split each row into two draggable zones:

1. **Identity zone** (left) — `#`, cover image, label. Dragging the left handle reorders entire rows (existing behavior).
2. **Content zone** (right) — action, preview, content input, config, menu. Dragging the right handle swaps the content payload between two rows.

## Row Layout

```
[☑] [⠿] [#] [🖼] [Label]  ╎  [⠿] [▶Action] [👁] [Content...] [⚙] [⋮]
 ^--- row drag                 ^--- content drag
      IDENTITY ZONE           ╎     CONTENT ZONE
```

### CSS Column Order

```
col-active | col-drag | col-index | col-icon | col-label | col-divider | col-content-drag | col-action | col-preview | col-input | col-progress? | col-config | col-menu
```

### Divider

- Always visible as a subtle 1px vertical line between label and content zones
- Becomes 2px + brighter on row hover
- Right drag handle appears with grab cursor on hover

## DnD Architecture

### Approach: Dual DndContext (nested)

Two independent dnd-kit systems:

**System 1: Row Reorder (existing, unchanged)**
- Per-section `SortableContext` with `useSortable` on left handle
- Reorders entire rows within a section

**System 2: Content Swap (new)**
- Single `DndContext` wrapping all sections globally
- Right handle uses `useDraggable` hook
- Each row's content zone uses `useDroppable` hook
- Collision detection: `closestCenter`
- IDs encode location: `content-{sectionIndex}-{itemIndex}`
- Cross-section swaps are supported

### Nesting

```jsx
<DndContext onDragEnd={handleContentSwap} collisionDetection={closestCenter}>
  {sections.map((section, si) => (
    <DndContext onDragEnd={(e) => handleRowReorder(e, si)}>
      <SortableContext items={...}>
        {items.map(item => <ListsItemRow ... />)}
      </SortableContext>
    </DndContext>
  ))}
</DndContext>
```

Outer context handles content swaps. Inner contexts handle row reorder. dnd-kit propagates drag events to the context whose draggable was activated.

## Visual Feedback

### Drag Ghost (DragOverlay)
- Compact rendering of the dragged content: action badge + content display (thumbnail, title, source badge)
- Follows cursor, semi-transparent (opacity 0.8) with subtle shadow

### Source Row During Drag
- Identity zone (left) stays at full opacity
- Content zone (right) fades to 0.3 with dashed border outline ("empty slot")

### Target Row (hover/over)
- Content zone gets 2px blue border highlight
- Ghost preview: incoming content rendered at 0.5 opacity overlaid on current content
- Current content shifts down 2px and fades to 0.4 opacity
- Small swap icon (↔) appears at the divider

### Drop Completion
- Both rows flash briefly (200ms highlight) to confirm swap
- Invalid drop (self or empty): snaps back with cancel animation

## Data Model

### Field Classification

**Identity fields** (stay with the row):
- `label`, `image`, `uid`, `active`

**Content payload fields** (swap between rows):
- `input`, `action`
- Playback: `shuffle`, `continuous`, `loop`, `fixedOrder`, `volume`, `playbackRate`
- Scheduling: `days`, `snooze`, `waitUntil`
- Display: `shader`, `composite`, `playable`
- Status: `progress`, `watched`

### Swap Logic

```js
const CONTENT_PAYLOAD_FIELDS = [
  'input', 'action',
  'shuffle', 'continuous', 'loop', 'fixedOrder', 'volume', 'playbackRate',
  'days', 'snooze', 'waitUntil',
  'shader', 'composite', 'playable',
  'progress', 'watched',
];
```

Extract payload from both items, cross-assign, update both.

## Persistence

- Two sequential `updateItem(sectionIndex, itemIndex, updates)` calls per swap
- No new backend endpoint needed
- Optimistic update: apply swap locally, then fire API calls
- On failure: revert both items, show error notification
- Content info cache (`contentInfoMap`) already has entries for both inputs (both rows were visible)

## Edge Cases

- **Swap with self:** No-op (detected by matching active/over IDs)
- **Empty rows:** If either row has no `input`, swap proceeds — the empty content moves to the other row
- **EmptyItemRow (add row):** Not a drop target — only existing items participate in swaps
- **During content drag, row reorder blocked:** The content DndContext captures the drag, so the inner SortableContext won't fire
