# Content DnD Collision Detection Snaps to Wrong Target

**Date:** 2026-03-02
**Status:** Fixed
**Severity:** Critical (feature unusable)

## Symptom

When dragging content from one row to an adjacent row, the drop target highlights the wrong row. The collision detection resolves to a completely unrelated row instead of the nearest neighbor.

## Observed Behavior

From session log `2026-03-02T06-06-09.jsonl`:

1. User grabbed content handle on **row 5** (index 4, `plex:642172`)
2. Dragged toward **row 4** (index 3, one row above)
3. Drop target resolved to **row 1** (index 0, `singalong:hymn/1006`) — completely wrong

```json
{"event":"drag.start","data":{"type":"content","section":0,"index":4,"input":"plex:642172"}}
{"event":"content.swap","data":{"src":{"section":0,"index":4,"input":"plex:642172"},"dst":{"section":0,"index":0,"input":"singalong:hymn/1006"}}}
```

## Expected Behavior

Dragging content from row 5 toward row 4 should highlight row 4 as the drop target, not row 1.

## Root Cause (suspected)

The `dualCollisionDetection` function in `ListsFolder.jsx` is likely not correctly resolving the nearest content drop zone. The collision detection strategy may be comparing distances incorrectly, or the droppable zones for content may have incorrect bounding rects.

## Where to Look

- `ListsFolder.jsx` — `dualCollisionDetection` function
- `ListsItemRow.jsx` — `useDroppable` setup for content drop zones
- `@dnd-kit/core` `closestCenter` vs custom collision detection logic

## Impact

Content drag-and-drop is 100% unusable — users cannot reliably swap content between adjacent rows.

## Resolution

**Root Cause:** The content droppable wrapper `<div>` used `display: 'contents'`, which removes the element from the box model. `getBoundingClientRect()` returns `{0,0,0,0}` for such elements. dnd-kit's `closestCenter` then computed all droppables as equidistant from the pointer (all centered at origin), causing it to return the first container in DOM order (index 0) instead of the geometrically nearest.

**Fix:** Replaced `display: 'contents'` with a `.content-drop-zone` flex wrapper (`display: flex; flex: 1; align-items: center; min-width: 0`). This gives the wrapper a real bounding rect spanning its content columns, so `closestCenter` correctly identifies the nearest row.

**Files Changed:**
- `ListsItemRow.jsx:2692` — wrapper class change
- `ContentLists.scss` — new `.content-drop-zone` rule
- `ListsFolder.jsx` — zero-rect warning in collision detection

**Status:** Fixed
