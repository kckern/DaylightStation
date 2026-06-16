# ArtMode Per-Screen Ambient Dimming — Design

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan

## Context

A follow-on to the ArtMode rework. ArtMode auto-dims to room light by subscribing to a
single hardcoded eventbus topic (`ambient`, fed by the kitchen illuminance sensors) and
mapping lux → dim with a curve carried in each preset. Every preset currently carries a
**byte-identical copy** of that one curve.

Triggering `display=art:kids` on the **office** TV exposed two problems:

1. **Wrong sensor.** Office ArtMode dims off the kitchen sensors, not the office.
2. **Wrong range.** The office sensor (`sensor.office_tv_nightlight_illuminance`) reads
   ~36 lx in normal light; the kitchen sensors read ~132–152 lx. The kitchen-tuned curve
   would dim the office to ~58% in ordinary light.

Both point to the same conclusion: the dim **curve** is a property of a *room/sensor*,
not of a *preset*. The fix makes ambient a **per-screen** concern.

## Approach (chosen)

Ambient config (which topic to listen on + how to map its lux to dim) moves to the
**screen config**. The backend produces lux **per zone**; each screen declares the zone
topic it consumes and the curve tuned to that zone's sensor. The same preset shown on
two screens then dims correctly for each room.

Rejected alternatives:
- **Backend computes dim** (curve in `ambient.yml`, broadcast `{lux, dim}`): purest SSOT
  but changes the broadcast contract, needs a REST seed for late-mounting ArtMode, and
  discards the tested frontend `luxToDim`.
- **Topic-only** (keep curves in presets): smallest change but office reuses the
  kitchen-tuned curve (over-dims) and leaves the curve duplicated across every preset.

## Components

### 1. Backend — multi-zone producer

`data/household/config/ambient.yml` gains a `zones:` list, each `{ topic, entities }`:

```yaml
zones:
  - topic: ambient            # kitchen — living-room screen
    entities:
      - sensor.kitchen_desk_nightlight_illuminance
      - sensor.kitchen_night_light_illuminance
  - topic: ambient:office     # office screen
    entities:
      - sensor.office_tv_nightlight_illuminance
```

**Backward compatibility:** if `zones` is absent but the legacy `illuminance:` block is
present, normalize it to a single zone `{ topic: illuminance.topic || 'ambient',
entities: illuminance.entities }`.

`app.mjs` reads/normalizes the zone list and starts **one `AmbientLightService` per
zone** that has entities. The existing single-zone `AmbientLightService` is reused
**unchanged** — each instance gets its own `{ entities, topic }` and its own HA
websocket. The service continues to broadcast **lux** (not dim) on its topic. Two HA
websocket connections is acceptable (HA pushes all `state_changed` events regardless;
each service filters by its `entities`).

Normalization lives in a small pure helper (e.g. `normalizeAmbientZones(config)`) so it
is unit-testable independent of HA/websocket wiring.

### 2. Screen config — owns the mapping

Each screen YAML gains an `ambient` block with the zone topic, an initial `defaultLux`,
and the curve tuned to that screen's sensor.

```yaml
# data/household/screens/office.yml  (sensor ~36lx in normal light → gentler curve)
ambient:
  topic: ambient:office
  defaultLux: 36
  curve:
    - { lux: 0,   dim: 0.90 }
    - { lux: 10,  dim: 0.60 }
    - { lux: 30,  dim: 0.32 }
    - { lux: 80,  dim: 0.15 }
    - { lux: 200, dim: 0.05 }

# data/household/screens/living-room.yml  (keeps today's kitchen-tuned curve)
ambient:
  topic: ambient
  defaultLux: 80
  curve:
    - { lux: 0,   dim: 0.92 }
    - { lux: 5,   dim: 0.85 }
    - { lux: 40,  dim: 0.55 }
    - { lux: 150, dim: 0.32 }
    - { lux: 400, dim: 0.15 }
```

