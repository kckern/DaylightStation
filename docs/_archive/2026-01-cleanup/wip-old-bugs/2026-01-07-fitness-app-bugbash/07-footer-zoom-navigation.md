# Bug 07: Footer Zoom Navigation Fails to Seek

**Severity:** Medium
**Area:** Navigation
**Status:** Open

## Summary

The zoomed-in sub-navigation on the player footer is broken. Clicking an item in the "zoomed-in" lower half of the footer does not advance the playhead to the corresponding timestamp.

## Symptoms

1. User zooms into a section of the timeline via footer
2. Clicks on a position in the zoomed view
3. Playhead does not seek to the expected timestamp
4. Video continues playing at current position

## Root Cause

Mapping error between the zoom level coordinate system and the actual video timecode. The click position is likely being calculated against the full timeline instead of the zoomed range.

## Relevant Code

### Core Coordinate Mapping
**File:** `frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterSeekThumbnails.jsx`

| Function | Lines | Purpose |
|----------|-------|---------|
| `positionToSeconds(clientX, rect)` | 396-401 | Maps click X to timeline seconds |
| `handleClick(e)` | 582-588 | Handles click events, calls `commit()` |
| `commit(t)` | 403-443 | Records seek intent, dispatches seek |

**Key formula (lines 396-401):**
```javascript
const positionToSeconds = useCallback((clientX, rect) => {
  if (!rect) return rangeStart;
  const clickX = clientX - rect.left;
  const pct = clamp01(clickX / rect.width);
  return rangeStart + pct * rangeSpan;  // Uses zoom range
}, [rangeStart, rangeSpan]);
```

### Zoom State Management
**File:** `FitnessPlayerFooterSeekThumbnails.jsx`

| State/Ref | Lines | Purpose |
|-----------|-------|---------|
| `zoomRange` | 69 | Current zoom bounds [start, end] |
| `zoomStackRef` | 71 | Stack of zoom snapshots |
| `effectiveRange` | 94-122 | Visible time range (zoomed or full) |
| `rangePositions` | 127-133 | 10 segment positions |

### Zoom Operations
| Function | Lines | Purpose |
|----------|-------|---------|
| `handleZoomRequest(bounds)` | 272-287 | Zooms into time range |
| `resolveZoomIndex()` | 289-307 | Finds position in zoom snapshot |
| `setZoomRangeFromIndex(targetIndex)` | 309-326 | Updates zoom from thumbnail index |
| `stepZoomBackward()` | 328-336 | Navigate previous segment |
| `stepZoomForward()` | 338-346 | Navigate next segment |

### Parent View Component
**File:** `frontend/src/modules/Fitness/FitnessPlayerFooter/FitnessPlayerFooterView.jsx`

| State | Lines | Purpose |
|-------|-------|---------|
| `isZoomed` | 36 | Zoom state flag |
| `zoomNavState` | 37 | Navigation state |
| `handleBack()` | 42-47 | Resets zoom |

## Likely Failure Points

1. **`rangeStart`/`rangeSpan` not updated:**
   - Zoom state changes but `positionToSeconds` dependencies stale
   - `useCallback` dependency array missing zoom values

2. **Click target mismatch:**
   - Clicking on zoomed container but `rect` refers to parent
   - `getBoundingClientRect()` called on wrong element

3. **Zoom range calculation error:**
   - `effectiveRange` not correctly computed when zoomed
   - `zoomRange` state not propagating to seek logic

4. **Event handler on wrong element:**
   - Zoomed view has its own click handler that's not wired
   - Click events captured by wrong layer

5. **Seek dispatch failure:**
   - `commit()` called with correct time but dispatch fails
   - Player ref not available in zoomed context

## Fix Direction

1. **Verify `rangeStart`/`rangeSpan` reactivity:**
   - Add logging to `positionToSeconds` to confirm values
   - Check these are derived from `effectiveRange` when zoomed

2. **Audit click handler wiring:**
   - Ensure zoomed container uses same `handleClick`
   - Verify `getBoundingClientRect()` targets the zoomed element

3. **Add debugging for coordinate flow:**
   ```javascript
   // In handleClick
   console.log('Click:', { clientX, rect, pct, targetTime, rangeStart, rangeSpan, isZoomed });
   ```

4. **Check zoom state synchronization:**
   - Verify `zoomRange` updates trigger re-computation of `rangeStart`/`rangeSpan`
   - Ensure `effectiveRange` useMemo has correct dependencies

5. **Test seek dispatch path:**
   - Log in `commit()` to verify correct time is passed
   - Verify player receives seek command

## Related Components

- `FitnessPlayerFooterSeekThumbnail.jsx` - Individual thumbnail button
- `ProgressFrame.jsx` - Progress visualization with zoom window

## Testing Approach

Runtime tests should:
1. Zoom into timeline segment
2. Click at various positions in zoomed view
3. Verify seek goes to correct timestamp within zoom range
4. Test zoom navigation (step forward/backward)
5. Test nested zoom (zoom into zoomed view)
6. Verify zoom reset returns to full timeline seek behavior
