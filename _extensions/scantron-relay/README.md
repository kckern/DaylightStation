# scantron-relay — OMR bubble-sheet reader → DaylightStation event bus

> **Status: scaffold — hardware chosen, protocol not yet captured.** The RS-232
> transport is fixed (below); the **serial frame format is TBD** until captured
> on the real scanner. Per `feedback_dont_assert_unverified_device_facts`, don't
> write byte meanings here until they're measured on hardware.

An **M5Stack ATOM Lite** (ESP32-PICO-D4) taps the **RS-232 serial output** of a
**Chatsworth Data OMR 1200** optical-mark-recognition (bubble-sheet / scantron)
reader and streams decoded sheet results over **WebSocket** to the
DaylightStation backend event bus (`/ws`). The backend re-broadcasts a
`scantron` topic and persists completed reads.

Same family as [`barcode-relay`](../barcode-relay/) and
[`food-scale-relay`](../food-scale-relay/): **firmware only**, no host daemon,
config-driven from the household SSOT — nothing hardcoded. Unlike those, the
transport is plain **RS-232 serial** — no BLE bonding, no proprietary GATT — so
it sidesteps the decode-transport wall that stalled barcode-relay.

```
OMR 1200 ──DB9 RS-232──▶ MAX232 base ──TTL UART──▶ ATOM Lite ──WS /ws──▶ backend event bus
                                                        │                     │ broadcast('scantron')
                                                        └─────────────────────┘   ├─▶ apps (live)
                                                                                   └─▶ history/scantron/<reader-id>/
```

## Hardware

| Part | Role |
|------|------|
| **M5Stack ATOM Lite** (ESP32-PICO-D4) | relay MCU — WiFi + WS client (same board as food-scale-relay / barcode-relay) |
| **M5Stack ATOMIC RS232 base** (MAX232) | TTL ↔ RS-232 level shifter, clips onto the ATOM |
| **DB9 male screw-terminal breakout** | solderless tap of the OMR 1200's serial pins |
| **Chatsworth Data OMR 1200** | the bubble-sheet scanner (serial output source) |

> An ATOMS3 Lite (ESP32-S3) also works but forks you onto a second toolchain for
> no benefit — this relay needs only one UART + WiFi. Stick with the ATOM Lite.

## Serial protocol (TBD — capture first)

- **Transport:** RS-232, DB9. Baud / parity / framing **unknown** — sniff with a
  USB-serial adapter + `pio device monitor` (or a logic analyzer) before coding.
  OMR-1200-era readers commonly default to low baud (1200/9600, 7E1 or 8N1);
  **verify, don't assume.**
- **Frame format:** _TBD_ once captured. Record real bytes → document here.
- Design write-up will live at `docs/_wip/plans/YYYY-MM-DD-scantron-relay-design.md`.

## Messages sent to the bus (proposed)

```json
{"source":"scantron-relay","type":"sheet","id":"<reader-id>","answers":["A","C","B"],"ts":123}
```

Backend dispatch (to be added at
`backend/src/3_applications/hardware/scantronRelay.mjs`, wired in `app.mjs`)
will rebroadcast these on `scantron` and persist completed reads. Mirror the
handler in `foodScaleRelay.mjs` as the reference implementation.

## Build & flash (planned)

Prereqs: PlatformIO (`pio`), Node, the ATOM on USB (`/dev/cu.usbserial-*`).

```bash
cd firmware
# one shot: gen config from SSOT, build, upload (autodetects port)
node tools/flash.mjs "$DAYLIGHT_BASE_PATH/data/household/config/scantrons.yml" study-scantron

# or step by step
node tools/gen-config.mjs "$DAYLIGHT_BASE_PATH/data/household/config/scantrons.yml" study-scantron
pio run -e m5-atom -t upload --upload-port /dev/cu.usbserial-XXXX
pio device monitor -b 115200        # watch bytes; first goal is a `raw` capture
```

## Bring-up checklist (do this the day the hardware arrives)

Work top to bottom. The risk in this project is **not** the electronics (those
are a copy of the other two relays) — it's concentrated in steps 0–2: *what the
OMR 1200 actually emits, and at what serial settings.* Everything from step 3 on
is a solved problem. Don't skip step 0.

### Step 0 — Decide the mode question FIRST (before wiring anything)

