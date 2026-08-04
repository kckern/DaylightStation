# SchoolCalc native-tool handoff

## Decision and implementation status

SchoolCalc may launch built-in calculator environments, but it treats the
transition as **durable suspend and explicit resume**. It never assumes that a
Z80 call stack will survive an OS application switch.

The non-hardware portion is implemented:

- the School application owns portable `tool` schemas and knows no TI names;
- `Ti86NativeToolMapper` compiles all seven portable capabilities into a closed,
  bounded TI-86 plan;
- the same mapper semantically decodes every plan at the runtime boundary,
  before the first durable write;
- authored expressions pass through a reviewed arithmetic tokenizer rather
  than becoming TI-BASIC or assembly source;
- `SCN1` stores a bounded, checksummed native snapshot;
- `Ti86NativeHandoffTransaction` enforces snapshot-before-mutation,
  continuation-before-launch, exact-resource ownership, idempotent restoration,
  and cleanup-last ordering;
- host tests interrupt every preparation and restoration mutation boundary;
- the 6,740-byte `SCNATIVE` Z80 runtime reopens the selected SCL1/SCP1,
  validates the exact six-field plan and operations 1–6 down to payload
  framing, expression grammar/depth, canonical TI reals, and window bounds,
  then visibly refuses with settings unchanged.

The first Z80 boundary is intentionally read-only: shared variable-write
routines are compiled out, native-program operation 7 is rejected while the
runtime allowlist is empty, and no OS environment is launched. Actual `SCN1`
capture, TI-OS graph-database/settings calls, restoration, OS tail-transfer,
and fleet-ROM execution proof remain gated. Consequently the installed client
does not yet advertise any native capability.

## Portable capability contract

A lesson declares only a portable capability and neutral configuration:

```yaml
- moduleId: motion-graph
  type: tool
  title: Explore the graph
  capability: graph@1
  config:
    equations:
      - slot: primary
        expression: 2*x+1
    window:
      xMin: -10
      xMax: 10
      yMin: -10
      yMax: 10
```

Initial capabilities are:

- `calculator@1`
- `graph@1`
- `table@1`
- `solver@1`
- `matrix@1`
- `equation-editor@1`
- `native-program@1`

The School domain and application never know `y1`, TI variable types, GDB
layout, ROM calls, graph RAM, or how another family such as a TI-89 implements
the request.

## TI-86 compiled native plan

The TI-86 artifact replaces portable `config` with a non-executable
`school.calc.ti86-native-plan/v1` record:

```text
schema       fixed plan schema
version      1
operation    finite code 1..7
launch       finite OS-environment code 1..7
snapshot[]   sorted finite resource codes
payload      bounded operation-specific bytes
```

The payload ceiling is 1,152 bytes. The decoder requires the exact
operation/launch pair, the exact sorted mutation-resource set, complete
operation-specific framing, canonical ten-byte reals, and no trailing bytes.
It parses the equation grammar again from token bytes; an outer SCP1 checksum
does not turn unknown tokens into trusted data.

The operation/launch mappings are calculator, graph, table, solver, matrix,
equation editor, and allowlisted TI-BASIC program. Logical graph slots
`primary` through `quaternary` map to TI-86 equation slots 1 through 4 only in
this adapter.

### Z80 semantic guard

`SCLEARN` dispatches a selected `tool` module only to the fixed build-owned
program name `SCNATIVE`. After validating its own SCX1 header, `SCNATIVE`
reopens the newest unambiguous local continuation and exact immutable lesson
artifact. It requires the module to be `tool`, finds `nativePlan`, and repeats
the host decoder's closed semantic checks for calculator, graph, table, solver,
matrix, and equation-editor operations. Extra/truncated fields, mismatched
launch or snapshot codes, duplicate matrix/equation slots, malformed numeric
literals, unsupported tokens/variables/functions, noncanonical reals, invalid
ranges, excess depth, and trailing payload bytes fail closed.

A valid plan currently leads only to a status screen saying the plan was
validated, settings are unchanged, OS launch is locked, and ROM proof is
required. ENTER, LEFT, or EXIT returns through the ordinary durable caller.
This guard is useful executable parser evidence, but it is not a claim that
the native transaction or TI-OS invocation exists on the calculator.

