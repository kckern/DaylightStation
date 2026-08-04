# SchoolCalc TI-86 emulator gate

SchoolCalc uses MAME's maintained TI-86 driver as a release gate. Emulator
testing does not replace the physical test ladder, but no new Z80 binary may
reach a calculator before its exact packaged bytes pass here.

## ROM provenance

MAME does not include the copyrighted TI-86 ROM. Dump a ROM from a calculator
in the SchoolCalc fleet only after the battery and backup gates in
[`hardware-test-gates.md`](./hardware-test-gates.md) pass:

```sh
/path/to/ti86-graph-link romdump /secure/path/calculator-a.rom
```

Keep ROM dumps outside the repository. The gate accepts only a 262,144-byte
image whose SHA-1 matches a TI-86 revision declared by MAME. It stages the ROM
under MAME's required filename in a private temporary directory and removes
that directory after each run.

## Exact-release scenario harness

The scenario harness boots the calculator's owned ROM, provisions every file
from one `complete-install.json`—including the learner roster and canonical
`DSPROG` progress projection—through MAME's emulated Grey Graph Link, then
launches the transferred `ASCHL` BASIC entry point through TI-OS's Program
menu. It drives F1-F5, arrows, ENTER, EXIT, CLEAR, and ON through MAME's
actual TI-86 key matrix and captures the complete 128x64 framebuffer after
each step. A missing frame, timeout, unchanged required transition, or a
route that never reaches the SchoolCalc inverse header fails the run. This is
the release gate: it proves the container bytes, Graph Link transfer, TI-OS
Program menu, TI-BASIC `Asm(` launcher, and calculator key matrix together.
The release timeout allows a complete 9600-baud install rather than assuming
memory writes are instantaneous.

```sh
node _extensions/ti86-app/tools/ti86-mame-scenario-harness.mjs \
  --rom /secure/path/calculator-a.rom \
  --bundle _extensions/ti86-app/dist/install-ti86a-RELEASE \
  --graph-link /path/to/ti86-graph-link
```

Editable flows live in `testing/mame-scenarios.yml`. PNGs and a digest-bearing
JSON report are written below `dist/mame-scenarios/`. A complete scenario run
is now required before transferring a new SchoolCalc release to hardware.
The high-coverage cold/warm startup, profile, Catalog, and content-path matrix
is maintained in [`cli-test-plan.md`](./cli-test-plan.md).

### Latest exact-release evidence

On 2026-08-03, release `295065f74710` passed all five named scenarios against
the owned TI-86 1.4 ROM. The report was generated at
`/private/tmp/schoolcalc-mame-full-295065f74710/report.json`. It contains 89
captured LCD frames across:

- `profile-catalog-return` — child EXIT returns to `SCHOOLCALC` Home. The
  current input contract additionally requires EXIT/CLEAR at Home to remain in
  the app and only `2nd` + EXIT to return to TI-OS;
- `catalog-lesson-flow` — Subject → single-option Course/Unit/installed-Lesson
  collapse → Module (the one installed Catalog wrapper is not rendered) →
  installed `FIND TEN PERCENT` reader;
- `profile-switching` — durable learner selection and picker reopen;
- `my-courses-progress` — selected Soren's `MATH` / `8{0/O}%` projection; and
- `quiz-result-qr` — a three-question local assessment, queued offline result,
  fixed Version-5/M QR presenter, and sparse F1 DONE/F5 LATER optical receipt
  rail.

`{0/O}` is the transcript's deliberate compact-font ambiguity marker, not a
guess. Exact pixels remain available in the adjacent ASCII/PNG artifacts.

### Incremental Catalog-transition evidence

On 2026-08-03, release `5055ef0944b1` passed the exact owned-ROM
`catalog-lesson-flow` scenario after adding the Catalog's short local
`.` → `..` → `...` interstitial. The route reached the reader through every
forward hierarchy level and returned safely to the lesson list. This is a
focused regression result, not a claim that the other four named scenarios
were rerun for that release.

### Timing is part of the protocol

A full starter release takes about 85 seconds to traverse the emulated Graph
Link. After `ASCHL` starts, SCHLCALC independently verifies nine installed
SCX1 runtime envelopes before it renders the learner picker; allow 1,200
emulated frames (about 20 seconds) before treating the retained LCD as a
failure. Selecting a learner and entering a child runtime each perform a
durable state handoff, so named scenarios give those transitions 300 frames.
The harness emits a five-second transfer-progress line and a 300-frame
heartbeat, making expected validation work distinguishable from a stalled
transport or a failed runtime.

