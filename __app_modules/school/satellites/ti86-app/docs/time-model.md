# SchoolCalc event-time model

## Decision

The TI-86 has no battery-backed real-time clock or TI-OS calendar service.
SchoolCalc therefore never invents an absolute calculator timestamp. A TI-86
record proves its device identity, device-global order, content identity, and
learner evidence; the backend proves when each copy arrived.

This is an evidence-quality rule, not merely a space optimization. A plausible
but unprovable time is worse than an explicitly unknown occurrence time.

## Hardware evidence

The manufacturer guidebook describes the lithium cell as retaining memory when
the AAA cells are removed and describes Automatic Power Down, but documents no
clock, date, calendar, or RTC interface. The supported inference is that the
cell protects Constant Memory rather than advancing civil time.

The calculator does expose a hardware interrupt at approximately 200 Hz. That
interrupt can measure foreground elapsed time, but it is not a wall clock: it
has no epoch, calendar, timezone, or trustworthy continuity across application
exit, APD, reset, battery loss, or memory clear.

Sources:

- Texas Instruments, [TI-86 Graphing Calculator Guidebook](https://education.ti.com/download/en/ed-tech/29D96806F8F4429C82F75713DF53EA1C/C7CFB64BF4924AD1BE8A514E7EF98E4A/86bookeng.pdf), pp. 16–17 (guidebook pagination), battery retention and APD.
- James G. Malcolm, [TI-86 interrupt mode 1 notes](https://jgmalcolm.com/z80/advanced/im1i), documenting the approximately 200 Hz hardware interrupt.
- R.S. Key, [TI-86 feature record](https://www.rskey.org/CMS/exhibit-hall/?id=7&manufacturer=Texas+Instruments&model=TI-86&view=article), whose capability legend distinguishes RTC from continuous memory and does not list RTC for the TI-86.

## Timestamp vocabulary

| Field | Authority | Meaning |
| --- | --- | --- |
| `sequence` | calculator durable state | Exact order and idempotency identity within one enrolled device identity |
| `receivedAt` | backend clock | Time one QR or relay copy reached the result importer |
| `startedAt` | result ledger | First durable import-start time, retained across interrupted retries |
| `completedAt` | result ledger | Time the backend completed the logical import |
| attempt `at` | School application | For a TI-86 import, the retained first import-start time; it is not claimed as physical completion time |
| progress `recordedAt` | School application | Same first import-start time, with `timeBasis: backend_received` |
| `occurredAt` | unavailable in TI-86 v0 | Omitted rather than guessed |

Each arrival has its own `receivedAt`. Thus QR-first followed days later by a
cable replay creates one credited logical result, two arrival observations,
and two honest receipt times. The later replay does not rewrite the first
attempt time.

## Cross-component contract

### TI-86 shell and adapter

- `SCR1` contains no wall-clock field and spends no QR capacity on one.
- The 24-bit sequence is committed with the durable queue append and is never
  reused under the same enrolled device ID.
- The TI-86 codec rejects `at`, `timestamp`, `occurredAt`, `completedAt`,
  `receivedAt`, or `recordedAt` claims rather than silently serializing them.
- The shell may use interrupt ticks for transient UI or duration measurement,
  but v0 does not place them in `SCR1`.

### Relay

- The relay transports exact `SCR1` bytes and does not alter or enrich them.
- Relay uptime, NTP time, HTTP time, and cable phase age are operational
  telemetry. None becomes calculator occurrence time.
- The relay may expose its own `observedAt` in future fleet telemetry, provided
  it remains separately named and never replaces backend `receivedAt`.

### Backend

- `ImportSchoolCalcResult` reads an injected application clock once per arrival
  and persists that value as `receivedAt`.
- Claim identity remains `{deviceId, sequence}` plus record digest; time is not
  part of identity or grading.
- A resumed incomplete import reuses its original `startedAt` for downstream
  School attempts while recording the retry's new `receivedAt` separately.
- Direct calculator timestamp fields are rejected as authority claims.
- API import responses expose the current arrival's `receivedAt`; absence of
  `occurredAt` means unknown, not equal to receipt time.

## Optional future duration evidence

A versioned capability such as `timing.session-relative@1` may later add an
integer duration or tick count for timed drills. Its contract must include tick
frequency, wrap behavior, pause policy, and a session identifier. It remains a
duration, never a civil timestamp.

A relay may also provide a signed or authenticated time anchor. A calculator
could display an approximate time while the same foreground session continues,
but any persisted evidence must declare `relay_anchored` plus uncertainty and
must become invalid after continuity is lost. This requires a new versioned
record shape; it must not be slipped into `SCR1` v1.

## Verification

Automated tests prove that:

1. the pure attempt factory requires an application-supplied canonical time;
2. the neutral submission rejects calculator wall-time authority fields;
3. the TI-86 codec rejects wall-time fields;
4. the result ledger stores separate canonical `receivedAt` values;
5. QR and cable copies retain one logical identity and two arrivals; and
6. an interrupted import preserves its first `startedAt` for resumed grading.

No physical hardware gate can create an RTC that does not exist. A future
relative-timing implementation does require emulator frequency tests and a
physical APD/exit/reset continuity matrix before its evidence is published.
