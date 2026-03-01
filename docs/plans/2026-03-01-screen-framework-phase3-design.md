# Screen Framework Phase 3: Office Dashboard Migration

Implement the office dashboard under `/screen/office`, replacing the flat grid layout with a recursive flex panel system and coordinated data fetching. Existing OfficeApp stays intact.

## Architecture

### Panel Layout System

A recursive renderer walks the YAML layout tree. Each node is either a **panel** (has `children`, renders as a flex container) or a **widget** (has `widget`, resolves to a registered component).

Supported flex properties per node (map 1:1 to CSS flexbox):
- `direction` — `row` | `column` (default: `row`)
- `grow` — flex-grow (default: `1`)
- `shrink` — flex-shrink (default: `1`)
- `basis` — flex-basis (default: `auto`)
- `gap` — gap between children
- `justify` — justify-content (default: `stretch`)
- `align` — align-items (default: `stretch`)
- `overflow` — overflow behavior (default: `hidden`)

Panels nest arbitrarily. The root `layout` node fills the screen container.

### Widget Registry

Simple name-to-component map. No metadata, no data management.

```
clock            → Time
weather          → Weather
weather-forecast → WeatherForecast
calendar         → Upcoming
finance          → FinanceChart
health           → Weight
entropy          → EntropyPanel
```

Widgets are mounted directly — the registry just resolves the YAML name to a React component.

### Screen Data Provider

Screen config declares shared data sources with endpoints and refresh intervals. A React context provider fetches each unique endpoint once and distributes via a `useScreenData(key)` hook.

Widget data modes:
- **Coordinated** — widget declares `data: <key>` in YAML, calls `useScreenData(key)` internally
- **Self-contained** — no `data` key, widget manages its own fetching (Clock, Finance, Weight, Entropy)

### Theme System

Two-layer styling: structural (flex layout, always the same) and visual (themeable via CSS custom properties).

Screen-level `theme` object sets `--screen-*` CSS custom properties on the root element. Per-panel `theme` overrides set the same variables on that panel's div. CSS cascade handles inheritance — child panels inherit from parents unless overridden.

Available theme variables (all optional, sensible defaults):
- `panel-bg` — background (default: `transparent`)
- `panel-radius` — border-radius (default: `0`)
- `panel-shadow` — box-shadow (default: `none`)
- `panel-padding` — padding (default: `0`)
- `font-family` — font-family (default: `inherit`)
- `font-color` — color (default: `inherit`)
- `accent-color` — accent/highlight color (default: `inherit`)

Base widget panel styles:
```css
.screen-panel--widget {
  background: var(--screen-panel-bg, transparent);
  border-radius: var(--screen-panel-radius, 0);
  box-shadow: var(--screen-panel-shadow, none);
  padding: var(--screen-panel-padding, 0);
  font-family: var(--screen-font-family, inherit);
  color: var(--screen-font-color, inherit);
}
```

### ScreenRenderer

Orchestrates config loading, theme application, data provider, and panel rendering:

```
ScreenRenderer
  → fetch config from /api/v1/screens/{id}
  → set --screen-* CSS variables from config.theme
  → ScreenDataProvider (shared data sources)
    → PanelRenderer (recursive layout tree)
      → widget nodes → registry lookup → mount component
      → panel nodes → flex div (+ theme overrides) → recurse children
  → InputManager (already built, attaches to ActionBus)
```

## YAML Config: office.yml

```yaml
screen: office
route: /screen/office
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
  events:
    source: /api/v1/home/events
    refresh: 180

layout:
  direction: row
  gap: 1rem
  children:
    - direction: column
      basis: 25%
      shrink: 0
      gap: 0.5rem
      children:
        - widget: clock
          grow: 0
        - widget: weather
          grow: 0
          data: weather
        - widget: weather-forecast
          grow: 1
          data: weather
        - widget: entropy
          grow: 1
    - direction: column
      grow: 1
      gap: 0.5rem
      children:
        - widget: calendar
          grow: 2
          data: events
        - direction: row
          grow: 1
          gap: 0.5rem
          children:
            - widget: finance
              grow: 1
            - widget: health
              grow: 1
```

