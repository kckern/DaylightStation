# Screen Configuration Reference

Screen configs define room-based displays using YAML.

## Location

Configs are stored in the data mount:
```
{DAYLIGHT_DATA_PATH}/household/screens/*.yml
```

## Example Configuration

```yaml
# office.yml - Office dashboard screen
screen: office
route: /office
profile: dashboard
input:
  type: numpad
  keyboard_id: officekeypad

layout:
  type: grid
  columns: 2
  rows: 3
  gap: 1rem

widgets:
  clock:
    row: 1
    col: 1
  weather:
    row: 1
    col: 2
  calendar:
    row: 2
    col: 1
    colspan: 2
  finance:
    row: 3
    col: 1
  entropy:
    row: 3
    col: 2
```

## Config Fields

### Top-level

| Field | Required | Description |
|-------|----------|-------------|
| screen | Yes | Unique identifier |
| route | No | URL path (defaults to /screen/{id}) |
| profile | No | Base profile (dashboard, media-browser) |
| input | No | Input configuration object (see Input section) |
| layout | Yes | Layout configuration |
| widgets | Yes | Widget definitions |

### Layout

| Field | Description |
|-------|-------------|
| type | Layout engine: grid, regions, flex |
| columns | Number of columns (grid) |
| rows | Number of rows (grid) |
| gap | Gap between cells (CSS value) |
| template | Template name (regions) |

### Input

| Field | Required | Description |
|-------|----------|-------------|
| type | Yes | Adapter type: `numpad`, `remote`, `keyboard` |
| keyboard_id | Depends | Keymap ID for API lookup. Required for `numpad` and `remote`. |

Types:
- **numpad** — Fetches keymap from `/api/v1/home/keyboard/{keyboard_id}`, translates numpad keys to actions via the action map. Supports secondary fallback.
- **remote** — Same keymap fetch, but unmapped arrow/enter/escape keys fall through to navigation actions.
- **keyboard** — Dev fallback. Hardcoded: arrows → navigate, Enter → select, Escape → escape. No keymap fetch.

```yaml
# Office numpad
input:
  type: numpad
  keyboard_id: officekeypad

# TV remote
input:
  type: remote
  keyboard_id: tvremote
```

### Widgets

Each widget key is the widget name from the registry. Value can be:

**Shorthand (position only):**
```yaml
clock: { row: 1, col: 1 }
```

**Full config:**
```yaml
weather:
  row: 1
  col: 2
  source: /api/v1/home/weather  # Override default
  refresh: 30s                   # Override refresh
  on_tap: open_forecast          # Action override
```

## Available Widgets

| Name | Default Source | Description |
|------|---------------|-------------|
| clock | (local) | Flip clock display |
| weather | /api/v1/home/weather | Current weather |
| weather-forecast | /api/v1/home/weather | Weather forecast |
| calendar | /api/v1/calendar | Upcoming events |
| finance | /api/v1/finance/chart | Spending chart |
| entropy | /api/v1/entropy | Accountability nudges |
| health | /api/v1/health | Health metrics |
| menu | (configured) | Navigation menu |
| player | (actions) | Media player |
| art | /api/v1/art/featured | ArtMode framed-artwork screensaver/scene |

## Screensaver

A screen may declare a `screensaver:` block. The screensaver shows a widget as a
lowest-priority fullscreen overlay on boot (`showOnLoad`) and after inactivity
(`idle`), behind the menu — the splash / lock / ambient surface.

```yaml
screensaver:
  widget: art            # widget registry key (ArtMode is `art`)
  idle: 180              # seconds of inactivity before showing (0 = never)
  showOnLoad: true       # show immediately at boot
  interactive: true      # widget owns its own input + calls onExit (ArtMode does)
  preset: gallery-silent # ArtMode preset (resolved from artmode.yml)
```

For ArtMode, the screensaver references a **preset** by key instead of inlining
props. Presets live in `data/household/config/artmode.yml`; each bundles a
collection, optional music, and display options. The screens API expands
`screensaver.preset` into `screensaver.props` when it serves the config; an inline
`screensaver.props` block (if present) shallow-overrides the preset. The passive
screensaver is silent by convention (e.g. `gallery-silent` has `music: null`).

A screen with no `screensaver:` block has no passive screensaver — ad-hoc scenes
(below) still work.

## Triggering an ArtMode scene (any screen, any target)

ArtMode can be shown ad hoc — with music — by dispatching a **display** content
intent through the device load API:

```
GET /api/v1/device/<deviceId>/load?display=art:<preset>
```

This works on **any** screen (a `screensaver:` block is not required) and **any**
target, because delivery is transport-agnostic:

- **FullyKiosk** targets receive it as a `?display=art:<preset>` URL parameter
  (consumed by the screen's autoplay parser).
- **WebSocket** targets receive it as a structured `display` command on their topic
  (routed by the screen's command handler).

Both converge on a `display:content` action handled centrally by the screen's action
handler, which resolves the preset (`GET /api/v1/art/preset/<preset>`) and shows
ArtMode as a one-shot fullscreen scene. On exit it returns to the screen's normal
content; where a passive screensaver is configured, its idle timer resumes the
default afterward.

This is distinct from the passive `screensaver.preset` (idle/boot, silent): the
trigger is an explicit, on-demand presentation.
