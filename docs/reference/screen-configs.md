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
input: numpad

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
| input | No | Input mode (touch, remote, numpad, keyboard) |
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
