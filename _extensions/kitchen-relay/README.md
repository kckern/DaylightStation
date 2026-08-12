# kitchen-relay — BLE kitchen scale + barcode scanner on one ATOM

An **M5Stack ATOM Lite** (ESP32-PICO-D4) that hosts both kitchen BLE peripherals
and streams everything to the DaylightStation event bus over **WebSocket** (`/ws`):

| Peripheral | Link | What it sends |
|---|---|---|
| **KitchenIQ 50797** (SENSSUN FOOD) scale | BLE notify on `0xFFB2` | weight + button events |
| **Zebra DS2278** in *HID Bluetooth Low Energy (Discoverable)* | BLE HID (HOGP), ATOM is central | barcode scans |

```
BLE scale ──notify(FFB2)──▶┐
                           ├─ ATOM Lite ──WS /ws──▶ backend ──┬─▶ food-scale     topic
DS2278 ────BLE HID/HOGP───▶┘   │ button GPIO39                └─▶ barcode-relay  topic
                                                                    ├─▶ apps (live)
                                                                    └─▶ history/nutrition/<scale-id>/
```

No host daemon — **firmware only**, config-driven from the household SSOT
(`data/household/config/scales.yml`). Nothing is hardcoded.

> **Both peripherals are LE, and that is the whole design.** This board briefly
> split in two (2026-07-23 → 2026-07-28) because the *previous* scanner, a Zebra
> **DS6878**, was Classic BT: one ESP32 cannot run BLE discovery while holding a
> Classic link — it dies with HCI `0x08` (supervision timeout), measured
> repeatedly. The DS2278 is LE, so the scale and the scanner are two LE
> connections sharing the LE scheduler and the contention never arises. Do not
> reintroduce Classic BT here — NimBLE supports none of it, and the Bluedroid
> stack that does is mutually exclusive with NimBLE (one BLE stack per binary).
> The retired Classic board is recorded in
> [`docs/_archive/deleted-extensions.md`](../../docs/_archive/deleted-extensions.md).

## Messages sent to the bus

**One `source`, three `type`s.** The backend discriminates on `type`:
`foodScaleRelay.mjs` claims `scale`/`button`, `barcodeRelay.mjs` claims `scan`.

```json
{"source":"kitchen-relay","type":"scale","id":"kitchen-food-scale","grams":240,"stable":true,"unit":"g","ts":123}
{"source":"kitchen-relay","type":"button","id":"kitchen-food-scale","press":"short","ts":123}
{"source":"kitchen-relay","type":"scan","device":"nutribot-upc","route":"nutribot","code":"012345678905","ts":123}
```

Both handlers **also** accept the legacy per-board sources (`food-scale-relay`,
`barcode-relay`), which is what keeps
[`../content-barcode-relay`](../content-barcode-relay) working unchanged. What
apps subscribe to is unaffected: the re-broadcast topics are still `food-scale`
and `barcode-relay`.

> **DEPLOY THE BACKEND BEFORE YOU FLASH.** The legacy acceptance makes the
> *backend* safe to deploy early — it keeps serving the old firmware — but it
> does nothing in the other direction. A board flashed with this firmware emits
> `kitchen-relay`, and a backend that predates the change matches no handler, so
> every reading and every scan is dropped **silently**: the WebSocket connects,
> `/status` shows `ws.connected: true` and `scan_count` climbing, and nothing
> reaches the bus. Verified the hard way on 2026-07-29.

## Scale protocol (verified)

`SENSSUN FOOD`, service `0xFFB0`, notify char **`0xFFB2`** streams ~4 Hz on its own.
10-byte frame: `FF A5 | weight(uint16 BE) | mirror | b6 | b7 | unit(b8) | checksum`.
Weight = grams (÷1); b6 `0xAA`=settled/`0xA0`=changing; b8 `0x00`=g/`0x02`=ml;
checksum = `sum(b2..b8) & 0xFF`. Full write-up:
`docs/plans/2026-07-10-food-scale-relay-design.md`.

