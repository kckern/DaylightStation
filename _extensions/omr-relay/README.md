# omr-relay — OMR bubble-sheet reader → DaylightStation event bus

> **Status (2026-07-21): protocol SOLVED and verified on hardware — cards decode
> correctly.** The reader is a **Chatsworth Data OMR-1100** (firmware
> `Version 1.04, Wed Oct 2 1996`). Link is **9600 7E1**, and a conversion mode
> must be downloaded before the reader emits anything at all. Vendor manuals are
> archived in [`docs/recovered/`](./docs/recovered/).
>
> **Update 2026-07-29:** extension renamed `scantron-relay` → `omr-relay` (bus
> topic `scantron` → `omr`, source `scantron-relay` → `omr-relay`, config
> `scantrons.yml` → `omr-readers.yml`). Host-side wiring is **resolved**
> (Step 1), the household config is **written**, and **backend dispatch is built
> and wired** (Step 5).
>
> **The ATOM IS FLASHED and live (2026-07-29).** An earlier revision of this note
> listed flashing as outstanding; it was already done. `study-omr` runs on the LAN
> with the bus connected — confirm with `curl http://<ip>/health`. The GPIO
> mapping is likewise settled: the base's own silkscreen reads `RX:22 TX:19`, so
> the Step 1b loopback is a debugging tool now, not a prerequisite.
>
> **NFC tap-to-start ADDED (2026-07-29).** The same ATOM now also reads NFC cards
> from an M5 Unit NFC on its Grove port and beeps an audible ACK — see
> [NFC tap reader](#nfc-tap-reader--tap-to-start) below. Verified on hardware:
> ST25R3916 at I²C `0x50`, IC Identity `0x2A`, an NTAG 215 read end to end.
>
> **Cards are ORDERED (2026-07-22)** — one 500-pack of Lincolnshire `3705`,
> invoiced 7/24. The long-standing card-sourcing blocker is closed; see
> [sourcing](../../docs/reference/omr/README.md#sourcing-cards--solved--ordered-2026-07-24)
> for the `SD`-suffix / infrared caveat before reordering.
>
> **System reference — protocol, card spec, troubleshooting, and where to buy
> cards — is `docs/reference/omr/README.md` in the main repo docs; that doc
> is authoritative.** This README covers building and flashing the relay.
> Remaining work: `docs/_wip/plans/2026-07-21-omr-relay-bringup.md`.

An **M5Stack ATOM Lite** (ESP32-PICO-D4) taps the **RS-232 serial output** of a
**Chatsworth Data OMR-1100** optical-mark-recognition (bubble-sheet / scantron)
reader and streams decoded sheet results over **WebSocket** to the
DaylightStation backend event bus (`/ws`). The backend re-broadcasts a
`omr` topic and persists completed reads.

Same family as [`barcode-relay`](../content-barcode-relay/) and
[`food-scale-relay`](../food-scale-relay/): **firmware only**, no host daemon,
config-driven from the household SSOT — nothing hardcoded. Unlike those, the
transport is plain **RS-232 serial** — no BLE bonding, no proprietary GATT — so
it sidesteps the decode-transport wall that stalled barcode-relay.

```
OMR-1100 ──DB9 RS-232──▶ MAX232 base ──TTL UART──▶ ATOM Lite ──WS /ws──▶ backend event bus
                                                        │                     │ broadcast('omr')
                                                        └─────────────────────┘   ├─▶ apps (live)
                                                                                   └─▶ history/omr/<reader-id>/
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
| **Original Chatsworth data cable** | 6-pin circular at the reader, DB9 at the host; on hand and verified working |
| **Chatsworth Data OMR-1100** | the bubble-sheet scanner (serial output source) |
| 3 × 22 AWG solid-core wire | breakout screw terminals → base screw terminals (see Step 1) |

> **The manual's cable table does not describe our unit.** `OMR1100Manual.pdf`
> §3 says the reader has a **25-pin female** connector and lists PC (25/25),
> AT (25/9) and Macintosh (25/9-pin DIN) cables. The unit on hand terminates in
> a **6-pin circular** connector instead. The manual is still authoritative on
> protocol and card geometry; treat its connector section as not applicable.

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

## NFC tap reader — tap-to-start

**Optional, off by default.** The same ATOM can also read NFC cards, so a student
taps a card to say "I'm ready" and the backend starts a session (print the test,
open the app, whatever the trigger config says). Enable it per reader with the
`nfc:` and `buzzer:` blocks in `omr-readers.yml`; with `nfc.enabled: false` the
whole path compiles out and the firmware keeps its OMR-only footprint (30.3%
flash vs 38.9% with NFC).

| | |
|---|---|
| Unit | **M5 Unit NFC** (SKU U216) — ST25R3916 NFC front-end, I²C `0x50` |
| Verified | IC Identity `0x2A` (`ic_type` 5, silicon rev 2), 2026-07-29 |
| Bus | Grove port: **SDA GPIO26 / SCL GPIO32** — no clash with the UART on 22/19 |
| Technology | **NFC-A only** (ISO 14443A: MIFARE, NTAG). Read an NTAG 215 |
| Driver | [`m5stack/M5Unit-NFC`](https://github.com/m5stack/M5Unit-NFC) + M5Unified |

### Why the NFC poll runs on the other core

A **failed** `detect()` blocks for its whole timeout. The UART reader is the only
hard real-time path in this firmware — at 9600 baud a byte lands every ~1 ms —
so NFC polling must never sit in front of it. The ESP32-PICO-D4 has two cores and
Arduino's `loop()` runs on core 1, so the poll is pinned to **core 0** and hands
cards across a **FreeRTOS queue**. `loop()` drains that queue, which is what keeps
`emit()`, the outbound bus queue and the buzzer single-threaded — the existing
queue was written assuming one writer and still gets exactly one.

`detect_timeout_ms` defaults to **120 ms, not the library's 1000 ms**. At 1000 ms
the reader listens barely once a second and a quick swipe falls between polls,
giving the student no beep and no clue why. Measured at the defaults: **6.05
polls/sec, 165 ms per cycle**. `handoffLost` in `/health` counts any tap the
handoff dropped — a lost tap is never silent.

### The ACK has to be audible, and it has two stages

A status LED is useless here: the board lives in a case where nobody can see it.
So events make a sound. Active (self-oscillating) buzzer, **GND + GPIO23** on the
base's free solder pads, gated through LEDC and sequenced non-blocking in
`loop()`.

A local beep only proves *this board* read the card — it says nothing about
whether the server got it. So there are two stages:

| Sound | Meaning | Default on the fitted (active) buzzer |
|---|---|---|
| `read` | a card or sheet was read **here** | one 4 ms tick |
| `confirmed` | the **server echoed it back** — round trip closed | tick-tick (4 ms, 60 ms gap, 4 ms) |
| `failed` | no echo inside `ack_timeout_ms` | one 250 ms buzz |

The ack is real, not assumed: the relay **subscribes to its own bus topic**
(`{"type":"bus_command","action":"subscribe","topic":"omr"}`) and waits for the
backend's re-broadcast of its own event to come back. That echo proves received →
validated → accepted. It needs **no new backend capability** —
`client-control:<clientId>` would have been the other route, but it "logs a warn
and drops" because connection identity isn't tracked, whereas topic subscription
already works.

> The echo means **accepted**, not **durably stored**. The backend broadcasts
> first and persists on the subscriber chain immediately after, so a `confirmed`
> sound is not a disk guarantee. A storage-level ack would need a new message.

Patterns live in config as `{ tone, ms, gap }` steps, so the vocabulary is data
rather than hard-coded rhythm.

### ⚠️ Pitch needs different hardware

> **The fitted buzzer cannot do pitch.** It is *active* — self-oscillating — so it
> plays its own single fixed tone regardless of what you drive it with. Measured
> 2026-07-29: driving it at 30 kHz produced an audible tone, which is only
> possible if the element generates its own frequency. `tone` in the pattern table
> is therefore **ignored** when `buzzer.kind: active`, and `gen-config` warns
> rather than letting a melody silently collapse to one note.
>
> For real low→high / high→low, solder a **passive piezo** to the same two pads
> and set `buzzer.kind: passive`; the firmware then uses `ledcWriteTone()` and the
> same pattern table gains pitch with no code change.

Ruled out along the way, so nobody re-treads it:Ruled out along the way, so nobody re-treads it: a **Grove hub + Unit Buzzer**
cannot work — the Unit Buzzer is PWM on the Grove signal pin (GPIO26 on an ATOM
Lite), which is the NFC unit's SDA; a hub multiplexes I²C *devices* and a PWM
buzzer is not one. An **ATOM Echo** (built-in speaker) is also out: M5 reserves
G19/G22/G23/G33 for its I²S audio and warns that reusing them can damage the
board — and the RS232 base drives the OMR UART on G22/G19.

### One tap, one trigger

After a successful read the firmware sends **HLTA** (halt). A halted PICC ignores
**REQA** until it leaves the field and loses power, so a card left resting on the
antenna does **not** re-fire — the debounce is a property of the protocol, not a
timer. The backend adds a second guard, deduping per UID inside
`persistence.dedupWindowMs`, because a fumbled card can leave and re-enter the
field in a moment and a double tap must not start two sessions.

Resolving `uid` → student is **not** the relay's job, exactly as scoring isn't:
that mapping belongs to the consuming app, which is what lets one reader serve
several rosters.

## Messages sent to the bus

```json
{"source":"omr-relay","type":"sheet","id":"<reader-id>","columns":39,"markedColumns":37,"marks":[2048,1024,512]}
{"source":"omr-relay","type":"nfc","id":"<reader-id>","uid":"04669C0FCB2A81","piccType":"NTAG 215","atqa":68,"sak":0}
```

`marks[]` is one 12-bit mask per column in physical top-to-bottom order:
bit 0 = row 12 (far edge) … bit 11 = row 9 (strobe edge). Mapping columns to
questions/answers is form-specific and belongs in the backend, not the relay.

The firmware also emits `{"type":"raw","hex":…,"len":…}` for undecodable frames
(and every frame in `SNIFF_MODE`), `{"type":"reader-error","echo":…}` when the
reader rejects a command with `…?`, and `{"type":"relay-status",…}` on every bus
reconnect reporting `queued` / `dropped` / `truncated`.

Every delivered message carries **`ageMs`** — how long it sat in the outbound
queue. The backend subtracts it when stamping `ts`, so a sheet queued across an
outage is recorded at the time the card was READ, not when the socket came back.
Without that, an outage spanning midnight files the sheet under the wrong day.

## Outbound queue — no silent failures

**The relay never drops a card because the network is down.** A bubble sheet is a
one-shot physical event; you cannot ask a student to re-feed a sheet you lost.

The original `emit()` opened with `if (!wsConnected) return;` — during any WiFi
or backend outage every message was discarded with no counter, no log, and no
change to the LED. Nothing upstream could distinguish "no cards were fed" from
"every card was thrown away". That line is gone. `emit()` now always enqueues,
and a bounded drain sends when the link is up.

| Property | Value | Why |
|---|---|---|
| Capacity | 64 items **or** 40 KB, whichever binds first | a 126-column sheet is ~700 B of JSON; ~248 KB heap is free, so this is deliberately conservative |
| Overflow policy | evict oldest, `dropped++` | bounded so a long outage can't exhaust the heap and turn a recoverable outage into a crash loop |
| Drain rate | 4 messages per `loop()` | a backlog must not starve the UART reader, the only hard real-time path here |
| Loss reporting | `dropped` in `/health` + `/queue`, a `relay-status` push on reconnect, and a persisted `data-loss` record backend-side | eviction is never quiet |
| Send failure | `sendTXT()` result checked; item stays queued | the old code ignored the return value |

**Verified on hardware 2026-07-29:** the `relay-status` message is generated
during boot while the bus is still down, and `/health` afterwards showed
`maxDepth: 1, delivered: 1, dropped: 0` — queued while disconnected, drained on
connect. (The multi-item and eviction paths are unit logic that has not yet been
exercised against real hardware.)

### Two other silent-failure paths closed at the same time

- **Frame truncation was silent corruption, not just loss.** Bytes past
  `frameBuf`'s 512 were discarded and the frame was then flushed *as if
  complete*, so an over-long record decoded into a structurally valid,
  plausible-looking short card — a wrong answer that looks right. Overrun is now
  flagged, counted (`truncated`), routed away from the decoder, and emitted as
  `raw` with `truncated: true`.
- **`ws.sendTXT()`'s return value was ignored**, so a send that failed on a
  half-open socket looked identical to success.

## Diagnostics HTTP server (port 80)

Read-only by design — this board sits unauthenticated on the LAN, so no route
can change reader state or clear the queue. All JSON.

| Route | Returns |
|---|---|
| `/`, `/health` | identity, uptime, free heap, WiFi (IP/RSSI), bus state, **the UART config as actually compiled**, all counters, queue summary, and a top-level `ok` (false if anything was ever dropped or truncated) |
| `/queue` | length, bytes, dropped, delivered, high-water depth, **and the full verbatim payload of every queued item** — payloads are small, and during an outage you want to confirm a specific card is safely held |
| `/recent` | the last 16 frames the UART saw (delivered or not) with `kind`, `len`, `truncated` and a hex preview |
| `/events` | a rolling window of the **lifecycle** — card read, ack confirmed, ack timed out, WS connect/disconnect — newest first, with `msAgo`, plus `ackOk`/`ackTimeout` totals. This is the route for "I tapped it and nothing happened": it answers the question after the fact, without a serial cable and without having been watching. Distinct from `/recent`, which is raw UART frames. |
| anything else | `{"ok":false,"error":"not found"}` |

`/health` reporting the compiled UART config matters for bring-up: it's the only
way to confirm which pins were actually flashed without reading `config.h` on the
build host.

**This is what makes the Step 1b loopback test remote.** Jumper `R` to `T`, wait
for the 60 s re-arm, then `curl http://<ip>/recent` — if the `I00` download comes
back you'll see the frame. No USB cable, no serial monitor, from anywhere on the
LAN.

Backend dispatch **exists** at
`backend/src/3_applications/hardware/omrRelay.mjs`, wired in `app.mjs`: it
rebroadcasts on `omr` and persists sheets + reader errors. See Step 5.

## Build & flash — BUILDS CLEAN ✅ (2026-07-29)

`pio run -e m5-atom` succeeds: RAM 14.2% (46,612 / 327,680), Flash 29.2%
(919,701 / 3,145,728). Three defects fixed to get there and to survive first
contact:

- **`CRGB::Amber` does not exist** — amber is not a W3C named color, so FastLED's
  HTML color enum has no such constant and the build failed outright. Defined as
  `CRGB(0xFF,0xBF,0x00)` rather than substituting `Orange`, so the LED table
  below stays literally true.
- **`setLed()` now only pushes on a color CHANGE.** It is called once per
  received *byte*; `FastLED.show()` drives the RMT peripheral and blocks for the
  ~300 µs reset latch, and at 9600 baud a byte lands every ~1 ms. The old
  unconditional `show()` burned a third of every inter-byte window in the LED
  driver.
- **WiFi no longer blocks forever.** `connectWifi()` spun in an unbounded
  `while (WiFi.status() != WL_CONNECTED)`. A power cut brings the router and the
  ATOM back at once and the ATOM wins that race — the relay would sit red
  forever and never retry. Now: 20 s attempt, then fall through, with a 15 s
  retry watchdog in `loop()` (arduinoWebSockets reconnects its socket but cannot
  bring the radio back up).

Also `ws.onEvent()` now precedes `ws.begin()` — a handler registered after
`begin()` can miss the first transition, leaving `wsConnected` false while the
socket is actually up, which makes every `emit()` drop silently.

`tools/flash.mjs` carried an argument-parsing bug: with `--port` omitted,
`indexOf` returns −1 and the filter `i !== portIdx + 1` evaluated to `i !== 0`,
eating the **config path** so `gen-config` got the reader id as its filename and
died on ENOENT. Fixed, and port autodetection now covers `wchusbserial`,
`SLAB_USBtoUART` and `usbmodem` alongside `usbserial`.

Prereqs: PlatformIO (`pio`), Node, the ATOM on USB (`/dev/cu.usbserial-*`).

```bash
cd firmware
# one shot: gen config from SSOT, build, upload (autodetects port)
node tools/flash.mjs "$DAYLIGHT_BASE_PATH/data/household/config/omr-readers.yml" study-omr

# or step by step
node tools/gen-config.mjs "$DAYLIGHT_BASE_PATH/data/household/config/omr-readers.yml" study-omr
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

### Step 1 — Physical RS-232: RESOLVED ✅ (2026-07-29)

**Three wires. That's the whole job.**

```
OMR-1100 ──original Chatsworth cable──▶ DB9 breakout          ATOMIC RS232 base
         (6-pin circular at the reader)  ─────────────        ─────────────────
                                          2  RXD    ────────▶  R
                                          3  TXD    ◀────────  T
                                          5  GND    ────────   G
                                          1,4,6,7,8,9 unused   DC12V  ← LEAVE OPEN
```

**Why pin 2 is the reader's output** — this is settled empirically, not
inferred. The original cable was tested working against a plain USB-serial
adapter on Linux with **no null-modem in the path**. A USB-serial dongle is a
DTE, so the cable's DB9 end presents PC/DTE orientation: `RXD` (pin 2) carries
data *from* the reader. The ATOM base drops into exactly the dongle's slot, so
it takes the same assignment.

**No handshake lines are needed.** This unit's EEPROM flags byte reads `00` —
flow control off (see `docs/reference/omr/command-reference.md`). `DCD`, `DTR`,
`DSR`, `RTS`, `CTS`, `RI` all go unconnected. This matters because the ATOM base
*has* no handshake lines: the Linux dongle asserted DTR/RTS and the ATOM won't.
Only the `00` flags byte makes that difference harmless. If flow control is ever
enabled via `SETFLAGS`, RTS/CTS additionally requires swapping the stock cable
for a null-modem cable — the stock cable only supports XON/XOFF.

**Wire spec:** 22 AWG **solid-core** hookup wire, three colors, ~15–20 cm,
stripped 5–6 mm. Solid, not stranded — screw terminals grip solid wire cleanly
while stranded frays and strands escape the clamp into the neighboring
terminal. If stranded is all you have, tin the ends or crimp ferrules. Don't use
30 AWG wire-wrap; the screw won't bite. Length is irrelevant to signal integrity
here (RS-232 is specced to 15 m and this is a 20 cm run) — keep it short for
tidiness only. Use black for GND.

**Hazards:**

- **`DC12V` is a power input for the base, not a serial line.** Nothing from the
  reader touches it. Power the ATOM over USB-C.
- **Never** wire the reader's TX straight to an ATOM GPIO — RS-232 swings
  **±5–12V** and will fry the 3.3V pin. The signal **must** pass through the
  ATOMIC RS232 base (MAX3232). The base's screw terminal is on the RS-232 side
  of the transceiver, which is exactly where the DB9 belongs.
- Do **not** back-power the reader from the ATOM — the OMR-1100 has its own
  external mains PSU.
- **The link is bidirectional.** An earlier version of this doc called the
  reader "send-only" and specified TX→RX + GND as sufficient. That is **wrong**:
  the host must transmit the `I00` mode download or the reader emits nothing at
  all (see Step 0/Step 3). `T` is not optional.

**If it's silent:** swap `R` and `T`. RS-232 is short-tolerant and a reversal
does no damage, so this is a free two-screw experiment before you start
theorizing. Note that the reader is *also* legitimately silent for the first
60 s after power-up, until the firmware's re-arm sends the mode download — don't
diagnose a wiring fault inside that window.

### Step 1b — Loopback test (do this BEFORE connecting the reader)

**RESOLVED 2026-07-29 — the mapping is printed on the base itself.** The
ATOMIC RS232 base's silkscreen reads `RX:22  TX:19`, matching what the scaffold
shipped with and what `config.h` generates. No loopback needed to establish it.
The same face also breaks out solder pads `3V3 / 22-Rx / 19-Tx / 23 / 33`, i.e.
**GPIO23 and GPIO33 are free** — that is where the tap buzzer lives (see below).

The loopback below is still the right tool if the link is ever silent, because it
separates "our end is fine" from "the reader or cable is at fault":

1. Jumper `R` to `T` on the screw terminal. Nothing else connected.
2. Flash with `sniff_mode: true`.
3. The 60 s re-arm transmits the `I00` download on TX — with the loopback in
   place it comes straight back in and lands in the sniff output.

Bytes back ⇒ GPIO mapping, baud, framing and the MAX3232 are all good, and
anything that fails afterward is the reader or the cable. Nothing back ⇒ swap
`rx_pin`/`tx_pin` in `omr-readers.yml` and reflash. This is worth the one flash
cycle: with the reader attached, "silence" has at least four independent causes
and no way to tell them apart.

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

### Step 5 — Backend dispatch: DONE ✅ (2026-07-29)

`backend/src/3_applications/hardware/omrRelay.mjs` (mirrors
`foodScaleRelay.mjs`), wired in `app.mjs` next to `createFoodScaleRelay`.
Re-broadcasts on `omr` and persists completed reads to
`household/history/omr/<reader-id>/<YYYY-MM-DD>.yml`. 20 tests in
`omrRelay.test.mjs`.

Handled: `sheet` (broadcast + persist), `reader-error` (broadcast + persist,
rare and diagnostically valuable), `raw` (broadcast only — sniff mode is a
firehose and must never reach disk). Malformed frames are dropped with a warn
rather than thrown, since a garbled frame off a serial line is an expected
condition. `columns`/`markedColumns` are re-derived from `marks[]` rather than
trusted from the wire. Identical sheets inside `persistence.dedupWindowMs`
(default 2000) are treated as one card — the reader has a documented `R`
retransmit and re-fed cards are byte-identical.

**Scoring is NOT here and should not be added here.** The reader reports which
positions were marked; the mapping from columns → questions → answers is
form-specific and belongs to the consuming app (School). Keeping it out is what
lets one reader serve several form designs.

### Status LED (onboard SK6812, GPIO27) — dark by default

**The LED is off unless data is arriving from the reader.**

| State | LED |
|-------|-----|
| purple flash (120 ms) | bytes arriving from the OMR-1100 |
| everything else | **off** |

Connectivity deliberately does not drive it. Wi-Fi down, bus down, reconnecting,
idle — all dark. The LED answers exactly one question: *is the reader sending
anything right now?* That makes it useful as a feed indicator while standing at
the machine, and invisible the rest of the time.

Earlier revisions used red/blue/amber/green for link state. Those are gone —
**connectivity now lives on `/health`**, which is the better place for it anyway
since you can read it without being in the room.

Two implementation notes, both of which were bugs waiting to happen:

- `setLed()` short-circuits when the color is unchanged, and `ledCurrent` starts
  as Black, so it would never push the first frame — leaving whatever the SK6812
  powered up with lit. `setup()` therefore forces one explicit `FastLED.show()`
  of black rather than going through `setLed()`.
- The flash expiry compares with `(int32_t)(millis() - ledOffAtMs) >= 0` so it
  stays correct across the ~49-day `millis()` rollover.

## Config — `data/household/config/omr-readers.yml` ✅ WRITTEN

The real file lives in **private household data** (Dropbox-synced), never in
this repo. `config.example.yml` here is the schema only. Written 2026-07-29 and
verified against `gen-config.mjs`; the generated `firmware/include/config.h` is
gitignored and must never be committed (it contains the Wi-Fi PSK).

Keyed by reader id under `scanners:` (plural, so a second reader is just another
key + another ATOM). Holds Wi-Fi creds, backend host/port, and the per-reader
serial + decode params. Current reader: **`study-omr`**, topic `omr`,
9600/7E1, `sniff_mode: true` pending the Step 1b loopback test.

```bash
node firmware/tools/gen-config.mjs \
  "$DAYLIGHT_BASE_PATH/data/household/config/omr-readers.yml" study-omr
# -> firmware/include/config.h  backend=<host>:<port>/ws  9600/7E1 sniff=1
```

Two traps in the generator worth knowing:

- **`sniff_mode` treats any value other than an explicit `false` as true.**
  Omitting the key gives you a sniffer, not a decoder.
- **`framing` must be one of** `8N1 8E1 8O1 7N1 7E1 7O1` — anything else exits
  with an error rather than silently defaulting. Ours is `7E1`.

## Reference

- [OMR-1100 datasheet extract](./OMR-1100-datasheet.md) — full transcribed specs
  and provenance.
