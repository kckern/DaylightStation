# scantron-relay — OMR bubble-sheet reader → DaylightStation event bus

> **Status (2026-07-21): protocol SOLVED and verified on hardware — cards decode
> correctly.** The reader is a **Chatsworth Data OMR-1100** (firmware
> `Version 1.04, Wed Oct 2 1996`). Link is **9600 7E1**, and a conversion mode
> must be downloaded before the reader emits anything at all. Vendor manuals are
> archived in [`docs/recovered/`](./docs/recovered/). The ESP32 relay and the
> backend dispatch are **not yet built**.
>
> **System reference — protocol, card spec, troubleshooting, and where to buy
> cards — is `docs/reference/scantron/README.md` in the main repo docs; that doc
> is authoritative.** This README covers building and flashing the relay.
> Remaining work: `docs/_wip/plans/2026-07-21-scantron-relay-bringup.md`.

An **M5Stack ATOM Lite** (ESP32-PICO-D4) taps the **RS-232 serial output** of a
**Chatsworth Data OMR-1100** optical-mark-recognition (bubble-sheet / scantron)
reader and streams decoded sheet results over **WebSocket** to the
DaylightStation backend event bus (`/ws`). The backend re-broadcasts a
`scantron` topic and persists completed reads.

Same family as [`barcode-relay`](../content-barcode-relay/) and
[`food-scale-relay`](../food-scale-relay/): **firmware only**, no host daemon,
config-driven from the household SSOT — nothing hardcoded. Unlike those, the
transport is plain **RS-232 serial** — no BLE bonding, no proprietary GATT — so
it sidesteps the decode-transport wall that stalled barcode-relay.

```
OMR-1100 ──DB9 RS-232──▶ MAX232 base ──TTL UART──▶ ATOM Lite ──WS /ws──▶ backend event bus
                                                        │                     │ broadcast('scantron')
                                                        └─────────────────────┘   ├─▶ apps (live)
                                                                                   └─▶ history/scantron/<reader-id>/
```

## The reader is READ-ONLY

The OMR-1100 detects marks and ships them out the serial port. It does **not**
print, imprint, endorse, score, or grade — there is no printer or marking
mechanism in the unit. **All scoring is our job**, downstream in the backend.

> The datasheet's "**Graded** index fiber read head" is an optics term
> (graded-index optical fiber) and has nothing to do with grading tests. Don't
> let it mislead you into expecting scoring support.

Design consequence: the answer key lives in DaylightStation, not on the sheet or
in the reader. The firmware emits *which positions were marked*; the backend
maps positions → answers → score.

## Form factor — 3-1/4" wide, and that's non-negotiable

| | |
|---|---|
| **Form width** | **3-1/4"** (fixed) |
| **Form length** | 5" to 14" |
| **Scan area** | up to **12 × 105 mark positions** (body text says up to 126 rows) |
| **Paper weight** | 18–100 lb (.004"–.010") |
| **Sides read** | one (single-sided head) |

**Standard Scantron forms do NOT fit.** The 882-E and its relatives are 4.25" or
8.5" wide; the transport takes 3-1/4". We print our own forms.

The datasheet's sanctioned pattern for full-size sheets:

> Input forms may also be part of a larger 8 1/2" x 11" sheet using a
> perforation at 3 1/4" to separate the input portion of the sheet from the Text
> portion.

i.e. questions/text on the big portion, a 3-1/4" answer strip perforated off to
feed the reader.

### ⚠️ Which optical variant do we have? (blocks form design)

The OMR-1100 shipped in two styles, and this constrains printing more than paper
size does:

| Variant | Reads | Background printing |
|---|---|---|
| **Infra Red** | #2 pencil, punched slots, pre-printed marks — **no pen** | any color |
| **Visible Red** | pencil **+ blue/black ballpoint and felt tip**, punched, pre-printed | **must be "warm red"** dropout ink |

If ours is Visible Red, every form must use warm-red dropout or the reader will
read our own gridlines as marks. **Determine this before designing any form** —
see Step 0b in the bring-up checklist.

## Hardware

