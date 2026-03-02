# Screen Framework

**Last Updated:** 2026-03-02
**Status:** Phase 4 complete (overlays/subscriptions/input wiring)
**Related:** [Backend Architecture](./backend-architecture.md) | [Configuration](./configuration.md)

---

## Overview

The screen framework replaces hardcoded app layouts (`OfficeApp`, `TVApp`) with config-driven kiosk interfaces. Each physical display gets a YAML config file that declares its layout, widgets, data sources, theme, and event subscriptions.

Route: `/screen/:screenId` — config loaded from `/api/v1/screens/:id`, served from `data/household/screens/{id}.yml`.

## Architecture

```
ScreenRenderer
  → fetch config from /api/v1/screens/{id}
  → set --screen-* CSS variables from config.theme
  → ScreenDataProvider (shared data sources)
    → ScreenOverlayProvider (three slots: fullscreen/pip/toast)
      → ScreenActionHandler (ActionBus → overlay bridge)
      → ScreenSubscriptionHandler (WS topics → overlay triggers)
      → PanelRenderer (recursive layout tree)
        → widget nodes → registry lookup → mount component
        → panel nodes → flex div → recurse children
  → InputManager (adapters → ActionBus → widgets)
```

## Screen Config (YAML)

Each screen config has five sections:

| Section | Purpose |
|---------|---------|
| `screen` / `route` / `resolution` / `input` | Identity, resolution, and input device binding |
| `theme` | CSS custom property values for visual styling |
| `data` | Shared data sources with API endpoints and refresh intervals |
| `layout` | Recursive flex panel tree with widget placements |
| `subscriptions` | WebSocket topic responses (Phase 4) |

### Example

```yaml
screen: office
route: /screen/office
resolution:
  width: 1280
  height: 720
input:
  type: numpad
  keyboard_id: officekeypad

theme:
  panel-bg: rgba(0, 0, 0, 0.6)
  panel-radius: 8px
  panel-shadow: 0 2px 8px rgba(0,0,0,0.3)
  panel-padding: 1rem
  font-family: Roboto Condensed, sans-serif
  font-color: "#e0e0e0"
  accent-color: "#4fc3f7"

data:
  weather:
    source: /api/v1/home/weather
    refresh: 60

layout:
  direction: row
  gap: 1rem
  children:
    - direction: column
      basis: 25%
      shrink: 0
      children:
        - widget: clock
        - widget: weather
        - widget: weather-forecast
        - widget: entropy
    - direction: column
      grow: 1
      children:
        - widget: calendar
          grow: 2
        - direction: row
          grow: 1
          children:
            - widget: finance
            - widget: health
```

## Resolution & Centering

Screens declare a fixed resolution. The layout renders at that exact pixel size, centered horizontally and vertically in the viewport. This decouples the layout from the browser window size — the dashboard is designed for a specific display resolution.

```yaml
resolution:
  width: 1280
  height: 720
```

If `resolution` is omitted, the screen fills 100% of the viewport (legacy behavior).

The `screen-viewport` wrapper handles centering with flexbox. The `screen-root` inside it gets fixed width/height from the config.

## Panel Layout System

The layout tree is recursive. Each node is either a **panel** (has `children`) or a **widget** (has `widget`). Panels render as flex containers. Widgets resolve to registered React components.

### Flex Properties

All properties map 1:1 to CSS flexbox. No abstraction layer.

| Property | CSS equivalent | Default |
|----------|---------------|---------|
| `direction` | `flex-direction` | `row` |
| `grow` | `flex-grow` | `1` |
| `shrink` | `flex-shrink` | `1` |
| `basis` | `flex-basis` | `auto` |
| `gap` | `gap` | — |
| `justify` | `justify-content` | — |
| `align` | `align-items` | `stretch` |
| `overflow` | `overflow` | — |

Panels nest arbitrarily. The root `layout` node fills the screen container.

## Theme System

Two layers: structural (flex layout, always the same) and visual (themeable via CSS custom properties).

**Screen-level:** `theme` object sets `--screen-*` CSS variables on the root element.
**Per-panel:** Any node can have a `theme` key that overrides variables for that subtree.

CSS cascade handles inheritance — child panels inherit from parents unless overridden.

### Theme Variables

| Variable | CSS property | Default |
|----------|-------------|---------|
| `panel-bg` | `background` | `transparent` |
| `panel-radius` | `border-radius` | `0` |
| `panel-shadow` | `box-shadow` | `none` |
| `panel-padding` | `padding` | `0` |
| `font-family` | `font-family` | `inherit` |
| `font-color` | `color` | `inherit` |
| `accent-color` | — | `inherit` |

Base styles in `PanelRenderer.css` reference these as `var(--screen-panel-bg, transparent)` etc.

## Widget Registry

Simple name-to-component map. Widgets are mounted directly — the registry resolves YAML names to React components.

| Name | Component | Data mode |
|------|-----------|-----------|
| `clock` | `Time` | Self-contained |
| `weather` | `Weather` | Coordinated (`useScreenData`) |
| `weather-forecast` | `WeatherForecast` | Coordinated (`useScreenData`) |
| `calendar` | `Upcoming` | Self-contained |
| `finance` | `FinanceChart` | Self-contained |
| `health` | `Weight` | Self-contained |
| `entropy` | `EntropyPanel` | Self-contained |
| `piano` | `PianoVisualizer` | WS subscription (overlay) |

### Widget Interface

