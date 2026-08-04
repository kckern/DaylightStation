# SchoolCalc TI-86 runtime modules

## Decision

The TI-86 client uses TI-OS assembly modules to keep the resident shell within
its reviewed 9 KiB ceiling and the physical 9,400-byte assembly window:

```text
SchoolCalc client release
├── SCHLCALC  stable shell/orchestrator (independent program transfer)
├── SCLEARN   reviewed standard-learning runtime (program variable)
├── SCQR      reviewed outbound-result QR runtime (program variable)
├── SCCAT     reviewed generic Catalog browser (program variable)
├── SCREQ     reviewed delivery-request queue writer (program variable)
├── SCQUEUE   reviewed result/progress queue writer (program variable)
├── SCSYNC    reviewed cooperative foreground-sync runtime (program variable)
├── SCNATIVE  read-only native-plan semantic guard (program variable)
├── SCPROF    reviewed learner-profile/roster runtime (program variable)
└── SCTUTOR   reviewed learner-scoped realtime-remediation runtime

DPxxxxxx      immutable lesson data (String variable; never executable)
```

This is a code-release boundary, not a content-pack feature. A lesson declares
a versioned capability such as `reader@1`; it cannot declare `SCLEARN`, a TI
variable type, an address, source text, or executable bytes. The TI-86 shell's
closed dispatch table is the only mapping from a validated interaction to a
runtime program name.

The TI-86 has one assembly execution window beginning at `$D748`. Calling a
second program with a normal hand-written copy would overwrite the caller.
TI-OS already owns the required save/load/restore behavior: `_exec_assembly`
at `$5730` executes the assembly program named in OP1. Published TI-86 source
uses `call _exec_assembly` and then continues in the caller after the applet
returns. The comprehensive public include file labels `$5730` the “asm module
executor.” This behavior still requires emulator and fleet-ROM verification
before the production binary is transferred.

Research evidence:

- Texas Instruments documents that ordinary TI-86 assembly programs execute
  through `Asm(program)` in the [TI-86 support article](https://education.ti.com/en/customer-support/knowledge-base/other-graphing/product-usage/10442)
  and [TI-86 Guidebook](https://education.ti.com/download/en/ed-tech/29D96806F8F4429C82F75713DF53EA1C/C7CFB64BF4924AD1BE8A514E7EF98E4A/86bookeng.pdf).
- The source-included [Geometry Solver archive](https://www.ticalc.org/pub/86/asm/source/geometry.zip)
  loads a fixed program name into OP1, calls `_exec_assembly`, and continues
  after it returns.
- The published [TI-86 include archive](https://www.ticalc.org/pub/86/asm/source/include/ti86.zip)
  identifies `_exec_assembly = $5730` and `_asm_exec_ram = $D748`.

The last two sources are executable-era community artifacts rather than a
manufacturer ABI promise. Consequently, every supported ROM revision remains
a named hardware gate; SchoolCalc does not infer cross-ROM safety from one
address listing.

## Call transaction

1. Resolve the module type/capability from validated SCP1 data.
2. Map it through a shell-compiled registry to one fixed TI program descriptor.
3. Commit the exact SCL1 lesson/module/item/focus/scroll/draft continuation.
4. Find the program as TI variable type `$12`; absence is a visible,
   fail-closed incompatibility.
5. The shell validates each immutable installed Program wrapper, SCX1
   header/code/ceiling/length/reserved fields, and payload CRC into the fixed
   `runtimeModuleMask` it publishes in DSINFO before TI-OS loads a mutable
   execution image.
6. Call TI-OS `_exec_assembly`.
7. Each child reopens only durable records: `SCLEARN` reads SCL1/SCM1/SCP1,
   `SCQR` reads the newest exact SCR1 in SCQ1 and may write only its private
   DSQOUT/SCO1 optical receipt, and `SCCAT` reads SCL1/SCC1.
   No page-zero pointer or caller register is part of the ABI.
8. A child may make one more fixed, build-owned call after first committing its
   continuation: `SCCAT` calls `SCREQ`, and `SCLEARN` calls `SCQUEUE`.
9. `SCREQ` alone mutates DSREQ/DSREQB; `SCQUEUE` alone mutates DSQ/DSQB;
   `SCQR` never mutates DSQ and may write only its non-relayed DSQOUT/SCO1
   self-report map. Each returns normally.
10. `SCSYNC` alone owns port 7 in foreground mode. It reads only DSID, DSINFO,
    DSINST, DSQ, DSREQ, and DSTREQ; writes only DSCATNEW, DSACKNEW, DSTNEW,
    DSSYNC, or bounded
    immutable `DPxxxxxx`, plus the replaceable DSUSRNEW/DSPRGNEW profile read
    models; and releases both lines before returning.
11. Every restored caller reloads SCL1 before rendering or returning. The
    shell validates and atomically commits staged DSSYNC after SCSYNC returns.
12. For a `tool` module, `SCLEARN` makes one fixed call to `SCNATIVE`.
    `SCNATIVE` reopens SCL1/SCP1, independently validates the complete native
    plan, and returns a locked status without creating, deleting, or changing
    TI variables or launching an OS environment.
13. The shell's fixed USER action calls `SCPROF`. It validates device-bound
    `SCU1`/`SCG1`, promotes `DSUSRNEW`→`DSUSERS` and
    `DSPRGNEW`→`DSPROG` with staging deleted last, reconciles retired
    selections only outside active/pending work, renders selected-learner My
    Progress, and writes only profile/navigation state through alternating
    `SCL1`.
14. An actionable connected-remediation follow-up lets `SCPROF` commit Tutor
    view 11 and return. The shell calls `SCTUTOR`, which validates the selected
    learner and current `SCG1`, writes one fixed `SCTQ` to `DSTREQ`, and enters
    Sync. A matching staged `SCTR` is promoted `DSTNEW`→`DSTURN` with staging
    deleted last. F1–F5 create the next exact A–E request; EXIT only pauses.
    Disconnect, processing, and retryable responses retain the same request ID
    and bytes for idempotent resume.

SCL1 stores only the ten-character immutable artifact key. In greenfield v0,
the TI String locator is deterministically `DP` plus the first six key
characters, and both the backend manifest codec and Z80 commit validator reject
any other pairing. SCLEARN therefore reopens a lesson without accepting a
variable locator from content or depending on a transient manifest pointer.

If the child, APD, ON, or a reset prevents normal return, step 3 remains the
recovery point. Relaunching `SCHLCALC` must resume the saved module address; it
must never depend on an in-memory return address.

## SCX1 executable header

Each reviewed runtime is an ordinary TI-86 assembly program whose executable
bytes begin with TI-OS's executor prefix followed by a fixed SCX1 envelope.
The complete immutable envelope is 21 bytes. Integers are little-endian.

| Offset | Bytes | Meaning |
| ---: | ---: | --- |
| 0 | 1 | TI-OS executor marker (`NOP`) |
| 1 | 3 | Absolute `JP $D75E`, skipping the envelope |
| 4 | 2 | TI-OS executor input word (zero) |
| 6 | 2 | Pointer to NUL title byte at offset 21 |
| 8 | 4 | ASCII `SCX1` |
| 12 | 1 | ABI version (`1`) |
| 13 | 1 | Closed build-registry module code |
| 14 | 1 | Flags (`0` in ABI v1) |
| 15 | 2 | Complete executable byte length (`21..8192`) |
| 17 | 2 | CRC-16/CCITT-FALSE over bytes 21 through end |
| 19 | 2 | Reserved zero |

The TI file checksum and SCX1 CRC detect corruption; neither authenticates
code. The host release manifest pins SHA-256 for exact distribution evidence.
Trust is the same as for `SCHLCALC` itself: reviewed source and an authorized
client release. A future relay code updater would require a separate
authenticated client-release policy and may not reuse the content Catalog API.

The shell validates this immutable envelope immediately before each TI-OS
launch; that is the sound place to validate source bytes because TI-OS changes
the loaded execution image. This is damage detection, not authenticity: the
release SHA-256 and authorized distribution remain the trust boundary. The
shell must still independently validate the installed module before it may
advertise any runtime-backed capability.

## Closed v0 registry

| Module code | Mask bit | Program | Role | Advertised capabilities |
| ---: | ---: | --- | --- | --- |
| 1 | 0 | `SCLEARN` | Durable notes/examples/flashcard/choice-assessment runner and pending-result author | none pending emulator/fleet recovery proof |
| 2 | 1 | `SCQR` | Newest-result BASE32 + Version-5/M QR presenter; private SCO1 receipt only | none pending emulator/fleet recovery proof |
| 3 | 2 | `SCCAT` | Generic Catalog/Subject/Course/Unit/Lesson/Module browser | none pending emulator/fleet recovery proof |
| 4 | 3 | `SCREQ` | Backup-first fixed `SCD1` delivery-request queue writer | none pending emulator/fleet recovery proof |
| 5 | 4 | `SCQUEUE` | Backup-first fixed `SCR1` response/progress queue writer | none pending emulator/fleet recovery proof |
| 6 | 5 | `SCSYNC` | Cooperative port-7/TI-packet/SCF1 variable transport and live awareness UI | none pending emulator/protected-interface/fleet proof |
| 7 | 6 | `SCNATIVE` | Read-only operation/snapshot/payload/token/real validator and locked-status presenter | none pending SCN1/TI-OS mutation/restore/launch and ROM/fleet proof |
| 8 | 7 | `SCPROF` | Recoverable configured-learner roster/progress projection, remembered soft profile claim, Guest, pending-work switch lock, and curriculum-history overview/focus/inspector | none pending emulator/fleet recovery proof |
| 9 | 8 | `SCTUTOR` | Learner-scoped connected-remediation request/response renderer with exact A–E choices and retry/resume | none pending emulator/protected-interface/fleet proof |

Implemented source does not count as an advertised capability. `reader@1`,
`examples@1`, `problems@1`, `flashcards@1`, `quiz@1`, response entry, queue
append, and QR output are advertised only after their device runtime and
recovery tests pass. Specialized
interactions may later receive another fixed registry entry and reviewed
program; adding YAML can never create one.

The shell publishes the unsigned 16-bit installed set as DSINFO
`runtimeModuleMask`.
That is integrity/presence evidence, not itself a portable capability list.
The TI-86 adapter rejects unknown mask bits and rejects a DSINFO that directly
claims capabilities beyond the build-approved shell baseline. Its mask-to-
capability promotion switch is deliberately false until the named execution
and recovery gates pass.

## Build and install

Run:

```sh
node _extensions/ti86-app/tools/build-schoolcalc-client.mjs
```

The build emits:

- `dist/SCHLCALC.86p`;
- `dist/SCLEARN.86p`;
- `dist/SCQR.86p`;
- `dist/SCCAT.86p`;
- `dist/SCREQ.86p`;
- `dist/SCQUEUE.86p`;
- `dist/SCSYNC.86p`;
- `dist/SCNATIVE.86p`;
- `dist/SCPROF.86p`;
- `dist/SCTUTOR.86p`;
- `dist/SCHOOLCALC.86g` and `dist/SCTUTOR.86g` as unverified convenience
  groups that are not deployment units;
- `dist/schoolcalc-client-release.json`, the exact digest-pinned release
  manifest.

`build-complete-install.mjs` emits a second exact manifest covering independent
program files, device/profile/Catalog/install Strings, both consecutive SCL1
slots, every lesson artifact, and the launcher last. The production transfer
uses those independent files so an Error 38 has one explicit retry target.
Every variable is received back and checked with
`audit-complete-readback.mjs` before the launcher is run.

The manifest also records a conservative installed-storage estimate and the
standard-client target/ceiling. The adapter reserves 9 KiB for `SCHLCALC`, a
6 KiB target/9 KiB ceiling for `SCLEARN`, a 4 KiB target/6 KiB ceiling for
`SCQR`, a 6 KiB target/8 KiB ceiling each for `SCCAT` and `SCREQ`, a 4 KiB
target/8 KiB ceiling for `SCQUEUE`, a 6 KiB target/8 KiB ceiling each for
`SCSYNC` and `SCNATIVE`, a 6 KiB target/8 KiB TI-OS child-image ceiling for `SCPROF`, and a 6 KiB target/9 KiB ceiling for `SCTUTOR`,
where a target is a capacity-planning signal and its paired ceiling is the
compile-blocking execution safety limit. A runtime may temporarily exceed its
target only while it remains below the ceiling and the aggregate release
budget still preserves the calculator's content and recovery reserve.
and 32 bytes of calculator-variable overhead for each. This makes the
ten-program planning target 60,736 bytes. The independent per-program ceilings
sum to 83,264 bytes, but the enforced reserve-safe aggregate maximum is 71,662
bytes: no build may consume the calculator's 9,600-byte scratch/free reserve merely
because each executable fits independently. At the planning target, 15,406
bytes remain for downloadable content after the Catalog, result, delivery,
learner-roster, progress, and interaction target buckets; at the reserve-safe
aggregate maximum, content capacity is zero.

The current digest-pinned release estimates 71,391 installed bytes. It is
10,655 bytes above the planning target, leaves 271 bytes before the
reserve-safe aggregate maximum, and leaves 5,391 bytes for downloadable
content after the 256-byte interaction-request and 1,024-byte committed-response
target buffers. Per-program ceilings remain independently enforced.

The calculator therefore has one SchoolCalc product but more than one TI
program variable. All nine SCX1 runtimes are implementation support and may be
visible in the TI-86 PRGM list; users launch only `Asm(SCHLCALC)`.

## Remaining verification gates

- Keep runtime capability promotion disabled until the exact installed-mask,
  nested-call, and recovery gates pass; discovery is implemented, but source
  completion alone cannot justify an advertised capability.
- Run exact caller → `_exec_assembly` → child → caller tests in MAME with an
  owned TI-86 ROM dump.
- Repeat on every fleet ROM revision with a fresh main/backup battery and
  verify stack, screen, key, error, APD, ON, and reset paths.
- Exercise Catalog browse/action, `SCD1` recovery, notes/examples/flashcards/
  choice assessments, response/progress `SCQ1` recovery, and dynamic QR against
  exact binaries before advertising their capabilities.
- Exercise staged roster promotion, profile selection/Guest, retired profiles,
  session locking, and immutable learner attribution in the same exact-binary
  recovery matrix.
- Exercise My Progress F1 Tutor handoff, SCTQ creation/counter repair,
  foreground interaction response, A–E selection, processing retry, pause,
  staging promotion, and mid-session cable removal under the same exact-binary
  and protected-interface matrix.
