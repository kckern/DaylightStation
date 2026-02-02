# Canvas Art Provider Design

## Overview

A robust TV art display system leveraging DDD architecture. Provides ambient art display with context-aware selection, multiple content sources, and configurable display options.

## Integration

New integration category: `canvas`

```yaml
# household/config/integrations.yml
canvas:
  - provider: immich
    library: art           # Immich external library name
  - provider: filesystem
    path: /media/art       # Category subfolders within
```

## Content Sources

### Immich Canvas Adapter

Uses same Immich instance as `gallery` but scoped to a dedicated art library (Immich external library feature).

- Reuses existing `ImmichClient`
- Queries only the designated art library
- Returns `DisplayableItem` with metadata

### Filesystem Canvas Adapter

Reads local folders organized by category:

```
/media/art/
  landscapes/
  abstract/
  portraits/
  classical/
```

- Scans category folders
- Extracts EXIF metadata (artist, year, keywords)
- Category derived from folder name

## Domain Model

### DisplayableItem

Extends `ViewableItem` with art-specific metadata:

```javascript
// backend/src/2_domains/content/capabilities/Displayable.mjs
export class DisplayableItem extends ViewableItem {
  constructor(props) {
    super(props);
    this.category = props.category;      // landscapes, abstract, portraits
    this.artist = props.artist;          // from EXIF or metadata
    this.year = props.year;              // creation year
    this.tags = props.tags || [];        // mood, season, time-of-day hints
    this.frameStyle = props.frameStyle;  // minimal, classic, ornate, none
  }
}
```

### CanvasSelectionService

Pure domain logic for art selection:

```javascript
// backend/src/2_domains/content/services/CanvasSelectionService.mjs
export class CanvasSelectionService {
  // Pure functions - receives data, returns decisions
  selectForContext(items, context) { }
  pickNext(pool, shownHistory, options) { }
  buildContextFilters(timeSlot, calendarTags, devicePrefs) { }
}
```

## Application Layer

### Ports (Interfaces)

```javascript
// 3_applications/canvas/ports/ICanvasEventSource.mjs
export const ICanvasEventSource = {
  onMotionDetected: (callback) => {},   // (deviceId) => void
  onContextTrigger: (callback) => {},   // (deviceId, triggerType) => void
  onManualAdvance: (callback) => {},    // (deviceId) => void
};

// 3_applications/canvas/ports/ICanvasScheduler.mjs
export const ICanvasScheduler = {
  scheduleRotation: (deviceId, intervalMs, callback) => {},
  resetTimer: (deviceId) => {},
  cancelRotation: (deviceId) => {},
};

// 3_applications/canvas/ports/IContextProvider.mjs
export const IContextProvider = {
  getContext: (deviceId, householdId) => {},  // Returns time, calendar, device context
};
```

### CanvasService

Orchestrates via ports - no infrastructure knowledge:

```javascript
// 3_applications/canvas/services/CanvasService.mjs
export class CanvasService {
  constructor({ contentSources, selectionService, scheduler, eventSource, contextProvider }) {
    // Wire up events via ports
    eventSource.onMotionDetected((deviceId) => scheduler.resetTimer(deviceId));
    eventSource.onManualAdvance((deviceId) => this.advance(deviceId));
  }

  async getCurrent(deviceId, householdId) { }
  async advance(deviceId) { }
}
```

## Adapter Layer

### HomeAssistantEventAdapter

Implements `ICanvasEventSource`, translates HA/MQTT events to abstract events:

```javascript
// 1_adapters/events/homeassistant/HomeAssistantEventAdapter.mjs
export class HomeAssistantEventAdapter {
  constructor({ mqttClient, entityMappings }) { }
  onMotionDetected(callback) { }
  start() { /* MQTT subscription, event translation */ }
}
```

## Context Configuration

### Household Canvas Config

