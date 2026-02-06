# Displayer Component Design

**Date:** 2026-02-06
**Status:** Approved

## Problem

The `DisplayableItem` domain capability exists on the backend but has no first-class frontend renderer. Static image display is shoehorned into an "Art" app inside `AppContainer/Apps/`, treating it as an openable app rather than a content type. This breaks the capability-to-module mapping used elsewhere in the system.

## Capability-to-Module Mapping

| Domain Capability | Frontend Module | Concern |
|---|---|---|
| Playable | `modules/Player/` | Temporal — seek, progress, resilience, transport |
| Listable | `modules/Menu/` | Navigation — browse, select, drill down |
| Openable | `Apps/` | Interactive — webcam, clock, fitness |
| Readable | *(future)* | Paginated — ebooks, articles |
| **Displayable** | **`modules/Displayer/`** | **Static — image, card, poster** |

## Design Decisions

1. **Displayer is a peer to Player**, not inside it. Player is 830 lines of temporal machinery (queue controllers, remount backoff, resilience, transport adapters). None of that applies to showing a picture.

2. **Displayable = static, single view.** No timeline, no advance, no duration. Slideshows are temporal and belong in Player (CompositePlayer with a visual queue of images + timed advance + optional audio track).

3. **Display modes are configurable.** Displayer renders a bare image by default. "Art mode" (frame + matte + info overlay) is one presentation config among others (poster, card).

4. **Cascade resolution for config.** Item metadata provides defaults, URL params override. Matches Player's convention for volume/playbackRate (item-level -> caller-level -> default).

5. **Art app is fully removed.** No backward compat shim. Content lists referencing `app:art/X` are updated to use `display` action with actual content source IDs (`immich:X`, `canvas:X`).

## Component Architecture

### Displayer.jsx (~80-120 lines)

**Location:** `frontend/src/modules/Displayer/Displayer.jsx`

**Props:**
- `display` — DisplayableItem data (full object) or `{ id }` (triggers fetch)
- `mode` — `'default'` | `'art'` | `'poster'` | `'card'`
- `frame` — `'none'` | `'classic'` | `'minimal'` | `'ornate'` (art mode only)
- `onClose` — escape/click handler

**Config cascade:**
1. `display.frameStyle` from item metadata (adapter-set)
2. `frame` prop from URL params (caller-set)
3. Mode default (`art` -> `'classic'`, `poster` -> `'none'`, `default` -> `'none'`)

**Data fetching:** If `display` is just `{ id: 'immich:abc' }`, Displayer fetches from `/api/v1/info/{source}/{localId}` to hydrate. If full data is already provided, renders immediately.

### Display Modes

| Mode | Renders | Use Case |
|---|---|---|
| `default` | Bare image, fills viewport | Generic display |
| `art` | Frame + matte + info overlay toggle | Canvas art on wall display |
| `poster` | Image + title/subtitle below | Movie poster in TV room |
| `card` | Image + full metadata panel | Photo detail view |

Each mode is a small wrapper (~30-50 lines) receiving resolved display data.

## File Structure

### New Files

```
frontend/src/modules/Displayer/
  Displayer.jsx          # Main component
  Displayer.scss         # Base styles + mode-specific styles
  modes/
    ArtMode.jsx          # Frame + matte + info overlay toggle
    PosterMode.jsx       # Image + title/subtitle below
    CardMode.jsx         # Image + full metadata panel
```

### Deleted Files

- `frontend/src/modules/AppContainer/Apps/Art/Art.jsx`
- `frontend/src/modules/AppContainer/Apps/Art/Art.scss`
- `art` entry removed from `frontend/src/lib/appRegistry.js`

## Integration Points

### MenuStack

Swap the existing `case 'display'`:

```jsx
// Before: hardcoded ArtViewer
case 'display':
  return <ArtViewer item={props.display} onClose={clear} />;

// After: generic Displayer with mode support
case 'display':
  return <Displayer display={props.display} onClose={clear} />;
```

### TVApp Query Parsing

Extend the existing `display:` handler to carry mode/frame:

```
?display=immich:abc-123              -> { id: 'immich:abc-123' }
?display=immich:abc-123&mode=art     -> { id: 'immich:abc-123', mode: 'art' }
?display=canvas:sunset&frame=ornate  -> { id: 'canvas:sunset', mode: 'art', frame: 'ornate' }
```

### Content Lists (YAML)

Any content lists referencing `app:art/something` are updated:
- **Before:** action `open`, value `app:art/monalisa`
- **After:** action `display`, value `immich:monalisa` or `canvas:monalisa`

### Canvas Service

Stays untouched. Canvas polling/rotation is a *caller* of Displayer, not part of it. A future "rotating art display" would be either:
- A canvas controller component that swaps Displayer's `display` prop on a timer
- A CompositePlayer slideshow (temporal, with optional audio)

## Backend Changes

**None required.** All backend infrastructure already supports this:
- `DisplayableItem` domain class has all needed fields (imageUrl, thumbnail, frameStyle, artist, year, tags, category)
- `ImmichAdapter.getViewable()` returns DisplayableItem
- Canvas adapters produce DisplayableItem with frameStyle/artist/year
- `/api/v1/info/` endpoint derives "displayable" capability
- `/api/v1/display/` endpoint serves image redirects
