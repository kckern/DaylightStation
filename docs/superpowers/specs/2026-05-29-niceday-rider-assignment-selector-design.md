# NiceDay Rider Assignment via Cycling Selector — Design

**Date:** 2026-05-29
**Status:** Approved (design); ready for implementation plan
**Author:** KC Kern + Claude

## Problem

The NiceDay stationary bike in the garage knows *that* someone is pedalling (ANT+
cadence sensor `7138 → niceday`) but not *who*. Today, when a cycle challenge fires,
`GovernanceEngine` picks the rider automatically — `forceRiderId` if supplied, else a
random choice from the equipment's `eligible_users`. There is no way for the actual
person on the bike to identify themselves.

A Zigbee Tuya 4-button wireless scene switch ("Garage Cycling Selector", model
`TS0044_2`) is paired through zigbee2mqtt and publishes `{ "action": "N_single" }` to
`zigbee2mqtt-usb/Garage Cycling Selector` on button presses. Each button will carry a
physical sticker naming a specific rider. A rider sits down, presses their button, and
the system should know who is riding.

## Goals

- Let a rider claim the NiceDay bike with a physical button press.
- Make "who is on bike X right now" **first-class, general session state** — not welded
  to the challenge framework — so future cycling activities can read or subscribe to it.
- Feed the claimed rider into governance's cycle-rider selection.
- Surface the current rider in the UI (cycle overlay during a challenge; the bike's
  realtime RPM card always).

## Non-goals (v1)

- LED or audible confirmation feedback (visual only for v1).
- Idle/inactivity auto-expiry of a claim.
- Selectors for other bikes (config supports a list; none added beyond NiceDay).
- A "press your button to ride" prompt overlay — we use the existing random fallback
  when a challenge fires on an unclaimed bike instead.

## Concept

A session-scoped **equipment-rider claim**: a map `equipmentRider[equipmentId] = userId | null`
that records the current occupant of each cadence equipment. The Garage Cycling Selector
feeds it over MQTT; governance consumes it; the UI reflects it.

## Decisions (locked during brainstorming)

1. **Standing claim.** The bike always has a known occupant (or null). The press records
   durable session state, consulted whenever a rider is needed.
2. **Dedicated selector map.** A config block maps each button action → a specific userId
   (matching the physical stickers). The selector is **authoritative**: a claimed rider is
   used as the NiceDay rider even if absent from `eligible_users`.
3. **Null at session start.** No rider is assumed until a button is pressed.
4. **Null fallback at challenge time.** If a cycle challenge fires while the bike is
   unclaimed, governance falls back to today's behavior — random pick from
   `eligible_users`. A claim overrides that pick.
5. **Sticky + reassign + session reset.** A press sets the rider; a different press
   reassigns (last button owns the bike); the claim resets to null when the session
   ends / a new session starts. No idle expiry.
6. **Dedicated backend adapter.** A new `MQTTSelectorAdapter` modeled on the existing
   `MQTTBarcodeAdapter` (discrete-action device), keeping the vibration-focused
   `MQTTSensorAdapter` untouched.
7. **Visual-only feedback** for v1.
8. **UI scope:** governance consumption + cycle overlay rider avatar (existing) + the
   NiceDay's `RpmDeviceCard`/`RpmDeviceAvatar` showing the claimed rider live.

## Architecture

### Data model & lifecycle

- New state on `FitnessSession`: `equipmentRider` — `{ [equipmentId]: userId | null }`.
- Initialized empty (all null). Cleared on session start/end, alongside the existing
  vibration-tracker reset (`FitnessSession.js` ~L2370).
- A button press sets `equipmentRider[equipmentId] = userId`. A subsequent press for the
  same equipment (any button) reassigns to that user. No timeout-based clearing.
- The claim is **authoritative** — a claimed rider bypasses the `eligible_users`
  membership check. Base-requirement (HR-zone) gating still applies downstream as it does
  today; an unclaimed rider with no HR simply may fail base-req normally.

