# SchoolCalc TI-86 client

## Product flow

The first calculator course is deliberately a closed loop:

`course → unit → lesson → examples → drills → QR receipt → School re-grades`

The multiplication program is the first transport/display experiment. The v0
product architecture is now generic SchoolCalc: `catalog → course → unit →
lesson → learning modules → result`, with backend grading and idempotent QR or
cable delivery.

The calculator executable and lesson payloads are intentionally separate; see
[`docs/schoolcalc-packaging.md`](./docs/schoolcalc-packaging.md).

The canonical v0 product requirements—including the content-pack model,
component taxonomy, custom-module boundary, cable/QR sync, API ownership, and
native calculator/TI-BASIC handoff—are in
[`docs/schoolcalc-requirements.md`](./docs/schoolcalc-requirements.md).
Implementation and proof are tracked requirement-by-requirement in
[`docs/delivery-matrix.md`](./docs/delivery-matrix.md).
Physical execution is governed by the mandatory
[`docs/hardware-test-gates.md`](./docs/hardware-test-gates.md).
The exact-binary MAME workflow is documented in
[`docs/emulator-testing.md`](./docs/emulator-testing.md); its required
cold/warm startup and Catalog/content coverage matrix is
[`docs/cli-test-plan.md`](./docs/cli-test-plan.md).
The exact alternating local-state and backup-first result-queue transactions
are specified in [`docs/durable-storage.md`](./docs/durable-storage.md).
The no-RTC finding and the authoritative event/arrival-time semantics are in
[`docs/time-model.md`](./docs/time-model.md).
The closed native capability plan, `SCN1` snapshot, suspend/resume ordering,
allowlist boundary, and remaining Z80/ROM gates are in
[`docs/native-tool-handoff.md`](./docs/native-tool-handoff.md).

The complete proposed system design—including Catalog, fleet identity, offline
queues, lesson artifacts, and relay API boundaries—is in
[`docs/system-architecture.md`](./docs/system-architecture.md).
Its concrete component ownership and interface contracts are in
[`docs/component-contracts.md`](./docs/component-contracts.md).

The calculator-shell GUI is authored as complete 128×64, reviewable `.`/`█`
bitmap rows in [`gui/screens.yml`](./gui/screens.yml). Render its PNG previews
with `npm run schoolcalc:gui:render`; rendering first enforces the machine-readable
component, template, interaction, region, and QR contracts. The combined reference
is [`docs/gui/schoolcalc-gui-sheet.png`](./docs/gui/schoolcalc-gui-sheet.png).
The component taxonomy and interaction rules live in
[`docs/gui-design-system.md`](./docs/gui-design-system.md).
The relay-side requirements are locked in
[`../ticalc-relay/docs/requirements.md`](../ticalc-relay/docs/requirements.md).
The corresponding backend compilation and API handoff is
[`../ticalc-relay/docs/backend-handoff.md`](../ticalc-relay/docs/backend-handoff.md).
The concrete v1 calculator-variable and sync protocol is
[`../ticalc-relay/docs/v1-protocol.md`](../ticalc-relay/docs/v1-protocol.md).
The approved v1 design and remaining gaps are
[`../ticalc-relay/docs/v1-design.md`](../ticalc-relay/docs/v1-design.md).

This extension explores using the TI-86 as an offline School drill terminal.
Its first established transport is a genuine QR code on the calculator's LCD:
a phone can scan an encoded quiz result without reconnecting the calculator to
USB or to the future ESP relay.

> **Hardware result — 2026-08-01:** `QRDEMO.86p` was transferred over the
> connected TI USB Graph Link and run on the physical TI-86. Its QR rendered
> successfully and was readable. The calculator → camera → server route is
> therefore a proven outbound channel.

> **Hardware safety note — 2026-08-01:** an early `SCINFO` build displayed its
> Sync screen but mixed raw `_get_key` scan codes with translated `_getkey`
> codes, so ENTER and EXIT could not leave the program. Battery interruption
> recovered TI-OS, but an expired backup cell allowed RAM to clear. The input
> contract is corrected and tested in source; corrected assembly is withheld
> from physical execution until the emulator/backup gates pass. See the
> [incident record](../../docs/_wip/bugs/2026-08-01-ti86-scinfo-input-lock.md).

## What is here

The extension contains distinct hardware artifacts. Their names are
deliberately different so a probe cannot be mistaken for the production shell:

