# Phase 9 — Quick Add — execution report

Branch `feat/health-usability`, worktree `.claude/worktrees/health-usability`.
Base at start: `f8897c1fe`. `main` merged first (fast-forward to `6d93ca52a`,
one file: `scripts/audit-direct-fs-imports.mjs`).

---

## Status per task

| Task | Status | Commit |
|---|---|---|
| 9.1 Bucket-aware zero-query suggest | done | `3a8a05a7d` |
| 9.2 Combobox opens with suggestions | done | `dacf38b0d` |
| 9.3 Docs | done | `252801fb9` |

---

## What shipped

**The ranking** lives in `backend/src/2_domains/health/services/bucketSuggestRanking.mjs`
— pure, clock injected as an argument. Three tiers: favorites, then entries with history
in this bucket ordered by `0.6 * min(1, count/90) + 0.4 * 0.5**(daysSinceInBucket/14)`,
then a global-score backfill admitted **only while fewer than five entries have any
history in the bucket**. Ties break on normalized name; the ordering is total. With no
bucket, the result is byte-for-byte the shipped favorites → global-score → name list.

**`FoodCatalogEntry.usageByBucket`** — `{ [bucket]: { count, lastUsed, quantity } }`,
defaulting to `{}`, never null. Written by `quickAdd` and by `backfill`.

**`quickAdd(id, userId, { mealTime })`** writes the row into that bucket with
`settled: true, settledBy: 'user', settledAt`, and defaults the portion to the last one
logged for that food in that bucket.

**The combobox** fetches on mount with `?bucket=…&limit=8`, undebounced; typing switches
to `?q=` on the existing 250 ms debounce; rows carry the food's icon.

---

## Test counts, each with the command's OWN exit code

Every number from `npx vitest run <files>` with `echo $?` on the command itself, never on
a pipeline.

| Suite | Tests | Exit |
|---|---|---|
| `bucketSuggestRanking.test.mjs` (new) | 18 passed | 0 |
| `bucketUsageRoundtrip.test.mjs` (new) | 10 passed | 0 |
| `health.quickAddBucket.test.mjs` (new) | 6 passed | 0 |
| `FoodCatalogService.quickAdd.test.mjs` (+12) | 14 passed | 0 |
| `FoodCatalogService.suggest.test.mjs` (+4) | 9 passed | 0 |
| `AddCombobox.test.jsx` (+9) | 14 passed | 0 |
| whole `frontend/src/modules/Health/` | 356 passed / 36 files | 0 |
| Phase 9 sweep (all of the above + backend health, icons routes, presenter, stored-shape char) | **579 passed / 57 files** | **0** |
| Every other test file touching `quickAdd` / `suggest` / `FoodCatalogEntry` / `recordUsage` (the three nutribot use-cases + `tests/unit/applications/health/FoodCatalogService.test.mjs`) | 15 passed / 4 files | 0 |
| `auditLayerImports` + `auditDirectFsImports` | 65 passed / 2 files | 0 |
| `npm run audit:ui` | all counters at or under baseline | 0 |
| `node scripts/check-scss-build.mjs` | 314 entrypoints compiled | 0 |

### The full branch gate — GREEN (the first red was contaminated)

The first sweep I ran came back **exit 1** with two new failing files, one of them mine
(`tests/unit/domains/health/foodCatalogStoredShape.char.test.mjs`). I refused to record it
as a verdict and refused to baseline it. That was the right call: **the run was
contaminated, and the contamination was another agent's falsification pass.**

The Phase 9 reviewer was working in this same worktree from 05:16:48 to 05:22:22, breaking
and restoring the very modules under test. The gate's JSON shows my file failing at
**05:18:44** with an exact-shape mismatch at **line 64** — the precise signature of
removing `usageByBucket` from `#dehydrate`, which was one of the reviewer's own
falsifications. This report's Task 9.1 falsification table independently predicts exactly
that failure for exactly that breakage (7 tests). `quizScanRecorder.test.mjs` failed at
05:08:07, before the reviewer started, and is named in the gate's own header as a known
roaming victim.

**The authoritative gate, re-run on a restored tree at comparable load (loadavg 21-33):
exit 0** — 32,524 passing, **12 failing files exactly equal to the baseline**, and both
suspect files green.

