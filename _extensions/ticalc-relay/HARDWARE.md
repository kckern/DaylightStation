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

## Exact hardware to obtain

| Qty. | Item | Required characteristics |
|---:|---|---|
| 1 | M5Stack ATOM Lite | ESP32 controller; its built-in RGB LED is on GPIO 27. |
| 1 | M5Stack ATOM Hub Proto Kit | A solderable carrier/enclosure for the ATOM. |
| 1 | 2.5 mm **stereo TRS switched jack** | Panel/board-mount socket with an independent normally-closed plug-detect contact. Its datasheet must show which contact changes only on plug insertion. A plain three-terminal socket is insufficient for reliable insertion detection. |
| 2 | 2N7000 N-channel MOSFETs | One independent open-drain sink per TI line. BSS138 is acceptable only after its pinout and low-gate behaviour are verified for the chosen part. |
| 2 | 10 kΩ, 1/4 W resistors | Upper legs of the TI-to-ESP input dividers. |
| 2 | 15 kΩ, 1/4 W resistors | Lower legs of the TI-to-ESP input dividers. |
| 4 | 100 Ω, 1/4 W resistors | Two GPIO-input protection resistors and two MOSFET-gate resistors. |
| 2 | 100 kΩ, 1/4 W resistors | Gate pulldowns; they keep both sinks released through reset/unpowered states. |
| 1 | 10 kΩ, 1/4 W resistor | External 3.3 V pull-up for the jack-detect input. Do not rely solely on an ESP32 internal pull-up. |
| 1 | 1 kΩ, 1/4 W resistor | Series protection between the jack's detect contact and its GPIO. |
| 1 | 100 nF ceramic capacitor | Jack-detect debounce capacitor, from GPIO side of the 1 kΩ resistor to ground. |
| 1 | 2.5 mm TRS male-to-male calculator link cable | A proper calculator cable, not a 3.5 mm audio lead and not a USB Graph Link. |
| 1 | Digital multimeter | Mandatory before the first calculator connection. |
| 1 | Heat-shrink, strain relief, insulated enclosure | Mandatory for the cable and the finished board. |

Do not buy an RS-232 base, a USB-to-TI Graph Link cable, or a generic I²C
bidirectional level-shifter board for this circuit. None provides the required
two independent, reset-safe open-drain sinks.

## Pin allocation

These are **ESP32-side** pins. They are not calculator pins.

| Function | Firmware symbol | Current pin | Direction/circuit |
|---|---|---:|---|
| TI tip/red sense | `TIP_SENSE_PIN` | GPIO 32 | divider output → input only |
| TI tip/red assert | `TIP_SINK_PIN` | GPIO 25 | MOSFET gate through 100 Ω |
| TI ring/white sense | `RING_SENSE_PIN` | GPIO 33 | divider output → input only |
| TI ring/white assert | `RING_SINK_PIN` | GPIO 26 | MOSFET gate through 100 Ω |
| Built-in RGB LED | `LED_PIN` | GPIO 27 | already owned by the ATOM LED |
| Jack insertion detect | `PLUG_DETECT_PIN` | one spare, exposed, non-strapping GPIO | input only; external 10 kΩ pull-up |

Select the detect GPIO from pins physically exposed by the particular ATOM Hub
Proto carrier. It must not be one of the five pins above, a boot-strapping pin,
or a pin used by the USB serial path. Configure it in the private relay YAML:

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

## Plug-detect wiring

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
4. With no calculator cable inserted, verify the jack-detect GPIO is low.
   Insert the cable only into the relay jack and verify it becomes high after
   debounce. Confirm this test does not change either tip/ring net.
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
