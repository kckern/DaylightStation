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

Release `caacecbbb8b6` has seven retained exact CLI UX cases against the owned
TI-86 1.4 ROM. The self-contained evidence lives in
[`testing/cli-cases`](../testing/cli-cases/): each transfers the complete
23-variable release, launches `ASCHL`, records ordered keypad input, and
captures the actual 128×64 LCD. It covers first boot, learner-named Progress,
a seven-page Notes reader through `END`, Math `MARK` receipt extraction,
History `LATER` pending work, the six-question Pokémon assessment, and a
nonzero Science route with compact context title, full `REMOVE` rail, and safe
Cancel. The compact `0` and `O` glyphs are distinct; transcripts must never
use ambiguity markers for numeric values.

### Incremental Catalog-transition evidence

On 2026-08-03, release `5055ef0944b1` passed the exact owned-ROM
`catalog-lesson-flow` scenario after adding the Catalog's short local
`.` → `..` → `...` interstitial. The route reached the reader through every
forward hierarchy level and returned safely to the lesson list. This is a
focused regression result, not a claim that the other four named scenarios
were rerun for that release.

### Inline-assessment evidence

On 2026-08-03, release `56ac632a8a5f` passed the owned-ROM,
virtual-Graph-Link `pokemon-identification-quiz` scenario. It captures the
full generic route for Soren: Arts & Culture → auto-collapsed Course/Unit/
Lesson → Modules → all six locally scored questions → durable offline result
→ Version-5/M QR presenter. Each normal question shows its compact prompt and
labelled `A)`–`D)` choices in the same body, with the answer letters on F1–F4;
there is no intermediate `ANS` state. The 25 captured PNG/ASCII frames and
report are in the scenario output directory selected for that run.

On 2026-08-03, the exact-release CLI independently completed the six-question
Pokémon flow for bundle `fc89608f8385`: fresh picker → Soren → Arts & Culture
→ one-transition Course/Unit/Lesson collapse → Pokémon Identification → Q1–Q6
→ locally queued result → Version-5/M result QR → `MARK`/`LATER`. The real
TI-OS/MAME transcript contains every authored prompt and answer—including
`DRAGONAIR`, `DRAGONITE`, `GYARADOS`, and `BAGON`—and contains no `CONTENT
UNAVAILABLE` screen. This also proves the text-first CLI decoder order against
the actual crowded compact assessment framebuffer.

### Cross-surface continuation-code evidence

On 2026-08-04, complete 24-variable release `7f9e19d5a4be` passed the owned
TI-86 1.4 exact CLI route from a real TI-OS `ASCHL` launch: first boot → Soren
→ Subjects → Home → `CODE` → typed `123456` → Pokémon Identification Q1/6.
`123456` is the deliberately reversible pairing of Milo's configured stable
slot and the authored Pokémon module route `098765`; the installed `SCCO`
index resolves it locally before the normal learning runtime receives the
target. The captured LCD proves each numeral, the `CODE` screen, and the
question-and-choice surface. This is device-local navigation evidence, not a
claim that the six digits authenticate a learner or that an external surface
has uploaded progress.

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
MARK/LATER rail, and the selected learner's `My Progress` projection. It also proves that EXIT from a
child Catalog route returns to SchoolCalc Home; ordinary EXIT/CLEAR may not
leak across that runtime boundary or quit the app, while `2nd` + EXIT is the
intentional OS-return gesture.

The `contrast-chord` scenario specifies the shared keypad boundary: it presses
and releases `2nd`, then holds UP, requires a new write to the TI-86 contrast
port, and requires the selected profile bitmap to remain unchanged. A following
plain UP must move the profile cursor. This is how contrast support is tested
without treating the analog LCD level itself as framebuffer pixels. The owned
v1.4 MAME run currently renders the SCX1 child but does not deliver scripted
key fields to its direct matrix loop, so it is not accepted as final evidence
for this path. Record a successful physical-rung result before declaring the
contrast change hardware-proven.

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

For a bounded state/renderer investigation, `--debug-memory CAFA:32` appends
only that final 32-byte TI-86 RAM window as `SCHOOLCALC_MEMORY` to the
transcript. It is a diagnostic aid, not an alternative to screen-based UX
evidence.

For an exact QR-output receipt check, follow `MARK` with `SECOND,EXIT` to
leave SchoolCalc, then append `--debug-receipt`. The CLI requests `DSQOUT`
over the same virtual Graph Link, verifies the received TI String and `SCO1`
CRC, and appends its base sequence and marked result indexes. This validates a
private self-report only; it never treats an optical scan as server upload.

The virtual Graph Link is intentionally paced. If the calling terminal has a
short command window, add `--detach --output /private/tmp/run.txt`; the CLI
starts an identical worker in its own process session and writes its stderr
to `/private/tmp/run.txt.log`. Inspect the transcript only after the worker
finishes—detachment does not skip, inject, or accelerate any release step.

Screen modes are:

- `hybrid` (default): recognized authored text plus semantic controls, then
  compact Braille only for residual graphics;
- `text`: recognized glyphs and semantic controls only;
- `braille`: direct 2×8-pixel LCD approximation;
- `pixels`: exact 128×64 `.`/`█` rows.

The semantic transcript sweeps every supported authored font at all legal
horizontal/vertical offsets and both LCD polarities. It reserves either fixed
full-frame QR profile first, then recognises authored text, then admits known
design-system primitives such as `❯`, `●`, and `○` only in the remaining
pixels before applying Braille fallback. That order prevents a decorative
shape that happens to match inside a letter from fragmenting an authored word.
It reports QR placement/profile rather than inventing text out of QR modules.
Ambiguous compact glyphs are emitted explicitly (for example `{0/O}`) rather
than guessed. This keeps one screen to about ten readable terminal rows while
retaining a deterministic exact-pixel mode for assertions.

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
  MARK/LATER rail; DSQ must remain unchanged while F1 creates or updates only
  DSQOUT;
- exact SCNATIVE valid/rejected screens for all six implemented operations,
  with the complete TI variable/settings set unchanged before and after;
- TI-OS String creation, replacement, parser rejection, and durable-state
  transaction inspection;
- APD, wake, `2nd` + `OFF`, native-function handoff, and return-to-shell state;
- induced interruption around every persistent-state commit phase.

These remain prerequisites for moving the corresponding feature to the next
physical-test rung.
