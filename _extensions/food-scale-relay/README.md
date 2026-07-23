# food-scale-relay — shared BLE kitchen scale + content barcode gateway

An **M5Stack ATOM Lite** (ESP32-PICO-D4) BLE-bridges a **KitchenIQ 50797**
(SENSSUN FOOD) kitchen scale and streams decoded weight + button events over
**WebSocket** to the DaylightStation backend event bus (`/ws`). When configured,
the same ATOM also hosts a barcode scanner and emits barcode events. The backend
re-broadcasts scale and barcode topics independently.

Two different scanners, two different transports — do not confuse them:

| Scanner | Transport | Role | Used for |
|---------|-----------|------|----------|
| Zebra **DS6878** | **Classic BT SPP**, scanner is Master and dials the ATOM | ATOM is the SPP *acceptor* | nutrition / `nutribot` |
| Zebra DS2278 | BLE HID (HOGP) | ATOM is the HID host | content barcodes |

No host daemon — this is **firmware only**, config-driven from the household
SSOT (`data/household/config/scales.yml`). Nothing is hardcoded.

```
BLE scale ──BLE notify(FFB2)──▶ ATOM Lite ──WS /ws──▶ backend event bus
                                   │ button GPIO39      │ broadcast('food-scale')
DS6878 ────Classic BT SPP─────────▶│                    │ broadcast('barcode-relay')
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

- **AUTO** — a settled rise above the learned resting load posts **one** prompt that
  then **edits in place** as the weight climbs (no message pile-up). Answering it frees
  it, so the next load starts fresh. Returning near the resting load ends the session and
  **retracts** an unanswered prompt (no leftover slop). A placement is **suppressed** when
  it looks like putting the scale away — it lands in the configured `storage_weight_g`
  band, or it's a `heavy_g`+ jump right after a burst of recent posts. Weights never
  expire.
- **FORCE** — an **ESP button press** logs the live weight now, **bypassing the suspicion
  filter**. It no-ops when a live prompt already covers ~this weight (no duplicate), so
  it's purely the override for anything auto suppressed or mis-gated.

Tuning knobs live in the `nutribot:` block of `scales.yml` (see
[`config.example.yml`](config.example.yml)); the persistence arm above is decoupled and
records to disk regardless.

## DS6878 scanner — pairing (Classic BT SPP)

The scanner is the **SPP Master**: it dials the ATOM's Classic BT MAC, which is
printed at boot (`[classic-spp] our BT MAC …`) and exposed at `/status` as
`barcode.host_bt_mac`. The ATOM only listens; there is no host-initiated connect.

**Pairing is a scanner-side operation and needs three bar codes, in order:**

1. **Set Factory Defaults** — DS6878 Product Reference Guide p.5-5
2. **Serial Port Profile (Master)** — PRG p.4-5 (*not* "Serial Port (Slave)")
3. **Pairing** — `<Fnc3>B<12-hex-MAC>`, PRG p.4-25; generate with
   `firmware/tools/gen-pairing-barcode.py` for the MAC above

Success = a LOW-then-HIGH beep pair, `/status` showing `barcode.connected: true`
and `bonds: 1`, and a test scan incrementing `scan_count`.

> **Step 1 is not optional.** The scanner persists pairing state that the PRG's
> "Unpairing" bar code does not clear. In that state it connects, completes SDP,
> requests a link key, and then **refuses to bond** when told we have none —
> tearing the ACL down in ~200 ms with HCI `0x13`. It looks exactly like a
> firmware fault and is not one: the ESP answers SDP correctly and replies
> `Link_Key_Request_Negative_Reply` correctly. Only a factory reset clears it.
> (Diagnosed 2026-07-22 after ~25 failed attempts; the factory reset fixed it on
> the first try.) A factory reset also reverts the host type to *Cradle Host*,
> which is why step 2 must follow it.

The bond persists in NVS: it survives power cycles **and reflashes**, and the
scanner reconnects on its own within seconds of boot. Re-pairing is a one-time
operation, not part of normal ops.

> **Leave `barcode.auto_escalate` off.** The escalation ladder calls
> `classicUnbond()` at a fail streak of 3 (`main.cpp`, `noteClassicFailure`),
> so three transient RF failures would delete a working bond and force a manual
> re-pair. It was built to search for a pairing config back when the config was
> the suspect; it isn't, and the search is now purely destructive.

## HTTP control plane

Ops without a USB cable. Base `http://<atom-ip>/`.