My own triage, done before that result existed, independently refuted the two wrong
explanations. Kept because the method is reusable:

| Hypothesis | Verdict |
|---|---|
| Load starvation | **Rejected** — the file has no clock and no I/O, so a busy machine has nothing to trip. |
| Cross-file pollution under sharding | **Refuted by reproduction.** The population was reconstructed by mirroring `vitestPopulation()` and came to **3,014 files — the count the gate itself reported**; the target sits at index 2952 → chunk 4 (2400-2999), position 552/600. Target + prime suspect (`tests/unit/applications/health/FoodCatalogService.test.mjs`): green. Target + all 46 health/nutrition/catalog neighbours in chunk order: 671 passed / 47 files. **The entire chunk 4 verbatim** — same 600 files, same order, same `--max-workers=8`: **7,814 tests, 0 failures**, target `passed`. |
| A concurrent agent mutating the modules mid-sweep | **Correct** — confirmed by the reviewer from the gate's own JSON. |

Nothing was changed in response to the red. No assertion was loosened; neither file was
baselined.

### Two things the gate itself should learn from this

1. **The gate destroys the evidence needed to triage its own red.** `runVitest` deletes
   each chunk's JSON as it merges it (`rmSync(chunkOut)`) and never writes the merged
   report to `outFile`, so a failing file's assertion message is unrecoverable minutes
   later; the log prints file names only. My triage had to proceed entirely by
   reconstruction — the reviewer could name the 05:18:44 timestamp and line 64 only
   because it still held its own copy.
2. **A full gate is not safe in a worktree another agent is editing.** A falsification
   pass — the practice this program mandates — deliberately puts broken code on disk for
   seconds at a time. A concurrent sweep reads it and reports a red nobody can reproduce.
   That is exactly what happened.

---

**New tests added: 59** — 34 in three new files, 25 appended to three existing ones.

---

## Falsification — every new test broken deliberately

Automated: apply one breakage, run the affected suites, restore from the in-memory
original, report. 30 breakages, **all fail**. Two rounds, because the first round found
two of my own tests were inert.

### Task 9.1 (21 breakages)

| Breakage | Result |
|---|---|
| Dehydrator drops `usageByBucket` | **7 failed** |
| Entity drops `usageByBucket` (always `{}`) | **9 failed** |
| `recordUsage` ignores the bucket option | **10 failed** |
| `quickAdd` ignores the caller's mealTime (clock always wins) | **9 failed** |
| `quickAdd` stops writing `settled` | **3 failed** |
| `quickAdd` ignores the remembered portion | **2 failed** |
| `recordUsage` never records a bucket (service side) | **6 failed** |
| `backfill` stops donating mealTime/portion | **1 failed** |
| `backfill`'s name gate narrowed back to `label` only | **3 failed** |
| Nutrilist store defaults an absent `settled` to `false` | **1 failed** |
| Ranking: backfill threshold removed (always backfill) | **2 failed** |
| Ranking: weights swapped (0.4 / 0.6) | **2 failed** |
| Ranking: half-life 14 → 30 days | **2 failed** |
| Ranking: frequency window 90 → 30 days | **2 failed** |
| Ranking: name tie-break dropped | **1 failed** |
| Ranking: favorites lose their tier | **7 failed** |
| Ranking: bucket ignored entirely | **8 failed** |
| Service: `suggest` stops forwarding the bucket | **2 failed** |
| Router: `suggest` stops forwarding the bucket | **1 failed** |
| Router: `quickadd` stops forwarding mealTime | **2 failed** |
| Router: phantom-bucket / phantom-mealTime guards removed | **1 failed** each |

### Task 9.2 (9 breakages)

| Breakage | Result |
|---|---|
| No zero-query fetch (empty text clears the list, as before) | **8 failed** |
| Bucket not sent on the opening request | **1 failed** |
| Opening list no longer short (limit 8 → 60) | **1 failed** |
| mealTime no longer travels with the quickadd | **2 failed** |
| The follow-up PUT is restored | **1 failed** |
| Suggestion rows draw no icon | **2 failed** |
| A broken icon is not retired (`onError` no-ops) | **1 failed** |
| The neutral `default` sentinel treated as a picture | **1 failed** |
| Typing no longer switches off the bucket list | **2 failed** |

