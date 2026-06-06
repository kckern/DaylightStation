# Garage Fan Trigger — Design

**Date:** 2026-06-06
**Status:** Approved design, pending implementation
**Author:** KC + Claude (brainstorming session)

## Goal

Turn on a Home Assistant smart-plug fan (`switch.garage_fan_plug_temp`) when someone
is working hard on a stationary bike in a warm garage. **Trigger-on only** — a
separate system owns turning it off. Must be **config-driven with minimal code**,
and must **abstract the machinery shared with the existing ambient-LED system**
rather than copy-pasting it.

## Conditions (all AND'd, re-evaluated on every RPM/HR update)

| Condition | Config key | Resolves to |
|---|---|---|
| Pedaling hard | `min_rpm: 30` | The fanned equipment's cadence sensor reads ≥ 30 RPM |
| Someone working hard | `min_hr_zone: warm` | **Any** active participant at HR-zone ≥ `warm` (HR ≥ 120) |
| Garage warm enough | `min_temp: 65` | HA `sensor.garage_temp_temperature` > 65°F |
| Action | `plug_entity` | `switch.turn_on` on `switch.garage_fan_plug_temp` |
| Off | — | **Out of scope** — separate deactivation system |

Decisions made during brainstorming:
- **Trigger site:** frontend-driven, piggybacking the ambient-LED path. RPM + HR
  zones already live together in `FitnessContext`; only garage temp is read on the
  backend from HA. Fires only while the session UI is live — which is exactly when
  someone is on the bike.
- **"Warm" scope:** *any* active participant in warm+, not specifically the bike
  rider. Avoids fragile bike→rider→HR-strap matching.

## Config (already present in `data/household/config/fitness.yml`)

The `fan:` block nests **under the equipment item**, tying the fan to that bike's
cadence sensor. The adapter scans `equipment[].fan` across **all** equipment, so
adding a fan to another bike later is config-only (zero code).

```yaml
equipment:
  - name: NiceDay
    id: niceday
    type: stationary_bike
    cadence: 7138
    fan:
      plug_entity: garage_fan_plug_temp      # normalized → switch.garage_fan_plug_temp
      temp_entity: garage_temp_temperature   # normalized → sensor.garage_temp_temperature
      min_temp: 65
      min_rpm: 30
      min_hr_zone: warm
```

Entity names are stored bare and prefixed in code, matching how `ambient_led.scenes`
already works (`garage_led_off` → `scene.garage_led_off`).

## Abstractions to extract

The point of this work is **not** to clone `AmbientLedAdapter`. Three things get
abstracted; everything else stays concrete (YAGNI — no general rules engine).

### 1. Backend: `HaActionGuard` (composition, not inheritance)

Both the LED and the fan wrap every Home Assistant call in the same guard rails:
throttle (min ms between calls), circuit breaker (failure backoff), dedup (don't
re-fire the same action), and metrics + a `getStatus()/reset()` shape for the
`/status` and `/reset` endpoints. Pull these into one small stateful helper class.
Each adapter **holds** a guard (no inheritance coupling); `GarageFanAdapter` stays
thin because the guard does the heavy lifting.

- New: `backend/src/1_adapters/fitness/HaActionGuard.mjs`
- `AmbientLedAdapter` keeps its LED-specific grace-period / zone→scene logic.

### 2. Frontend: `useFitnessStateSync`

`useZoneLedSync` is really "debounce + throttle + fire-and-forget POST + `sendBeacon`
on unload." Extract that into a generic hook parameterized by endpoint + payload
builder. `useZoneLedSync` and the new `useEquipmentFanSync` become ~10-line wrappers.

- New: `frontend/src/hooks/fitness/useFitnessStateSync.js`
- Refactor: `frontend/src/hooks/fitness/useZoneLedSync.js` → thin wrapper.

### 3. Config generalization

The adapter iterates `equipment[].fan`, not a hard-coded NiceDay. Multiple fans
supported with no code change.