Backend dispatch (`backend/src/3_applications/hardware/foodScaleRelay.mjs`)
rebroadcasts and persists two record kinds:

- **settled readings** — a stable, non-empty weight, logged once and not repeated
  until it changes (`dedupDeltaG`) or the pan is emptied (`emptyThresholdG`). This
  stops the scale resting on its side on the shelf from re-logging the same load
  on every BLE reconnect.
- **button presses** — force-capture the live weight at that instant, settled or
  not. Pressing the button is the explicit "log this now" gesture.

## Nutribot integration

A second, independent consumer of the `food-scale` topic
(`backend/src/3_applications/hardware/ScaleNutribotBridge.mjs`) turns weights into
Telegram density-logging prompts for the household head. Two paths:

- **AUTO** — a settled rise above the learned resting load posts **one** prompt that
  then **edits in place** as the weight climbs. Answering it frees it. Returning near
  the resting load ends the session and **retracts** an unanswered prompt. A placement
  is **suppressed** when it looks like putting the scale away — it lands in the
  configured `storage_weight_g` band, or it's a `heavy_g`+ jump right after a burst of
  recent posts. Weights never expire.
- **FORCE** — an **ESP button press** logs the live weight now, **bypassing the
  suspicion filter**. It no-ops when a live prompt already covers ~this weight.

Tuning knobs live in the `nutribot:` block of `scales.yml`; the persistence arm is
decoupled and records to disk regardless.

## The scanner

### Quick reference — print this

**[`ds2278-quick-reference.pdf`](./ds2278-quick-reference.pdf)** (also
[`.svg`](./ds2278-quick-reference.svg)) is a one-page sheet with every bar code
you need — re-bond, discoverable mode, beeper volume, factory reset — in the
order you actually scan them. Scan them straight off the page or a screen.

Everything on it except the beeper-volume trio is **vector artwork clipped
directly out of** the DS2278 Product Reference Guide (MN-002915), so no bug in
the generator can emit a bar code that means something other than its caption.
The volume bar codes are bitmaps in the guide (141×32 px); those three are
decoded, mod-103-checksum-verified, and re-drawn as vector, and the generator
hard-fails unless re-encoding reproduces the guide's own module widths exactly.

Regenerate with `python3 tools/gen-ds2278-reference.py <ds2278-prg-en.pdf>`
(needs `pymupdf` + `pillow`; the guide itself is not in the repo).

### Re-bonding after moving the gun to a different board

**A BLE bond does not transfer between relay boards.** LE Secure Connections
stores a Long Term Key on *both* ends, and the scanner's copy is keyed to the
central's identity address. A different ATOM is a different address, so the
scanner has no bond for it — the old board's NVS keeps the only copy.

The ladder, cheapest first. Stop as soon as `/status` shows
`barcode.connected: true`:

1. **Just power the new board up.** With `barcode.mac` pinned the relay connects
   by address and attempts a fresh bond (Just Works, io-cap NONE). This may be
   all it takes. **Power the OLD board down first** — otherwise both boards chase
   the same MAC and whichever wins holds the gun.
2. **Clear the relay's side:** `curl http://<relay-ip>/barcode/unbond`, then
   reboot. Rules out a stale bond in the *new* board's NVS. (The 3 s button hold
   does the same thing without a laptop.)
3. **Scan `[1] Unpairing`, then `[2] HID Bluetooth Low Energy (Discoverable)`**
   from the quick-reference sheet. This is the scanner-side reset — it drops the
   old host and puts the gun back into advertising BLE-HID mode.
4. **Last resort: `Set Factory Defaults`, then `[2]` again.** A factory reset
   reverts the host type, so re-scanning `[2]` is mandatory or the relay will
   never see it.

> **Never scan "HID Bluetooth Classic."** It sits immediately above the LE bar
> code in the guide (PRG 6-6) and is the easiest mis-scan to make. It moves the
> gun to Classic BT, which this NimBLE firmware cannot see at all — the symptom
> is a scanner that beeps happily and a relay that reports nothing.