Named scenarios can additionally require decoded authored text or a semantic
control on a captured LCD frame. This keeps a wrong-but-different page from
passing a route solely because its pixels changed; for example, the current
acceptance flow requires the `FIND TEN PERCENT` reader page, a quiz prompt and
its choices, the offline-result notice, the Version-5/M QR surface and its
DONE/LATER rail, and the selected learner's `My Progress` projection. It also proves that EXIT from a
child Catalog route returns to SchoolCalc Home; ordinary EXIT/CLEAR may not
leak across that runtime boundary or quit the app, while `2nd` + EXIT is the
intentional OS-return gesture.

## Interactive exact-release CLI

`ti86.cli.mjs` is the fast, exploratory companion to the named scenario
harness. It does **not** simulate SchoolCalc in JavaScript: each invocation
starts MAME's TI-86 driver with an owned ROM, sends the exact digest-pinned
release through the emulated Graph Link PTY, launches the transferred
TI-BASIC `ASCHL` program through TI-OS, presses MAME's actual calculator key
matrix, and reads the emulated LCD's 128×64 bitmap at `$FC00`.

Use it to reproduce a report, explore a new path, or turn a confirmed path
into a named regression scenario. `--keys`, `--text`, and `--wait` are kept
in the order supplied, so a runtime handoff can settle before its next key:

```sh
node _extensions/ti86-app/ti86.cli.mjs \
  --bundle _extensions/ti86-app/dist/install-ti86a-RELEASE \
  --rom /secure/path/calculator-a.rom \
  --load ASCHL --wait 1200 \
  --keys UP,ENTER --wait 300 \
  --key ENTER --wait 120 \
  --screens each --screen hybrid \
  --output /private/tmp/schoolcalc-transcript.txt
```

`--load ASCHL` always uses the real TI-OS Program menu. The first post-load
wait is intentional: the shell checks all installed runtime envelopes and
checksums before presenting its profile picker. The tool can transfer a
diagnostic subset with `--transfer NAME,NAME`; ordinary release proof must
omit that flag and transfer the complete manifest.

Screen modes are:

- `hybrid` (default): recognized authored text plus semantic controls, then
  compact Braille only for residual graphics;
- `text`: recognized glyphs and semantic controls only;
- `braille`: direct 2×8-pixel LCD approximation;
- `pixels`: exact 128×64 `.`/`█` rows.

The semantic transcript sweeps every supported authored font at all legal
horizontal/vertical offsets and both LCD polarities. It prioritizes known
design-system primitives such as `❯`, `●`, `○`, soft-key labels, rules, and
headers before applying Braille fallback. It recognizes the two fixed
full-frame QR profiles before glyph sweeping, reporting their placement and
profile rather than inventing text out of QR modules. Ambiguous compact glyphs are emitted
explicitly (for example `{0/O}`) rather than guessed. This keeps one screen to
about ten readable terminal rows while retaining a deterministic exact-pixel
mode for assertions.

The required testing ladder is:

1. Reproduce and inspect behavior with this exact-release CLI.
2. Promote the stable key path and semantic screen assertions into
   `testing/mame-scenarios.yml` / automated tests.
3. Run the complete release scenario against the owned ROM.
4. Only then perform the focused physical TI-86 smoke test for transfer,
   calculator LCD/keys, and real-cable behavior.

The emulator gate is therefore the inner development loop; it does not claim
to prove USB hardware, physical link timing, battery-backed RAM, or the future
ESP relay.

## Scope still required

The current gate proves full-link launch; learner selection and reopening;
the learner-scoped My Progress view; Subject → Module traversal through
single-option Course/Unit/installed-Lesson collapse; an installed reader page; a three-question
named-learner assessment; durable offline result presentation; and the fixed
Version-5/M QR surface. Subsequent
emulator fixtures must add:

- UP, DOWN, LEFT, RIGHT and F1–F5 navigation paths;
- framebuffer snapshots and pixel comparisons for every runtime component;
- exact SCQR framebuffer comparison against the fixed Version-5/M host oracle
  for minimum, progress, and maximum assessment records, including the sparse
  DONE/LATER rail; DSQ must remain unchanged while F1 creates or updates only
  DSQOUT;
- exact SCNATIVE valid/rejected screens for all six implemented operations,
  with the complete TI variable/settings set unchanged before and after;
- TI-OS String creation, replacement, parser rejection, and durable-state
  transaction inspection;
- APD, wake, `2nd` + `OFF`, native-function handoff, and return-to-shell state;
- induced interruption around every persistent-state commit phase.

These remain prerequisites for moving the corresponding feature to the next
physical-test rung.
