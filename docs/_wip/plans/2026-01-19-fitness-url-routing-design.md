# Fitness App URL Routing Design

## Overview

Add URL-based deep linking to FitnessApp for quick access shortcuts and testing workflows. Users can bookmark or trigger specific views, content, and settings directly via URL.

## URL Structure

**Hybrid approach:** Path segments for content type + ID, query params for display options.

### Routes

| Route | Description |
|-------|-------------|
| `/fitness` | Default view (first nav item) |
| `/fitness/menu/:id` | Menu view - single Plex ID, comma-separated IDs, or custom menu string |
| `/fitness/show/:id` | Show's episode list |
| `/fitness/play/:id` | Start playing movie/episode directly |
| `/fitness/plugin/:id` | Launch plugin (e.g., `fitness_session`) |
| `/fitness/users` | Users/session view |

### Menu ID Flexibility

The `:id` in `/fitness/menu/:id` supports:
- Single Plex collection ID: `/fitness/menu/12345`
- Multiple IDs (comma-separated): `/fitness/menu/123,456,789`
- Custom menu string (future): `/fitness/menu/my-workouts`

### Query Parameters

| Param | Values | Description |
|-------|--------|-------------|
| `music` | `on`, `off` | Force music player state |
| `fullscreen` | `1` | Enter fullscreen mode on load |
| `simulate` | `<duration>,<users>,<rpm>` or `stop` | Start/stop fitness simulation |

### Simulate Parameter Parsing

Format: `simulate=<duration>,<users>,<rpm>`

| Value | Behavior |
|-------|----------|
| `?simulate` or `?simulate=` | Start with defaults (120s, all devices) |
| `?simulate=300` | 300s duration, all HR users, all RPM devices |
| `?simulate=300,2` | 300s duration, 2 HR users, all RPM devices |
| `?simulate=300,2,4` | 300s duration, 2 HR users, 4 RPM devices |
| `?simulate=120,0,2` | 120s duration, all HR users, 2 RPM devices |
| `?simulate=stop` | Kill any running simulation |

**Defaults:** duration=120, users=0 (all), rpm=0 (all)

## Examples

```
/fitness/menu/12345                     → Jump to workout collection
/fitness/show/67890                     → Jump to show's episodes
/fitness/play/abc123?music=off          → Play episode with music disabled
/fitness/plugin/fitness_session         → Launch session plugin
/fitness/users?simulate=300,2,3      → Session view with 5-min sim, 2 HR, 3 RPM
/fitness/menu/123,456?fullscreen=1      → Multi-collection, fullscreen
```

## State Management

### URL ↔ State Sync

```
URL Change → Parse params → Set React state → Render view
     ↑                                              ↓
     └──────────── Update URL on navigate ←────────┘
```

- URL parsing happens in `useEffect` on mount + URL changes
- State-to-URL sync uses `navigate(path, { replace: true })` to avoid history spam
- Only sync meaningful state changes (debounce rapid updates)

### Underlay/Back Navigation

When navigating via URL, track the "underlay" for proper back/close behavior:

| Current View | On Close/Finish | Notes |
|--------------|-----------------|-------|
| `/fitness/play/:id` | → `/fitness/show/:showId` | Derive showId from episode metadata |
| `/fitness/plugin/:id` | → Previous menu/view | Track in state |
| `/fitness/show/:id` | → `/fitness/menu/:id` or `/fitness` | Based on entry point |

### Play Route Flow

The `/fitness/play/:id` route requires special handling:

1. **Fetch episode metadata** - Lightweight API call to get showId, seasonId, labels
2. **Build queue item** - Construct with full context (showId for close navigation)
3. **Start playback** - Add to fitnessPlayQueue
4. **On close** - Navigate to `/fitness/show/:showId`

This is a lightweight fetch approach - full show context loads lazily only if user exits to show view.

## Backend API

### Simulation Endpoints

**Start Simulation**
```
POST /api/fitness/simulate
Content-Type: application/json

{
  "duration": 300, // seconds (default: 120)
  "users": 2,      // HR user count (0 = all)
  "rpm": 3         // RPM device count (0 = all)
}

Response: { "started": true, "pid": 12345 }
```

**Stop Simulation**
```
DELETE /api/fitness/simulate

Response: { "stopped": true }
      or: { "error": "no simulation running" }
```

**Implementation Notes:**
- Backend tracks spawned PID in memory
- Uses `child_process.spawn` with detached process
- Spawns `_extensions/fitness/simulation.mjs` with args
- Prevents duplicate spawns (returns existing PID if running)

## Files to Modify

### Frontend

**`frontend/src/main.jsx`**
- Change `/fitness` route to `/fitness/*` to capture sub-paths
- Add wrapper component that parses params

**`frontend/src/Apps/FitnessApp.jsx`**
- Add `useParams()` and `useSearchParams()` hooks
- Parse URL on mount, initialize state from params
- Add `useEffect` to sync state changes back to URL
- Add simulation trigger logic (call API if `?simulate` present)
- Track underlay state for back navigation

### Backend

**`backend/routers/fitness.mjs`** (create or extend)
- `POST /api/fitness/simulate` - Spawn simulation process
- `DELETE /api/fitness/simulate` - Kill simulation process
- Track PID in module-level variable

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `/fitness/play/invalid-id` | Show error toast, redirect to `/fitness` |
| `/fitness/show/invalid-id` | Show error in FitnessShow (existing behavior) |
| `/fitness/menu/unknown` | Fall back to first nav item |
| Simulation already running | Return existing PID, don't spawn duplicate |
| Simulation spawn fails | Return error with message, log to backend |
| Invalid simulate param | Ignore, use defaults |

## Testing Scenarios

1. **Direct menu access**: `/fitness/menu/12345` loads correct collection
2. **Show deep link**: `/fitness/show/67890` loads show with episodes
3. **Play with return**: `/fitness/play/abc` plays, close returns to show
4. **Simulation start**: `/fitness/users?simulate=2,3` starts sim with 2 HR, 3 RPM
5. **Simulation stop**: Navigate to `?simulate=stop` kills running sim
6. **Music override**: `?music=off` disables music player
7. **Fullscreen**: `?fullscreen=1` enters fullscreen on load
8. **Invalid IDs**: Graceful fallback to default view

## Future Considerations

- Custom menu definitions (string IDs mapping to configured collections)
- Shareable session URLs with participant pre-selection
- Time-based simulation profiles (warm-up → peak → cooldown)
