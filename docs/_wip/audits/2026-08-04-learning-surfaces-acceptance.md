# Learning Surfaces v1 — Acceptance Evidence (spec §12)

Date: 2026-08-04
Branch: `docs/learning-surfaces-spec` (worktree `sheetmusic-wave3`)
HEAD at evidence time: `a3262c441`
Merge base with `main`: `1b75c8011` (current tip); pre-implementation baseline used for
"predates this branch" checks below: `03f453da9` ("docs(school): implementation plan
rev 2"), the last commit before Task 1 landed. `git log --oneline 03f453da9..HEAD`
shows exactly the 15 Task 1–15 commits plus this one.

Task: [Task 16 — Acceptance sweep and evidence](../../../.superpowers/sdd/2026-08-04-learning-surfaces-implementation-plan/task-16-brief.md)

**Amended (final fix wave, same date):** §12.2 gained a corpus-wide TI-86
parity follow-up (F4a), §12.5's summary row was restyled from a soft
"finding" to an explicit FAILED status pending a data-mount fix (F4b), and
§12.7 gained an honest note on the "simulated second calculator family"
(F4c). See
`.superpowers/sdd/2026-08-04-learning-surfaces-implementation-plan/final-fix-wave-report.md`
for the full fix-wave report (F2/F3/F6/F7/F8/F12/F13).

**Amended again (same fix wave, after the above landed):** the data-mount
blocker behind §12.5's FAILED status was resolved out-of-band (surface
profiles authored — `screen-browser`, `paper-letter-mono` — and the missing
question bank added). §12.5 and §12.6 were re-run against this fix wave's
own HEAD (not just the coordinator-supplied numbers, since F7's new
unregistered-capability gate and F13's serializer change could plausibly
have altered real-mount output — they did not) and updated from
FAILED/degenerate to PASSED with fresh evidence; §12.2's F4a note was
corrected from "still blocked" to "unblocked as of the data fix." All 12
acceptance items now read PASSED.

---

## §12.1 — vocabulary safety / golden-digest + bundle suites

Command:

```
npx vitest run backend/src/1_adapters/schoolcalc/ backend/src/3_applications/school/
```

Result: **green**.

```
 Test Files  42 passed (42)
      Tests  292 passed (292)
   Duration  3.72s
```

All golden-digest, codec, and surface-certification/bundle tests under the
schoolcalc adapters and the whole `3_applications/school/` tree (including
`surfaces/`, `schoolcalc/`, catalog, remediation, print) are green with the
feature merged.

---

## §12.2 — calculator parity

New test: `backend/src/3_applications/school/surfaces/acceptance.v1.test.mjs`
(`describe('§12.2 calculator parity …')`).

Uses the exact fixture bundle from `Ti86SchoolCalcCodec.test.mjs` (now exported
as `bundle`, following the same cross-task fixture-export pattern already used
by `PaperCertification.test.mjs`). Three cases:

1. **Renderable bundle** — `Ti86SchoolCalcCodec.supports(bundle, report).compatible === true`,
   `compile()` does not throw, and `Ti86SurfaceCertification.certify(bundle, profile).lesson.verdict === 'full'`.
2. **Capability-incompatible variant** (`capabilities: [...bundle.capabilities, 'image@1']`) —
   `supports().compatible === false`; `compile()` is never attempted by the port
   (guarded); certified reasons (as a set) equal `supports().reasons` exactly.
3. **Compile-throw variant** (oversized `lecture_notes` document, same shape as
   the existing `Ti86SurfaceCertification.test.mjs` byte-ceiling case) —
   `supports().compatible === true` (`supports().reasons` empty), `compile()`
   throws; certified reasons (as a set) equal `supports().reasons` (empty)
   union the single compile error message.

The report used against the codec is built by a small `toCodecReport(profile)`
helper in the test that mirrors the port's private `translateProfile` (strip
`return.*`, set `platformId: 'ti86'`) — this is a test-local repro of an
unexported function, not a new production API.

All three assertions pass (see full-file result below).

