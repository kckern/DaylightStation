# Phase 10 — Smart Meal Templates — report

Branch `feat/health-usability`, worktree `.claude/worktrees/health-usability`.
Base `6e57205e6`. Not deployed, not merged.

## Status per task

| Task | Status | Commit |
|---|---|---|
| 10.1 Template model + service | done | `d99c3d269` |
| 10.2 Saved-meals migration | done | `c5322d069` |
| 10.3 Template mining | done | `6bd83f630` |
| 10.4 Picker replaces SavedMealsSheet | done — deletion performed, parity driven first | `8d7a34675` |
| 10.5 Docs + program close-out | done | `e547df36e` |

## Test counts — each command's OWN exit code

| Command | Exit | Result |
|---|---|---|
| `npx vitest run backend/src/2_domains/nutrition/services/TemplateMiner.test.mjs` | 0 | 31 passed (31) |
| `npx vitest run backend/src/3_applications/health/TemplateService.test.mjs` | 0 | 26 passed (26) |
| `npx vitest run backend/src/3_applications/health/TemplateService.roundtrip.test.mjs` | 0 | 3 passed (3) |
| `npx vitest run backend/src/3_applications/health/TemplateCurationJob.test.mjs` | 0 | 7 passed (7) |
| `npx vitest run backend/src/4_api/v1/routers/health.templates.test.mjs` | 0 | 13 passed (13) |
| `npx vitest run cli/migrateSavedMealsToTemplates.test.mjs` | 0 | 9 passed (9) |
| `npx vitest run frontend/src/modules/Health/today/TemplatePicker.test.jsx` | 0 | 15 passed (15) |
| `npx vitest run frontend/src/modules/Health/` | 0 | 379 passed (379) |
| `npm run test:unit:vitest` (the gate) | 0 | 32,722 tests — 32,630 pass, 37 fail, 52 skipped; 11 failing files, **all in the baseline**; "OK (no new failures vs baseline)" |
| `npm run audit:layers` | 0 | 46 rules, every one at baseline |
| `npm run audit:ui` | 0 | 5 rules at/under baseline |
| `npm run audit:links` | 0 | 3,513 modules |
| `npm run check:parse` | 0 | 9,133 parsed |
| `npm run check:scss` | 0 | 314 entrypoints compiled |
| `npm run test:composition-contracts` | 0 | 9 passed |

**Test count (M-6, corrected).** The first version of this report said "104 new tests across
8 files"; that was an undercount — it counted only the new FILES and missed tests added to
four existing ones. Measured after the review round: **131 added `it()` across 11 files**
(121 in 7 new files, 10 appended to 4 existing), minus the 2 in the deleted
`SavedMealsSheet.test.jsx` = **net +129**.

| File | `it()` |
|---|---|
| `TemplateMiner.test.mjs` (new) | 33 |
| `TemplateService.test.mjs` (new) | 33 |
| `TemplateService.roundtrip.test.mjs` (new) | 4 |
| `TemplateCurationJob.test.mjs` (new) | 7 |
| `health.templates.test.mjs` (new) | 13 |
| `migrateSavedMealsToTemplates.test.mjs` (new) | 9 |
| `TemplatePicker.test.jsx` (new) | 22 |
| `AddCombobox.test.jsx` | +4 |
| `layout.contract.test.js` | +3 |
| `TodayView.test.jsx` | +2 |
| `EntryEditSheet.test.jsx` | +1 |
| `SavedMealsSheet.test.jsx` (deleted) | −2 |

**Two runs that were NOT verdicts, and are not recorded as one:**
- A first `npm run test:unit:vitest` reported 1 NEW failing file,
  `frontend/src/modules/School/SchoolApp.lockSplit.test.jsx`. Run alone it passes 6/6
  (exit 0). It is untouched by this phase — the "roaming victim of a starved worker"
  the vitest config itself documents. A second gate run came back clean (above).
- The second gate run was first killed by a 10-minute tool timeout (exit 143, truncated
  output). That was discarded and re-run to completion in the background; only the
  completed run is reported.

## Falsification — every new test, broken deliberately

Each mutation was applied alone and reverted immediately; the tree is clean.

**`TemplateService` / round trip**

| Break | Result |
|---|---|
| group row carries the meal's calories (the Phase-2 double-count) | 3 fail incl. row-conservation and the on-disk fold |
| `settled: true` → `false` on the group row | 2 fail |
| variants always included (drop the `role === 'core'` filter) | 4 fail |
| proposals become instantiable | 1 fail |
| dismissed keys ignored in `saveProposals` | 3 fail |
| `list` shows proposals by default | 1 fail |
| delete `kind` from `saveMany`'s whitelist | round trip fails |
| delete `parentId` from `saveMany`'s whitelist | round trip fails |
| delete `settled` from `saveMany`'s whitelist | round trip fails |