Prior art worth respecting: the DS6878 held pairing state that its own
"Unpairing" bar code did not clear, and only a factory reset fixed it — after
~25 failed attempts that looked exactly like a firmware fault. If step 3 doesn't
take, go to step 4 rather than assuming the firmware is broken.

### A pinned MAC is authoritative

With `barcode.mac` set, the scan callback matches on **address alone**. It used
to fall through to `|| advertises 0x1812 || name contains DS2278`, which meant
pinning the address bought nothing — the first stray BLE keyboard in range was
adopted and then locked the real scanner out. Leave `mac: ""` only for bring-up
before the LE address is known; `gen-config.mjs` prints a warning when you do.

## HTTP control plane

Ops without a USB cable. Base `http://<atom-ip>/`.

| Endpoint | Effect |
|---|---|
| `GET /status` (or `/`) | Full state: wifi, ws, scale, barcode, `recent_logs` ring |
| `GET /reboot` | Remote restart |
| `GET /ble/scan?on=0\|1` | Silence the BLE scale scan (**not** persisted) |
| `GET /barcode/disconnect` | Drop the HID link; it re-connects on the next scan sweep |
| `GET /barcode/unbond` | Forget BLE bonds — forces a fresh pairing |
| `POST /simulate/scale`, `POST /simulate/barcode` | Inject a fake reading/scan end-to-end |

`barcode.connected`, `barcode.bonded` and `barcode.streams` are the three fields
that matter when the scanner is misbehaving. `streams: 0` while connected means
the HID subscribe failed — the gun streams on the **boot** keyboard report
(`0x2A22`), not only the report characteristic (`0x2A4D`), so the firmware
subscribes to both.

## Build & flash

Prereqs: PlatformIO (`pio`), Node, the ATOM on USB (FTDI `/dev/cu.usbserial-*`).

```bash
cd firmware
# one shot: gen config from SSOT, build, upload (autodetects port)
node tools/flash.mjs "$DAYLIGHT_BASE_PATH/data/household/config/scales.yml" kitchen-food-scale

# or step by step
node tools/gen-config.mjs "$DAYLIGHT_BASE_PATH/data/household/config/scales.yml" kitchen-food-scale
pio run -e m5-atom -t upload --upload-port /dev/cu.usbserial-XXXX
```

`m5-atom` is the **only** environment. `platform = espressif32@6.5.0` is pinned
because NimBLE-Arduino 1.4.x needs Arduino core 2.x — newer platforms pull core
3.x and NimBLE faults at `esp_bt_controller_init` (`INVALID_STATE`).
`upload_speed=115200` (the FTDI link corrupts at high baud),
`huge_app.csv` partitions. Free the port first if held:
`kill $(lsof -t /dev/cu.usbserial-*)`.

> Do **not** hold the serial port open to watch logs while debugging. Opening
> *or* closing `/dev/cu.usbserial-*` toggles DTR and resets the ESP32, which
> wipes the in-RAM log ring. Use `/status` over HTTP — that is what it exists for.

## Is it alive? (staleness alert)

The board sat dark from **2026-07-31 19:43 to 2026-08-12** — twelve days — and
nobody noticed, because nothing watches it. The relays are pass-throughs: the
~0.5 Hz heartbeat is broadcast on the bus and dropped (`foodScaleRelay.mjs`,
"the raw ~4 Hz stream stays ephemeral on the bus"), no `lastSeen` is kept, and
`docker logs` resets at container start. A dead board is visible only as history
that stopped being written.

`backend/src/3_applications/hardware/relayWatchdog.mjs` closes that gap: it
watches `onClientMessage` for frames carrying `source: kitchen-relay`, and if
none arrive for **12 h** it sends one high-urgency `system` notification (which
routes to Telegram — see `DEFAULT_PREFERENCES` in
`5_composition/modules/notifications.mjs`). It alerts **once per outage** and
re-arms when frames resume. Wired in `app.mjs` as the scheduler job
`hardware:relay-watchdog` (`*/30 * * * *`).