| Part | Role |
|------|------|
| **M5Stack ATOM Lite** (ESP32-PICO-D4) | relay MCU — WiFi + WS client (same board as food-scale-relay / barcode-relay) |
| **M5Stack ATOMIC RS232 base** (MAX232) | TTL ↔ RS-232 level shifter, clips onto the ATOM |
| **DB9 male screw-terminal breakout** | solderless tap of the OMR-1100's serial pins |
| **Chatsworth Data OMR-1100** | the bubble-sheet scanner (serial output source) |

> An ATOMS3 Lite (ESP32-S3) also works but forks you onto a second toolchain for
> no benefit — this relay needs only one UART + WiFi. Stick with the ATOM Lite.

> **A USB-serial adapter is NOT a viable sniffer on the Apple-silicon Mac.** The
> on-hand Keyspan USA-19H (VID `0x06cd`/PID `0x0121`) enumerates on USB but
> creates no `/dev/cu.*` — it predates USB-CDC and its vendor kext was never
> ported to DriverKit. Use the ATOM in sniff mode as the capture device, or an
> FTDI/CP2102/CH340 adapter (a CH34x dext is already installed on that Mac).

## Serial protocol — SOLVED ✅ (verified on hardware 2026-07-21)

Unit: **OMR-1100, firmware "Version 1.04, Wed Oct 2 1996"**. Vendor manuals and
DOS utilities recovered from the Wayback Machine and archived in
[`docs/recovered/`](docs/recovered/) — `OMR1100Manual.pdf`,
`OMR1100commandsB.pdf` (factory command set), `omr1102_techmanual.pdf` (48pp,
the richest: download commands, Appendix A card/strobe spec, Hollerith + binary
tables).

- **Link: 9600 baud, 7 data bits, EVEN parity, 1 stop (7E1).** Power-up default,
  confirmed by manual *and* by live query. **8N1 gives silence, not garbage** —
  do not "correct" it.
- **Command framing:**
  - download: `0x12 <cmd> 0x12 'E'` (Ctrl-R, cmd, Ctrl-R, "E")
  - factory/read-only: `0x12 ESC <cmd> 0x12 'E'`
  - ack `G`+CR on success; `…?`+CR on rejection
- **⚠️ Conversion modes are VOLATILE.** A freshly powered reader has *no* mode
  loaded, so it transports cards and emits **nothing at all**. The host must
  download one first. This was the entire cause of the long "reader scans but
  sends zero bytes" hunt. Firmware sends `I00` (Binary-to-ASCII, all columns) at
  boot and re-arms every 60 s while idle, so it self-heals if the reader is
  power-cycled on its own.
- **Record format (mode `I00`):** two bytes per column, CR-terminated. Bit 5
  (`0x20`) is forced high so every byte is printable; a blank column is
  `0x20 0x20`.
  - byte 1: `0x01`=row12 `0x02`=row11 `0x04`=row0 `0x08`=row1 `0x10`=row2 `0x40`=row3
  - byte 2: `0x01`=row4 `0x02`=row5 `0x04`=row6 `0x08`=row7 `0x10`=row8 `0x40`=row9
  - Rows are Hollerith, far edge → strobe edge; **row 9 is nearest the timing track**.
- Read-only queries worth knowing: `GETCONFIG` (baud/flags/timing/parity/
  threshold), `GETTBLS`, `S` (status byte), `V` (version).
- **Never** send `SETBAUD` / `SETFLAGS` / `SETPARITY` / `SETTHRESH` / `SETDECAY` /
  `SETTMCH` / `PROGRAM` / `SETFACTORY` casually — they write EEPROM.

## Messages sent to the bus

```json
{"source":"scantron-relay","type":"sheet","id":"<reader-id>","columns":39,"markedColumns":37,"marks":[2048,1024,512]}
```

`marks[]` is one 12-bit mask per column in physical top-to-bottom order:
bit 0 = row 12 (far edge) … bit 11 = row 9 (strobe edge). Mapping columns to
questions/answers is form-specific and belongs in the backend, not the relay.

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

## Bring-up checklist