The `/api/v1/screens/:id` endpoint already returns the full screen config object; the
`ambient` key passes through with no API change (verify during implementation).

### 3. Frontend — per-screen consumer

- `ScreenRenderer` wraps its rendered tree in a small `ScreenAmbientProvider` carrying
  `config.ambient` (or `null`). A `useScreenAmbient()` hook returns it.
- `ArtMode` resolves its ambient config in this order:
  **screen ambient (`useScreenAmbient()`) → preset `ambient` prop (legacy fallback) →
  none.** It subscribes via `useWebSocketSubscription([resolved.topic])` instead of the
  hardcoded `['ambient']`, and uses `resolved.curve` / `resolved.defaultLux` with the
  existing `luxToDim` mapping. When no ambient config resolves, ArtMode does not dim.
- Preset `ambient` blocks in `artmode.yml` become **legacy/optional** — left in place
  (harmless) but superseded by screen ambient. No mass preset edit required.

## Data flow

```
HA sensor (state_changed)
  → per-zone AmbientLightService (filters its entities, broadcasts lux on its topic)
  → eventbus topic  (e.g. "ambient:office")
  → office screen's ArtMode (subscribed to that topic via useScreenAmbient)
  → luxToDim(lux, officeCurve)
  → image dim overlay
```

## Error handling

- **No `ambient` block on a screen** → ArtMode falls back to the preset `ambient` prop;
  if that's also absent, no dimming. Screen never blanks.
- **Late-mounting ArtMode** — the eventbus does not replay last value for ambient topics
  (snapshot replay is device-state only). ArtMode starts at `luxToDim(defaultLux, curve)`
  and updates on the next lux change. Unchanged from today's behavior.
- **Empty/unresolved zone entities** → that zone's `AmbientLightService` logs
  `ambient.disabled` and no-ops (existing single-zone behavior).
- **Malformed `zones`** → `normalizeAmbientZones` drops zones without a topic or without
  a non-empty `entities` array (logged); other zones still start.

## Testing

**Backend (unit):**
- `normalizeAmbientZones`: a `zones` list passes through; a legacy `illuminance` block →
  one zone with `topic` (defaulting to `ambient`); a zone missing `topic` or with empty
  `entities` is dropped; empty/absent config → `[]`.
- app wiring: one `AmbientLightService` started per non-empty zone (assert via a stub
  service factory counting starts and the `{entities, topic}` passed to each).

**Frontend (unit):**
- `useScreenAmbient` returns the screen's `ambient` object (and `null` when absent).
- `ArtMode` subscribes to the **screen's** topic (e.g. `ambient:office`), not `ambient`,
  and applies the screen curve to a broadcast lux value.
- Fallback: with no screen ambient but a preset `ambient` prop, ArtMode uses the preset
  topic/curve; with neither, ArtMode renders without a dim overlay.

**Live (post-deploy):**
- `/api/v1/device/office-tv/load?display=art:kids` → office ArtMode dims off
  `ambient:office` as `sensor.office_tv_nightlight_illuminance` changes; living-room
  ArtMode still tracks the kitchen sensors on `ambient`.

## Out of scope

- Backend-computed dim / broadcast contract change (rejected above).
- A REST seed endpoint for ambient (initial value stays `defaultLux`-derived).
- Per-preset ambient overrides on top of per-screen (screen ambient is authoritative;
  preset ambient remains only as a legacy fallback).
- Removing the now-redundant `ambient` blocks from `artmode.yml` presets (left as
  harmless legacy; can be cleaned up later).

## Wrap-up

Ambient dimming becomes a clean producer/consumer split: `ambient.yml` zones map sensors
→ topics (backend producer); each screen config maps a topic → curve (frontend consumer).
The curve lives with the room it's tuned for, the office TV dims off its own sensor, and
the duplicated-across-presets curve stops being the source of truth.