| Program | Purpose |
| --- | --- |
| `QRDEMO` | Proven calculator-to-camera QR channel |
| `SCGUI` | Eight-screen, full-frame design-system gallery with key navigation |
| `SCINFO` | TI-OS String-variable probe that creates a valid `DSINFO`/`SCI1` record |
| `SCUIPRB` | Runtime bitmap-font, icon, clipping, wrapping, and layout probe |
| `SCREAD` | Paged typed-record reader and corruption-rejection probe |
| `SCHLCALC` | In-progress production shell; not yet approved for physical execution |
| `SCLEARN` | Reviewed SCX1 notes/examples/flashcard/assessment runtime with durable continuation and result/progress handoff |
| `SCQR` | Reviewed SCX1 dynamic QR runtime; renders the newest exact queued result, retaining only a private self-reported QR receipt |
| `SCCAT` | Reviewed SCX1 Catalog hierarchy browser and install/remove/update action chooser |
| `SCREQ` | Reviewed SCX1 crash-safe `SCD1` delivery-request queue writer |
| `SCQUEUE` | Reviewed SCX1 crash-safe `SCR1` response/progress queue writer |
| `SCSYNC` | Reviewed SCX1 cooperative port-7/SCF1 foreground-sync runtime |
| `SCNATIVE` | Reviewed SCX1 read-only native-plan semantic guard; OS mutation/launch remains locked |
| `SCPROF` | Reviewed SCX1 learner picker, Guest mode, and recoverable roster installer |
| `SCTUTOR` | Reviewed SCX1 durable, learner-scoped adaptive tutor and A–E response UI |
| `SCHOOLCALC.86g` | Convenience group containing the shell and eight reviewed runtimes; not used by the verified installer |
| `SCTUTOR.86g` | Convenience one-program tutor group; not used by the verified installer |

Build all current probes from the repository root:

```sh
node _extensions/ti86-app/tools/build-qr-demo.mjs
node _extensions/ti86-app/tools/build-gui-gallery.mjs
node _extensions/ti86-app/tools/build-device-info-probe.mjs
node _extensions/ti86-app/tools/build-ui-renderer-probe.mjs
node _extensions/ti86-app/tools/build-record-reader-probe.mjs
node _extensions/ti86-app/tools/build-schoolcalc-shell.mjs
node _extensions/ti86-app/tools/build-standard-runtime.mjs
node _extensions/ti86-app/tools/build-qr-runtime.mjs
node _extensions/ti86-app/tools/build-catalog-runtime.mjs
node _extensions/ti86-app/tools/build-request-runtime.mjs
node _extensions/ti86-app/tools/build-result-queue-runtime.mjs
node _extensions/ti86-app/tools/build-sync-runtime.mjs
node _extensions/ti86-app/tools/build-native-runtime.mjs
node _extensions/ti86-app/tools/build-profile-runtime.mjs
node _extensions/ti86-app/tools/build-tutor-runtime.mjs
node _extensions/ti86-app/tools/build-schoolcalc-client.mjs
node _extensions/ti86-app/tools/build-complete-install.mjs
```

The complete builder emits a digest-pinned TI86A directory with every runtime
as an independent `.86p`, both ordered `DSLOCAL` slots, the learner roster,
canonical learner-progress projection (`DSPROG`), Catalog/install records,
the manifest-selected lesson packs, and `ASCHL` last. Compiled packs are build
output under `dist/content-packs`; the mounted School Catalog remains source
data only. Independent
program transfers make one failed link packet retryable without accepting a
partially installed 60 KB group. After receiving the variables back from the
calculator, prove their exact code/token/String bytes with
`tools/audit-complete-readback.mjs`.

For a superseded content variable, use the narrowly scoped maintenance builder
instead of clearing calculator memory: `build-ti86-string-cleaner.mjs` accepts
the exact obsolete String names, produces a one-shot `SCCLEAN` program, and
does not touch Programs or any retained String. Run it from a temporary
TI-BASIC `Asm(SCCLEAN)` launcher, then remove that temporary program.

### Exact-emulator release evidence

Release `caacecbbb8b6` has seven retained exact CLI cases against the owned
TI-86 1.4 ROM. Each transfers all 23 variables through the virtual Graph Link,
launches `ASCHL` through TI-OS, and drives the actual key matrix. They prove
first boot, learner-scoped Subjects and My Progress, a complete seven-page
reader ending in `END`, a 2/3 Math result with QR `MARK`, a validated private
`DSQOUT`/`SCO1` receipt, History QR `LATER` preserving pending work, and the
auto-collapsed six-question Pokémon assessment through result QR. The Science
route proves compact `WATER CHANGES` context, full `REMOVE` rail, and safe
Cancel. EXIT and CLEAR navigate Back; only `2nd` + EXIT deliberately returns
to TI-OS. See
[`docs/emulator-testing.md`](./docs/emulator-testing.md)
for the reproducible command and its boundaries: this is not a substitute for
the physical calculator, USB Graph Link, or ESP relay gates.