Work top to bottom. The electronics are a copy of the other two relays; the
remaining risk is concentrated in *what the OMR-1100 emits and at what serial
settings.*

### Step 0 — Mode question: RESOLVED ✅

Earlier versions of this doc worried the reader might be a dumb scan head
streaming undecoded mark-timing to proprietary DOS software — the same
proprietary-transport wall that stalled barcode-relay. **The datasheet settles
it:** Data Output is *ASCII character / binary / download mask*, and the reader
"detect[s] marks … and transfer[s] the data to a computer … for processing by
application software." It decodes on-board. Proceed.

### Step 0b — Identify the optical variant (do before designing forms)

Cheapest signals first:

1. **Model/serial label** on the chassis or underside — the variant may be in
   the part number.
2. **Power it on and look into the read slot.** Visible Red glows obviously red.
   An IR head looks dark or faintly dull-red. Cross-check with a phone camera:
   many sensors render IR emitters as pale violet/white that the eye can't see.
3. **The bundled test cards / sample forms.** Warm-red background printing is a
   strong tell for a Visible Red unit; any other background color implies IR.
4. **Definitive (needs the chain working):** mark one form with #2 pencil and
   another with blue ballpoint. Pen reads → Visible Red. Pen ignored but pencil
   read → Infra Red.

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
- Do **not** back-power the scanner from the ATOM — the OMR-1100 has its own
  external mains PSU.
- The unit shipped with a **serial data cable (Mac or PC)** — check the box
  before wiring from scratch; a known-good cable removes one variable.

### Step 2 — Serial parameters: RESOLVED ✅

**9600 / 7E1.** See *Serial protocol* above. No sweep needed; a wrong framing
here produces silence rather than garbage, which is why this cost a whole
session. `tools/omr-query.py` re-verifies against live hardware at any time.

### Step 3 — Capture real frames: DONE ✅

`tools/omr-listen.py` downloads mode `I00` and streams every byte to disk
(Ctrl-C safe at any moment — never buffer a capture in RAM). `tools/omr-decode.py`
renders a capture as a mark grid.

First successful read, 2026-07-21 — the generated test strip, 39 columns, all 36
designed marks correct:

```
      123456789012345678901234567890123456789
   12 ...........#...........#...........#..#
   11 ..........#...........#...........#...#
    0 .........#...........#...........#....#
  ... (walking diagonal, 3 cycles) ...
    9 #...........#...........#.............#
```

The trailing all-channel column is the printed cut-line border of the test
strip, not data.

### Step 3b — Making cards the reader will accept

**A Scantron-compatible form is not a Chatsworth form.** A ScanRite 815-E was
transported happily and read as nothing: the strobe geometry has to match
Appendix A of `omr1102_techmanual.pdf`, not merely look like a bubble sheet.

`tools/gen-test-strip.py` emits a spec-exact printable strip
(`docs/omr1100-test-strip.pdf`) — 3.25" wide, black ticks 0.125"×0.060" flush to
the strobe edge on 0.250" centers, first tick 0.375" from the leading edge, 12
rows on 0.250" centerlines, plus a walking-diagonal pattern whose decode is
self-evident. **Print at 100% / Actual Size** and cut on the outline. This is
also the starting point for designing real household forms.

### Step 4 — Decoder: DONE ✅

`handleFrame()` in `firmware/src/main.cpp` decodes `I00` records into 12-bit
column masks; `SNIFF_MODE` defaults to 0. CR is the frame boundary (the idle
timeout is only a truncation backstop). Command acks (`G`) and error echoes
(`…?`) are filtered off the data path.

### Step 5 — Backend dispatch + scoring

Add `backend/src/3_applications/hardware/scantronRelay.mjs` (mirror
`foodScaleRelay.mjs`), wire it in `app.mjs`, re-broadcast on `scantron`, persist
completed reads under `household/history/scantron/<reader-id>/`. **Scoring lives
here** — the reader only reports marks (see "read-only" above), so the answer
key and grading logic are backend concerns.

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

## Reference

- [OMR-1100 datasheet extract](./OMR-1100-datasheet.md) — full transcribed specs
  and provenance.