### The hello frame (flash required)

The firmware now sends `{"source":"kitchen-relay","type":"hello",…}` on every WS
connect and then every 60 s. Both relay handlers ignore it (`barcodeRelay` wants
`type === 'scan'`, `foodScaleRelay` wants `scale`/`button`), so it exists purely
so that **"no frames" means "no board"** — before it, the board sent nothing at
all while its BLE scale was switched off, and a healthy relay was
indistinguishable from a dead one. It is never queued: a flushed hello would
claim the board was alive minutes after it died.

It also carries the post-mortem (`boot_count`, `last_reset`, `free_heap`,
`min_heap`, `rssi`). The watchdog logs `relay_watchdog.boot` when the boot
counter moves — once per reboot, not once per heartbeat.

> **Until this build is actually flashed, the 12 h threshold stands.** Tightening
> it to ~1 h is the payoff for the flash, and doing it early would cry wolf every
> evening the scale is put away. Same reason the OBD relay (gone for days) and
> the OMR relay (used a few times a term) stay unwatched: once they send hellos
> too, they can opt in.

### Post-mortem: why did it die?

`GET /status` now answers this, under `boot`:

| Field | Meaning |
|---|---|
| `boot.count` | NVS counter, survives reboots |
| `boot.last_reset` | `TASK_WDT` = loop() wedged and the watchdog recovered it · `BROWNOUT` = the supply sagged, suspect the USB brick · `PANIC` = crash, read `recent_logs` · `POWERON` = the plug (or a human power-cycling a hang) · `SW` = our own `/reboot` |
| `heap.min_free` | low-water mark — a leak is the most likely wedge mechanism, and it was invisible before |
| `wifi.drops` | link losses since boot; this board sits at rssi ~-78 |

A **task watchdog** (30 s, `panic=true`) is armed at the end of `setup()` — after
the WiFi wait, which blocks up to 20 s and must not be watched. This is what
makes `last_reset` diagnostic at all: without it, a wedge and an unplugging both
read `POWERON`, because in both cases a human supplied the reset.

> **The scheduler does not run outside production.** In dev the job registers and
> then logs `scheduler.disabled_non_production`; set `ENABLE_CRON=true` to
> exercise it locally.

## Status LED

Event-only lighting: the LED stays dark during idle/connection monitoring and
briefly flashes when something is emitted.

| Colour | Meaning |
|--------|---------|
| dark | normal — the LED only lights on events |
| green flash | scale reading sent to the bus |
| blue flash | barcode scan received and sent |
| purple flash | button press sent |
| amber flash | event bus down — reading/press **queued** for later delivery |
| red flash | event bus down and the event was **dropped** (not durable) |

The button: a quick press logs the current weight; a 3 s hold clears the BLE
bond and forces a re-pair.

## Config — `data/household/config/scales.yml`

Keyed by scale id (plural, so a second scale is just another key + another ATOM).
Each scale entry may also carry a `barcode:` block; that scanner shares the same
ATOM and BLE controller. Schema/example:
[`config.example.yml`](config.example.yml). The generated
`firmware/include/config.h` is gitignored.

Routing note: `barcode.route` is only the **default** for a code that claims no
namespace. Prefixed codes (`sch:`, `go:`, `cmd:`, `nut:`, and legacy
`dl:`/`ct:`/`rs:`) are dispatched by prefix regardless of route — see
`backend/src/5_composition/modules/scanDispatch.mjs`.

> Unprefixed **content** cards (`living-room:plex:594036+shuffle`) are the
> exception: they parse as `unknown`, so on this reader — whose route is
> `nutribot` — they fall to `SCAN_ROUTE_FALLBACK.nutribot = 'product'` and reach
> the UPC lookup instead of the content dispatcher. Scanning an old content card
> on the kitchen gun misroutes rather than errors.