`SCGUI` is an older full-frame gallery. Runtime programs use the shared raw
scan-code boundary in `src/input.asm`: ON is the emergency OS return; EXIT and
CLEAR are Back/cancel; and `2nd` + EXIT is the only deliberate app quit. The
Home view does not quit on an ordinary Back key. `SCINFO` is a separate,
disposable diagnostic probe: it creates/replaces the ordinary TI-86 String
`DSINFO`, shows the canonical sync screen, and accepts ENTER, EXIT, CLEAR, or
ON as exits. Its reported
free-memory/install state is fixed probe data; only the eventual `SCHLCALC`
shell may advertise live device state.

`SCHLCALC` is assembled from reviewable
[`src/schoolcalc.asm`](./src/schoolcalc.asm) with `z80asm` (`brew install
z80asm`). Its current fail-closed core publishes a live-free-memory,
CRC-checked `DSINFO`, detects `DSID`, restores alternating `DSLOCAL` state,
commits a staged sync transaction, and dispatches fixed runtimes that hydrate
the selected checksum-valid `SCC1`/`SCP1` variables. It independently validates
every installed SCX1 Program into a `runtimeModuleMask`, but advertises only
`shell-core@1`; runtime-backed capabilities remain off until emulator and fleet
recovery gates pass. The current 8,092-byte build leaves 1,124 bytes under its
9 KiB product ceiling and 1,308 bytes below video RAM. Learning, QR, and tutor
behavior therefore live behind the reviewed
runtime-module boundary rather than being hidden in the shell allocation.

The standard client reserves 9 KiB for the shell; `SCLEARN` has a 6 KiB
target/9 KiB ceiling; `SCCAT` and `SCREQ` each have a 6 KiB target/8 KiB
ceiling; 4 KiB target/6 KiB ceiling for
`SCQR`; 4 KiB target/8 KiB ceiling for `SCQUEUE`; and 32 conservative overhead
bytes per program variable. `SCSYNC` and the read-only `SCNATIVE` guard each
have a 6 KiB target/8 KiB ceiling; `SCPROF` has a 6 KiB target/8 KiB TI-OS
child-image ceiling; `SCTUTOR` has a 6 KiB
target/9 KiB ceiling. The ten-program planning
target is 60,736 bytes and its reserve-safe aggregate ceiling is 71,962 bytes. The
current release estimates 71,960 installed bytes: 11,224 above the planning
target and 2 below the aggregate ceiling. With 3.5 KiB for the one-Catalog
snapshot, 4 KiB for results, 512 bytes for delivery requests, 256 bytes for
the learner roster, 2 KiB for compact progress, 256 bytes for the durable tutor
request, 1 KiB for its committed response, a 66-byte private QR-output receipt,
and a 9,300-byte protected reserve, that leaves 5,122 bytes (about 5.00 KiB) for content at the current measured
client size. Sync still uses
reported free RAM rather than assuming this estimate.

`SCLEARN` now selects the newest checksum-valid SCL1 slot, derives the exact
lesson variable from its durable artifact key, revalidates the immutable SCP1
identity, dispatches closed `lecture_notes`, `examples`, `problems`,
`flashcards`, `quiz`, and `learning_probe` shapes, and commits navigation/drafts to the inactive
SCL1 slot before redraw. A validated `scan_action` page exposes only F1 QR,
then expands its validated packed Version-1/L symbol into a centered
full-frame 2× presenter. Multiple choice uses F1–F5. Assessments are scored
immediately from the compiled answer key so the learner sees a useful offline
result. Learning probes preserve the first score-bearing choice, show immediate
authored feedback, allow up to two bounded retries, and durably distinguish
feedback presentation and continuation. The queued mode-3 record carries the
full append-only trace; ordinary queued records carry responses and score. The
backend recomputes it from the immutable artifact before accepting it.
Assessment completion and reportable lesson/flashcard progress are first
committed as a typed pending
draft in alternating `SCL1`; `SCQUEUE` then builds the canonical timestamp-free
`SCR1`, validates/replays `DSQB`, replaces `DSQ`, and advances its
device-global sequence before showing success.
TI-86 codec v5 emits package schema v2 and converts neutral text to complete
23-column by five-line pages; each is at most 119 bytes. Keeping queue mutation
in `SCQUEUE` leaves `SCLEARN` at 9,199 bytes, with 17 bytes in its 9 KiB
execution ceiling. Its F5 label is `NEXT` while another block follows and `END`
at the final block, eliminating ambiguity about scroll completion. A normal
quiz keeps its compact question and labelled `A)`–`E)` choices in one body
surface, with matching F1–F5 keys in the rail; a very tall prompt alone falls
back to `MORE`/`ANS` and preserves `LEFT: Q` from that separate choice view.
Capability advertisement stays off until owned-ROM emulator and fleet recovery
gates pass.

