# rf-blaster — config-driven ATOM Lite 433 MHz transmitter (and learner)

An **M5Stack ATOM Lite** (ESP32-PICO-D4) that emits named 433 MHz codes over a
simple HTTP endpoint, and can **learn** them off a real remote. Codes are stored
in the household SSOT as raw microsecond timings and replayed via the ESP32's
RMT peripheral with the carrier disabled — baseband on/off keying, which is what
EV1527/PT2262-class remotes (disco lights, RF outlets, doorbells) actually speak.

No host daemon — **firmware only**, config-driven from
`data/household/config/rf-blasters.yml`. Nothing is hardcoded.

```
HTTP GET /send?code=disco_on ──▶ ATOM Lite ──433MHz OOK──▶ disco light
HTTP GET /learn?ms=8000      ──▶ ATOM Lite ◀─433MHz OOK── the light's own remote
                                     ▲
                   DaylightStation backend / HA rest_command / curl
```

This is the sibling of [`../ir-blaster`](../ir-blaster/README.md) and mirrors it
deliberately: same SSOT registry shape, same `GET /send?code=NAME` surface, same
status-LED vocabulary, same `gen-config.mjs` → `config.h` → `flash.mjs` chain.

## Status — NOT YET RUN ON HARDWARE

**Written before the radio modules arrived. Nothing here has driven a real
remote.** What *has* been verified:

| | |
|---|---|
| ✅ Compiles | `pio run -e m5-atom` → SUCCESS, RAM 18.9%, flash 63.7% |
| ✅ Config chain | `gen-config.mjs` produces a valid `config.h` from the example YAML |
| ❌ Transmit | never sent a frame |
| ❌ Learn | never captured a remote |
| ❌ Timing constants | `sync_gap_us`, `NOISE_FLOOR_US`, default `repeats` are reasoned from datasheets, **not measured** |

Treat every number in here as a starting guess until a real button press has
gone in one side and a real light has come on from the other.

## Parts needed

| Part | Role | Notes |
|---|---|---|
| M5Stack ATOM Lite | host | already in the fleet; a spare is on the bench |
| 433 MHz TX (FS1000A or SYN115) | transmit | one GPIO. SYN115 is the better of the two — the FS1000A is a bare SAW oscillator with noticeable frequency drift |
| 433 MHz RX (**RXB6** or similar superheterodyne) | learn | one GPIO. **Do not use the little green "no-name" super-regenerative receiver** that ships in the usual FS1000A kit — it is far too noisy to capture usable timings |

## Wiring

⚠️ **The receiver must be powered from 3.3 V, not the Grove port's 5 V.** The
RXB6 runs on 3.3–5.5 V, but its DATA output swings to whatever it is powered at,
and the ESP32's GPIOs are **not** 5 V tolerant. At 3.3 V the output is safe
directly. Sensitivity drops slightly, which is irrelevant for a light in the
same room. *(Inferred from the RXB6 datasheet — not yet measured on this rig.)*

The transmitter is the opposite case: power it from **5 V** for range, and drive
its DATA pin from 3.3 V logic, which it accepts fine — DATA only gates the
oscillator.

| Signal | ATOM Lite | Module |
|---|---|---|
| TX data | GPIO26 (Grove signal 1) | TX `DATA` |
| TX power | 5 V (Grove) | TX `VCC` |
| RX data | GPIO32 (Grove signal 2) | RX `DATA` |
| RX power | **3V3 (bottom header)** | RX `VCC` |
| Ground | GND | both `GND` |

Antennas matter more than anything else here: a **17.3 cm** straight wire on each
module (quarter wave at 433.92 MHz) is the difference between working across the
house and working across the desk.

If you would rather not use the bottom header, the alternative is to run the RX
at 5 V behind a resistor divider on DATA (e.g. 10 kΩ / 20 kΩ). Both work; the
3.3 V route needs no components.

## HTTP API

| Method | Path | Result |
|--------|------|--------|
| GET | `/` or `/health` | `{ id, ip, uptime_ms, sends, last_code, free_heap, pins, codes:[...] }` |
| GET | `/send?code=NAME` | transmit `NAME`; `{ ok, code, id }` (404 if unknown) |
| GET | `/send?code=NAME&repeats=N` | override the configured repeat count for one shot |
| GET | `/learn?ms=8000` | listen for `ms`, isolate a repeating frame, return its timings |

Reachable at `http://<esp-ip>/` or, via mDNS, `http://rf-disco-light.local/`.

Status LED: **red** no Wi-Fi · **green** idle · **blue** transmitting ·
**yellow** listening. Set `status_led: false` in the SSOT to keep it dark.

## Learning a remote

See [LEARNING.md](LEARNING.md). Short version:

```bash
curl 'http://rf-disco-light.local/learn?ms=8000' &   # arms a listening window
# ...press the remote button repeatedly during it...
```

Paste the returned `timings` array into `rf-blasters.yml`, regenerate, reflash.

## Why RMT, and why not rc-switch

**RMT, not bit-banging.** `digitalWrite` + `delayMicroseconds` is the obvious
implementation and is what rc-switch does. But this board also runs Wi-Fi and an
HTTP server, whose interrupts land mid-frame and stretch individual pulses. A
receiver decoding 350 µs bit cells tolerates some of that and then abruptly does
not. RMT clocks the frame out in hardware where Wi-Fi jitter cannot reach it.
`ir-blaster` uses the same peripheral with a 38 kHz carrier switched on; here it
is switched off. That one flag is most of the difference between the two boards.

**Raw timings, not rc-switch.** rc-switch decodes to a protocol number plus an
integer and silently declines anything outside its table. Raw timings replay
whatever the remote actually sent, including protocols nobody has named. The
cost is that the config is a list of numbers rather than a tidy code.

**`repeats` is not decoration.** Receivers in this class routinely ignore a lone
frame and act only on a second identical one — that is how they reject noise. A
code that works from the real remote but not from here is usually a repeats
problem before it is a timing problem.

## Config

`data/household/config/rf-blasters.yml` — schema and commentary in
[config.example.yml](config.example.yml). One key per physical board.

```bash
# generate include/config.h from the SSOT
node firmware/tools/gen-config.mjs <dataDir>/household/config/rf-blasters.yml disco-light

# generate + build + upload in one step (autodetects /dev/cu.usbserial-*)
node firmware/tools/flash.mjs <dataDir>/household/config/rf-blasters.yml disco-light
```

`config.h` holds Wi-Fi credentials and is **gitignored**. Never commit it.

## Relation to AmbientLedAdapter

`backend/src/1_adapters/fitness/AmbientLedAdapter.mjs` drives lights through
`IHomeAutomationGateway` (Home Assistant). This board is the other route: no
gateway, no HA, DaylightStation → HTTP → radio → light. Use it for gear that has
no smart-home integration at all, which is exactly the case for a $20 disco
light that came with a credit-card remote.
