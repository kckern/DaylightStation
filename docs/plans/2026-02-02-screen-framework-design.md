# Daylight Screen Framework Design

A config-driven framework for room-based display interfaces ("screens") in Daylight Station.

## Problem Statement

Current kiosk apps (TVApp, OfficeApp) are hardcoded React components with tightly coupled layouts, input handlers, and widgets. This creates barriers:

- **Flexibility:** Changing layouts or widgets requires code changes and deploys
- **Scale:** Adding new room displays (kitchen tablet, bedroom panel) means building new React apps
- **Onboarding:** Future users can't create their own screens without writing React code

## Goals

1. **Config-driven screens:** Define screens via YAML, no React code for common use cases
2. **Hot-reconfigurable:** Change layouts/widgets without deploys
3. **Scalable foundation:** Support future display types (tablets, e-ink, voice)
4. **Sensible defaults with escape hatches:** Profiles and built-in widgets that work out of the box, with overrides when needed

## Scope

**In scope:** Room-based mounted displays

- Living room TV (`/tv`)
- Office dashboard (`/office`)
- Future: kitchen tablet, bedroom display, garage panel

**Out of scope:** Domain-specific special apps

- `/fitness` - ANT+ sensors, governance, session management
- `/finance` - Financial dashboards
- `/health` - Health tracking
- `/life` - Lifelog
- `/home` - Home automation

These remain bespoke React apps with deep domain logic.

---

## Core Concepts

### Screens

A **screen** is a config-driven kiosk interface for a physical display. Each screen is defined by a YAML file declaring:

- **Route** - URL path for the screen
- **Profile** - Starting template (dashboard, media-browser, single-focus)
- **Input mode** - Primary input type (touch, remote, numpad, keyboard)
- **Layout** - How widgets are arranged (grid, regions, flex)
- **Widgets** - What components to render and their configuration
- **Overrides** - Per-widget input and behavior customization

### Example Configuration

```yaml
# /data/household/screens/kitchen.yml
screen: kitchen
route: /kitchen
profile: dashboard
input: touch

layout:
  type: grid
  columns: 2
  rows: 3

widgets:
  clock: { row: 1, col: 1 }
  weather: { row: 1, col: 2, on_tap: open_forecast }
  calendar: { row: 2, col: 1, colspan: 2 }
  quick-actions:
    row: 3
    col: 1
    colspan: 2
    actions:
      - { label: "Morning Playlist", action: "play:Morning Program" }
      - { label: "Recipes", action: "open:recipes" }
```

---

## Input System

The framework provides **input adapters** that translate hardware events into **abstract actions**.

### Built-in Input Modes

| Mode | Hardware | Default Actions |
|------|----------|-----------------|
| `touch` | Touchscreen | tap→select, swipe_left→back, swipe_right→forward, long_press→context |
| `remote` | IR/Bluetooth remote | arrows→navigate, enter→select, back→escape |
| `numpad` | USB numpad | Loaded from `keyboard.yml` (existing pattern) |
| `keyboard` | Full keyboard | arrows→navigate, enter→select, escape→back, alphanumeric→search |

### Action Bus

All inputs emit to a central action bus. Widgets subscribe to actions they handle.

```
Hardware Event → Input Adapter → Action Bus → Widgets
     (tap)        (touch mode)    (select)    (handles it)
```

### Per-Widget Overrides

```yaml
widgets:
  weather:
    on_tap: open_forecast      # override default "select"
    on_long_press: refresh     # custom action
  player:
    gestures:
      swipe_up: volume_up
      swipe_down: volume_down
```

### Extensibility

Custom input adapters can be registered for new hardware (voice, gesture sensors, MQTT buttons).

---

## Layout System

Each screen declares a layout type. The framework includes three layout engines.

### Grid Layout

For dashboards with many widgets:

```yaml
layout:
  type: grid
  columns: 3
  rows: 4
  gap: 1rem

widgets:
  clock: { row: 1, col: 1 }
  weather: { row: 1, col: 2, colspan: 2 }
  calendar: { row: 2, col: 1, rowspan: 2 }
  finance: { row: 2, col: 2 }
  health: { row: 2, col: 3 }
  entropy: { row: 3, col: 2, colspan: 2 }
```

### Regions Layout

For media/navigation interfaces:

```yaml
layout:
  type: regions
  template: nav-content-overlay  # predefined arrangement

widgets:
  nav: plex-menu
  content: player
  overlay: notifications
```

Built-in templates:
- `sidebar-main`
- `nav-content-overlay`
- `header-body-footer`
- `single-focus`

### Flex Layout

For power users needing full control:

```yaml
layout:
  type: flex
  direction: column
  children:
    - type: row
      height: 30%
      children: [clock, weather]
    - type: row
      flex: 1
      children: [calendar]
```

### Responsive Hints

```yaml
layout:
  type: grid
  columns: 3
  breakpoints:
    narrow: { columns: 1 }
    medium: { columns: 2 }
```

---

## Widget Registry

Widgets are React components registered with the framework.

### Built-in Widgets

| Widget | Default Source | Description |
|--------|---------------|-------------|
| `clock` | (local) | Time display with date |
| `weather` | `/api/v1/home/weather` | Current conditions + forecast |
| `calendar` | `/api/v1/calendar` | Upcoming events |
| `finance` | `/api/v1/finance/chart` | Spending chart |
| `entropy` | `/api/v1/entropy` | Accountability nudges |
| `health` | `/api/v1/health` | Weight/activity trends |
| `menu` | `/api/v1/item/folder/{id}` | Navigable content menu |
| `player` | (via actions) | Media playback |
| `plex-menu` | `/api/v1/content/plex/{id}` | Plex library browser |