The whitelist row deserves a note: my **first** falsification pass reported `kind` and
`settled` as *not* caught. That was a bug in the mutation script, not the test — both
strings occur three times in `YamlNutriListDatastore.mjs` (`#normalizeItem`, the
`syncFromLog` dehydrator, and `saveMany`) and `replace(..., 1)` was hitting the wrong one.
Re-run by exact line number, all three fail. Worth recording because a sloppy
falsification tool produces a *false clean* — the same failure mode as a vacuous test.

**`TemplateMiner`** — every threshold falsified in **both** directions, and each is
asserted twice over (against the PRD literal *and* against the constant, separately):

| Break | Result |
|---|---|
| `MIN_OCCURRENCES` 6 → 5 | 3 fail |
| `MIN_OCCURRENCES` 6 → 7 | 11 fail |
| `CORE_PRESENCE` 0.7 → 0.65 | 2 fail |
| `CORE_PRESENCE` 0.7 → 0.75 | 3 fail |
| `VARIANT_MIN_PRESENCE` 0.2 → 0.15 | 2 fail |
| `VARIANT_MIN_PRESENCE` 0.2 → 0.25 | 3 fail |
| `MINER_WINDOW_DAYS` 90 → 60 | 3 fail |
| `MINER_WINDOW_DAYS` 90 → 120 | 3 fail |
| `MIN_CORE_COMPONENTS` 2 → 1 | 2 fail |
| `MIN_CORE_COMPONENTS` 2 → 3 | 17 fail |
| uncounted rows admitted | 1 fail |
| key includes variants | 1 fail |
| dismissal/existing-key check removed | 3 fail |
| group identity ignored in the occurrence key | 1 fail |
| name dedup removed | 1 fail |
| **group header rows admitted as components** | **initially PASSED — see below** |

**A vacuous test, found and fixed.** The first version of "ignores group header rows"
gave every day's children the same `parentId`, so six days collapsed into one occurrence
and the header (`parentId: null`) landed in a *different* occurrence bucket that never
formed a combo — the assertion was unreachable. Rewritten to the real shape (a Smoothie
group with two children **plus a loose coffee in the same bucket and day**), removing the
filter now mines a second proposal whose first component is a dish name carrying zero
calories, and the test fails. This is the fourth phase running in which falsifying is what
found the defect.

The 0.7→0.65 and 0.2→0.15 mutations *also* initially failed only the constant assertion,
because 10-occurrence fixtures have nothing between 0.6 and 0.7 to separate the two
values. 20-occurrence cases (13/20 vs 14/20, 3/20 vs 4/20) were added; both directions now
fail behaviourally.

**Migration**

| Break | Result |
|---|---|
| name-dedup guard removed | 4 fail incl. both idempotency tests |
| components not forced to `role: 'core'` | 2 fail |
| `--dry-run` writes anyway | 1 fail |

**Frontend**

| Break | Result |
|---|---|
| picker skips the variant step | 5 fail |
| picker counts variants as logged food (all components, not core) | 1 fail |
| combobox quick-adds a template instead of handing it to the picker | 1 fail |
| `TodayView` "Save as meal" writes a saved meal again | 1 fail |
| `EntryEditSheet` "Save as meal" writes a saved meal again | 1 fail |

## Idempotency — proved by running, not asserted

**The migration**, end to end through the real `DataService` and real YAML, on a seeded
data root (`--user kckern`, two saved meals):

```
run 1: created 2  -> sha1 92a8f9a6ec063a573bfc4eda22ee8c6ed767a40f
run 2: created 0, skipped 2 -> sha1 92a8f9a6ec063a573bfc4eda22ee8c6ed767a40f
run 3: created 0            -> diff vs run 1: IDENTICAL
```

`meals.yml` is untouched by all three runs (the originals are not deleted). Against the
**real** data root a dry run reports `saved meals read: 0` — production `meals.yml` is
`[]`, so there is nothing to migrate and nothing was stranded by the sheet's deletion.
No write was made to the live data volume.

**The curation job**: `TemplateCurationJob.test.mjs` runs `run('u')` three times over the
same history and asserts the serialized store is byte-identical after each, with `created:
0` on runs 2 and 3 and **no counter moved** (`useCount` still `[0]`). Dedup is two-layered
— the miner is handed last run's keys and proposes nothing, and `saveProposals` refuses a
known key independently; both layers have their own test. Approval and dismissal are both
proved to block re-proposal forever.

This is explicitly *not* `backfill`'s behaviour (decision §2.29), which is why it was
demonstrated rather than claimed.

## SavedMealsSheet parity — how it was established