```yaml
# household/apps/canvas/config.yml
defaults:
  rotation:
    interval: 300          # 5 minutes
    mode: random           # random | sequential
    avoidRepeats: true
  frame:
    style: classic         # minimal | classic | ornate | none
  transitions:
    type: crossfade        # crossfade | fade | none
    duration: 1000
  overlay:
    enabled: false
    showOnInteract: true

contexts:
  time:
    morning:               # 6am-12pm
      tags: [bright, warm]
      categories: [landscapes, nature]
    evening:               # 6pm-10pm
      tags: [calm, warm]
    night:                 # 10pm-6am
      tags: [dark, minimal]
      frame:
        style: none

  calendar:
    christmas:
      dateRange: [12-01, 12-31]
      tags: [holiday, winter]
    easter:
      dynamic: true
      tags: [spring]

  devices:
    living-room-tv:
      categories: [landscapes, classical]
      frame:
        style: ornate
    bedroom-display:
      rotation:
        interval: 600
      tags: [calm]

events:
  motion:
    enabled: true
    entity: binary_sensor.living_room_motion
    action: reset_timer
  time_boundaries:
    enabled: true
    action: advance
```

## API Endpoints

```javascript
// backend/src/4_api/v1/routers/canvas.mjs
router.get('/canvas/current', async (req, res) => { });   // Get current art for device
router.post('/canvas/next', async (req, res) => { });     // Manual advance
router.post('/canvas/event', async (req, res) => { });    // Webhook for events
```

## Frontend Component

### Enhanced Art.jsx

- Fetches current art from `/api/v1/canvas/current`
- Preloads next image for smooth transitions
- Supports frame style variants (minimal, classic, ornate, none)
- Optional info overlay (title, artist, year) on demand
- Crossfade transitions between images

### SCSS Additions

- Frame style variants: `.art-frame--minimal`, `.art-frame--classic`, `.art-frame--ornate`, `.art-frame--none`
- Transition animations: `.fading-out`, `.fading-in`
- Info overlay styling: `.art-overlay`

## File Structure

```
backend/src/
  1_adapters/
    content/canvas/
      immich/ImmichCanvasAdapter.mjs
      filesystem/FilesystemCanvasAdapter.mjs
    events/homeassistant/HomeAssistantEventAdapter.mjs

  2_domains/content/
    capabilities/Displayable.mjs
    services/CanvasSelectionService.mjs

  3_applications/canvas/
    ports/ICanvasEventSource.mjs
    ports/ICanvasScheduler.mjs
    ports/IContextProvider.mjs
    services/CanvasService.mjs

  4_api/v1/routers/canvas.mjs

frontend/src/modules/AppContainer/Apps/Art/
  Art.jsx (enhanced)
  Art.scss (frame variants, transitions, overlay)

data/household/
  apps/canvas/config.yml
  config/integrations.yml (add canvas entry)
```

## DDD Layer Boundaries

| Layer | Knows About | Does NOT Know About |
|-------|-------------|---------------------|
| `2_domains` | Items, contexts, selection rules | Adapters, MQTT, HA, filesystems |
| `3_applications` | Ports/interfaces, domain services | Specific adapters, infrastructure |
| `1_adapters` | MQTT, HA, Immich, filesystem | Domain logic |
| `0_system` | Wiring adapters to ports | Business logic |

## Display Modes

1. **Slideshow** - Auto-rotating art, changes every N minutes
2. **Static** - Single piece shown until manually changed
3. **Context-aware** - Art changes based on time, calendar, room/device

## Rotation Behavior

Hybrid approach:
- Base: Timer-based rotation (configurable interval)
- Motion: Resets timer on room entry
- Context: Forces new selection on time boundary or calendar event change
- Manual: Advance on remote button press

## Context Priority

Contexts layer and override in order:
1. Time-of-day provides base filters
2. Calendar events override with seasonal/holiday tags
3. Device config overrides both with room-specific preferences