### Two of my own tests were inert, and only the pass found them

1. **`recencyDecay` could not detect the half-life changing.** It asserted
   `recencyDecay(daysAgo(RECENCY_HALF_LIFE_DAYS)) === 0.5` — written in terms of the
   constant, so it moved *with* the constant: setting the half-life to 30 days left it
   green. This is precisely the "assertion that could never differ" shape §5.2 names.
   Rewritten against literal 14 and 28 days plus an explicit `expect(CONST).toBe(14)`;
   the same breakage now fails 2 tests. The frequency-window assertion had the same
   shape and was rewritten the same way (it happened to be caught by a second assertion,
   but was not testing what it claimed).
2. **Nothing covered `backfill`'s bucket donation at all.** Deleting the four lines that
   donate `mealTime`/portion left every test green — a decorative addition. Chasing that
   uncovered a real defect (below), and three tests now cover it.

---

## Proof that `usageByBucket` survives a real round trip

`backend/src/3_applications/health/bucketUsageRoundtrip.test.mjs` drives the **real**
`YamlFoodCatalogDatastore` and the **real** `YamlNutriListDatastore` (the latter against a
temp directory on disk). The catalog's `dataService` double stores **YAML text** —
`yaml.dump` on write, `yaml.load` on read — so nothing can survive by being the same
object in memory:

- A quick-add's bucket usage is asserted to be **in the serialized bytes**
  (`expect(text).toContain('usageByBucket')`, then `yaml.load(text)[0].usageByBucket.morning`),
  then read back through `#hydrate` as a record on a `FoodCatalogEntry`.
- Counts **accumulate across three quick-adds**, each of which reloads from the serialized
  file — a dropped field would reset them to 1 rather than reaching 2 and 1.
- The **ranking reads what came off disk**: six real morning quick-adds put `oatmeal` ahead
  of a `useCount: 200` burrito for `bucket=morning`, and behind it for `bucket=evening`.
- The remembered **portion** round-trips (240 g → next quick-add logs 240 g).
- A **legacy catalog file with no `usageByBucket` key at all** — the exact shape on disk in
  production today — loads as `{}`, ranks bucket-blind, and starts accumulating from its
  next use.

Falsified: deleting the field from `#dehydrate` fails 7 tests; blanking it in the entity
constructor fails 9.

Alongside it, `settled` is proven on the nutrilist side: a quick-added row reads back off
the YAML file as `settled: true, settledBy: 'user', mealTime: 'morning'`, while a
**legacy-shaped row written alongside it that OMITS the key** reads back `undefined`.
Only an omitted key can detect a `?? false` creeping in (`false ?? x` is `false`) —
introducing `settled: item.settled ?? false` in the store fails that test.

---

## Measured: the icon-request count on a real open of the combobox

Real browser (Playwright, Chromium, 390×844), Vite dev server on 4321 proxying to the dev
backend on 3113, against the **real** production catalog. Requests counted from the moment
the "+ Add food…" affordance is clicked.

| | rows | icon requests | total requests after open |
|---|---|---|---|
| Real catalog, Breakfast | 8 | **0** | **1** — `suggest?bucket=morning&limit=8` |
| Worst case: all 8 suggestions stubbed to icon-bearing foods | 8 | **8** | 9 |

Zero, today, because **no production catalog entry carries an icon** (verified: `suggest?limit=60`
returns 60 entries, 0 with an icon). Phase 7 populates `FoodCatalogEntry.icon` from live
captures and the "always" override; nothing has back-filled it yet.

Worst case is 8, capped by the deliberate `limit=8` on the opening fetch. Measured against
the icon route directly on the same backend: a served icon is **~1 KB in ~5 ms warm**
(`chicken` 1066 B/5.2 ms, `egg` 568 B/5.0 ms, `rice` 1334 B/6.5 ms); eight concurrent
completed in 1.48 s wall, dominated by the four 404s (~0.3 s each — those slugs are not in
this backend's manifest, and the `<img> onError` fallback correctly dropped them, leaving
4 images and 4 icon-less rows). This is nowhere near the 60-concurrent-cold-render shape
Phase 7 had to bound.