**By driving both components, not by reading them.** Before the deletion,
`TemplatePicker.test.jsx` rendered `SavedMealsSheet` and `TemplatePicker` side by side over
the same meal — the saved meal `{ name: 'Protein breakfast', items: [Eggs 140, Toast 180] }`
and the template `cli/migrate-saved-meals-to-templates.mjs` produces from it — and asserted
five observables against each. All five passed with both mounted (14 passed, exit 0). Only
then were `SavedMealsSheet.jsx` and its test deleted; the picker halves of those five (plus
a sixth) remain as the standing guard.

| # | Sheet behaviour | Picker |
|---|---|---|
| 1 | lists the meal by name | same |
| 2 | states "2 items · 320 kcal" | same string, from core components |
| 3 | one tap logs into the LAUNCH bucket + `onLogged` | same; no variant step appears when nothing rotates |
| 4 | fetches only while open | same |
| 5 | empty state rather than a blank sheet | same (different copy) |
| 6 | a failed log was only `logger.error`, invisible | picker **surfaces** the message and does not call `onLogged` |

**Driving it found what reading it would not.** Two WRITE paths fed the meals store and
would have kept writing into a file nothing lists, silently and with a success toast:

- `TodayView.saveBucketAsMeal` — the per-bucket "Save as meal" header action (US-2.2).
- `EntryEditSheet`'s "Save as meal" button.

Both now `POST /nutrition/templates` with all-core components, each pinned by its own test
in its own file, each falsified by reverting it to the meals endpoint. **The deletion was
only safe once those moved** — the surface was replaceable, the things feeding it were not.

The meals *endpoints* are untouched, exactly as the plan requires: `copyMealToToday` still
does create → log → `DELETE` as ephemeral transport, and nothing ever lists what it makes.
`grep` confirms no consumer of `log_uuid: 'SAVEDMEAL'` outside `SavedMealsService`, its
test, and the live API test — all of which still pass.

## Visual verification (jsdom cannot see layout)

Compiled `health.scss` rendered in real headless Chromium at **390px** and **1440px**:
variant toggles measure exactly 44px tall at both widths (A2), the selected state carries
an accent **border** and a `✓`-vs-`+` glyph rather than colour alone (A1), the meal badge
renders inline as a pill, and `scrollWidth === innerWidth` at both widths (no horizontal
overflow). Three of those facts are also pinned in `layout.contract.test.js`, which reads
the compiled stylesheet rather than jsdom.

## Concerns

1. **The Playwright health flow smoke was NOT run, deliberately — and my first stated reason
   was wrong (M-7).** I named port 3111, the prod container. `playwright.config.mjs` resolves
   `getAppPort()` from `system.yml`, which sets **3112** on this host, and *nothing is
   listening there*. So the hazard is not "a false verdict against the old prod image" — it is
   that `reuseExistingServer` would find no server and the harness would fire `npm run dev`
   against `DAYLIGHT_BASE_PATH`, i.e. **the live data volume**, and `health-fast-log` would
   write real nutrition rows into the household's actual day. That is the reason to refuse. I
   have no mandate to mutate household data for a test. Recommend running it after merge and
   deploy, against a server the branch actually owns.
2. **`TEMPLATE_SUGGEST_CAP = 3` is mine, not the PRD's** — now recorded as decision **§2.37**
   in the decisions doc rather than only here, since that is the file that travels. The
   zero-keystroke list is capped at 8 rows; an unbounded template block would push a person's
   actual regulars off it. A typed query shows every match.
3. **A template's name-collision dedup can suppress a genuinely new combo.** The miner
   refuses a proposal whose auto-generated name ("Morning oatmeal") is already taken, per the
   plan's literal "dedup against existing template names". Identity is really the core-set
   key; the name check is a second, coarser filter. In practice a collision means the person
   already has a template for that meal's headline food, so suppressing is right — but it is
   a filter that can hide a real combo, and disambiguating the name instead would be the
   alternative.
4. **Instantiated rows are not editable once archived.** Template rows are ordinary nutrilist
   rows, so §6.16 applies unchanged: a row older than the 30-day retention window is readable
   but an edit throws `NOT_FOUND`. Nothing new, but templates make old-day groups more likely
   to be looked at.
5. **The curation job runs for the head of household only.** Single-user is a stated PRD
   non-goal, and the job resolves one username. If the household ever becomes multi-user this
   is one of the places that silently serves one person.
6. **The job is composed inside a try/catch and is non-fatal.** A wiring error logs
   `health.templates.curation.compose_failed` and the weekly task never registers — the same
   fail-soft posture as §2.8, chosen so a nutrition convenience cannot take media, fitness and
   school down at boot. The trade-off is that a silent mis-wiring shows up only in the log.
