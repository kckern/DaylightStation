# ticalc-relay

ESP32 M5Stack ATOM-class relay for TI calculators with a 2.5 mm TRS link
port (TI-86 first; TI-89-compatible transport is planned). The relay is the
physical bridge between [`../ti86-app`](../ti86-app) and the SchoolCalc APIs.

```
TI calculator 2.5 mm TRS
        |  protected open-drain interface
        ▼
M5 ATOM / ESP32 -- Wi-Fi --> DaylightStation SchoolCalc API
```

## Current milestone

The checked-in firmware contains the safe hardware bring-up layer and the
bounded production sync transaction:

- Wi-Fi and backend API configuration comes from the household SSOT;
- `/status` reports Wi-Fi/backend state plus raw/recent TRS activity, truthful
  peer evidence, direction, item progress, phase age, and cable safety;
- the idle TI task accepts a calculator-originated `SCSYNC`/`SCF1` HELLO without
  requiring a WebSocket command or manual HTTP pre-arm, while explicit Silent
  Link/diagnostic jobs remain serialized on the same wire;
- `/sync` queues one identity → observation/queue/request → Catalog/artifact →
  acknowledgement/manifest transaction;
- `DSID`, `DSINFO`, optional committed `DSINST`, optional `DSQ`, and optional
  `DSREQ` are read through the TI variable protocol;
- Catalog and immutable artifacts are fetched through the authenticated
  SchoolCalc API and validated before TI writes;
- `DSUSRNEW`, `DSPRGNEW`, `DSCATNEW`, artifact variables, and `DSACKNEW` are
  staged before `DSSYNC` is written last as the calculator-side transaction
  marker; learner/progress promotion and the content commit remain separately
  validated calculator operations;
- `/diagnostics/link/screenshot` and its `.raw` companion perform one gated,
  read-only TI-86 screenshot transaction for electrical bring-up (not a
  SchoolCalc API route); and
- both calculator lines are input-only at boot and are never driven high.

The relay LED is blue while negotiating, cyan for calculator upload, yellow
while contacting the backend, purple for calculator download, green on terminal
success, and red on terminal failure. Idle-high is reported as `unknown`, not
as proof that a cable is connected.

The screenshot path implements TI link bit timing and packet framing behind a
dedicated transport task. It is off by default and must only be enabled after
the protection board passes the meter checks. The sync state machine, HTTP
adapter, resource ceilings, native tests, and calculator-side staged commit are
implemented. The CRC-checked `SCF1` codec, foreground variable adapter,
calculator-originated listener, and bounded TI-86 `SCSYNC` port-7 client are
linked and build-tested. The virtual relay has two complementary lanes: a
TilEm raw-BlackLink run executes the exact `SCSYNC` binary over emulated port
7 (HELLO plus ordered phase/progress frames) and checks ON/ENTER/CLEAR matrix
input; the hermetic production relay session byte-compares semantic
Catalog/module, quiz/progress, and staging records. The owned SchoolCalc 1.4
ROM is valid for the MAME Graph Link provisioning and TI-OS UI path. TilEm
cannot safely resume MAME's TI-OS VAT helper state after a cross-emulator RAM
transfer, so full calculator String-variable service remains covered by the
semantic lane, not misreported as a 1.4 compatibility failure. Stock MAME
does not test TI-86 port 7. Protected-cable bench proof remains.

The SchoolCalc application itself has a separate owned-ROM MAME release gate:
it validates the complete variable bundle over MAME's virtual Graph Link,
then runs the TI-OS launcher, learner/profile flow, Catalog/reader, quiz, and
result QR. That gives the relay a proven peer-side application contract, but
does not verify this ESP32's electrical protection, TRS timing, Wi-Fi, or
backend credentials; those remain the relay's physical acceptance gates.
The permanent electrical and protocol contract is documented in
[`../ti86-app/docs/direct-link-relay.md`](../ti86-app/docs/direct-link-relay.md).
The before/during/after user and evidence contract is in
[`../ti86-app/docs/transport-awareness.md`](../ti86-app/docs/transport-awareness.md).

## Transport contract — do not regress

This relay is a TI link peer, not a UART adapter. The calculator's 2.5 mm TRS
tip and ring are a shared 5 V, asserted-low, open-collector bus: the ESP32
only senses each line through a protected divider and only asserts it by
turning on that line's external sink transistor. It never drives either line
high; both sinks must be released during reset and at boot. A high/idle input
is merely `unknown_idle`, not proof of a connected calculator.

Each link byte is LSB-first and uses the four-edge TI handshake: the sender
asserts red or white for a zero or one bit, the receiver acknowledges on the
opposite line, then both release. Above that electrical layer, packets are
`machineId | command | length(u16 LE) | data | additiveChecksum(u16 LE)`;
the relay identifies as `06h` and a TI-86 as `86h`. Edge, packet, and retry
waits are bounded. Keep this timing loop in the dedicated link task—never in
the Wi-Fi, HTTP, WebSocket, or UI loop.

There are two intentional transport owners:

| Calculator state | Wire protocol | What the relay may do |
|---|---|---|
| TI-OS owns the link | TI variable packets (`VAR`, `CTS`, `DATA`, `ACK`, `EOT`, etc.) | Read/write staged Strings and use the read-only screenshot gate. |
| SchoolCalc `SCSYNC` owns port 7 | TI `DATA` carrying `SCF1` frames | Exchange HELLO/HELLO_ACK, ordered phase/progress, variable, ACK, error, cancel, and completion frames. One SCF1 frame is in flight; chunks are at most 128 bytes. |

