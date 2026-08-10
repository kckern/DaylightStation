# SchoolCalc Adaptive Study TI-86 client

SchoolCalc Adaptive Study v1 is an agenda-driven, code-first calculator
experience:

```text
Agenda task -> six-digit code -> one-time relay resolution
            -> adaptive flashcards -> quiz -> QR or cable result
```

The canonical product, UX, state, content, relay, result, and acceptance
contract is
[`docs/schoolcalc-v1-requirements.md`](./docs/schoolcalc-v1-requirements.md).
The earlier broad
[`docs/schoolcalc-requirements.md`](./docs/schoolcalc-requirements.md) is
superseded reference material.

## v1 release boundary

Every launch opens `ENTER CODE`. An agenda prints an opaque code such as
`012 345` on the applicable task with “Enter on calculator.” A new code is
resolved once through the relay into an immutable artifact and device-bound
study prescription. The learner can then study, pause/resume, take the
prescribed A-E quiz, queue the result, and display its QR offline.

The startup value uses a dedicated 7×8 numeral face found nowhere else in the
UI. Adaptive cards have a fixed border and true line/block centering. Bank
items may also carry normalized vector diagrams (lines, polylines, rectangles,
circles, points, and short labels); the backend compiles them to bounded TI-86
commands and rejects overflow without truncation.

The default installation contains:

- `ASCHL`: TI-OS launcher;
- `SCHLCALC`: code-entry shell and dispatch;
- `SCLEARN`: adaptive cards, study summary, and prescribed quiz;
- `SCQUEUE`: durable result append and exact acknowledgement removal;
- `SCQR`: exact queued-result Version-5/M QR;
- `SCSYNC`: calculator-initiated result delivery and one-time code resolution;
- shared input, rendering, record, CRC, state, and sync-commit infrastructure.

Catalog browsing, profile selection, notes, worked examples, progress trees,
realtime tutor, native tools, install/remove requests, and the v0
`DSCODE`/`SCCO` route remain in source for research or future optional bundles.
They are omitted from the default v1 installation and are not reachable from
the v1 shell.

## Durable v1 state

| Variable | Contract |
| --- | --- |
| `DSENTRY` / `SCE1` | calculator-owned `{deviceId, requestId, sixDigitCode}` resolution claim |
| `DSSTUDY` / `SCSP` | canonical immutable device-bound prescription |
| `DSSTDNEW` / `SCSP` | staged prescription written by relay |
| `DSSYNC` | exact acknowledgement written last |
| alternating local slots / `SCL1` | one 45-byte calculator-owned adaptive continuation |
| result queue | multiple immutable, unacknowledged compact study results |

Only one unfinished prescription may occupy continuation state. Multiple
completed results may remain queued. The calculator clears `DSENTRY` only
after an exact acknowledgement and removes a result only after an accepted or
duplicate cable acknowledgement.

## Documentation map

- [Adaptive Study v1 requirements](./docs/schoolcalc-v1-requirements.md) —
  canonical behavior and acceptance
- [Delivery matrix](./docs/delivery-matrix.md) — v1 implementation/proof status
- [Packaging contract](./docs/schoolcalc-packaging.md) — default install and
  inactive-source boundary
- [CLI test plan](./docs/cli-test-plan.md) — named exact-binary scenarios and
  decoded-result inspection
- [GUI design system](./docs/gui-design-system.md) — retained visual
  infrastructure plus the v1 interaction profile
- [Direct-link relay](./docs/direct-link-relay.md) — retained electrical and
  transaction boundary plus v1 resolution ordering
- [Durable storage](./docs/durable-storage.md) — alternating state and
  backup-first queue foundations
- [QR outbound channel](./docs/qr-outbound-channel.md) — proven optical channel
- [Hardware test gates](./docs/hardware-test-gates.md) — physical safety gates
- [Emulator testing](./docs/emulator-testing.md) — exact-binary MAME workflow

Relay-specific documents live under [`../ticalc-relay/docs`](../ticalc-relay/docs).
Those documents distinguish retained link/API infrastructure from inactive v0
Catalog/profile/tutor routes.

## Build and test status

The repository contains the Adaptive Study v1 backend, calculator runtime,
default package, relay transaction, named acceptance scenarios, and semantic
result inspection. The delivery matrix is authoritative about which slices
are implemented versus proven on an emulator or physical device. Do not infer
hardware readiness from a generated binary in `dist/`.

Useful current commands from the repository root include:

```sh
node _extensions/ti86-app/tools/build-schoolcalc-shell.mjs
node _extensions/ti86-app/tools/build-schoolcalc-launcher.mjs
node _extensions/ti86-app/tools/build-standard-runtime.mjs
node _extensions/ti86-app/tools/build-result-queue-runtime.mjs
node _extensions/ti86-app/tools/build-qr-runtime.mjs
node _extensions/ti86-app/tools/build-sync-runtime.mjs
node _extensions/ti86-app/ti86.cli.mjs --help
npx vitest run _extensions/ti86-app/tools
node _extensions/ti86-app/ti86.cli.mjs --inspect-result-file retained-DSQ.86s
```

`build-complete-install.mjs` emits the digest-pinned v1 manifest containing
only the active release boundary. Existing complete-install output that includes
`SCCAT`, `SCPROF`, `SCTUTOR`, or `SCNATIVE` is v0 evidence, not the default v1
package.

## Proven foundations and remaining proof

The static TI-86 QR channel has been exercised successfully on physical
hardware. Input handling, envelope CRCs, alternating durable state,
backup-first queues, immutable artifact storage, idempotent result import, and
foreground relay framing have implementation evidence from v0. They are
foundations to adapt, not proof of the v1 learner flow.

MAME provides exact program, key-matrix, durable-restart, semantic-screen, and
result-decode evidence. It cannot emulate the TI-86 port-7 peer. Actual
artifact/prescription download transactions therefore belong in the
virtual-relay and TilEm lanes, followed by the protected-interface physical
hardware gates.

## Safety

The TI-86 assembly path is hardware-sensitive. Do not transfer a new build to a
physical calculator until the emulator, memory-window, battery/backup, link
electrical, and recovery gates in the hardware plan pass. `ON` remains the
emergency OS return; ordinary `EXIT` in Adaptive Study commits a safe pause.
