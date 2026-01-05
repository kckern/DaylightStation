# Ambient LED Fitness Zone Configuration Guide

This guide documents the configuration options for the Ambient LED feature, which syncs fitness heart rate zones with Home Assistant-controlled LED lights.

## Quick Start

Add the following to your household's fitness config (`data/households/{household_id}/apps/fitness/config.yml`):

```yaml
ambient_led:
  scenes:
    off: garage_led_off
    cool: garage_led_blue
    active: garage_led_green
    warm: garage_led_yellow
    hot: garage_led_orange
    fire: garage_led_red
    fire_all: garage_led_red_breathe
  throttle_ms: 2000
```

## Configuration Reference

### `ambient_led` Section

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `scenes` | object | Yes | - | Maps zone names to Home Assistant scene entity names |
| `throttle_ms` | number | No | 2000 | Minimum milliseconds between HA scene activations |

### `scenes` Object

| Key | Required | Description |
|-----|----------|-------------|
| `off` | **Yes** | Scene to activate when session ends or no active participants |
| `cool` | No | Scene for cool zone (<60% max HR) |
| `active` | No | Scene for active zone (60-70% max HR) |
| `warm` | No | Scene for warm zone (70-80% max HR) |
| `hot` | No | Scene for hot zone (80-90% max HR) |
| `fire` | No | Scene for fire zone (90%+ max HR) |
| `fire_all` | No | Scene when ALL active participants are in fire zone |

**Note:** The `off` scene is required. If other scenes are missing, they fall back to the next lower zone, ultimately to `off`.

### Scene Fallback Chain

When a zone scene is not configured, the system falls back through this chain:

```
fire_all → fire → hot → warm → active → cool → off
```

Example: If you only configure `off` and `fire`:
- cool, active, warm, hot zones → `off` scene
- fire zone → `fire` scene
- all-fire condition → `fire` scene (since `fire_all` not configured)

## Zone Mapping

| Zone | Heart Rate | LED Color | Trigger |
|------|------------|-----------|---------|
| Off | - | Off | Session ended or no active participants |
| Cool | <60% | Blue | Recovery, warmup |
| Active | 60-70% | Green | Fat burn zone |
| Warm | 70-80% | Yellow | Cardio zone |
| Hot | 80-90% | Orange | Threshold zone |
| Fire | 90%+ | Red | Max effort |
| Fire All | All users 90%+ | Red (breathing) | Special effect when everyone is maxed |

## Multi-User Behavior

When multiple users are active:
- **Max Zone Wins**: The highest zone among all active participants is displayed
- **All-Fire Special**: When every active participant is in the fire zone, triggers the breathing effect

Example with 3 users:
- User A: warm (70%)
- User B: hot (85%)
- User C: cool (55%)
- **Result**: Orange LED (hot zone - the maximum)

## Feature Toggle

The feature is automatically **disabled** if:
- `ambient_led` section is missing from config
- `ambient_led.scenes` is missing or empty
- `ambient_led.scenes.off` is not configured

This makes it safe to deploy to households without Home Assistant integration.

## Home Assistant Requirements

### Scene Setup

Create scenes in Home Assistant for each LED state. Example `scenes.yaml`:

```yaml
- name: "Garage LED Off"
  entities:
    light.garage_led_strip:
      state: "off"

- name: "Garage LED Blue"
  entities:
    light.garage_led_strip:
      state: "on"
      brightness: 255
      rgb_color: [0, 100, 255]

- name: "Garage LED Green"
  entities:
    light.garage_led_strip:
      state: "on"
      brightness: 255
      rgb_color: [0, 255, 100]

- name: "Garage LED Yellow"
  entities:
    light.garage_led_strip:
      state: "on"
      brightness: 255
      rgb_color: [255, 255, 0]

- name: "Garage LED Orange"
  entities:
    light.garage_led_strip:
      state: "on"
      brightness: 255
      rgb_color: [255, 150, 0]

- name: "Garage LED Red"
  entities:
    light.garage_led_strip:
      state: "on"
      brightness: 255
      rgb_color: [255, 0, 0]

- name: "Garage LED Red Breathe"
  entities:
    light.garage_led_strip:
      state: "on"
      brightness: 255
      rgb_color: [255, 0, 0]
      effect: "Breathe"
```

### Environment Variables

Ensure these are set in your DaylightStation environment:

```yaml
HOME_ASSISTANT_TOKEN: "your_long_lived_access_token"
home_assistant:
  host: "http://homeassistant.local"
  port: 8123
```

## API Endpoints

### Check Status
```bash
GET /fitness/zone_led/status?householdId=default
```

Response:
```json
{
  "enabled": true,
  "scenes": { "off": "garage_led_off", ... },
  "throttleMs": 2000,
  "state": {
    "lastScene": "garage_led_yellow",
    "lastActivatedAt": 1735123456789,
    "failureCount": 0,
    "backoffUntil": 0,
    "isInBackoff": false
  }
}
```

### View Metrics
```bash
GET /fitness/zone_led/metrics
```

Response:
```json
{
  "uptime": { "ms": 3600000, "formatted": "1h 0m" },
  "totals": {
    "requests": 150,
    "activated": 45,
    "failures": 0
  },
  "skipped": {
    "duplicate": 80,
    "rateLimited": 25
  },
  "sceneHistogram": {
    "garage_led_blue": 10,
    "garage_led_yellow": 20
  }
}
```

### Reset Circuit Breaker
```bash
POST /fitness/zone_led/reset
```

Use this after fixing Home Assistant connectivity issues.

## Example Configurations

### Minimal (Only On/Off)
```yaml
ambient_led:
  scenes:
    off: led_strip_off
    fire: led_strip_red
```

### Full Color Gradient
```yaml
ambient_led:
  scenes:
    off: fitness_led_off
    cool: fitness_led_blue
    active: fitness_led_green
    warm: fitness_led_yellow
    hot: fitness_led_orange
    fire: fitness_led_red
    fire_all: fitness_led_rainbow
  throttle_ms: 1500
```

### Multiple Light Groups
```yaml
# Use scenes that control multiple lights
ambient_led:
  scenes:
    off: gym_lights_off
    cool: gym_lights_cool
    active: gym_lights_active
    warm: gym_lights_warm
    hot: gym_lights_hot
    fire: gym_lights_fire
    fire_all: gym_lights_party_mode
```

## Related Documentation

- [Ambient LED Fitness Zones PRD](./ambient-led-fitness-zones-prd.md)
- [Troubleshooting Guide](./ambient-led-troubleshooting.md)
- [Home Assistant API Reference](https://developers.home-assistant.io/docs/api/rest/)