### Config — new `selectors:` block in `fitness.yml`

```yaml
selectors:
  - id: niceday_rider_selector
    mqtt_topic: "zigbee2mqtt-usb/Garage Cycling Selector"
    equipment: niceday
    buttons:                 # button action -> userId (per the physical stickers)
      "1_single": felix
      "2_single": milo
      "3_single": kckern
      "4_single": alan
```

The exact button→user mapping is set by KC to match the stickers. The block is a list,
so additional selectors/bikes can be added later without code changes.

### Backend — `MQTTSelectorAdapter` (new)

Location: `backend/src/1_adapters/hardware/mqtt-selector/` (`MQTTSelectorAdapter.mjs`,
`index.mjs`), mirroring the structure and reconnect/backoff behavior of
`backend/src/1_adapters/hardware/mqtt-barcode/`.

Responsibilities:

- Constructor `(config, options)` where `config = { host, port }` and
  `options = { selectors, onSelect, logger }`.
- Build a topic → selector map from `selectors` (topic, equipmentId, button map).
- Subscribe to each selector's `mqtt_topic` on connect.
- On message: `JSON.parse`, read `action`, look up `buttons[action]`. On a mapped
  single-press, fire `onSelect({ selectorId, equipmentId, userId, action })`.
- **Ignore:** unmapped actions (`*_double`, `*_hold`), the empty reset event
  (`action: ""`), JSON-parse failures, and messages on unknown topics.
- Standard `isConfigured()`, `init()`, `close()`, `getStatus()`.

### Backend wiring (`bootstrap.mjs` + `app.mjs`)

- `createHardwareAdapters` (`bootstrap.mjs`): construct a `selectorAdapter` next to
  `barcodeAdapter`, gated on the presence of `selectors`. Return it alongside the others.
- `app.mjs`: read `fitnessConfig.selectors`; pass into `createHardwareAdapters`; provide
  an `onSelect` callback that broadcasts:
  ```js
  broadcastEvent({ topic: 'rider_select', equipmentId, userId, action, selectorId });
  ```
  Initialize the adapter when `enableMqtt` is true (same gate as the sensor adapter).
- This reuses the existing MQTT → `broadcastEvent` → WebSocket path; no new transport.

### Frontend — ingestion

- `DeviceEventRouter._resolvePayloadType`: add
  `if (payload.topic === 'rider_select') return 'rider_select';`.
- Register a `rider_select` handler that calls `session.setEquipmentRider(equipmentId, userId)`
  and logs `fitness.rider.claimed` with `{ equipmentId, userId, action }`.

### Frontend — `FitnessSession`

- Add the `equipmentRider` map plus `setEquipmentRider(equipmentId, userId)` and
  `getEquipmentRider(equipmentId)`.
- `setEquipmentRider` updates state, logs, and marks the session dirty for re-render.
- Reset the map to empty on session start/end.
- Include an `equipmentRiderMap` in the inputs object built for `engine.evaluate()`,
  next to `equipmentCadenceMap` (`FitnessSession.js` ~L1976–1992).

### Frontend — `GovernanceEngine` rider selection (~L2448–2490)

- New precedence for cycle-rider selection:
  1. `forceRiderId` (explicit `triggerChallenge`/swap API) — unchanged, highest.
  2. `equipmentRiderMap[equipmentId]` — the standing claim, used as-is (bypasses
     `eligible_users` membership).
  3. Random pick from filtered `eligible_users` — today's behavior, the null fallback.
- **Live swap:** on each `evaluate()` tick, if there is an active cycle challenge whose
  `equipment` has a claim that differs from its current rider, reconcile via the existing
  `swapCycleRider(userId, { force: true })` — a physical press bypasses the per-user
  cooldown.
- The `CycleChallengeOverlay` requires no changes; it already renders `challenge.rider`,
  and the correct rider now flows in.

### Frontend — RPM avatar