| Endpoint | Effect |
|---|---|
| `GET /status` | Full state: wifi, ws, scale, barcode, `recent_logs` ring |
| `GET /reboot` | Remote restart |
| `GET /ble/scan?on=0\|1` | Silence the BLE scale scan (**not** persisted) |
| `GET /barcode/unbond` | Drop link keys — forces a full re-pair, see warning above |
| `GET /barcode/profile?n=0\|1\|2` | Pairing profile; `0` = the working default |
| `GET /barcode/auto?on=0\|1` | Automatic escalation — keep `0` |
| `GET /barcode/trace[?clear=1]` | Bluedroid stack trace of the last failed Classic attempt |
| `GET /barcode/tracefilter?v=…` | Substring filter for the trace ring (e.g. `btm_sec`) |
| `GET /barcode/{cod,name,srvname,scn,dip}` | Identity knobs, persisted in NVS |

## Radio arbitration

One antenna, three consumers (WiFi, BLE scale, Classic scanner). `classicHoldsRadio()`
hands it to Classic for `CLASSIC_RADIO_HOLD_MS` after every ACL event, and the BLE
scale scan pauses for that window — pairing is the timing-sensitive phase and a
continuous BLE scan has been observed wrecking it.

An **established** SPP session deliberately does *not* hold the radio. It used to,
which was invisible while the link never survived; once the scanner stayed
connected it suppressed the scale scan permanently, and since the scale powers
itself off between uses and must be re-discovered by scanning, that killed the
scale half of the relay. Don't reinstate it.

## Build & flash

Prereqs: PlatformIO (`pio`), Node, the ATOM on USB (FTDI `/dev/cu.usbserial-*`).

```bash
cd firmware
# one shot: gen config from SSOT, build, upload (autodetects port)
node tools/flash.mjs "$DAYLIGHT_BASE_PATH/data/household/config/scales.yml" kitchen-food-scale

# or step by step
node tools/gen-config.mjs "$DAYLIGHT_BASE_PATH/data/household/config/scales.yml" kitchen-food-scale
pio run -e m5-atom-idf5 -t upload --upload-port /dev/cu.usbserial-XXXX
```

`m5-atom-idf5` (ESP-IDF 5.x) is the environment that ships. `m5-atom` is the older
IDF 4.4 build, kept but stale — it has none of the Classic SPP work.

> Do **not** hold the serial port open to watch logs while debugging Classic BT.
> Opening *or* closing `/dev/cu.usbserial-*` toggles DTR and resets the ESP32,
> which wipes the in-RAM trace ring. Use `/status` and `/barcode/trace` over HTTP
> instead — that is what they exist for.

## Status LED

Event-only lighting: the LED stays dark during idle/connection monitoring and
briefly flashes when a scale reading, button press, or barcode scan is emitted.

| Color | Meaning |
|-------|---------|
| red | no Wi-Fi |
| blue | Wi-Fi ok, no scale |
| amber | scale ok, no event bus |
| green | streaming |
| purple flash | button press sent |

## Config — `data/household/config/scales.yml`

Keyed by scale id (plural, so a second scale is just another key + another ATOM).
Each scale entry may also contain a `barcode:` target; that scanner shares the
same ATOM and BLE controller. The content-barcode use case is documented in
[`../content-barcode-relay`](../content-barcode-relay).
Schema/example: [`config.example.yml`](config.example.yml). The generated
`firmware/include/config.h` is gitignored.