### Equation data, not executable source

The expression compiler accepts a deliberately small grammar:

```text
numbers, x, pi
+ - * / ^ and parentheses
unary minus
abs, ln, exp, log, pow10, sin, cos, tan
one equality only for solver@1
```

It emits TI-86 equation tokens with a 192-byte ceiling and a maximum nesting
depth of 16. Colons, commands,
labels, implicit multiplication, arbitrary variables, program tokens, BASIC,
and assembly are rejected. The family mapper supports at most four equations,
three matrices of at most 6×6, and eight allowlisted program arguments.

Window, table, solver, and matrix numbers are compiled to the documented
ten-byte TI-86 real representation. Greenfield v0 deliberately admits only
exponents −308 through +307, the 14-significant-digit subset that the backend
Number boundary and Z80 guard both round-trip exactly. A graph plan contains no authored native
variable or program name.

### Native-program allowlist

`native-program@1` accepts a logical `toolId` and scalar arguments. A
composition-owned TI-86 allowlist supplies the unique installed Program name,
argument kinds/count, and exact snapshot resources. Compiler and runtime use
the same allowlist; the default is empty and fails closed at both boundaries.
Duplicate installed names are invalid. Content cannot supply `programName`,
`source`, `code`, `assembly`, or `basic`.

## Snapshot resources

Every plan declares the complete finite set it may mutate:

| Code | Resource | Maximum bytes | Purpose |
| ---: | --- | ---: | --- |
| 1 | `homeEntry` | 128 | Home-entry continuation altered by calculator launch |
| 2 | `functionGraphDatabase` | 3,072 | Opaque TI-OS function GDB |
| 3 | `tableSettings` | 32 | Table start/step and mode state |
| 4 | `solverState` | 512 | Solver equation/variable state |
| 5 | `matrixWorkspace` | 2,048 | SchoolCalc-reserved native matrix slots |
| 6 | `nativeProgramWorkspace` | 1,024 | Reviewed program argument/result workspace |

The mutation facade refuses any resource absent from the committed snapshot.
This turns “snapshot everything the adapter will alter” into an executable
invariant.

For graph and equation-editor handoff, the selected design uses a complete
function GDB as one opaque resource. TI documents that a GDB captures graphing
mode, format and range variables, equation-editor functions, selection state,
and graph styles, and that recalling it replaces the current values. This is
safer than copying unpublished RAM offsets individually. If the OS-produced GDB
does not fit the 3 KiB resource ceiling, SchoolCalc refuses the handoff and
changes nothing.

## `SCN1` / `DSNATIVE`

The client-private TI String `DSNATIVE` carries:

```text
magic "SCN1"
version 1
body length
snapshot generation (u32)
native capability code
entry count
entries sorted by resource code:
  resource code
  present/absent flag
  opaque byte length
  exact original bytes
CRC-16/CCITT-FALSE
```

The whole record is at most 4,096 bytes. Each entry also has its own resource
ceiling. An absent entry is meaningful: restoration deletes the
SchoolCalc-created resource. Unknown flags, duplicate/out-of-order resources,
truncation, trailing bytes, and checksum errors fail closed. Numeric BCD is
validated in the native plan before this opaque snapshot is written.

The 4 KiB record is transient and charged against the 10 KiB free reserve, not
downloadable-content capacity. The preflight leaves at least 6,112 bytes after
the maximum record and TI variable overhead. Insufficient RAM prevents any
native mutation.

## Durable handoff sequence

1. Semantically decode the complete compiled plan and validate its installed
   capability, operation/launch pair, exact snapshot scope, payload framing,
   tokens, numbers, and runtime allowlist.
2. Refuse a second handoff while one is pending.
3. Read exactly the plan's declared native resources.
4. Encode and durably write `DSNATIVE`.
5. Commit the current lesson/view/focus/scroll/card/draft continuation to the
   inactive `DSLOCAL` slot with phase `snapshotCommitted`.