- The live player renders RPM equipment in the `rpm-group` block of
  `FitnessUsers.jsx` using `@/modules/Fitness/components/RpmDeviceAvatar.jsx` (props
  `avatarSrc` / `avatarAlt`). When `equipmentRider[equipmentId]` is set, swap the avatar
  from the equipment image to the claimed rider's user avatar
  (`/static/img/users/{userId}`), live, even with no challenge active. Falls back to the
  equipment image when unclaimed (and via `fallbackSrc` if the user image 404s).

  > Note: supersedes an earlier draft that referenced `RealtimeCards/RpmDeviceCard` —
  > that component is not the live render path.

## Data flow

```
Tuya button press
  → zigbee2mqtt → MQTT topic "zigbee2mqtt-usb/Garage Cycling Selector"
  → MQTTSelectorAdapter (action -> {equipmentId, userId})
  → onSelect → broadcastEvent({ topic: 'rider_select', ... })
  → WebSocket
  → DeviceEventRouter (rider_select handler)
  → FitnessSession.setEquipmentRider(equipmentId, userId)
  → equipmentRiderMap in engine.evaluate() inputs
  → GovernanceEngine cycle-rider selection / live swap
  → CycleChallengeOverlay rider avatar + FitnessUsers rpm-group rider avatar
```

## Edge cases

- **Unmapped gestures** (`*_double`, `*_hold`) and the empty `action:""` reset event are
  ignored by the adapter.
- **Unknown equipment id** in a `rider_select` payload (config mismatch): the session
  stores it but nothing consumes it; log a warning on the frontend.
- **Claim for a non-eligible user:** allowed by design (claim is authoritative).
- **Multiple selectors / bikes:** supported by the list-shaped config; v1 ships one.
- **Reset boundary:** `equipmentRider` clears on new session start, satisfying the
  null-init requirement.

## Testing

### Backend (`MQTTSelectorAdapter` unit tests, mirroring barcode adapter tests)

- Mapped single-press → `onSelect` fired with `{ selectorId, equipmentId, userId, action }`.
- Unmapped action (`*_double`, `*_hold`) → no `onSelect`.
- Empty `action:""` reset event → no `onSelect`.
- Malformed / non-JSON payload → ignored, no throw.
- Message on an unconfigured topic → ignored.

### Frontend

- `DeviceEventRouter` routes a `rider_select` payload → `session.setEquipmentRider`.
- `FitnessSession`: set/get; reset to null on session start.
- `GovernanceEngine` (extends `CycleStateMachine.test.js`):
  - Claimed rider wins over random pick.
  - Null claim → random from `eligible_users` (existing behavior preserved).
  - Claimed rider used even when not in `eligible_users`.
  - Claim change mid-challenge → live force-swap (bypasses cooldown).

## Affected files (anticipated)

- `data/household/config/fitness.yml` — new `selectors:` block.
- `backend/src/1_adapters/hardware/mqtt-selector/MQTTSelectorAdapter.mjs` (new) + `index.mjs` (new).
- `backend/src/0_system/bootstrap.mjs` — construct selector adapter.
- `backend/src/app.mjs` — read selectors config, wire `onSelect` broadcast, init adapter.
- `frontend/src/hooks/fitness/DeviceEventRouter.js` — `rider_select` routing + handler.
- `frontend/src/hooks/fitness/FitnessSession.js` — `equipmentRider` state + reset + inputs.
- `frontend/src/hooks/fitness/GovernanceEngine.js` — rider-pick precedence + live swap.
- `frontend/src/modules/Fitness/player/panels/RealtimeCards/RpmDeviceCard.jsx` /
  `RpmDeviceAvatar.jsx` (+ panel wiring, e.g. `FitnessUsers.jsx`) — rider avatar.
- Tests: new backend adapter test; extensions to `CycleStateMachine.test.js` and
  `DeviceEventRouter` / `FitnessSession` tests.
