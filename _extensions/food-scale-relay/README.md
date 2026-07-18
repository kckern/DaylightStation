# food-scale-relay — BLE kitchen scale → DaylightStation event bus

An **M5Stack ATOM Lite** (ESP32-PICO-D4) BLE-bridges a **KitchenIQ 50797**
(SENSSUN FOOD) kitchen scale and streams decoded weight + button events over
**WebSocket** to the DaylightStation backend event bus (`/ws`). The backend
re-broadcasts the `food-scale` topic and persists settled measurements +
button-captured weights.

No host daemon — this is **firmware only**, config-driven from the household
SSOT (`data/household/config/scales.yml`). Nothing is hardcoded.

```
BLE scale ──BLE notify(FFB2)──▶ ATOM Lite ──WS /ws──▶ backend event bus
                                   │ button GPIO39      │ broadcast('food-scale')
                                   └────────────────────┘   ├─▶ apps (live)
                                                             └─▶ history/nutrition/<scale-id>/
```

## Scale protocol (verified)

`SENSSUN FOOD`, service `0xFFB0`, notify char **`0xFFB2`** streams ~4 Hz on its own.
10-byte frame: `FF A5 | weight(uint16 BE) | mirror | b6 | b7 | unit(b8) | checksum`.
Weight = grams (÷1); b6 `0xAA`=settled/`0xA0`=changing; b8 `0x00`=g/`0x02`=ml;
checksum = `sum(b2..b8) & 0xFF`. Full write-up:
`docs/plans/2026-07-10-food-scale-relay-design.md`.

## Messages sent to the bus

```json
{"source":"food-scale-relay","type":"scale","id":"kitchen-food-scale","grams":240,"stable":true,"unit":"g","ts":123}
{"source":"food-scale-relay","type":"button","id":"kitchen-food-scale","press":"short","ts":123}
```

Backend dispatch (`backend/src/3_applications/hardware/foodScaleRelay.mjs`, wired
in `app.mjs`) rebroadcasts these on `food-scale` and persists two record kinds:

- **settled readings** — a stable, non-empty weight, logged once and not repeated
  until it changes (`dedupDeltaG`) or the pan is emptied (`emptyThresholdG`). This
  stops the scale resting on its side on the shelf from re-logging the same load
  on every BLE reconnect.
- **button presses** — force-capture the live weight at that instant, settled or
  not. Pressing the button is the explicit "log this now" gesture, so the record
  carries `grams`/`unit`/`stable` from the moment of the press.

## Nutribot integration

A second, independent consumer of the `food-scale` topic
(`backend/src/3_applications/hardware/ScaleNutribotBridge.mjs`) turns weights into
Telegram density-logging prompts for the household head. Two paths:

- **AUTO** — the scale never returns to ~0 (it rests at a variable load on the shelf),
  so the bridge learns that resting load as a **baseline** and pushes a **new prompt for
  every distinct settled value that rises above it**. Re-settles within
  `baseline_tolerance_g` are suppressed (jostle); a settle back near/below baseline ends
  the session and re-learns the resting load, so the next placement pushes fresh.
  **Weights never expire** — a prompt waits until you answer it. The one unavoidable cost
  of not having an orientation sensor: flipping the scale onto its shelf looks like a
  placement, so it emits **one** stray prompt (just ignore it — it is not repeated).
- **FORCE** — an **ESP button press logs the live weight right now**, bypassing the
  baseline/dedup gates entirely. This is the reliable manual override for anything the
  auto heuristic would miss or mis-gate (a small item, a load that never rose far above
  the resting baseline, etc.).

Tuning knobs live in the `nutribot:` block of `scales.yml` (see
[`config.example.yml`](config.example.yml)); the persistence arm above is decoupled and
records to disk regardless.

## Build & flash

Prereqs: PlatformIO (`pio`), Node, the SM ATOM on USB (FTDI `/dev/cu.usbserial-*`).

```bash
cd firmware
# one shot: gen config from SSOT, build, upload (autodetects port)
node tools/flash.mjs "$DAYLIGHT_BASE_PATH/data/household/config/scales.yml" kitchen-food-scale

# or step by step
node tools/gen-config.mjs "$DAYLIGHT_BASE_PATH/data/household/config/scales.yml" kitchen-food-scale
pio run -e m5-atom -t upload --upload-port /dev/cu.usbserial-XXXX
pio device monitor -b 115200        # watch [wifi]/[ble]/[ws] logs
```

## Status LED (onboard SK6812, GPIO27)

| Color | Meaning |
|-------|---------|
| red | no Wi-Fi |
| blue | Wi-Fi ok, no scale |
| amber | scale ok, no event bus |
| green | streaming |
| purple flash | button press sent |

## Config — `data/household/config/scales.yml`

Keyed by scale id (plural, so a second scale is just another key + another ATOM).
Holds Wi-Fi creds, backend host/port, and per-scale BLE target + decode params.
Schema/example: [`config.example.yml`](config.example.yml). The generated
`firmware/include/config.h` is gitignored.
