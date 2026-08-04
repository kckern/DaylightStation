# SchoolCalc TI-86 CLI coverage plan

`ti86.cli.mjs` is the fast, exact-binary exploration loop: it sends one
digest-pinned install over MAME's virtual Graph Link, launches `ASCHL` through
TI-OS, presses the TI-86 key matrix, and decodes the actual 128×64 LCD. This
plan turns a confirmed CLI transcript into a named MAME scenario before a
physical transfer. It deliberately tests a durable restart, not a JavaScript
model of the application.

## Startup state model

There are exactly two product startup states in the alternating `SCL1` record.

| State | Durable condition | First visible SchoolCalc screen |
| --- | --- | --- |
| Unconfirmed | `learnerSelected` is clear; selected key is irrelevant | **Who is studying?** picker, initially focused on the first configured learner |
| Confirmed | `learnerSelected` is set; selected key is a roster learner or explicit Guest (`0`) | learner-scoped **Subjects** list with the active learner in the inverse header |

The picker is therefore a first-boot and explicit-switch interface, not a
screen inserted into ordinary launches. `USER` at the Subject root opens the
active learner's **My Progress** view; `SWITCH` is the only route back to the
picker. A cold process restart means ASCHL runs again after the application
returns to TI-OS while the transferred `DSLOCAL0`/`DSLOCAL1` records remain.

## Test conventions

- Use a complete release bundle. `--transfer` is only for an intentionally
  isolated transport diagnostic, never a release-path test.
- Capture `--screens each --screen hybrid` and retain the transcript as a
  failure artifact. Use `--screen pixels` only when a semantic assertion is
  insufficient.
- When a complete virtual transfer cannot finish inside the terminal's command
  window, use `--detach --output /private/tmp/schoolcalc-route.txt` and read
  the adjacent `.log` if no transcript appears. Detachment preserves the
  exact paced transfer and all emulated-frame waits.
- Wait at each TI-OS child-runtime handoff. The starter fixture uses 300–420
  emulated frames after picker selection, Catalog drill-down, module launch,
  profile launch, and return. A key sent during the handoff is not a valid
  interaction test.
- Assert semantic text and controls, not merely an LCD change: e.g. `SUBJECTS`
  plus `SOREN`, `MY PROGRESS` plus `SWITCH`, or the exact lesson title.
- Each named scenario begins from a new MAME process and complete transferred
  bundle. A scenario that needs restart performs the restart *within that
  process*, without retransferring `DSLOCAL` state.

## Required startup and profile matrix

| ID | Setup / key path | Required assertion |
| --- | --- | --- |
| `cold-unconfirmed-picker` | Fresh complete bundle → `ASCHL` | Picker is visible; no Catalog, lesson, or progress view is visible first. |
| `cold-confirm-guest` | Fresh bundle → move to Guest → `ENTER` | Subject root header says `GUEST`; Guest is now a confirmed identity. |
| `cold-confirm-soren` | Fresh bundle → picker selection of Soren | Subject root header says `SOREN`; only learner-visible Catalog entries render. |
| `cold-confirm-alan` | Same, parameterized for Alan | Header and profile evidence identify Alan, never the prior selection. |
| `cold-confirm-milo` | Same, parameterized for Milo | Header and profile evidence identify Milo. |
| `cold-confirm-felix` | Same, parameterized for Felix | Header and profile evidence identify Felix. |
| `warm-named-start` | Confirm a named learner → Subject root → return to TI-OS → relaunch `ASCHL` | Goes directly to the same learner's Subject root; picker does not flash or intercept input. |
| `warm-guest-start` | Confirm Guest → Subject root → return to TI-OS → relaunch `ASCHL` | Goes directly to Subject root with `GUEST`; key `0` is not mistaken for unconfirmed state. |
| `user-profile-return` | Settled Subject root → `F3 USER` → `EXIT` | **My Progress** shows the active learner; EXIT returns to Subject root, not Home or a loading loop. |
| `switch-commit` | Subject → `USER` → `F5 SWITCH` → another learner → `ASCHL` restart | Subject header and My Progress both use the newly selected learner after restart. |
| `switch-cancel` | Subject → `USER` → `F5 SWITCH` → `EXIT` | Returns to the unchanged learner's Subject root; no route remains at private view `12`. |
| `profile-progress` | Confirm learner → Subject root → `F3 USER` | Projection is scoped to the selected learner; Guest is explicitly local-only. |

The four named learner rows must remain separate data cases even when their
navigation is identical. They guard against roster ordering, 16-bit key, and
learner-access regressions that a single happy path cannot see.

## Catalog-to-content matrix

The shipped starter Catalog is deliberately small but has four independent
content-pack variables. Every release must traverse all four:

| ID | Subject path | Minimum actions / assertions |
| --- | --- | --- |
| `math-notes-examples-quiz` | Math → Mental Percent → Percent Basics → Find Ten Percent | Open Notes and page to `END`; return safely. Open Examples and step both prompt and worked steps. Open Quiz, use its labeled F-key answers, verify local score plus queued result then QR `MARK`/`LATER`. |
| `science-notes-examples-quiz` | Science → Water Cycle → Water Moves → Evaporation and Condensation | Open Notes and prove wrapped scroll plus `NEXT`/`END`; open Examples and its distinct text; complete the quiz and verify result is learner-scoped. |
| `history-notes-examples-quiz` | History → Roman Roads → Empire Connections → Why Roads Matter | Open Notes and return; open Examples and its distinct prompt/steps; complete the quiz and verify result/QR flow. |
| `arts-pokemon-quiz` | Arts & Culture → Pokémon Identification → Pokémon Basics → Pokémon Identification | Prove the one-module auto-skip opens the six-question quiz directly, then verify score/mastery and QR flow. |
| `catalog-back-edges` | At Subject, Course, Unit, Lesson, Module, and content depths | `EXIT`, `CLEAR`, and F2 Back follow the documented parent route; ordinary back never quits to TI-OS. |
| `catalog-focus-scroll` | Fixture with more than six visible list entries | Arrow movement redraws only the focus cells when unscrolled; scrolling moves rail/thumb and preserves selected label. |

The starter packs cover `lecture_notes`, `examples`, and `quiz`. Before a
release promotes generic-module coverage, add a compact deterministic test
pack that also contains at least one `problems` drill, a multi-card
`flashcards` deck, a long wrapped card, and an unavailable/downloadable entry.
That fixture closes the current subject-neutral coverage gaps without adding
subject-specific runtime code.

## Recovery and continuation matrix

| ID | Interruption point | Required invariant |
| --- | --- | --- |
| `relaunch-from-subjects` | Exit to TI-OS at Subject root, then relaunch | Confirmed learner persists; launch is direct to Subject root. |
| `relaunch-from-deep-catalog` | Exit/relaunch while on Course, Unit, Lesson, or Module | Relaunch intentionally normalizes to Subject root; selected learner and installed content remain. |
| `relaunch-during-reader` | Exit/relaunch after moving within a note/example | Durable module continuation is either resumed by its explicit Continue route or safely normalized; it never points at a different artifact. |
| `relaunch-after-result` | Score quiz before QR, then restart | Pending result remains durable and QR is reachable; it is not silently marked uploaded. |
| `qr-mark-later` | Result QR → F1 Mark and separately F5 Later | F1 records only the private optical-scan receipt; F5 preserves pending work. Neither changes the queued result's idempotency key. |
| `invalid-state-safe-stop` | Corrupt a disposable `DSLOCAL` slot / a child header in a diagnostic bundle | A concise safe diagnostic appears; neither roster, Catalog, nor result queue is mutated. |

## CLI recipes

Use an owned TI-86 ROM and substitute the current bundle identifier:

```sh
# Fresh first boot: expect the picker.
node _extensions/ti86-app/ti86.cli.mjs \
  --rom /secure/path/ti86.rom \
  --bundle _extensions/ti86-app/dist/install-ti86a-RELEASE \
  --load ASCHL --wait 1200 --screens each --screen hybrid

# Settled named-user flow: choose Soren, wait for Subjects, then open USER.
node _extensions/ti86-app/ti86.cli.mjs \
  --rom /secure/path/ti86.rom \
  --bundle _extensions/ti86-app/dist/install-ti86a-RELEASE \
  --load ASCHL --wait 1200 \
  --key ENTER --wait 420 \
  --key F3 --wait 420 --screens each --screen hybrid \
  --output /private/tmp/schoolcalc-user-flow.txt
```

For a bounded low-level diagnostic while investigating a visual or state
failure, append `--debug-memory CAFA:32`. It records only that final 32-byte
RAM window in the transcript; normal UX evidence must remain screen-based.

For a QR `MARK` proof, deliberately leave the application after the QR screen
with `--keys SECOND,EXIT --wait 900`, then append `--debug-receipt`. The CLI
retrieves the actual `DSQOUT` TI String through the virtual Graph Link and
validates its `SCO1` checksum plus marked result indexes. `LATER` must not use
that option: its proof is the visible `QR QUEUED / CABLE OFF` Result screen.

For a warm-start transcript, use the explicit TI-OS sequence from a settled
Subject root: `EXIT` (return Home), wait; `SECOND,EXIT` (return to TI-OS),
wait; then `PRGM,F1,F1,ENTER` to launch `ASCHL` again. A future ordered
`--restart ASCHL` CLI action should encapsulate precisely that sequence; it
must not rerun the Graph Link transfer or recreate `DSLOCAL` state.

### Catalog singleton rule

After the learner explicitly chooses a Subject, the Catalog automatically
passes through a Course, Unit, or installed Lesson that has exactly one
visible, authorized option. It also opens a one-option Module panel directly;
a multi-option Module panel remains the meaningful activity choice. The rule
is forward-only; BACK and a fresh launch retain the durable hierarchy rather
than looping back into automatic descent. The `catalog-lesson-flow` and
`pokemon-identification-quiz` MAME scenarios exercise this behavior.

For a normal choice question, assert one captured screen contains both the
prompt and labelled `A)`–`E)` rows, then use the corresponding F key directly.
Do not add a synthetic `ANS` key step: that old two-surface flow is retained
only as the tall-prompt fallback.

## Promotion gate

An exploratory CLI transcript is evidence for diagnosis only. A fixed path is
promoted to `testing/mame-scenarios.yml` once it has a stable route and semantic
assertions. The complete MAME scenario suite must pass on the digest-pinned
bundle before the physical USB smoke test. The physical test then verifies the
same selected cold/warm profile path, LCD readability, real key timing, and
Graph Link transport; it does not replace the emulator matrix.