Vintage OMR readers come in two flavors, and only one of them is viable here:

- ✅ **Standalone / "data" mode** — the reader decodes marks itself and emits
  **ASCII records** (form id + answer string) over serial. Plug in, sniff, win.
- ❌ **Host-driven mode** — the reader is a dumb scan head that streams raw,
  undocumented mark-timing to *proprietary DOS/Windows software* that does the
  decoding. Tapping the serial line gets a meaningless binary firehose. This is
  the same "proprietary transport" wall that stalled [`barcode-relay`](../barcode-relay/).

**How to tell:** power the reader up on its own, feed a marked sheet, and watch
the serial line (step 3 sniffer). Clean ASCII you can read = standalone. If it's
silent or pure binary noise, check the OMR 1200's front-panel/DIP config for an
"output format" or "transmit" mode before concluding it's host-only.

### Step 1 — Physical RS-232 (the ±12V gotcha)

- **Never** wire the scanner's DB9 TX straight to an ATOM GPIO — RS-232 swings
  **±5–12V** and will fry the 3.3V pin. Signal **must** pass through the ATOMIC
  RS232 base (MAX3232). Confirm the base is seated and you're tapping *its* TTL
  side to the ATOM, not the raw DB9.
- **Minimum wiring** (send-only reader): scanner **TXD → base RXD**, and
  **GND → GND**. Common ground is mandatory.
- **TX/RX swap (DTE vs DCE)** is the #1 "it's dead" cause. If you get nothing,
  swap pins **2 ↔ 3** on the screw-terminal breakout (seconds, no soldering —
  this is why we bought the breakout).
- **Handshake stall:** some devices won't transmit until they see a ready host.
  If silent after the swap, jumper **DTR↔DSR (pins 4↔6)** and **RTS↔CTS
  (pins 7↔8)** on the breakout to fake it.
- Do **not** back-power the scanner from the ATOM — the OMR 1200 is mains-powered
  separately.

### Step 2 — Find the serial parameters (baud sweep)

Unknown and undocumented. Firmware ships in **sniff mode** (`SNIFF_MODE=1`), so
it forwards every received byte to the bus as `{"type":"raw","hex":...}`. Sweep
until the hex decodes to sensible ASCII:

- **Baud:** try `1200, 2400, 4800, 9600` (vintage gear is usually slow).
- **Framing:** try `8N1` then **`7E1`** (7-bit even parity is common on old gear).
- Edit `serial.baud` / `serial.framing` in `scantrons.yml`, re-flash, feed a
  sheet, read the `raw` bus messages. Wrong settings → garbage/framing errors;
  right settings → readable records.

### Step 3 — Capture real frames

With clean ASCII flowing, feed several *known* sheets (all-A, all-B, a mixed
answer key you filled by hand) and record the raw output for each. This is your
Rosetta Stone — it maps bytes → marks. Save captures to
`docs/_wip/scantron-captures/` and document the frame layout in **Serial protocol**
above (delimiters, field order, form-id position, checksum if any).

### Step 4 — Write the decoder & flip out of sniff mode

- Implement `handleFrame()` in `firmware/src/main.cpp` to parse a captured frame
  into `{type:"sheet", answers:[...]}`.
- Set `sniff_mode: false` in `scantrons.yml`, re-flash.
- Tune `FRAME_IDLE_MS` (or switch to a real CR/LF/STX-ETX delimiter) once you
  know the record boundary.

### Step 5 — Backend dispatch

Add `backend/src/3_applications/hardware/scantronRelay.mjs` (mirror
`foodScaleRelay.mjs`), wire it in `app.mjs`, re-broadcast on `scantron`, persist
completed reads under `household/history/scantron/<reader-id>/`.

### Status LED (onboard SK6812, GPIO27)

| Color | Meaning |
|-------|---------|
| red | no Wi-Fi |
| blue | Wi-Fi ok, event bus not connected |
| amber | disconnected from bus (was connected) |
| green | connected, idle |
| purple flash | serial bytes flowing |

## Config — `data/household/config/scantrons.yml` (planned)

Keyed by reader id (plural, so a second reader is just another key + another
ATOM). Holds Wi-Fi creds, backend host/port, and per-reader target + decode
params. The generated `firmware/include/config.h` will be gitignored.
