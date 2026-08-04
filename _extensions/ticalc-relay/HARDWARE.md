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

## Locked build decision

Start with two small, already-assembled modules and solder only their wires:

```text
TI cable → 2.5 mm stereo jack → BSS138 level-shifter breakout → ATOM Lite
```

No custom PCB and no discrete MOSFET/resistor circuit are required. A compact
"TI Link Hat" remains a future packaging refinement, not a prerequisite for a
working relay.

Power the ATOM before connecting the calculator cable, and remove the cable
before removing ATOM power. An unpowered BSS138 breakout has no defined high
side reference and must not be left attached to a calculator.

### v1: useful direct-link relay

Use two channels of an assembled BSS138 bidirectional level-shifter breakout.
Each channel is an open-drain level translator with a 10 kΩ pull-up, which is
the electrical model needed by the TI link bus. The ESP32 owns one open-drain
GPIO per TI line; it releases the line or pulls it low, never drives it high.

This first version proves a live calculator only from valid TI traffic or
`SCF1`; idle line levels never count as a connected calculator. Mechanical
insertion detection is not required.

### v1.1: mechanical insertion indication

Add a plug-detect input only after selecting a switched jack whose detect
contact is verified to be isolated from tip and ring. It reports
`absent`/`inserted`, never calculator power or protocol readiness. This option
must not delay v1.

## What to buy

| Qty. | Item | Required characteristics |
|---:|---|---|
| 1 | M5Stack ATOM Lite | ESP32 controller; its built-in RGB LED is on GPIO 27. |
| 1 | [Adafruit BSS138 4-channel bidirectional level converter](https://www.adafruit.com/product/757) | Use two channels. It is assembled, has 10 kΩ pull-ups, and supports the 3.3 V/5 V open-drain conversion needed here. The [SparkFun equivalent](https://www.sparkfun.com/products/12009) is also suitable. |
| 1 | [Same Sky / CUI SJ-2509N](https://www.cuidevices.com/product/resource/sj-2509n.pdf) | Plain 2.5 mm, stereo, three-conductor jack. Solder its tip, ring, and sleeve terminals to wires; its lack of a switch is intentional for v1. |
| 1 | 2.5 mm TRS male-to-male calculator link cable | A proper calculator cable, not a 3.5 mm audio lead or USB Graph Link. |
| 1 | Heat-shrink and strain relief | Insulate the three jack wires and relieve force from the jack terminals. |
| 1 | Digital multimeter | Mandatory before first calculator connection. |

The M5Stack ATOM Hub Proto Kit is optional: use it only if it gives the ATOM a
more convenient enclosure. Do not buy an RS-232 base, USB-to-TI Graph Link
cable, TXB0108-style automatic level shifter, or push-pull logic buffer. The
BSS138 breakout is deliberately different: its channels are open drain.

## Firmware interface contract

The BSS138 breakout needs a dedicated **single-pin-per-line open-drain**
firmware interface. It is not electrically compatible with the existing
four-pin discrete-interface profile (`TIP_SENSE_PIN`, `TIP_SINK_PIN`,
`RING_SENSE_PIN`, `RING_SINK_PIN`). Do not enable relay transmission with the
breakout attached until its BSS138 interface profile is flashed.

The profile must configure both line GPIOs as `OUTPUT_OPEN_DRAIN`: write low
to assert the line and write high to release it; read the same GPIO to sample
the translated bus level. Its expected private relay YAML is:

```yaml
link:
  interface: bss138_level_shifter
  tip_io_pin: 25
  ring_io_pin: 26
```

`bss138_level_shifter` is the required new interface name. GPIO 32 and GPIO
33 become unused by this build; they are retained only for the discrete
prototype circuit in [`docs/hardware-build.md`](./docs/hardware-build.md).

## Pin allocation

These are **ESP32-side** pins. They are not calculator pins.

| Function | Firmware symbol | Current pin | Direction/circuit |
|---|---|---:|---|
| TI tip/red I/O | `TIP_IO_PIN` | GPIO 25 | open-drain GPIO → `LV1` |
| TI ring/white I/O | `RING_IO_PIN` | GPIO 26 | open-drain GPIO → `LV2` |
| Built-in RGB LED | `LED_PIN` | GPIO 27 | already owned by the ATOM LED |
| Jack insertion detect (v1.1) | `PLUG_DETECT_PIN` | one spare, exposed, non-strapping GPIO | input only; external 10 kΩ pull-up |

Select the optional detect GPIO from a spare exposed ATOM pin. It must not be
one of the three pins above, a boot-strapping pin, or a pin used by the USB
serial path. Configure it in the private relay YAML:

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
| Tip | red | `TIP_BUS` | BSS138 `HV1` |
| Ring | white | `RING_BUS` | BSS138 `HV2` |
| Sleeve | black | `GND` | BSS138 `GND` and ATOM ground |

Solder these eight connections. Use two channels only; leave channels 3 and 4
unconnected and insulated.

```text
ATOM Lite                         BSS138 breakout              2.5 mm jack
─────────                         ───────────────              ────────────
3V3  ───────────────────────────→ LV
5V (USB rail) ──────────────────→ HV
GND  ───────────────────────────→ GND ───────────────────────→ sleeve
GPIO25 (`TIP_IO_PIN`) ──────────→ LV1
GPIO26 (`RING_IO_PIN`) ─────────→ LV2
                                   HV1 ───────────────────────→ tip
                                   HV2 ───────────────────────→ ring
```

The breakout's `HV` pin is a local 5 V reference from the ATOM's USB-powered
rail; it is not connected to calculator power. Its built-in 10 kΩ pull-ups
weakly bias the two link lines, just as an open-collector bus expects. The
ESP32 must never use a push-pull output on `LV1` or `LV2`, and no GPIO may be
connected directly to tip or ring.

For a future compact enclosure, these exact circuits can be integrated onto a
30–40 mm PCB; do not substitute a different electrical topology.

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
2. Verify the BSS138 breakout labels before soldering: 3.3 V goes only to `LV`,
   USB 5 V goes only to `HV`, and tip/ring go only to `HV1`/`HV2`. Do not trust
   connector order from a marketplace photo.
3. Power the ATOM with relay transmission disabled. With no calculator cable
   attached, verify `LV` is about 3.3 V, `HV` is about 5 V, and neither
   `HV1` nor `HV2` is shorted to ground.
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
   report a retryable failure, release both open-drain GPIOs, retain queues,
   and say `safe_to_unplug` only after it no longer owns the wire.

## Non-negotiable safety rules

- Never drive tip or ring high with a GPIO or a push-pull buffer. The BSS138
  breakout's 10 kΩ pull-ups are the only intentional high bias.
- Never enable transmission before the breakout-voltage and no-short tests
  pass.
- Never connect a calculator to an unpowered BSS138 breakout.
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