## Files

### Create

| File | Purpose |
|------|---------|
| `frontend/src/screen-framework/panels/PanelRenderer.jsx` | Recursive flex layout renderer |
| `frontend/src/screen-framework/panels/PanelRenderer.css` | Base panel styles using CSS custom properties |
| `frontend/src/screen-framework/data/ScreenDataProvider.jsx` | Shared data context + `useScreenData` hook |

### Modify

| File | Change |
|------|--------|
| `frontend/src/screen-framework/widgets/registry.js` | Simplify to name→component map, register dashboard widgets |
| `frontend/src/screen-framework/ScreenRenderer.jsx` | Swap GridLayout for PanelRenderer, add ScreenDataProvider |
| `frontend/src/modules/Weather/Weather.jsx` | Replace `weatherData` prop with `useScreenData('weather')` |
| `frontend/src/modules/Weather/WeatherForecast.jsx` | Same |
| `data/household/screens/office.yml` | Rewrite with recursive flex layout + data sources |

### Delete

| File | Reason |
|------|--------|
| `frontend/src/screen-framework/layouts/GridLayout.jsx` | Replaced by PanelRenderer |

### Untouched

- Clock, Upcoming, FinanceChart, Weight, EntropyPanel (self-contained, no changes)
- OfficeApp.jsx, TVApp.jsx, everything in `lib/OfficeApp/`
- Input system (ActionBus, adapters, InputManager)

## Widget Interface Contract

A screen-framework widget is a React component that:
1. Renders its own UI (no wrapper imposed)
2. Optionally calls `useScreenData(key)` to consume coordinated data
3. Otherwise manages its own data fetching internally

No base class, no HOC, no required props shape.

---

## Phase 4 Contract: Overlays & Subscriptions (Defined Now, Built Later)

### Two Types of Overlay Triggers

**Widget-internal** — A widget manages its own overlay lifecycle. Example: MenuStack pushes Player when a menu item is selected. This is the widget's concern — not declared in YAML.

**Screen-level subscriptions** — The screen declares which WebSocket topics it listens to and what response to trigger. This is the screen's concern — declared in YAML.

Widgets can also programmatically invoke any declared overlay via ActionBus: `dispatch('overlay:open', { overlay: 'piano' })`. This allows a menu item to trigger the same overlay that a hardware event triggers.

### Overlay Render Modes

- `fullscreen` — replaces the dashboard (Piano, Player launched from menu)
- `pip` — floats over the dashboard, doesn't interrupt (doorbell camera)
- `toast` — small notification, auto-dismisses, stackable (event notifications)

### Subscription Model

The screen YAML `subscriptions` section declares topic-scoped responses to WebSocket events:

```yaml
# office.yml
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
      inactivity: 30s

  doorbell:
    response:
      overlay: doorbell
      mode: pip
      position: top-right
    dismiss:
      timeout: 30s

  notification:
    response:
      overlay: toast
      mode: toast
      position: bottom-right
    dismiss:
      timeout: 5s
```

### Key Design Principles

1. **Screens subscribe, not components** — the screen decides which WS topics matter for this display
2. **Responses are scoped** — office subscribes to `midi`, TV might not
3. **Filter support** — `on:` can filter by event type within a topic (only `session_start`, not every MIDI note)
4. **Extensible beyond overlays** — future subscription responses could update widget data, change theme, trigger animations
5. **Widgets invoke freely** — any widget can `dispatch('overlay:open', ...)` to programmatically trigger a declared overlay without needing a subscription
6. **Priority** — `priority: high` allows an overlay to interrupt other active overlays (Piano interrupts Player)

### Overlay Registry

Overlay components are registered in the widget registry alongside dashboard widgets:

```
piano    → PianoVisualizer
doorbell → DoorbellPIP
toast    → ToastNotification
```

The registry is component-agnostic — it maps names to React components whether they render as dashboard panels or overlays. The `mode` in the subscription config determines how the framework renders them.
