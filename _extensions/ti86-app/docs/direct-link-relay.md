# Direct TI-86 link relay — permanent operational contract

> **Adaptive Study v1 boundary:** The electrical interface, TI packet layer,
> foreground ownership, retry rules, diagnostics, result idempotency, and
> write-last commit mechanism in this document are retained. Catalog refresh,
> install/remove requests, learner rosters, progress projections, and realtime
> tutor interactions are inactive learner routes in the default v1 release.
> The canonical resolution transaction is defined by
> [`schoolcalc-v1-requirements.md`](./schoolcalc-v1-requirements.md).

## Recommendation

Build the relay directly on the TI-86's **2.5 mm TRS** link port. It is a
permanent bidirectional DaylightStation device: it imports calculator-originated
records and transfers server-originated packs or commands whenever the
calculator is connected and responsive. Do not put the existing USB Graph Link
in the production path.

The USB cable is an active, vendor-specific bridge. A direct relay instead
speaks the documented calculator link protocol and works with an ordinary
Wi-Fi ESP32; it needs no USB-host controller.

```
TI-86 2.5 mm link port ──TRS cable──▶ protected open-drain interface ──GPIO──▶ ESP32 / M5 ATOM Lite
                                                                                     │ Wi-Fi
                                                                                     ▼
                                                                            DaylightStation School
```

## Electrical interface — required, not optional

| TRS contact | TI wire name | Relay connection |
|---|---|---|
| Tip | red | input divider → ESP GPIO; separate open-drain transistor output |
| Ring | white | input divider → ESP GPIO; separate open-drain transistor output |
| Sleeve | ground | common ground |

The calculator uses 5 V open-collector signalling. The ESP32 is **not 5 V
tolerant** and must never drive either line high. Each data line therefore
needs both:

1. a high-impedance 5 V → 3.3 V input divider or proper level shifter, and
2. an NPN/NMOS open-drain sink controlled by the ESP32, defaulting to release
   (high impedance) during boot/reset.

Use a 2.5 mm TRS socket/cable, not a 3.5 mm audio cable. Keep output FET gates
pulled down so powering or rebooting the relay cannot hold a calculator line
low. Do not attach a push-pull GPIO directly to tip or ring.

## Protocol layers

### 1. Wire bits

The link sends bytes least-significant bit first. A bit is a four-edge
handshake: the sender pulls red or white low to signal 0 or 1; the receiver
pulls the opposite line low; then each releases its line. Typical throughput
is 45–50 kbit/s. This is GPIO timing work, so it belongs in a small dedicated
ESP task, not inside the WebSocket loop.

### 2. TI-86 packets

Packets are:

```
machine-id | command | data-length (u16 little-endian) | data | checksum (u16 LE)
```

The relay presents as computer-for-TI-86 (`0x06`); the calculator responds as
TI-86 (`0x86`). The checksum is the low 16 bits of the data-byte sum.

Read-only validation command: request a screenshot with
`06 6D 00 00`. A TI-86 should acknowledge, return a `0x15` data packet with a
1024-byte LCD frame, and accept the host ACK. This is the first on-hardware
protocol milestone because it cannot modify calculator data.

### 3. School sync

`SCQUEUE` appends compact response/progress records to `DSQ` through a verified
`DSQB` replacement after `SCLEARN` commits the pending continuation. The relay silently requests that named variable and
submits each record to the **same** backend import endpoint used by a QR scan.
The idempotency identity is `{calculator-id, record-sequence}`; the record's
full CRC-protected bytes/digest are retained with that identity. Do **not**
delete the calculator queue merely as proof of delivery; retaining it makes
relay outages, a cable pull, and a prior QR scan harmless.

The backend decodes and validates the record, then invokes the existing School
grader. Persisted attempt events use `transport: 'calculator'`; the calculator
does not decide correctness, identity, or credit. `transport` can additionally
record `qr` or `relay` as arrival detail, but it must never change the result
identity or grading outcome.

## Offline queue and cross-transport idempotency

> **Current implementation contract:** `DSQ` queues `SCR1` result records;
> `SCP1` is reserved for downloaded lesson packages. The `DS1:R:...` notation
> below documents an earlier compact-envelope experiment. New relay, shell, and
> backend work must use the `SCR1` envelope implemented by
> `Ti86SchoolCalcCodec` and specified in
> [`../../ticalc-relay/docs/v1-protocol.md`](../../ticalc-relay/docs/v1-protocol.md).

`DSQ` is an append-only local result queue. Every completed quiz/drill creates
one immutable record before showing its QR code:

```
SCR1 binary bytes                  (inside SCQ1 over cable)
sch:r1:<BASE32 of exact SCR1>      (when displayed as QR)
```

The QR screen displays those exact bytes. A later cable sync sends those same
bytes. This gives the following required importer behavior:

| Server has seen | Incoming record | Result |
|---|---|---|
| Nothing | Valid record | Grade and append attempts; return `accepted` |
| Same identity and same digest | QR or relay replay | Return `duplicate`; append nothing |
| Same identity and a different digest | Collision/tampering | Return conflict; append nothing |
| A partially interrupted prior import | Same record | Append only missing item attempts; return completion |