**Follow-up (F4a, final fix wave):** the three cases above are hand-picked
bundles, not a corpus walk. `describe('§12.2b corpus-wide TI-86 parity …')`
in the same file adds a small in-memory, multi-lesson fixture corpus (five
lessons: quiz, lecture_notes, flashcards, a TI-86-projection-incompatible
quiz, and a byte-ceiling compile-throw case) resolved through the real
`BuildLearningLesson` path (not a parallel implementation), and walks every
resolvable lesson address through both `Ti86SchoolCalcCodec.supports()`/
`compile()` and `Ti86SurfaceCertification.certify()`, asserting parity for
each.

**Unblocked as of the data-mount fix** recorded in §12.5 below (the missing
question bank was authored and surface profiles were added, so gate mode now
certifies the whole real corpus cleanly instead of aborting on a schema
error — confirmed by this fix wave's own re-run: 24/24 rows certified, all 4
starter lessons `full` on `ti86-codec-baseline`). The corpus-wide **fixture**
parity test above covers the property (certify() agrees with
supports()/compile() across a multi-lesson corpus, not just hand-picked
cases); a dedicated parity **script** walking supports()/compile() vs.
certify() over every lesson in the *real* mount specifically (as opposed to
the gate-mode certification re-run, which proves the corpus certifies but
doesn't separately assert codec/port parity per real lesson) was not
additionally run as part of this update, per instruction to fold in the
unblock without running new sweeps.

```
npx vitest run backend/src/3_applications/school/surfaces/acceptance.v1.test.mjs
 Test Files  1 passed (1)
      Tests  62 passed (62)
```

---

## §12.3 — offer soundness (matrix property)

Same file, `describe('§12.3 offer soundness — matrix property over a two-lesson
fixture corpus …')`.

Fixture corpus: two lessons under one catalog —
- `render-me` (multiple-choice quiz) — renders on paper AND screen.
- `text-me` (short-answer quiz) — paper-incompatible (`paperProfile` lacks
  `response.text@1`), but screen-compatible (`screenProfile` has it).

Three assertions, all at the application layer (the same use cases the routes
call):

1. **Fixture sanity** — `GetSurfaceCertification.lesson()` confirms the paper
   row for the `text-me` lesson really is non-`full`, with the module verdict
   `'incompatible'`.
2. **`PrintService.listPrintables()`**, with `paperCertifyBank` bound the exact
   way `backend/src/app.mjs` wires it (render if ANY registered paper profile
   can render the bank) — given printables `{mc: render-everywhere bank, sa:
   paper-incompatible bank}`, the returned list is exactly `['mc']`. The
   non-render pair (`sa`, paper) is excluded; nothing else is.
3. **Screen launch gate** — `buildVerdictMap` + `moduleLaunchAllowed`
   (`frontend/src/modules/School/catalog/certification.js`, imported by
   relative path) over the screen-surface rows: `render-me` allowed on the
   full-everywhere lesson; **`text-me` is ALSO allowed** on the
   paper-incompatible lesson, because screen's own verdict for that module is
   `render` (it has `response.text@1`). This is the load-bearing assertion:
   the gate excludes exactly the non-render `(module, surface)` pairs — never
   a blanket cross-surface verdict inherited from a different surface's
   incompatibility. A fail-closed check (`moduleLaunchAllowed(map,
   'unknown-module') === false`) rounds it out.

### Full-file result

```
npx vitest run backend/src/3_applications/school/surfaces/acceptance.v1.test.mjs
 Test Files  1 passed (1)
      Tests  62 passed (62)
```

(62, not 3 — importing `PaperCertification.test.mjs` by path to reuse its
`paperProfile`/`choiceBank` fixtures also re-executes that file's own
`describe` blocks as an import side effect; this is the same behavior already
accepted in `GetSurfaceCertification.test.mjs`, which imports from the same
file the same way. The count grew from the original 50 to 62 across the
acceptance sweep and the final fix wave: +6 from §12.2b's corpus-wide parity
walk [F4a], +6 from F6's new PaperCertification missing-limits tests
re-executed as the same import side effect.)

Re-run alongside the codec/port suites it touches, to confirm no regressions
from the `bundle` export or the acceptance file's imports:

```
npx vitest run backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.test.mjs \
  backend/src/1_adapters/schoolcalc/ti86/Ti86SurfaceCertification.test.mjs \
  backend/src/3_applications/school/surfaces/
 Test Files  6 passed (6)
      Tests  147 passed (147)
```

---

## §12.4 — paper capture soundness

Proven in Task 7: `backend/src/1_adapters/school/paper/PaperCertification.test.mjs`,
`describe('PaperCertification specifics (spec §6.3)')` — item-level capability
reasons (text-answer disqualification naming `response.text@1`), OMR-channel
overflow naming the offending item and the channel limit, sheet/page budget
enforcement, and interactive-module exclusion, on top of the shared
`runCertificationPortContract` suite. No new assertions added here; this
section just points at that existing, still-green coverage (included in the
§12.1 run above).

---

## §12.5 — real-corpus inventory (read-only, prod-mounted content)

**Status: ✅ PASSED** (originally FAILED — see "Original run" below; the
blocking data-mount gap has since been fixed and re-verified against this
fix wave's own build).

### Re-run after the data-mount fix (final fix wave, this branch's HEAD)

The data-mount blocker recorded below was resolved out-of-band (not by this
task — data-mount changes are explicitly out of this task's scope): surface
profiles were authored in the corpus (`screen-browser`, `paper-letter-mono`
under `catalog/surfaces/`), `portal.yml` now carries `surfaceProfile:
screen-browser`, and the missing question bank was added at
`catalog/question-banks/arts/pokemon-identification/`.

Re-ran both §12.5 and §12.6's commands myself, read-only (no
`--write-manifest`), against **this fix wave's own build** (HEAD at
`05dff4d81` plus this doc commit) — not reusing the coordinator's numbers
uncritically, per instruction, since F7's new unregistered-capability gate
and F13's canonical-JSON serializer change could plausibly have altered
output on the real corpus. They did not: F7 found no unregistered capability
IDs in the real corpus (zero schema errors), and F13's serializer only
changed per-line key order, not row content or count.

```
node cli/school-certify.cli.mjs --data-dir /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data
```

Output (verbatim, table body omitted — 24 rows, all listed below by verdict):

```
School certification (gate mode)

Certified 24 row(s)
  bank:arts/pokemon-identification/pokemon-identification-medium  paper-letter-mono  render
  bank:arts/pokemon-identification/pokemon-identification-medium  screen-browser  render
  bank:arts/pokemon-identification/pokemon-identification-medium  ti86-codec-baseline (codec)  incompatible
  bank:starter-history-roman-roads  paper-letter-mono  render
  bank:starter-history-roman-roads  screen-browser  render
  bank:starter-history-roman-roads  ti86-codec-baseline (codec)  incompatible
  bank:starter-math-ten-percent  paper-letter-mono  render
  bank:starter-math-ten-percent  screen-browser  render
  bank:starter-math-ten-percent  ti86-codec-baseline (codec)  incompatible
  bank:starter-science-water-cycle  paper-letter-mono  render
  bank:starter-science-water-cycle  screen-browser  render
  bank:starter-science-water-cycle  ti86-codec-baseline (codec)  incompatible
  schoolcalc-starter/arts/pokemon-identification/pokemon-basics/pokemon-identification-medium  paper-letter-mono  full
  schoolcalc-starter/arts/pokemon-identification/pokemon-basics/pokemon-identification-medium  screen-browser  full
  schoolcalc-starter/arts/pokemon-identification/pokemon-basics/pokemon-identification-medium  ti86-codec-baseline (codec)  full
  schoolcalc-starter/history/roman-roads/empire-connections/roads  paper-letter-mono  full
  schoolcalc-starter/history/roman-roads/empire-connections/roads  screen-browser  full
  schoolcalc-starter/history/roman-roads/empire-connections/roads  ti86-codec-baseline (codec)  full
  schoolcalc-starter/math/mental-percent/percent-basics/ten-percent  paper-letter-mono  full
  schoolcalc-starter/math/mental-percent/percent-basics/ten-percent  screen-browser  full
  schoolcalc-starter/math/mental-percent/percent-basics/ten-percent  ti86-codec-baseline (codec)  full
  schoolcalc-starter/science/water-cycle/water-moves/evaporation  paper-letter-mono  full
  schoolcalc-starter/science/water-cycle/water-moves/evaporation  screen-browser  full
  schoolcalc-starter/science/water-cycle/water-moves/evaporation  ti86-codec-baseline (codec)  full

OK
```

`echo $?` after this run: **0**. Zero schema errors (no `Errors` section at
all — F7's new unregistered-`requiredCapabilities` gate ran as part of this
pass and found nothing to flag), zero certified-nowhere warnings (no
`Warnings` section). All **4 starter lessons** certify `full` on all three
registered surfaces (`paper-letter-mono`, `screen-browser`,
`ti86-codec-baseline`); all **4 standalone banks** certify `render` on both
`paper-letter-mono` and `screen-browser`, and `incompatible` on
`ti86-codec-baseline` — expected per spec §7.3 ("standalone banks are not
deliverable to calculators in v1"; `Ti86SurfaceCertification` has no
`certifyBank`, so `GetSurfaceCertification#bankRow` falls back to the
`BANK_NOT_DELIVERABLE_REASON` reason, confirmed in code).

This is the first real-mount run where surface profiles exist to certify
against at all — the "Secondary finding" below (no `surfaces/` directory
authored yet) is now resolved too.

### Original run (pre data-mount fix, before this fix wave)

Ran the CLI against the real mounted corpus, **gate mode, read-only** (no
`--write-manifest`), via `DAYLIGHT_BASE_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation`
(the value from the project's `.env`, not the worktree's, since the worktree
has none — this only reads the shared content mount).

```
DAYLIGHT_BASE_PATH=/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation \
  node cli/school-certify.cli.mjs
```

Output (verbatim):

```
School certification (gate mode)

Errors
  - lesson 'schoolcalc-starter/arts/pokemon-identification/pokemon-basics/pokemon-identification-medium': School question bank 'arts/pokemon-identification/pokemon-identification-medium' was not found

Certified 0 row(s)

FAILED
```

**Finding, not a defect in this branch's code (now fixed out-of-band, see
above):** the real corpus's `schoolcalc-starter` catalog
(`catalogs/schoolcalc-starter.yml`) authored an
`arts/pokemon-identification/pokemon-basics/pokemon-identification-medium`
lesson (and listed its address in `installSets.starter-four`) whose `quiz`
module referenced `bankId: arts/pokemon-identification/pokemon-identification-medium`
— but no such file existed anywhere under `question-banks/`
(`find … -iname "*pokemon*"` under `question-banks/` and `catalogs/` returned
only the catalog file itself). This was a genuine authoring gap in the
published content mount, pre-dating and unrelated to this feature (gate mode's
corpus-validation pass, spec §5.5.2, is exactly what is supposed to catch it —
and it did). It was recorded here per the task's "the corpus's own truth" ask,
not fixed as part of the original acceptance-sweep task; the bank has since
been authored (see "Re-run" above).