`SCF1` is CRC protected: `"SCF1" | type | flags=0 | sequence(u16 LE) |
payloadLength(u16 LE) | payload(0..256) | CRC-16/CCITT-FALSE`. The same
`ICalculatorVariables` boundary is used above either wire owner, so backend
code must not assume it knows which mode transferred a record. Catalog and
artifacts are staged first; `DSSYNC` is written last as the calculator-side
commit marker. Result and delivery queues are retired only after their matching
acknowledgements, making a reconnect or QR-first delivery idempotent.

The permanent test evidence is deliberately split. MAME performs Graph Link
provisioning and the actual TI-OS/keyboard path on the owned SchoolCalc 1.4
ROM. TilEm executes the exact `SCSYNC` Z80 port-7 code and tests raw
HELLO/phase/ACK frames plus ON/ENTER/CLEAR matrix input. The production virtual
session byte-checks the complete Catalog/module, quiz, progress, staging, and
queue-retirement transaction. Do not claim TilEm completes a MAME-resumed
TI-OS VAT service call: that is a cross-emulator-state limitation, not a
SchoolCalc 1.4 compatibility failure. Stock MAME has no TI-86 port-7 peer.

The recommended cable/interface wiring is in [`docs/wiring.md`](./docs/wiring.md).
The exact bill of materials, switched-jack presence detector, status evidence
contract, and safe build sequence are in [`HARDWARE.md`](./HARDWARE.md).
The locked product requirements and remaining decisions are in
[`docs/requirements.md`](./docs/requirements.md).
The backend implementation handoff is in
[`docs/backend-handoff.md`](./docs/backend-handoff.md).
The concrete calculator-variable, HTTP, and sync contract is in
[`docs/v1-protocol.md`](./docs/v1-protocol.md).
The deterministic host transaction lane is available with
`node firmware/tools/test-virtual-relay.mjs`; the owned-ROM emulator and
keyboard/UI coverage is documented in
[`docs/virtual-relay.md`](./docs/virtual-relay.md).
The local telemetry schema and failure runbooks are in
[`docs/operations-and-diagnostics.md`](./docs/operations-and-diagnostics.md).
The approved decisions and unresolved design gaps are in
[`docs/v1-design.md`](./docs/v1-design.md).
The plain-language ATOM Lite build and first-test guide is
[`docs/hardware-build.md`](./docs/hardware-build.md), with a printable
[PDF](./docs/hardware-build.pdf).
The OMR relay's operational conventions are followed here: generated config,
LAN health diagnostics, and a non-blocking retry-oriented device loop.

## Fleet transport split

The relay uses each protocol for the job it handles best:

| Channel | Role | Failure behavior |
|---|---|---|
| WebServer on port 80 | LAN `/health`, `/status`, `/sync`, and bring-up controls | works while Wi-Fi is local, independent of backend WS state |
| WebSocket `/ws` | fleet presence, health heartbeat, and future remote sync commands | reconnects automatically; never carries the only copy of a result |
| HTTP SchoolCalc API | identity, combined sync, Catalog/artifact download, and result import | calculator `DSQ` remains authoritative; retries are idempotent |

MQTT is not included in this image. Adding it would duplicate fleet presence
and command delivery without replacing the calculator's required HTTP API
boundary. It can be added later as an adapter if the wider device fleet
standardizes on a broker.

## Electrical safety

The calculator link is a 5 V open-collector bus. Do not connect tip or ring
directly to an ESP32 GPIO. Each line needs a high-impedance 5 V-to-3.3 V input
divider/level shifter and a separate N-MOSFET/NPN sink. The sink gate/base must
be pulled down so reset releases the calculator bus.

| TRS contact | Interface board | Firmware default |
|---|---|---|
| Tip / red | divider output + sink gate | `TIP_SENSE_PIN=32`, `TIP_SINK_PIN=25` |
| Ring / white | divider output + sink gate | `RING_SENSE_PIN=33`, `RING_SINK_PIN=26` |
| Sleeve | common ground | GND |

Verify the actual M5 brick pinout and change the generated configuration
before attaching a calculator. The default sink pins are held released; the
bring-up firmware never asserts them. See [`docs/wiring.md`](./docs/wiring.md)
before making the cable connection.

## Build and flash

For owned-ROM capture and the MAME virtual Graph Link lane, build the macOS
host utility and its pinned tilibs dependencies under this extension:

```sh
_extensions/ticalc-relay/tools/build-ti86-graph-link.sh
```

The checked-in patch avoids sending a zero-byte DBUS packet when a transfer is
an exact multiple of libticalcs' progress block size. Without it, MAME artifact
installs can hang after the final full chunk. The build needs the Homebrew
`glib`, `libusb`, `libarchive`, `pkg-config`, and autotools packages.

```sh
cd _extensions/ticalc-relay/firmware
node tools/gen-config.mjs <data-dir>/household/config/ticalc-relay.yml
pio run -e m5-atom -t upload --upload-port /dev/cu.usbserial-XXXX
```

`include/config.h` is generated and gitignored. Do not put Wi-Fi credentials
in the repository. The `bench-esp32` environment permits API/status testing
on a generic ESP32 without a TRS cable.

## Backend boundary

The normal firmware transaction uses the configured
`/api/v1/school/calc/devices/identify`, device `sync`, Catalog, and immutable
artifact endpoints. It transports opaque family records and does not grade,
select a learner, or trust calculator-provided correctness. The calculator
scores from its bounded answer key while offline; the backend independently
regrades before credit. `deviceId + sequence` remains the backend idempotency
key, so QR-first and relay-first delivery can converge.
