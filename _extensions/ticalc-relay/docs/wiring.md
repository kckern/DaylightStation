# TI calculator 2.5 mm TRS wiring

This is a **5 V open-collector calculator bus**, not a 3.3 V UART. Never wire
the red or white conductor straight to an ESP32 GPIO and never configure an
ESP32 pin to drive either conductor high.

## Identify the three conductors

The expected cable colors are:

| Cable | TRS contact | TI link name | Relay connection |
|---|---|---|---|
| red | tip | red/data line | `TIP_BUS` |
| white | ring | white/data line | `RING_BUS` |
| black | sleeve | ground | `GND` |

Color is only a convenience. Before connecting the calculator, use a
continuity meter to identify tip, ring, and sleeve on the actual plug. A 2.5
mm TRS plug is not interchangeable with a 3.5 mm audio plug.

## Recommended interface circuit

Build two identical channels. The example below uses the firmware defaults
`TIP_SENSE_PIN=32`, `TIP_SINK_PIN=25`, `RING_SENSE_PIN=33`, and
`RING_SINK_PIN=26`; change the generated config if the M5 brick exposes a
different pinout.

```text
                         10k                    15k
TIP_BUS (red) ──────────/\/\/───+─────────────/\/\/── GND
                                |
                               100R
                                |
                         TIP_SENSE_PIN (ESP32 input)

TIP_BUS (red) ─────── drain   2N7002 / BSS138
                         source ─────────────── GND
ESP TIP_SINK_PIN ─100R─ gate
                         gate ──100k────────── GND
```

Duplicate the circuit with `RING_BUS` (white), `RING_SENSE_PIN`, and
`RING_SINK_PIN`. The 10k/15k divider produces about 3.0 V from a 5 V high
line, giving the ESP32 a reliable logic-high margin while staying below 3.3 V.
If the specific ESP32 input requires a different threshold, use a proper
5 V-tolerant buffer/level translator instead of changing the divider without
measuring it.

The sink transistor is an open-drain/open-collector switch: it can pull the
calculator line low, but it cannot source a high level. The 100k resistor keeps
the sink released while the ESP32 is booting or unpowered. Use one transistor
per line; do not share the drains.

## Point-to-point connections

| From | To |
|---|---|
| black cable / TRS sleeve | ESP32 GND and interface-board GND |
| red cable / TRS tip | both the tip divider input and tip MOSFET drain |
| white cable / TRS ring | both the ring divider input and ring MOSFET drain |
| tip divider midpoint | `TIP_SENSE_PIN` only |
| ring divider midpoint | `RING_SENSE_PIN` only |
| tip MOSFET gate | `TIP_SINK_PIN` through 100 Ω, plus 100 kΩ to GND |
| ring MOSFET gate | `RING_SINK_PIN` through 100 Ω, plus 100 kΩ to GND |

Power the interface from the ESP32 3.3 V rail only where the divider/buffer
requires it. Do not feed calculator 5 V into the M5 board. Keep the calculator
ground and ESP32 ground common through the black conductor.

## First power-up checklist

1. Leave the calculator disconnected. Confirm tip/ring/black continuity and
   that tip-to-ring and either line-to-black are not shorted.
2. Power the M5 and query `GET /health` (or `/status`). Both sink states must
   report released; no ESP32 pin should measure as a driven voltage on the
   cable side.
3. With the calculator still disconnected, measure each bus line. The
   interface must not pull either line low.
4. Connect the calculator only after the divider readings and MOSFET gates
   look correct. Start with the firmware's observe-only image; do not enable
   packet transmission until the line levels are stable.

The TI-86 link timing and packet protocol are specified in
[`../../ti86-app/docs/direct-link-relay.md`](../../ti86-app/docs/direct-link-relay.md).