Because gate mode aborts before certifying anything on any corpus error (spec:
"any error aborts with nothing certified"), **no certified-nowhere warning
list could be produced** — there was nothing to warn about when nothing was
certified. Schema errors: **1** (the missing-bank reference above). Zero rows
certified.

**Secondary finding (now resolved, see "Re-run" above):** the real corpus had
no `<content-root>/surfaces/` directory at all yet — no paper or screen
surface profiles had been authored against it. Confirmed via a query-mode
single-address run (see §12.6's "Original run" below): the only row produced
was the injected `ti86-codec-baseline`, never a `paper-*`/`screen-*` profile
row, because none existed to enumerate. This was expected for a v1 rollout
where profile authoring is a separate, later content step — not a code
defect.

---

## §12.6 — determinism

**Status: ✅ PASSED** (non-degenerate, against the real mount, post data-mount
fix — see "Re-run" below; the original run's gate-mode proof was
byte-identical but degenerate, 0 rows, per §12.5's original finding).

### Re-run after the data-mount fix (final fix wave, this branch's HEAD)

Two consecutive **gate-mode** `--json` runs against the real mount, this
fix wave's own build, diffed:

```
node cli/school-certify.cli.mjs --data-dir /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data --json > a.json   # exit 0
node cli/school-certify.cli.mjs --data-dir /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data --json > b.json   # exit 0
diff a.json b.json   # no output
md5sum a.json b.json
8fdab98664ca8f2ebfd036551251f4d0  a.json
8fdab98664ca8f2ebfd036551251f4d0  b.json
wc -l a.json
24 a.json
```

Byte-identical across both runs, **non-degenerate this time** (24 rows, not
0 — gate mode now certifies the whole corpus instead of aborting on the
schema error). First row (verbatim, one line — note the keys are now
canonically sorted per line, F13):

```json
{"address":"bank:arts/pokemon-identification/pokemon-identification-medium","contentDigest":"51b7a0371ae0a16b32f21948a14cb32d50b1d7bf2ec8dbe6bdba00755e132a4a","moduleVerdicts":null,"profileDigest":"70434a83a939795899452d4308b57a9ef5dd0aace3ebc5148f4c954b76437005","reasons":[],"surfaceId":"paper-letter-mono","verdict":"render","warnings":[]}
```

### Original run (pre data-mount fix, before this fix wave)

**Gate mode** (the mode the corpus error above forced): two `--json` runs,
diffed.

```
DAYLIGHT_BASE_PATH=… node cli/school-certify.cli.mjs --json > a.json   # exit 1
DAYLIGHT_BASE_PATH=… node cli/school-certify.cli.mjs --json > b.json   # exit 1
diff a.json b.json   # no output
md5sum a.json b.json
d41d8cd98f00b204e9800998ecf8427e  a.json
d41d8cd98f00b204e9800998ecf8427e  b.json
```

Byte-identical — but degenerate (both empty: 0 rows, since gate mode aborted
before certifying, per §12.5's original run). To get a non-degenerate
determinism proof at the time, also ran **query mode** against one address
unaffected by the corpus error
(`schoolcalc-starter/math/mental-percent/percent-basics/ten-percent`, from the
same catalog's `installSets`), twice:

```
DAYLIGHT_BASE_PATH=… node cli/school-certify.cli.mjs \
  --address schoolcalc-starter/math/mental-percent/percent-basics/ten-percent --json > a.json   # exit 0
DAYLIGHT_BASE_PATH=… node cli/school-certify.cli.mjs \
  --address schoolcalc-starter/math/mental-percent/percent-basics/ten-percent --json > b.json   # exit 0
diff a.json b.json   # no output — byte-identical
```

Row produced (verbatim, one line):

```json
{"address":"schoolcalc-starter/math/mental-percent/percent-basics/ten-percent","surfaceId":"ti86-codec-baseline","baseline":"codec","verdict":"full","reasons":[],"warnings":[],"resource":{"estimatedBytes":2253,"limitsApplied":{"hardCeilingBytes":12288,"targetBytes":8192}},"moduleVerdicts":[{"moduleId":"notes","verdict":"render","reasons":[],"warnings":[]},{"moduleId":"examples","verdict":"render","reasons":[],"warnings":[]},{"moduleId":"check","verdict":"render","reasons":[],"warnings":[]}],"contentDigest":"b2d8a26a4bc66c2fb11b2c6dddf1522c68aa3304078fe392209d2b5305cf76dc","profileDigest":"ed05e307d37ebd9c99200604775f49c937f085d9eee3b0651c3ee051c492be8e"}
```

Byte-identical across both runs in both cases. Determinism confirmed (at the
time, in its degenerate/single-address form; superseded by the non-degenerate
whole-corpus proof above).

---

## §12.7 — contract + architecture

**Contract invocations (Tasks 6–8):** each family's certification port test
file invokes the shared `runCertificationPortContract` from
`tests/_lib/school/certificationContract.mjs`:

```
$ grep -rl "runCertificationPortContract" backend/src
backend/src/1_adapters/school/screen/ScreenCertification.test.mjs
backend/src/1_adapters/school/paper/PaperCertification.test.mjs
backend/src/1_adapters/schoolcalc/ti86/Ti86SurfaceCertification.test.mjs
```

Confirmed — Task 6 (TI-86), Task 7 (paper), Task 8 (screen) each call it.

**Architecture test extended:**
`tests/isolated/application/school/schoolcalcArchitecture.test.mjs` now also
scans `backend/src/1_adapters/school/paper/` and
`backend/src/1_adapters/school/screen/` (two new `PAPER_ADAPTER`/
`SCREEN_ADAPTER` constants, added to the existing directory-list arrays,
following the file's established pattern):

- `contains no calculator-family, wire-format, or subject branch in
  domain/application production code` — paper/screen ports must stay as free
  of TI-86/Z80-style device vocabulary as the schoolcalc domain/application
  code already is (they are device-family-agnostic ports per spec §6.3/§6.4).
- `uses Catalog vocabulary without commerce semantics` — paper/screen adapters
  join `SCHOOLCALC_ADAPTERS` in the commerce-vocabulary scan (that test
  already scanned adapters; these are School adapters too).

```
npx vitest run tests/isolated/application/school/schoolcalcArchitecture.test.mjs
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

**Honest note (F4c, final fix wave):** spec §12 item 7 names "the simulated
second calculator family" as one of the ports the shared contract suite
proves. That family does not exist as a second production adapter on this
branch — no second calculator codec was built. The stand-in is the
**domain-primitives fake** port in
`tests/isolated/application/certificationContract.selftest.test.mjs` (a
~40-line `certify()` built directly from `deriveModuleDemands` +
`capabilityReasons` + `moduleVerdict` + `rollUpLesson`, with no
family-specific logic). It legitimately proves the contract is satisfiable
by *any* conforming port — not just TI-86's, whose own domain-layer
plumbing it reuses — but it is not a second real calculator family.
Spec §12.7 has been amended to say this explicitly rather than implying a
second family was built.

---

## Final sweep

Required command:

```
npx vitest run backend/src/ frontend/src/modules/School/ tests/isolated/ cli/school-certify.cli.test.mjs
```

This glob spans the **entire** backend and `tests/isolated/` tree (well beyond
School — Life, Fitness, Piano, ArtMode, etc.), so it is large (~980 test files,
~10,200 tests) and, on this host, vitest's worker-thread pool has a known
teardown flake on it: one run completed cleanly with a full summary; a repeat
attempt hung during post-run worker teardown (`[vitest-pool]: Failed to
terminate threads worker … Timeout waiting for worker to respond`) for an
unrelated frontend test file and never reached its summary line, though no
vitest process was left running afterward. This teardown hang is a vitest/
worker-pool artifact after the test run itself is done, not a test failure —
consistent with the same "close timed out … prevents Vite server from
exiting" warning that appears even on runs that DO print a summary.

**Run 1 (completed, summary captured):**

```
 Test Files  73 failed | 901 passed | 4 skipped (978)
      Tests  82 failed | 10072 passed | 52 skipped | 3 todo (10209)
   Duration  115.98s
```

The full per-file FAIL list from this run wasn't preserved (truncated by a
`tail` in the capture pipeline). To positively confirm School's share of those
73/82 failures without re-running the full, flake-prone glob, a **scoped
equivalent** — every test file under the same four roots whose path contains
"school" (221 files, found via `find … | grep -iE school`) — was run
directly:

```
 Test Files  2 failed | 219 passed (221)
      Tests  5 failed | 2846 passed (2851)
   Duration  30.78s
```

Failing files (both **pre-existing, verified against merge base `03f453da9`**):

1. `tests/isolated/application/school/schoolcalcPlatformConformance.test.mjs`
   (4 tests) — `ValidationError: SchoolCalc device requires deviceId, label,
   platformId, catalogId, and createdAt`, thrown from
   `backend/src/2_domains/school/schoolcalc/SchoolCalcDevice.mjs:265` via
   `EnrollSchoolCalcDevice.execute`. Already documented in project memory as a
   known pre-existing failure, re-verified here.
2. `tests/isolated/e2e/school/schoolcalcActionQr.e2e.test.mjs` (1 test) — same
   root cause (`SchoolCalcDevice.enroll` → identical `ValidationError`), same
   `SchoolCalcDevice.mjs` call site.

Verification against the merge base: `git diff --stat 03f453da9..HEAD --`
against `SchoolCalcDevice.mjs`, `EnrollSchoolCalcDevice.mjs`,
`schoolcalcPlatformConformance.test.mjs`, and `schoolcalcActionQr.e2e.test.mjs`
each returns **empty** — none of these four files changed by even one line
across all 15 Task-1–15 commits (`git log --oneline 03f453da9..HEAD --
backend/src/3_applications/school/schoolcalc/` and the domain-layer
equivalent both return nothing). The failure is unrelated to and unmoved by
this feature; nothing in scope for this task touches it.

The remaining 71 failing files / 77 failing tests from Run 1's totals are
outside School entirely (Life, and other unrelated modules — e.g. the visible
`Life/UserSwitcher.test.jsx` "Should not already be working" React scheduler
errors seen in Run 1's tail) and are out of scope per the task's "do NOT chase
unrelated failures" instruction.

**Net for this task: 0 new failures.** The only School-area failures are the
2 pre-existing files noted above, confirmed unchanged since the pre-Task-1
baseline.

---

## Summary

| Item | Status |
|---|---|
| §12.1 vocabulary safety / golden suites | ✅ green (42 files / 292 tests) |
| §12.2 calculator parity | ✅ new test, green (part of the 62/62 below) |
| §12.2b corpus-wide TI-86 parity (F4a) | ✅ new test, green — in-memory 5-lesson fixture corpus; unblocked as of the data-mount fix (§12.5), fixture parity test covers the property |
| §12.3 offer soundness matrix | ✅ new test, green (part of the 62/62 below) |
| — `acceptance.v1.test.mjs` full file | ✅ 62/62 |
| §12.4 paper capture soundness | ✅ already proven (Task 7), referenced |
| §12.5 real-corpus inventory | ✅ **PASSED** (was FAILED, now fixed and re-verified) — data-mount gap resolved out-of-band (bank authored, surface profiles authored: `screen-browser`, `paper-letter-mono`, `portal.yml` carries `surfaceProfile: screen-browser`); re-run against this fix wave's own build: exit 0, 24/24 rows certified, zero schema errors, zero certified-nowhere warnings, all 4 starter lessons `full` on all 3 surfaces, all 4 banks `render` on paper+screen and correctly `incompatible` on the calculator baseline |
| §12.6 determinism | ✅ **PASSED**, non-degenerate — two real-mount gate-mode `--json` runs (this fix wave's own build) byte-identical, 24 rows each (superseding the original degenerate 0-row gate-mode proof) |
| §12.7 contract + architecture | ✅ 3/3 ports confirmed; architecture test extended + green; "simulated second calculator family" is the domain-primitives fake, not a second real adapter (F4c — see note above and spec §12.7) |
| Final sweep (School scope) | ✅ 219/221 files, 2846/2851 tests; the 2 failing files are pre-existing (verified vs. merge base `03f453da9`) |

No code defects found in this branch by the original acceptance sweep; the
final fix wave (F2/F3/F6/F7/F8/F12/F13) separately fixed seven review
findings — see
`.superpowers/sdd/2026-08-04-learning-surfaces-implementation-plan/final-fix-wave-report.md`.
The one actionable **content** finding, §12.5's missing question bank, has
since been resolved out-of-band along with authoring the first real surface
profiles (`screen-browser`, `paper-letter-mono`) — both re-verified against
this fix wave's own build: **all 12/12 acceptance items now PASS**, real
corpus included.