A widget is a React component that:
1. Renders its own UI (no wrapper imposed)
2. Optionally calls `useScreenData(key)` to consume coordinated data
3. Otherwise manages its own data fetching internally

No base class, no HOC, no required props shape.

## Data Coordination

`ScreenDataProvider` wraps the panel tree. It reads the `data` section from the screen config, fetches each unique endpoint once, refreshes on interval, and distributes via context.

```yaml
data:
  weather:
    source: /api/v1/home/weather
    refresh: 60   # seconds
```

Widgets consume via hook: `const data = useScreenData('weather')`. Returns `null` until data arrives. Two widgets referencing the same key share one fetch.

**Backward compatibility:** Weather widgets accept an optional `weatherData` prop. When rendered in OfficeApp (no provider), the prop is used. When rendered in the screen framework (provider present), the hook provides data.

## Overlay System

Widgets mounted in flex panels are constrained to their panel bounds. The overlay system lets widgets render content **above** the panel tree (e.g., a menu widget spawning a fullscreen player).

### Three Render Slots

`ScreenOverlayProvider` manages three independent overlay slots:

| Slot | Z-Index | Behavior |
|------|---------|----------|
| `fullscreen` | 1000 | Replaces dashboard visually (Piano, Player, MenuStack). One at a time. Dashboard stays mounted underneath. |
| `pip` | 1001 | Floats in a corner (doorbell camera). Fixed 320x240. Doesn't interrupt fullscreen. |
| `toast` | 1002 | Stackable notifications, auto-dismiss after timeout. |

```js
const { showOverlay, dismissOverlay } = useScreenOverlay();

showOverlay(Component, props);                                    // fullscreen (default)
showOverlay(Component, props, { mode: 'pip', position: 'top-right' });
showOverlay(Component, props, { mode: 'toast', timeout: 5000 });
showOverlay(Component, props, { mode: 'fullscreen', priority: 'high' }); // replaces existing

dismissOverlay();         // dismiss fullscreen (default)
dismissOverlay('pip');    // dismiss pip
```

Priority rule: a fullscreen overlay with `priority: 'high'` (like Piano from MIDI) can replace an existing fullscreen overlay. Normal priority is rejected if one is already active.

`useScreenOverlay()` returns no-op functions when used outside the screen framework, preventing crashes in legacy apps.

### Action Handler

`ScreenActionHandler` bridges ActionBus events to the overlay system. It subscribes to:

| Action | Effect |
|--------|--------|
| `menu:open` | `showOverlay(MenuStack, { rootMenu: menuId })` |
| `media:play` | `showOverlay(Player, { play: contentId })` |
| `media:queue` | `showOverlay(Player, { queue: [contentId] })` |
| `escape` | `dismissOverlay()` |

### WebSocket Subscriptions

Screens declare WS topic subscriptions in YAML config. `ScreenSubscriptionHandler` processes these and triggers overlays on matching events.

```yaml
subscriptions:
  midi:
    on:
      event: session_start
    response:
      overlay: piano
      mode: fullscreen
      priority: high
    dismiss:
      event: session_end
      inactivity: 30
```

Processing: for each topic, subscribe via `useWebSocketSubscription`. When a message arrives, check `on.event` filter (no filter = trigger on any message). On match, resolve `response.overlay` from widget registry, call `showOverlay`. Dismiss via event match, fixed timeout, or inactivity timer.

**Two trigger sources for overlays:**
- **Screen-level (subscriptions):** External events (MIDI keyboard, doorbell) auto-invoke overlays per YAML config
- **Widget-level (programmatic):** Widgets call `showOverlay()` directly (menu item selects video)

## Files

### Frontend

```
frontend/src/screen-framework/
├── ScreenRenderer.jsx          # Main entry point
├── index.js                    # Barrel exports (v0.3.0)
├── panels/
│   ├── PanelRenderer.jsx       # Recursive flex layout
│   └── PanelRenderer.css       # Base panel + theme styles
├── data/
│   ├── ScreenDataProvider.jsx  # Coordinated data context
│   └── DataManager.js          # Legacy singleton (unused)
├── actions/
│   └── ScreenActionHandler.jsx # ActionBus → overlay bridge
├── overlays/
│   ├── ScreenOverlayProvider.jsx  # Three-slot overlay system
│   └── ScreenOverlayProvider.css
├── subscriptions/
│   └── useScreenSubscriptions.js  # WS topic → overlay triggers
├── input/                      # Input adapters (Phase 2)
│   ├── ActionBus.js
│   ├── InputManager.js
│   ├── actionMap.js
│   ├── useScreenAction.js
│   └── adapters/
└── widgets/
    ├── registry.js             # Name → component map
    ├── builtins.js             # Dashboard widget registrations
    └── WidgetWrapper.jsx       # Legacy wrapper (unused)
```

### Backend

```
backend/src/4_api/v1/routers/screens.mjs   # GET /screens, GET /screens/:id
```

Reads YAML from `data/household/screens/{id}.yml`, validates `screen` field, returns JSON.

### Config

```
data/household/screens/
├── office.yml    # Office dashboard
└── tv.yml        # TV media browser
```

## Migration Path

1. **Phase 3 (complete):** Dashboard widgets render under `/screen/office`. Existing `/office` route unchanged.
2. **Phase 4 (complete):** Three-slot overlay system, ActionBus → overlay bridge, WS subscription processing from YAML config.
3. **Phase 5 (future):** Build `/screen/tv`, deprecate `OfficeApp.jsx` and `TVApp.jsx`. Move `/screen/office` to `/office`.