7. ~~**Templates never accrue micro provenance.**~~ **FIXED in the review round** — this was
   the right observation and the wrong conclusion. Documenting it would have shipped a
   template path that is strictly less rich than logging the same foods one at a time, and
   would have lowered the coverage caption in the commit that marks Theme 4 delivered. Micros
   and `microsSource` now travel through `snapshotComponent`, the miner, and the child-row
   builder under Phase 6's rules (per key, provenanced sources only, provenance without
   numbers is not provenance). See decision §2.38.
8. **`TemplateService` and `TemplateCurationJob` each construct their own
   `YamlMealTemplateDatastore`** off the shared `dataService`, matching the pattern the file
   documents for goals/savedMeals/medical/photos. Both resolve the same file and the job only
   appends, so it is operationally a singleton — but it is two handles on one file, and a
   future writer that does read-modify-write from both would need a real singleton.


---

# Review round (post final review)

Commit ``ef91d6b65``. Three REQUIRED items and four small ones.

**1 — `focusTemplateId` had no test.** The reviewer was right, and the cause is worse than
an oversight: I *wrote* those tests in Task 10.4 and then **destroyed them myself**. When I
rewrote the parity block, I partitioned the file on the `// PARITY.` marker and replaced
everything after it — and the `focusTemplateId` describe block had been appended *after*
that marker. It went silently, the file still passed, and the count dropped from 22 to 15
without anything failing. **A test file edited by "replace everything after this marker" is
a test file that can lose coverage with no signal.** Re-added and expanded to six tests
(variant template opens its toggles with no click and logs nothing; all-core template logs
on open; toggling from the focused view sends the variant; a focused PROPOSAL is never
auto-logged; Back does not re-focus; no focus id leaves the list alone).

**2 — micros and provenance now travel with a template.** Fixed in code, not documented:
`snapshotComponent` and the child-row builder carry `pickMicros(...)` + `microsSource`, and
so does the miner's component builder, all three under Phase 6's rules. Both frontend "Save
as meal" paths pass the row's micro keys and `microsSource` through. Guard: a template built
from a provenanced catalog food instantiates rows that read back off real YAML as
`microsSource: 'catalog'` with `sodium: 890`, and `BudgetService` reports
`microCoverage.sodium = { covered: 1, total: 2 }` — the unprovenanced sibling honestly
uncovered, the group header on neither side. See decision §2.38.

**3 — `TEMPLATE_SUGGEST_CAP` moved into the decisions doc** as §2.37.

**M-2** — `instantiate` now throws `TEMPLATE_NO_COMPONENTS` (router → 400) when the
selection would write nothing, and the picker's Log button is disabled until something is
chosen, with the hint changing to "Nothing is always included — pick at least one." (§2.39)

**M-3** — `docs/_wip/audits/2026-09-02-health-observability-sweep.md:52` now names
`today/TemplatePicker.jsx` and its four log events, and records that `SavedMealsSheet` was
retired in Phase 10.

**M-6** — test count corrected above: 131 added `it()` across 11 files, net +129.

**M-7** — the Playwright justification corrected above: the hazard is `npm run dev` firing
against the live data volume on port 3112, not a stale image on 3111.

## Falsification, review round

| Break | Result |
|---|---|
| `focusTemplateId` effect body gutted (the reviewer's exact break) | **4 fail** across the health frontend suite (was: 379 passed, exit 0) |
| `snapshotComponent` drops micros + provenance | **4 fail**, incl. the real-YAML → `BudgetService` coverage guard |
| child-row builder alone drops micros (whitelist-shaped) | **2 fail** |
| miner drops micro inheritance | **1 fail** |
| `TEMPLATE_NO_COMPONENTS` guard removed | **1 fail** |
| picker's Log button live on an empty selection | **1 fail** |

## Gate, review round

`npm run test:unit:vitest` — **its own exit code 0**: 32,739 tests, 32,646 pass, 38 fail,
52 skipped; 12 failing files, **all in the baseline**; "OK (no new failures vs baseline)".
`audit:layers`, `audit:ui`, `audit:links`, `check:parse`, `check:scss` and
`test:composition-contracts` (9 passed) each exit 0.

**One non-verdict, discarded.** The first gate run of this round reported one NEW failing
file, `frontend/src/modules/School/Programs/RubiksCube/RubiksCubeProgram.test.jsx` — one of
the roaming victims the vitest config names by name. It failed once in isolation and then
passed 3/3 alone, and `git diff 6e57205e6..HEAD -- frontend/src/modules/School/` is **empty**,
so nothing in this phase touches it. The re-run above is the verdict.

Worth stating because it nearly produced a false one: the background task notification for
that failing run reported **exit code 0** — that is the *wrapper's* exit, not the gate's.
The gate's own `EXIT=1` was in its log. Only the `cmd > log 2>&1; echo "EXIT=$?" >> log`
line is authoritative.