The server’s receipt ledger is therefore keyed by
`calculator-id + monotonic-sequence`, not by the transport and not by a QR
scan session. QR-first and cable-first are indistinguishable to grading. Each
arrival nevertheless receives its own backend `receivedAt`; the TI-86 supplies
no wall time because it has no RTC.

After an `accepted` or `duplicate` reply, the relay stages a bounded `SCA1`
record as `DSACKNEW` and writes the matching final `DSSYNC` manifest last. The
shell deletes the exact acknowledged queue batch only while committing that
validated manifest. It must preserve the calculator ID and never reuse a
sequence after compaction. If an acknowledgement is lost, replaying `DSQ` is
safe by design.

## Bidirectional sync contract

For Adaptive Study v1, combined sync imports queued results and resolves a
calculator-owned `DSENTRY`/`SCE1` claim. An installed immutable artifact needs
only the staged `DSSTDNEW`/`SCSP` prescription and final acknowledgement. A
missing artifact is written and verified first, the staged prescription
second, and `DSSYNC` last. Only that exact acknowledgement permits the
calculator to promote `DSSTUDY` and clear the matching entry request.

Unknown, completed, unauthorized, incompatible, memory-blocked, and
interrupted resolutions retain prior canonical state. A six-digit code is a
navigation value; the authenticated backend reauthorizes its learner, work,
bank, artifact, and requesting device at resolution time.

The older Catalog/artifact manifest sequence below documents retained v0
infrastructure and diagnostics; it is not the v1 learner route.

The calculator is online **while attached to the powered relay and answering
link requests**. Treat sync as a short transaction on plug/manual request, not
as an always-open socket.

```
calculator ── DSQ (results) ──▶ relay ── HTTPS/WS ──▶ server
calculator ◀── SCC1/DP* (Catalog/artifacts) ── relay ◀── HTTPS/WS ── server
```

1. While no explicit TI job owns the bus, the relay arms its foreground listener
   and accepts an explicit SchoolCalc `HELLO` initiated by the calculator; no
   HTTP/WebSocket pre-arm or `LINK > RECV` is required. Manual/auto Silent Link
   remains available for compatibility. Raw line levels are diagnostic only:
   the absent level depends on the protection input circuit, and neither idle
   nor an edge is called a verified peer before a valid handshake.
2. It retrieves the calculator's `DSQ` result queue and submits every record
   with its calculator ID and monotonic sequence. The server returns accepted
   sequence numbers; retries are safe.
3. It asks the server for the pending outbound manifest for that calculator.
   Each immutable pack has an ID, byte length, checksum, and generation.
4. It silently transfers missing immutable `DP*` variables plus staged
   Catalog/install records to the calculator and records
   completion only after the calculator ACKs the variable data.
5. It sends relay health/sync outcome to the server. A failed or unplugged
   transfer never drops either queue.

The relay may cache the next outbound manifest, but the server remains the
authority. The TI-86 app accepts only bounded, versioned data files; it never
executes server-supplied assembly. A server command therefore means a known
data record such as `show-pack`, `replace-pack`, or `clear-completed`, not
arbitrary code execution.

## Bring-up order and current state

The software portions below are implemented and native-tested; the protected
electrical interface and physical TI-86 transfer matrix remain hardware gates.

1. Make the interface; firmware observes and logs the two link-line
   levels. Validate that unplugged/plugged states behave as expected.
2. Implement the bit handshake and run only the read-only screenshot command.
   Save the received 1024 bytes for visual comparison.
3. Use the implemented silent request of a known test String variable; verify checksum,
   retry, timeout, and out-of-memory/error paths.
4. Exercise the implemented Wi-Fi upload, queue deduplication, health endpoint,
   and structured diagnostics.
5. Exercise the implemented SCR1/SCQ1 result path and School import endpoint.

The relay starts a sync after verifying a calculator-originated foreground
handshake, and also exposes manual Silent Link/foreground actions for diagnostics
and recovery. A raw edge alone never starts backend work. A calculator can be
off, in a link-busy state, or disconnected mid-packet. See
[`transport-awareness.md`](./transport-awareness.md) for the evidence model,
live state vocabulary, and safe-to-unplug contract.

## Why not retain the USB Graph Link?

It can work, but it requires an ESP32-S2/S3-class USB **host** and a port of
the Graph Link's vendor USB transport before any calculator packet can be
sent. The M5 ATOM Lite's standard ESP32 is USB-device/serial oriented and is
not a suitable host. The direct port needs four GPIO paths and a tiny level
shifter board instead, and its protocol is documented and testable.

## Sources

- [TI-86 link port, bit handshake, and packet examples](https://paperlined.org/EE/microcontrollers/pic/projects/portable_VT_terminal/ti_86_link_port/link86all.htm)
- [TI-86 packet and variable format reference](https://merthsoft.com/linkguide/ti86/packet.html)
- [Reverse-engineered TI USB Graph Link hardware/firmware](https://github.com/queueRAM/ti_graph_link)