6. Apply configuration through a facade restricted to snapshotted resources.
7. Commit phase `configured`.
8. Commit phase `restorePending` and the restore-needed flag.
9. Only now authorize a tail-transfer to the requested TI-OS environment.
10. The learner exits to TI-OS and relaunches SchoolCalc from CUSTOM.
11. Startup validates `DSNATIVE` generation and capability against `DSLOCAL`.
12. If needed, first durably advance to `restorePending`.
13. Restore every original resource idempotently.
14. Clear native continuation while retaining the exact SchoolCalc view and
    draft.
15. Delete `DSNATIVE` last. A remaining orphan is safe to remove on a later
    normal launch.

Recovery runs for `snapshotCommitted`, `configured`, or `restorePending`.
Therefore power loss during configuration cannot strand partially changed OS
state. A second restoration writes the same original bytes or repeats the same
delete, so interruption during restoration is also safe.

## OS launch and return

The eventual TI-86 runtime will use TI-OS-supported behavior wherever
available. Function graph display has the established `_PDspGrph` entry at
`$4D6F` in the source-included TI-86 development headers, but that entry and
the GDB store/recall invocation remain fleet-ROM gates rather than assumed ABI.

Return is intentionally simple:

1. EXIT leaves the native tool for TI-OS.
2. The learner launches SchoolCalc from its CUSTOM entry.
3. Startup restores the snapshot and resumes the exact continuation.

An EXIT hook is optional future work. Correctness never depends on it.

## Failure behavior

- Missing/unadvertised capability: explain and stay in SchoolCalc.
- Invalid or oversized plan: refuse before writing a snapshot.
- Insufficient transient RAM: refuse before mutation.
- Apply error after snapshot: retain pending recovery and restore before study
  continues.
- Missing, stale, or corrupt snapshot: keep SchoolCalc state and queued results,
  show a recovery warning, and never guess replacement settings.
- Power loss or APD: relaunch resumes the idempotent transaction.
- Repeated resume: restoration is safe and the snapshot is deleted only after
  the cleared continuation is durable.

## Automated evidence

- Mapper tests cover all capabilities, exact TI real bytes, tokenizer
  allow/deny cases, logical slot mapping, all bounds, compiler/runtime program
  allowlisting, and operation/launch/snapshot/payload tampering.
- Artifact tests prove SCP1 contains the compiled plan and omits portable config.
- Snapshot tests cover round-trip, canonical ordering, corruption, absence,
  unknown flags/resources, internal truncation/trailing bytes, per-resource
  bounds, and total bounds.
- Transaction tests cut power after every preparation and restoration mutation,
  prove multi-resource restoration, reject unsnapshotted mutation, enforce the
  RAM gate, and preserve lesson continuation plus the offline result queue.
- Runtime build/source contracts pin SCX1 module code 7, the payload/expression
  bounds, pre-display self-validation, read-only shared-content compilation,
  all six implemented operation parsers, locked status, and empty capability
  advertisement.

Still required before capability advertisement:

- implement Z80 `SCN1` snapshot/recovery and TI-OS capability adapters after
  proving the required OS interfaces;
- prove GDB store/recall, graph/table/solver/matrix/editor entry, APD, errors,
  and relaunch in MAME with an owned ROM;
- repeat recovery and byte-for-byte settings checks on every fleet ROM.

## Research basis

- [Texas Instruments TI-86 Guidebook](https://education.ti.com/download/en/ed-tech/29D96806F8F4429C82F75713DF53EA1C/C7CFB64BF4924AD1BE8A514E7EF98E4A/86bookeng.pdf): function equations, window variables, selection/styles, and the STGDB/RCGDB graph-database contract.
- [TI-86 Link Protocol Guide: variable formats](https://merthsoft.com/linkguide/ti86/vars.html): ten-byte reals, tokenized equations, and decoded GDB layout.
- [TI-86 Link Protocol Guide: tokens](https://merthsoft.com/linkguide/ti86/tokens.html): equation/program token values and variable-token forms.
- [TI-86 development utilities archive](https://ticalc.org/pub/unix/date.html): source-included `ti86asm.inc`, `Rom86.h`, and `Ram86.inc` used to cross-check established ROM/routine names. These community headers are evidence for testing, not a manufacturer ABI guarantee.