### Custom Widget Registration

```yaml
# /data/household/config/widgets.yml
custom_widgets:
  recipe-card:
    component: ./widgets/RecipeCard.jsx
    default_source: /api/v1/recipes/today
    actions: [select, refresh]

  baby-monitor:
    component: ./widgets/BabyMonitor.jsx
    subscribe: ws://events/nursery
```

### Widget Contract

Each widget receives standard props from the framework:

- `data` - Fetched/subscribed data
- `config` - Widget-specific config from screen YAML
- `dispatch` - Emit actions back to bus
- `layout` - Size hints from layout engine

---

## Routing

Screens register routes via config. The framework generates routes dynamically.

### Configuration

```yaml
# /data/household/screens/living-room.yml
screen: living-room
route: /tv               # primary route
aliases: [/living-room]  # additional routes
profile: media-browser
```

### Framework Router

```jsx
// Single generic handler replaces hardcoded routes
<Route path="/screen/:screenId/*" element={<ScreenRenderer />} />

// Legacy routes can redirect or be aliased
<Route path="/tv" element={<Navigate to="/screen/living-room" />} />
```

---

## Data Layer

Widgets declare data sources. The framework handles fetching, caching, and subscriptions.

### Data Bindings

```yaml
widgets:
  weather:
    source: /api/v1/home/weather   # REST endpoint
    refresh: 60s                    # polling interval

  calendar:
    source: /api/v1/calendar
    refresh: 300s

  notifications:
    subscribe: events/home          # WebSocket topic

  player:
    # No source - receives data via actions
```

### Built-in Defaults

Built-in widgets have default sources. Config overrides only when needed:

```yaml
widgets:
  weather: { row: 1, col: 1 }  # uses default /api/v1/home/weather
  calendar:
    row: 2
    col: 1
    source: /api/v1/calendar/family  # override: family calendar only
```

### Framework Data Manager

- Fetches on mount, refreshes on interval
- Caches responses (avoids duplicate fetches if same source)
- Manages WebSocket subscriptions per screen
- Passes data to widgets as props
- Handles loading/error states

---

## File Structure

### Config Location (Data Mount)

```
data/household/
├── screens/
│   ├── office.yml           # Office screen config
│   ├── living-room.yml      # TV/living room config
│   ├── kitchen.yml          # Future kitchen tablet
│   └── bedroom.yml          # Future bedroom display
├── widgets/
│   └── custom/              # User-defined widgets
│       ├── RecipeCard.jsx
│       └── BabyMonitor.jsx
├── input/
│   ├── keyboard.yml         # Numpad mappings (existing)
│   └── gestures.yml         # Custom gesture mappings
└── config/
    └── screen-framework.yml # Global framework settings
```

### Frontend Structure

```
frontend/src/
├── Apps/
│   ├── FitnessApp.jsx       # Special app (unchanged)
│   └── ScreenApp.jsx        # Generic screen renderer entry
├── screen-framework/
│   ├── ScreenRenderer.jsx   # Main orchestrator
│   ├── layouts/
│   │   ├── GridLayout.jsx
│   │   ├── RegionsLayout.jsx
│   │   └── FlexLayout.jsx
│   ├── input/
│   │   ├── InputManager.js
│   │   ├── adapters/
│   │   │   ├── TouchAdapter.js
│   │   │   ├── RemoteAdapter.js
│   │   │   └── NumpadAdapter.js
│   │   └── ActionBus.js
│   ├── data/
│   │   ├── DataManager.js
│   │   └── SourceCache.js
│   └── widgets/
│       ├── registry.js      # Built-in widget registry
│       └── WidgetWrapper.jsx
└── modules/                  # Existing widgets (Clock, Weather, etc.)
```

---

## Implementation Phases

### Phase 1: Foundation

- ScreenRenderer component
- Grid layout engine
- Wire existing widgets (Clock, Weather, Calendar, etc.)
- Migrate OfficeApp to screen config

### Phase 2: Input System

- Input adapters (touch, remote, numpad)
- Action bus
- Per-widget action overrides

### Phase 3: Layout Expansion

- Regions layout engine
- Flex layout engine
- Migrate TVApp to screen config

### Phase 4: Extensibility

- Custom widget registration
- Data manager refinements
- WebSocket subscription management

### Phase 5: Polish

- Hot-reload screen configs without page refresh
- Admin UI for screen config editing
- Screen preview/testing mode

---

## Migration Strategy

### OfficeApp → Screen

1. Create `/data/household/screens/office.yml` matching current layout
2. Verify all widgets render correctly via ScreenRenderer
3. Test numpad input via InputManager
4. Replace hardcoded route with screen route
5. Delete OfficeApp.jsx

### TVApp → Screen

1. Create `/data/household/screens/living-room.yml` with regions layout
2. Verify menu navigation works via action bus
3. Test remote input via InputManager
4. Replace hardcoded route with screen route
5. Delete TVApp.jsx

---

## Open Questions

1. **Profile inheritance:** Should profiles be composable? (e.g., `profile: [dashboard, media-capable]`)
2. **Conditional widgets:** Support for `if: { time: morning }` to show/hide widgets?
3. **Multi-screen sync:** Should screens be aware of each other? (e.g., "now playing" on all screens)
4. **Backend API:** New endpoint for screen config CRUD, or file-based only?

---

## Success Criteria

1. OfficeApp functionality fully replicated via screen config
2. TVApp functionality fully replicated via screen config
3. New screen (kitchen tablet) created without writing React code
4. Config changes reflected without deploy (hot-reload or page refresh)
5. Custom widget successfully registered and rendered
