# SchoolCalc packaging

SchoolCalc's generic hierarchy is `catalog → subject → course → unit → lesson`.
One `SchoolCalcDevice.catalogId` is assigned and installed per calculator
snapshot; the calculator opens directly at its Subject list rather than
rendering a Catalog selector. Other published Catalogs remain available to
other device assignments and non-calculator School surfaces.
A lesson contains standard learning modules such as lecture notes, examples,
problems, flashcards, and quizzes, plus explicitly registered specialized tools.

The SchoolCalc application resolves one lesson into a neutral lesson bundle. A
calculator adapter compiles the bundle into an immutable delivery
artifact for its platform:

```text
Catalog path + lesson modules
              │
       SchoolCalc lesson bundle
          ┌───┴──────────┐
          ▼              ▼
   TI-86 adapter     TI-89 adapter (future)
   compact SCP1      family-appropriate format
```

The TI-86 client has a stable shell (`SCHLCALC.86p`) plus nine fixed, reviewed
runtime programs: `SCLEARN.86p`, `SCQR.86p`, `SCCAT.86p`, `SCREQ.86p`,
`SCQUEUE.86p`, `SCSYNC.86p`, `SCNATIVE.86p`, `SCPROF.86p`, and
`SCTUTOR.86p`. The shell and first eight runtimes ship in `SCHOOLCALC.86g`;
the tutor ships in required `SCTUTOR.86g` because one TI-86 group section is
limited to 65,535 bytes. One digest manifest pins the complete ten-program
client release.
Downloaded lesson variables are never executable. Adding a lesson therefore
does not require a client release unless the content needs a capability that
its installed reviewed code does not support. See
[`runtime-modules.md`](./runtime-modules.md).

The production shell selects only Catalog/install snapshots committed by
`SCL1`, validates their complete `SCC1`/`SCM1`/`SCP1` envelopes, and traverses
typed fields through an offset reader. The current runtime proves this boundary
by rendering authored Catalog and lesson labels without embedding lesson bytes
in `SCHLCALC.86p`. `SCLEARN` then derives the selected `DPxxxxxx` locator from
the durable artifact key, revalidates the SCP1 identity, and pages authored
lecture-note/example content, flashcards, and multiple-choice assessments with
copy-on-write SCL1 continuation. `SCCAT` walks the complete generic hierarchy,
and `SCREQ` commits install/remove intent through DSREQB→DSREQ. Completed
assessments and reportable progress are handed to `SCQUEUE`, which appends the
exact SCR1 through DSQB→DSQ before success. `SCQR` later reads that immutable
queue record and renders it without mutating queue state; its F1 receipt is
stored only in private, non-relayed `DSQOUT`.
`SCSYNC` owns the bounded port-7/SCF1 exchange and returns staged records to
the shell's existing fail-closed commit path; it is code-release support, not
downloaded lesson content.
`SCNATIVE` reopens an authored `tool` module and semantically validates its
closed TI-86 plan before displaying a locked, no-mutation status. Actual
native settings capture/apply/restore and TI-OS launch remain release-gated.
`SCPROF` promotes device-bound learner/progress projections and renders the
picker/My Progress. `SCTUTOR` retains one exact `SCTQ`, validates matching
staged `SCTR`, and renders adaptive A–E turns with disconnect-safe retry.

Every compiled artifact has an adapter-generated immutable `artifactId` and
contains the source `lessonId`. Results carry both, allowing the backend to
interpret work completed offline against the exact downloaded artifact while
still recording ordinary School attempts for the canonical lesson modules.

Executable runtime modules are not delivery artifacts or install-set members.
They use fixed program names from a closed TI-86 build registry, an SCX1 ABI
header, and a digest-pinned client-release manifest. The Catalog and lesson
compiler cannot select, rename, or transport them.
