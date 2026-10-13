# TI-86 QR outbound channel

## Status

**Proven on physical hardware, 2026-08-01.** The `QRDEMO` TI-86 assembly
program rendered a camera-readable Version 1/M QR code on the calculator's
128×64 LCD. A result can therefore leave the calculator without USB and before
the permanent ESP relay exists.

```
TI-86 quiz result → QR on LCD → phone/camera scan → DaylightStation import
```

This establishes a durable transport option, not merely a visual test. It is the
offline fallback when the calculator is away from the relay, and may be the
simplest normal handoff for a supervised quiz.

## Constraints that are now settled

- The physical display supports a **Version 1, EC-M** QR (21×21 modules) at **2×**
  scale: 42×42 pixels.
- A four-module quiet zone fits in the 128×64 monochrome LCD.
- Keep result payloads compact and ASCII/alphanumeric where possible. The
  code is a result receipt, not a question bank or a bulk-sync format.
- QR is **outbound only**. A camera scan does not give the server a path to
  install packs or modify the calculator. The direct ESP link relay owns that
  bidirectional job.

The production `SCQR` runtime is now source-complete and builds its payload,
Reed–Solomon codewords, and pixels on the calculator. It uses a fixed **Version
5, EC-M, mask 0** profile: 37×37 modules plus a four-module quiet zone occupy
45×45 pixels. That fits every v0 compact result (up to 48 ordered choices and
67 `SCR1` bytes) with much larger modules than the Version-9 density fixture.
Host tests compare the fixed encoder module-for-module with the QR library.
Physical scanning of the dynamic runtime remains gated on fresh batteries and
safe emulator execution.

## Lesson-action QR

A second optical profile lets downloaded lesson content request a safe
server-resolved follow-up action:

```text
sch:<16-character opaque token>
```

This token is an 80-bit device-bound HMAC-derived identifier registered in the
School token registry. It exposes no learner, target, provider, lesson policy,
or command. The immutable lesson artifact carries the token and an exact packed
Version-1/EC-L symbol; the print/media meaning remains in the mounted server
action definition and is revalidated on every scan. Tokens are repeatable but
revocable, and a `tokenVersion` increment rotates a published action.

`SCLEARN` validates `kind: scan_action`, the exact token alphabet and length,
the 63-byte typed QR field, and all unused row-padding bits before showing an F1
`QR` affordance. The full-screen renderer expands the 21×21 bits to 2×2 modules
at `(43,11)`. The surrounding four-module quiet zone produces a centered 58×58
optical frame. F1, ENTER, EXIT, or LEFT returns to the same lesson page without
acknowledging, advancing, or changing durable state.

The complete software path is integration-tested from authored
Catalog/document/action data through device-specific artifact compilation and
QR bytes, registry resolution, repeated scans, revocation, learner attribution,
and the existing print-policy adapter. Exact calculator execution and camera
scan remain behind the emulator/fresh-battery fleet gate.

## Result envelope

The production contract is one checksum-protected binary `SCR1` record. Cable
sync queues the exact bytes inside `SCQ1`; QR renders those bytes as RFC 4648
BASE32 without padding:

```text
sch:r1:<BASE32 SCR1>
```

The decoded record contains `deviceId`, a device-global 24-bit `sequence`, an
immutable artifact key, module/item positions, and responses or progress. It
contains no claimed learner, correctness, score, or wall-clock timestamp. The
TI-86 has no RTC; every scan or relay import instead receives a separate
backend `receivedAt` as specified in [`time-model.md`](./time-model.md).

`SCP1` is the opposite-direction lesson artifact. `DS1:R:...` was the earlier
QR-density experiment and must not be implemented by a production importer or
shell. `DS1:DEMO:<score>` remains the proven display-only experiment:

```
DS1:DEMO:5
```

The experimental result was:

```
DS1:R:<calculator-id>:<pack-id>:<attempt-sequence>:<answer-bitmap>:<checksum>
```