### What stays concrete

The fan's actual condition (`rpm ≥ min_rpm AND any zone ≥ min_hr_zone AND temp >
min_temp`) lives plainly in `GarageFanAdapter`. No abstraction over arbitrary
conditions.

## Wire path

```
FitnessContext  →  useEquipmentFanSync (wraps useFitnessStateSync)
   POST /api/v1/fitness/equipment_fan
   { equipment:[{id:'niceday', rpm:72}], zones:[{zoneId,isActive}], sessionEnded, householdId }
      →  GarageFanAdapter.evaluate()
           for each equipment[].fan:
             rpm ≥ min_rpm ?               (from payload)
             any active zone ≥ warm ?      (rank zones[] vs config zone order)
             getState(sensor.garage_temp…) > min_temp ?
           all true AND not latched → guard.run(switch.turn_on) → latch
           sessionEnded → clear latch (re-arm next session)
```

## Backend adapter behaviors

- **Latch** keyed per `household:equipmentId`. Fires once per session; never turns
  off. `sessionEnded:true` clears the latch so the next session re-arms.
- **Temp read** happens only after RPM + zone already pass and we haven't fired yet,
  so HA `getState` calls are naturally bounded to a few per session — no polling.
- **Zone ranking** uses the `zones` list order (cool < active < warm < hot < fire),
  so a rider in *hot* also satisfies `min_hr_zone: warm`.
- **HA absent:** route 503s gracefully, adapter is null (mirrors LED).

## File inventory

**New:**
- `backend/src/1_adapters/fitness/HaActionGuard.mjs`
- `backend/src/1_adapters/fitness/GarageFanAdapter.mjs`
- `frontend/src/hooks/fitness/useFitnessStateSync.js`
- `frontend/src/hooks/fitness/useEquipmentFanSync.js`

**Modified:**
- `backend/src/0_system/bootstrap.mjs` — construct `GarageFanAdapter` when
  `haGateway` exists; export as `equipmentFanController`.
- `backend/src/4_api/v1/routers/fitness.mjs` — `POST /equipment_fan` (+ `/status`,
  `/reset`), wired to `equipmentFanController`.
- `frontend/src/context/FitnessContext.jsx` — add the payload memo + the
  `useEquipmentFanSync` call alongside the existing `useZoneLedSync`.
- `frontend/src/hooks/fitness/useZoneLedSync.js` — refactor to wrap
  `useFitnessStateSync`.
- `data/household/config/fitness.yml` — `fan:` block (already present).

**Reused as-is:**
- `HomeAssistantAdapter` — `getState()` for temp, `callService('switch','turn_on',…)`
  / `turnOn()` for the plug.

## Edge cases

- Equipment with no `fan` block → ignored.
- RPM device present but reading 0 (drawer ghost) → fails `min_rpm`, no fire
  (existing `rpmGhostFilter` already drops stray sensors upstream).
- Temp sensor unavailable / non-numeric state → treat as condition not met
  (fail-closed: don't fire), log a warning.
- Multiple participants → any one in warm+ satisfies the zone condition.
- Session ends mid-pedal → `sessionEnded:true` re-arms the latch; fan stays on
  (separate system turns it off).

## Testing

- **Unit (GarageFanAdapter):** condition matrix — each of rpm/zone/temp below vs.
  above threshold; latch fires once then suppresses; `sessionEnded` re-arms; temp
  sensor missing → no fire.
- **Unit (HaActionGuard):** throttle, circuit-breaker open/close, dedup.
- **Route:** `POST /equipment_fan` happy path + 503 when controller null.
- **Frontend:** `useFitnessStateSync` debounce/throttle/sendBeacon behavior
  (covers both LED and fan wrappers).

## Follow-ups (not in this change)

- Migrate `AmbientLedAdapter` onto `HaActionGuard` to shed ~80 lines of duplicated
  guard logic. Deferred to keep the working LED system untouched in this change.