`SCCAT` walks the generic Catalog → Subject → Course → Unit → Lesson hierarchy,
filters every level and install set against the selected learner's explicit
access projection (including a separate Guest grant), persists visible focus
and address changes through alternating `SCL1`, and opens an
install/remove/update action without knowing any subject. `SCREQ` converts that
confirmed action into an exact, ordered `SCD1` record through `DSREQB` →
`DSREQ`. Every request snapshots the selected 16-bit learner key and advances
its independent request counter only after verification. The backend resolves
that snapshot, rechecks current assignment, and authorizes the entire batch
before compiling or mutating desired state.
`SCQUEUE` similarly owns all response/progress queue mutation so learning
rendering and durable writes have separate reviewed budgets.

`SCSYNC` keeps the Sync screen live while it owns port 7. It initiates a
nonce-correlated SCF1 session, shows verified presence/direction/progress and
unplug safety, serves only the fixed upload variables, accepts only bounded
staging variables or immutable `DPxxxxxx` names, and returns through the
shell's existing `DSSYNC` validation/commit boundary. Its 6,480-byte runtime
is built and contract-tested but remains unadvertised pending owned-ROM
emulation, protected-interface testing, and fresh-battery fleet acceptance.

Native tool compilation is implemented on the host side and its first
calculator boundary now ships as `SCNATIVE`. The TI-86
adapter maps calculator, graph, table, solver, matrix, equation-editor, and
allowlisted-program modules to bounded non-executable plans, exact TI reals,
and reviewed equation tokens. A checksummed `SCN1` codec plus reference
transaction proves snapshot-before-mutation, continuation-before-launch,
unsnapshotted-write rejection, and idempotent cleanup across every injected
power cut. The 6,695-byte Z80 guard independently reopens the selected SCP1,
semantically validates operations 1–6 down to tokens/reals, and then refuses
with settings unchanged; its shared variable-write path is compiled out.
Native-program operation 7 is rejected while the calculator allowlist is
empty. The client still advertises none of these capabilities: actual `SCN1`
capture, TI-OS mutation/restore/launch, and owned-ROM/fleet execution remain.

`SCPROF` promotes a device-bound, checksum-valid `DSUSRNEW` roster to
`DSUSERS`, always deleting the staging copy last so restart converges. It lists
the School-configured learners plus synthetic Guest on first boot, remembers
the explicit selection (including Guest) in alternating `SCL1`, and blocks
switching while a lesson session is active or a result/delivery continuation is
pending. Later launches open that learner's Subject root directly; the
Catalog's `USER` softkey opens My Progress with an explicit `SWITCH` action. A successful profile
change resets only profile-visible Catalog navigation; installed content,
Catalog generation, and durable queues remain intact. Guest can study and score
locally but cannot create a durable attributed result. Each non-Guest session
and delivery request snapshots its stable 16-bit learner binding, so switching
later cannot reattribute queued work.

The same runtime validates and promotes the staged `DSPRGNEW` compact `SCG1`
projection to canonical `DSPROG`, deleting staging last. Its My Progress view
selects only the current learner's snapshot. A compact two-row curriculum
history keeps up to twelve grouped nodes visible while arrows move focus and a
stable inspector shows the selected level, score, activity, completion, and
pending state. The evidence tree and follow-ups remain generic School
semantics; Guest deliberately has no durable progress projection. When the
first actionable follow-up is a
connected remediation, F1 opens the independent `SCTUTOR` runtime. `SCPROF` is
8,177 bytes, leaving 15 bytes below its 8 KiB TI-OS child-image ceiling.

`SCTUTOR` is the reviewed, learner-scoped realtime remediation client. It
converts the selected opaque follow-up into a fixed `SCTQ` request, retains the
same request ID across disconnect/retry, promotes only a matching staged `SCTR`
response, and renders the server-authored tutor turn without receiving an
answer key. F1–F5 submit exact A–E choices; EXIT pauses safely. A processing or
retryable response remains resumable, and copy-on-write `DSTNEW` → `DSTURN`
promotion converges across every modeled interruption. `MORE` swaps A–E for
policy-projected WHY/SKIP/KNOW/STOP controls without treating those controls as
answers. Its 8,008-byte code image leaves 1,208 bytes below its independent 9 KiB
ceiling and 1,392 bytes below video RAM.

