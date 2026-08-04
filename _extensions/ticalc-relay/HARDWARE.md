# ticalc-relay hardware contract

This is the build sheet for a **TI-86 2.5 mm link relay with trustworthy local
status**. Build this circuit before enabling `link.transmit_enabled`. The
calculator link is a 5 V, asserted-low, open-collector bus; it is not audio,
UART, RS-232, or a 3.3 V GPIO signal.

The intended status model is deliberately evidence based:

```text
mechanical jack → electrical bus → verified protocol peer → sync transaction
        ↓                ↓                  ↓                    ↓
 absent/inserted   idle/activity/fault  packet/SCF1 proof   phase/outcome
```

Do not collapse those facts into a false `connected` indicator. In particular,
tip/ring high means only `unknown_idle`; it does not prove that a plug or a
powered calculator is present.

## Locked product decision

The production path is a small, factory-assembled **TI Link Hat** PCB for the
ATOM—not a hand-soldered collection of loose parts. This board is specified
here but has not yet been designed or fabricated.

```text
TI cable → 2.5 mm jack → TI Link Hat → short keyed header → ATOM Lite
```

### v1: useful direct-link relay

The first board contains the jack, two protected TI-line sense channels, two
open-drain sinks, a keyed low-voltage header, and enclosure mounting. It
proves a live calculator only from valid TI traffic or `SCF1`; idle line levels
never count as a connected calculator. Mechanical insertion detection is not
required for this useful first version.

### v1.1: mechanical insertion indication

Add a plug-detect input only after selecting a switched jack whose detect
contact is verified to be isolated from tip and ring. It reports
`absent`/`inserted`, never calculator power or protocol readiness. This option
must not delay v1.

## What to buy or order

| Qty. | Item | Required characteristics |
|---:|---|---|
| 1 | M5Stack ATOM Lite | ESP32 controller; its built-in RGB LED is on GPIO 27. |
| 1 | Factory-assembled TI Link Hat | Custom 30–40 mm board specified below; replaces loose MOSFETs, resistors, and jack wiring. |
| 1 | 2.5 mm TRS male-to-male calculator link cable | A proper calculator cable, not a 3.5 mm audio lead or USB Graph Link. |
| 1 | Enclosure or ATOM carrier | Provides strain relief and a protected place for the small PCB. |
| 1 | Digital multimeter | Mandatory before first calculator connection. |

The M5Stack ATOM Hub Proto Kit is useful only for development and board
bring-up; it is not the normal production adapter. Do not buy an RS-232 base,
a USB-to-TI Graph Link cable, or a generic I²C bidirectional level-shifter
board. None provides the required two independent, reset-safe open-drain
sinks.

## TI Link Hat fabrication contract

Target a 30–40 mm board with factory SMD assembly; the jack may be a
through-hole or panel-mount component if that makes enclosure mounting more
reliable. The installer should connect only a keyed header and calculator
cable—not solder the link interface.

| Function | Required circuit |
|---|---|
| Tip sense | 10 kΩ / 15 kΩ divider and 100 Ω GPIO protection; 5 V TI bus to 3.3 V input only. |
| Ring sense | Same protected input circuit as tip. |
| Tip sink | 2N7000-class N-channel MOSFET, 100 Ω gate resistor, 100 kΩ gate pulldown; open drain only. |
| Ring sink | Same independent open-drain circuit as tip. |
| v1.1 plug detector | 10 kΩ external pull-up, 1 kΩ series resistor, 100 nF debounce capacitor, only with a verified isolated jack contact. |

The keyed header carries 3.3 V, ground, the four TI GPIOs, and optionally the
plug-detect GPIO. It must not carry TI bus voltage into the ATOM power rails.

## Pin allocation

These are **ESP32-side** pins. They are not calculator pins.

| Function | Firmware symbol | Current pin | Direction/circuit |
|---|---|---:|---|
| TI tip/red sense | `TIP_SENSE_PIN` | GPIO 32 | divider output → input only |
| TI tip/red assert | `TIP_SINK_PIN` | GPIO 25 | MOSFET gate through 100 Ω |
| TI ring/white sense | `RING_SENSE_PIN` | GPIO 33 | divider output → input only |
| TI ring/white assert | `RING_SINK_PIN` | GPIO 26 | MOSFET gate through 100 Ω |
| Built-in RGB LED | `LED_PIN` | GPIO 27 | already owned by the ATOM LED |
| Jack insertion detect (v1.1) | `PLUG_DETECT_PIN` | one spare, exposed, non-strapping GPIO | input only; external 10 kΩ pull-up |

Select the detect GPIO from the pins exposed by the TI Link Hat header. It must
not be one of the five pins above, a boot-strapping pin, or a pin used by the
USB serial path. Configure it in the private relay YAML:

```yaml
link:
  plug_detect_pin: <your free GPIO>
  plug_detect_active_high: true
```

`true` matches the low-without-plug/high-with-plug circuit below. The firmware
uses the detector only as an input, debounces it for 75 ms, reports
`physical_presence: absent|inserted|unknown`, and records insert/remove events.
Leaving the pin at its default `-1` intentionally retains `unknown`.

## TI link wiring

The calculator cable has three conductors. Verify them with a continuity meter;
do not trust wire colours.

| TRS contact | Typical cable colour | Net name | Connects to |
|---|---|---|---|
| Tip | red | `TIP_BUS` | tip divider and tip MOSFET drain |
| Ring | white | `RING_BUS` | ring divider and ring MOSFET drain |
| Sleeve | black | `GND` | common circuit/ESP32 ground |

Build two identical channels:

```text
TIP_BUS ──────+────── 10k ──────+────── 100R ─── GPIO32  (sense only)
              |                  |
              |                 15k
              |                  |
              |                 GND
              |
              +── drain  2N7000  source ──────────────── GND
                         gate
GPIO25 ───────────────── 100R ───+
                                  |
                                100k
                                  |
                                 GND
```

Duplicate the circuit for `RING_BUS`, GPIO 33, and GPIO 26. The 10 kΩ/15 kΩ
divider converts a nominal 5 V high to about 3.0 V at the ESP32 input. The
MOSFET can pull the line low but can never drive it high. Its 100 kΩ gate
pulldown is a required safety component, not an optimization.

Connect sleeve/black to ESP32 ground exactly once at the interface board. Do
not feed calculator voltage into the M5 3.3 V or 5 V rails. Do not connect an
ESP32 GPIO directly to tip or ring.

## v1.1 plug-detect wiring

Use only an **isolated switched contact** on the jack. Some switched jacks
provide contacts that short a signal conductor when no plug is inserted; do
not use those contacts for detection. The selected contact must be electrically
separate from tip and ring.

Choose a jack where the detection contact is closed to sleeve when no plug is
inserted and opens when a plug is inserted. Wire it this way:

```text
3V3 ── 10k ──+── PLUG_DETECT_PIN
             |
            100nF
             |
            GND

PLUG_DETECT_PIN ── 1k ── switched detect contact ── sleeve/GND
```

This produces `LOW = no plug` and `HIGH = plug inserted`. Firmware must
debounce the signal for 50–100 ms and call the result **mechanical insertion**,
not calculator presence. If the chosen jack has the opposite switch polarity,
reverse the reported polarity in configuration—never move the detect wire onto
tip or ring.

The calculator may be off, in another link operation, or electrically faulty
while the plug is mechanically inserted. Only a valid TI packet or a valid
`SCF1` HELLO verifies a peer.

## Required status vocabulary

Once the circuit and optional detect input are available, status must preserve
these separate facts:

| Evidence level | Permitted value(s) | What proves it |
|---|---|---|
| Mechanical | `absent`, `inserted`, `unknown` | switched-jack contact, or no detector installed |
| Electrical | `unknown_idle`, `line_activity`, `both_lines_low_fault`, `busy` | protected tip/ring inputs only |
| Peer | `none`, `hello_candidate`, `ti_packet_verified`, `scf1_verified` | checksum-valid TI packet or CRC-valid SCF1 HELLO |
| Operation | `queued`, `negotiating`, `upload`, `network`, `download`, `awaiting_calculator_commit`, `complete`, `blocked`, `failed` | owning transaction state |
| Unplug advice | `keep_connected`, `safe_to_unplug` | transaction state, never just cable level |

The LED is an abbreviated version of this model. It must not replace
`/status` or diagnostics:

| Highest-priority condition | LED pattern |
|---|---|
| Both lines low / electrical safety fault | rapid red double flash |
| Active wire phase | 3–4 Hz pulse: blue negotiating, cyan calculator→relay, purple relay→calculator |
| Active backend work | slow yellow breathe |
| Completed, acknowledged relay transaction | solid green for 8–10 seconds, then ready heartbeat |
| Retryable or terminal failure | slow red blink until a new operation starts |
| Idle and service healthy | brief dim green heartbeat every 3–5 seconds |
| Wi-Fi/API unavailable | slow amber breathe |
| Plug inserted but no verified peer | amber heartbeat; never green “connected” |

## Build and meter checklist

Do every check in this order. If a result differs, remove USB and calculator
power before changing wiring.

1. With the ATOM unpowered and no cable inserted, verify no short between tip,
   ring, and sleeve. A momentary changing resistance from capacitors is normal;
   a steady near-zero resistance is not.
2. Verify each MOSFET's actual gate, drain, and source pinout against the
   manufacturer's datasheet. Do not trust a random package diagram.
3. Power the ATOM with `link.transmit_enabled: false`. Measure each MOSFET gate
   relative to ground: it must be near 0 V, not 3.3 V.
4. For a v1.1 board, with no calculator cable inserted, verify the jack-detect
   GPIO is low. Insert the cable only into the relay jack and verify it becomes
   high after debounce. Confirm this test does not change either tip/ring net.
   Skip this test for v1: it reports mechanical insertion as `unknown` by
   design.
5. Still with transmission disabled, insert the calculator cable and confirm
   the calculator does not reset, enter a menu, or receive a key event.
6. Request `/status`; confirm transmit is disabled, physical insertion is only
   reported if the detect feature is configured, and idle bus level is not
   labelled connected.
7. Enable transmission with foreground listener and auto-sync still disabled.
   Run the read-only screenshot diagnostic first. It must complete before any
   variable write or foreground sync test.
8. Run a complete Catalog/module, progress, and quiz sync. Only then enable
   the normal foreground listener.
9. Test interruption: pull the plug during an active transfer. The relay must
   report a retryable failure, release both sink gates, retain queues, and say
   `safe_to_unplug` only after it no longer owns the wire.

## Non-negotiable safety rules

- Never drive tip or ring high.
- Never enable transmission before the gate-voltage and no-short tests pass.
- Never infer insertion or a calculator peer from idle-high line readings.
- Never use the LED as the only diagnosis or as evidence that a record was
  committed.
- Never delete calculator results or delivery requests merely because a cable
  packet was sent; wait for the staged acknowledgement and calculator commit.
- Keep the link timing code on its dedicated ESP32 task; Wi-Fi, HTTP,
  WebSocket, and LED animation must not stretch a link edge.

For software and endpoint detail, see [`README.md`](./README.md),
[`docs/wiring.md`](./docs/wiring.md), and
[`docs/operations-and-diagnostics.md`](./docs/operations-and-diagnostics.md).