Row geometry measured in the real browser (jsdom cannot see layout): **44 px** rows
(A2 tap target), **24 px** icons matching the log rows, a long name wrapping to 62 px
rather than clipping, and an icon-less row starting at the left edge — the same
"icon takes the dot's column" behaviour `EntryRow` has.

Live read-side verification against the dev backend on the real data mount:
`suggest?bucket=morning&limit=8` → 200, 8 items; `suggest?bucket=brunch` → **400**
`Invalid bucket: brunch. Must be one of: morning, afternoon, evening, night`.

**No live WRITE was performed.** Driving a real quick-add would have added a food row to
the user's actual nutrition log for today; the write path is proven instead by the
round-trip test above, through the real stores. Flagging that as a deliberate choice
rather than an omission.

---

## What I refused, and why

**1. I did NOT thread `mealTime` into the three nutribot capture use cases.**
It is a one-line change at each site that looks obviously right, and it would have been
wrong. At the point where `LogFoodFromText` / `LogFoodFromImage` / `LogFoodFromUPC` record
catalog usage, the meal they hold is the **clock's** guess — each builds `meal.time` from
`#getMealTimeFromHour` and then *returns* `mealTime`/`mealTimeExplicit` for
`NutribotInputRouter#capture` to apply the precedence (`LogFoodFromText.mjs:390-396`
says so in as many words: "the log itself always stores the CLOCK-derived meal.time…
so the router seam can override"). Donating the pre-override value would write a wrong
bucket as a count on disk, permanently, in exactly the case decision §1 says matters most
("a meal named out loud beats the row the capture was launched from, which beats the
clock"). Those callers therefore record a use with **no bucket at all**, and a test pins
that they never guess one. The seam where this could be done correctly is the input
router, which is where the precedence is applied — a larger change than Task 9.1's scope.

**2. I did NOT add `usageByBucket` to `presentFoodCatalogEntry`.**
The brief says to add the field wherever a whitelist exists. That presenter is a *read*
projection to HTTP, not a persistence hop: the ranking is computed server-side, the client
never needs the field, and adding it would break the presenter's exact-shape test for no
benefit. The persistence hops (entity constructor, `#dehydrate`, `#hydrate`, the stored-shape
characterization) all carry it and are all falsified above.

**3. I did NOT fix the UTC/local date divergence between `recordUsage` and `quickAdd`.**
See Concerns.

---

## One real defect found and fixed, outside the plan's scope

**`backfill` was reading almost nothing.** It gated on `if (!item?.label) continue`, but
the nutrilist has two row shapes: `syncFromLog` rows key the name as `label`, `saveMany`
rows (quick-adds, group children) key it as `item`. On the production file the
`item`-shaped rows are the **majority** — verified on the running container: 68 rows,
39 `item:` vs 29 `label:`. So the backfill silently skipped most of the history its own contract
claims to read, and Phase 7's icon donation was riding on the same gate — **57 % dead, not 100 %**: production's gate processed the 29 `label` rows and skipped the 39 `item` ones. Nothing shipped depended on it (all 683 catalog entries carry `icon: null`, so that route has apparently never been run in production), and the widening changes nothing retroactively — it only makes a future backfill complete.

This mattered here because `backfill` is the only path that can seed bucket history from
finished rows (whose `mealTime` *is* the resolved meal) — so with the gate as it was, the
donation I had just added was dead code. Widened to the name the store itself resolves
(`item.name || item.item || item.label`, excluding `#normalizeItem`'s `'Unknown'`
sentinel). Falsified: narrowing it back fails 3 tests.

Found only because the falsification pass showed the donation was decoration.

---

## Concerns

1. **Bucket history starts thin, but that is a HISTORY artifact — not a structural gap.**
   An earlier draft of this concern claimed `dehydrateNutriListItem` writes no `mealTime`
   and that the AI capture path could therefore never contribute bucket history. **That was
   wrong**, and the review corrected it. The capture path persists the RESOLVED meal:
   `NutribotInputRouter#resolveMealTime` (`services/NutribotInputRouter.mjs:136`) applies
   explicit-utterance > bucket-param > clock and saves it onto the log at `:85`, before
   `#commitCapture` at `:99`; `YamlNutriListDatastore.mjs:180` stamps
   `mealTime: nutriLog.meal?.time ?? null` onto every row of that path; `AcceptFoodLog.mjs:121`
   does the same on the `saveMany` path. Both shipped 2026-09-02 and are in the deployed
   image. Verified per record against the production hot file: all **8** rows carrying a
   `mealTime` are dated 2026-09-02→03; all **60** without one are dated 2026-08-07→31 — a
   clean cutoff at the change. Every capture from now on contributes its bucket, so the
   ranking fills in on its own. `mealTime` is absent from `dehydrateNutriListItem` **by
   design**: the `.map()` at `:180` overrides it and `saveMany` already carries it at
   `:257`. **Do not add it there** — it would be dead code that reads like a fix.

2. **`recordUsage` dates in UTC while `quickAdd` dates locally.** `recordUsage` stamps
   `new Date(clock.now()).toISOString().slice(0,10)`; `quickAdd` uses the local-date helper
   (a fix that predates this phase, with its own test — a naive ISO slice reads as tomorrow
   every evening in this timezone). Both now write `usageByBucket[bucket].lastUsed`, so the
   same instant can be recorded a day apart depending on which path ran. Bounded — one day
   of decay on a 14-day half-life — and the divergence already applies to `entry.lastUsed`,
   which the shipped global score reads. Fixing it changes ranking for every existing entry
   on a path outside this task, so it is recorded (decision 2.28) rather than done.
3. **`suggest` returns raw entities, so `usageByBucket` now rides on the wire.** The route
   has always returned entity instances rather than a projection, because the UI needs
   `favorite` and `icon` which `presentFoodCatalogEntry` does not carry. The payload
   addition is small (≤ 4 buckets × 8 entries) but it is internal ranking state on a public
   response. A `presentSuggestion` projection is the tidy fix; introducing new API surface
   this late was not worth it.
4. **`backfill` is NOT idempotent — see decision 2.29.** `recordUsage` increments
   `useCount` (and now the per-bucket count) once per stored row per run, so a second run
   over the same window inflates every entry's global score and bucket frequency, with
   nothing detecting or correcting it. Recorded as a decision-log line rather than only
   here, because "bucket history seeds from backfill" makes running it the obvious next
   move and this is what someone needs to know first.
5. **Editing a portion does not update the bucket's remembered quantity — see decision
   2.30.** `PUT /nutrilist/:uuid` writes the row and never touches the catalog, so a
   corrected portion is re-offered stale by the next quick-add until a backfill replays it.
6. **Suggestion icons are invisible on real data today** (0 of 60 catalog entries have
   one). They will appear as captures accrue, or immediately after a `POST
   /nutrition/catalog/backfill` — which now actually processes the rows it was skipping.
   I did not run that backfill: it mutates the real catalog (it is not idempotent —
   `useCount` increments per row per run) and was not asked for.
7. **The five-entry threshold is a hard cut, by design.** A bucket with exactly five known
   foods shows five suggestions, not eight — no global backfill. That is the reading of the
   plan under which the threshold means anything, and it is what makes the Breakfast list
   *breakfast*. Worth confirming it matches product intent before this ships wide.
8. **`docs/_wip/plans/task-{6,7,8}-report.md` are untracked in this worktree**, from
   earlier phases. Left alone.

---

## Environment notes

- Two dev backends were already running in this worktree (PIDs 1457167/1457193, started
  04:33 by another agent). I did **not** kill them; I verified PID 1457167 on port 3113 was
  serving my Task 9.1 code (`?bucket=morning` → 200, `?bucket=brunch` → 400) and used it.
- My Vite dev server ran on **4321** (`--strictPort`) to avoid colliding with anything, and
  was stopped afterwards. Three scratch scripts written at the repo root for the
  measurement (`_measure-combobox.mjs`, `_probe.mjs`, `_shot.mjs`) were removed; `git
  status` is clean of them.
- Load average during this work ranged 27–60 with concurrent full-gate runs elsewhere. The
  Phase 9 sweep was re-run on the quieter side and reported 579/579, exit 0.