`SCQR` validates the outer `SCQ1` and newest nested `SCR1`, constructs the exact
`sch:r1:<BASE32>` payload on the calculator, applies Reed–Solomon error
correction, and draws a fixed Version 5/M symbol at 37×37 modules within a
45×45 quiet-zone footprint. The host reference model matches the QR library
for one-answer, progress, and maximum 48-answer records. F1 `MARK` records a
calculator-private `SCO1`/`DSQOUT` optical-scan receipt; F5 `LATER` leaves that
ordinal in the later batch. Neither action alters `DSQ` or claims server upload:
only an automated relay ACK clears the queue. Its 6,138-byte executable has
6 bytes left in its 6 KiB product ceiling.

The source for a macOS Graph Link diagnostic client is
[`tools/native/ti86-graph-link.c`](./tools/native/ti86-graph-link.c). It can
send, list, silently receive a named String, create/restore a complete `.86b`
backup, and dump the attached calculator's own ROM for legal emulation when
built against tilibs. A
received `.86s` file is strictly unpacked and its SchoolCalc envelope checked
with:

```sh
node _extensions/ti86-app/tools/inspect-ti86-string.mjs DSINFO.86s SCI1
```

## QR channel

`src/qr-demo.asm` copies one generated 1,024-byte framebuffer to the TI-86's
LCD. The frame contains a Version 1, error-correction M QR code at 2× scale
(42×42 pixels), including a four-module quiet zone.

That remains the physical display proof. Production `SCQR` is different: it
generates a Version 5/M result QR from the newest durable queue record at run
time, so exporting a newly completed quiz never requires rebuilding or
reconnecting the calculator.

The current payload is:

```
DS1:DEMO:5
```

`DS1` reserves a small DaylightStation QR protocol; `DEMO` is not an imported
attempt and `5` is the demonstration score. This standalone display proof has
no assessment or answer key. Production SchoolCalc artifacts do include the
bounded local answer key required for offline scoring, while still containing
no credentials; the backend independently verifies submitted score evidence. See
[`docs/qr-outbound-channel.md`](./docs/qr-outbound-channel.md) for the durable
result-envelope contract.

## Generate a test score

Run from the repository root:

```sh
node _extensions/ti86-app/tools/generate-demo.mjs --score 5
```

Scores are limited to `0`–`5` for this first five-question-quiz shape. The
generator produces [`src/generated/qr-frame.inc`](./src/generated/qr-frame.inc),
which is included by the assembly program.

## Build the installable program

The TI-86 runs an assembly **program** (`.86p`), not a Flash app. It needs its
normal assembly launcher/shell. Build it from the repository root:

```sh
node _extensions/ti86-app/tools/build-qr-demo.mjs
```

This writes [`dist/QRDEMO.86p`](./dist/QRDEMO.86p). The builder emits the tiny,
fixed Z80 instruction sequence directly and packs it into the TI-86 variable
format, so it does not depend on an uninstalled cross-assembler. It verifies
the TI-86 container signature, lengths, and checksum before writing.

Transfer `QRDEMO.86p` with a TI-86-compatible link sender. Do **not** open it
directly from `PRGM`—that tries to parse its assembly bytes as TI-BASIC and
raises `ERROR 07 SYNTAX`. At the home screen, insert the calculator's `Asm(`
token from `2nd` → `CATALOG`, select `QRDEMO` from `PRGM`, complete
`Asm(QRDEMO)`, then press `ENTER`. It clears the LCD and shows the QR code.

The initial macOS transfer required recovering the legacy SilverLink's stalled
USB endpoints (reset → re-enumerate → reopen); the final transfer completed on
the physical calculator. This affects the temporary USB sender only, not the
QR application or its displayed payload.

## Production-shell increment

The stable shell executable is `SCHLCALC.86p`. The complete installation sends
all ten program variables independently and verifies each one by name and
digest; the larger convenience groups are build artifacts, not the deployment
unit. One digest-pinned manifest covers the complete program, String, content,
state, and launcher transfer order.
Live `DSID`/`DSINFO`, bounded Catalog
and lesson parsing, durable `DSLOCAL` resume state, and transactional `DSSYNC`
commit handling, generic Catalog browsing, durable delivery intents, standard
learning interactions, assessment/progress queue append, and dynamic QR
presentation and cooperative foreground cable ownership are linked today. The
remaining core path is installed-runtime capability promotion after execution
proof, native settings capture/apply/restore and OS launch, and emulator/fleet
proof. All runtimes remain deliberately fail-closed in
capability advertisement until those required execution/recovery gates pass. See
[`docs/runtime-modules.md`](./docs/runtime-modules.md).