The first Math Lab density fixture used `QK1` with ten one-to-four choice
positions, for example `DS1:R:T86A:QK1:001:1234123412:1B68`. These historical
rules established the requirements later carried into `SCR1`:

1. `DS1` makes format evolution explicit.
2. A sequence is monotonic per calculator identity and forms the importer’s
   idempotency key with that identity.
3. `<answer-bitmap>` carries responses, not correctness. The backend uses the
   canonical School bank to grade it.
4. `<checksum>` detects camera/OCR transcription errors before import.
5. There are no credentials, student identities, or answer keys in the QR.
   Attribution is selected or resolved by the importing device/server.

On a successful import, School writes ordinary append-only attempt events with
`transport: 'calculator'`. A QR never grants a score on its own.

The displayed production QR decodes to the exact `SCR1` bytes first appended to
the calculator's offline `DSQ` queue. If scanned now and later uploaded through
the ESP relay, the backend recognizes the same `{deviceId, sequence}` and
record digest, records a second arrival, returns a duplicate acknowledgement,
and never creates a second set of attempts. See
[`direct-link-relay.md`](./direct-link-relay.md#offline-queue-and-cross-transport-idempotency).

## Maximum-density test payload

> This is a legacy `DS1:R` density experiment, not a production `SCR1` result.

[`tools/generate-quiz-result.mjs`](../tools/generate-quiz-result.mjs) produces
the screen-filling test record now installed as `QKRESULT.86p`:

```
DS1:R:T86A:QMX:001:<238 answer digits>:<CRC-16>
```

It uses **262 QR-alphanumeric characters**, exactly Version 9/M's capacity:
238 answer digits plus the envelope and a four-hex-digit CRC‑16/CCITT-FALSE.
The answer alphabet is `0` = blank, `1` = A, `2` = B, `3` = C, `4` = D. Its
53×53 modules plus the required quiet zone occupy 61×61 TI‑86 pixels. This is
a density test, not the recommended everyday QR size; camera readability at
one LCD pixel per module must be verified before adopting it operationally.

## Operating recipe

For the proven static fixture, build with `tools/build-qr-demo.mjs`, run
`Asm(QRDEMO)`, and scan the display. For the production path, the release build
installs both transfer groups from the complete ten-program client release. Complete an assessment;
after its exact result is committed to `DSQ`, the shell opens the durable
Result view. F1 invokes `SCQR`, which reads the newest record and renders it
without changing or acknowledging the queue. Its rail is F1 `MARK` and F5
`LATER`: `MARK` records the learner's **self-reported** optical scan in the
private `DSQOUT`/`SCO1` receipt map, while `LATER` leaves it in the QR-output
batch. Neither action changes `DSQ`, claims server receipt, or affects grading.
EXIT/ENTER returns to the Result view. USB is not involved in exporting
subsequent results.

An output remains visibly pending until actual server delivery. Link sync is
automatic and authoritative: only its accepted/duplicate acknowledgement can
retire `DSQ`. The generic batch-output surface will be reachable from learner,
subject, and course contexts; it presents each `DSQ` record in order, skips
only self-reported ordinals when requested, and reuses this exact QR presenter.
That list is a view of `DSQ` plus `DSQOUT`, never a second results queue.

## Relationship to the ESP relay

The permanent relay and QR transport complement each other:

| Need | Transport |
|---|---|
| Install/update programs or packs | USB during development; ESP relay in operation |
| Automatic result upload while attached | ESP direct-link relay |
| Result export away from the relay | QR scan |
| Trigger a mounted lesson worksheet/media action | QR scan |
| Server → calculator content | ESP direct-link relay only |

The TI-86 application owns one result-record format. It may serialize that
same record both into the calculator queue (`DSQ`, for the relay) and into a
QR screen. That prevents the camera and relay routes from becoming two School
systems.
