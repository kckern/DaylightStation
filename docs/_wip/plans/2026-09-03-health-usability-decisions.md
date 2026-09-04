# Health Usability Program — Decision Log

Companion to `docs/superpowers/specs/2026-09-02-health-usability-prd.md` (requirements)
and `docs/superpowers/plans/2026-09-02-health-usability-program.md` (the 40-task plan).

This file records **decisions and their reasoning** — the things a diff cannot explain.
It exists because the execution ledger lives in a git-ignored scratch directory and would
otherwise be lost. Written during execution; entries are append-only.

Branch: `feat/health-usability`. Phases 0–6 complete at time of writing (32 of 40 tasks);
Phases 0–4 are merged to `main` and deployed.

---

## 1. Product decisions (confirmed by the product owner)

These deliberately reverse behavior the shipped app had. They are recorded here because a
future reader will otherwise read them as regressions.

| Decision | Reasoning |
|---|---|
| Unsettled entries **count** in the calorie equation immediately | The pending queue's "doesn't count until accepted" rule made the equation lie between capture and review. The unsettled cue plus one-tap editing is the safety valve instead. |
| "Coach never auto-accepts" retired | Coach-logged food now lands unsettled and counting like every other capture. Editability replaces the gate. |
| The pending Accept/Revise/Discard queue retired **across all transports** | Web, Telegram and the coach share one lifecycle. Two review models over one data set was the underlying defect. |
| Discard = delete; `rejected` survives as a **scale-only** status | Originally recorded as "`rejected` becomes unreachable pending Phase 5". Phase 5 falsified that: see §3. Discard still deletes; `rejected` is simply never written by a discard. |
| Groups are dishes/courses **inside** a meal, not meals themselves | A casserole, a smoothie, or appetizer/main/dessert as siblings in one dinner. Meal buckets are unchanged. |
| A meal named out loud beats the row the capture was launched from, which beats the clock | Silently overriding what a person said is worse than being wrong; when the explicit meal wins, the UI says so. |
| Single-user this wave | Everything resolves to the head of household. Attribution is deliberately out of scope. |

---

## 2. Plan overrides made during execution

The plan was written before the code was read. Where it was wrong, it was overridden and
the override recorded. Each of these is a deviation a future reviewer would otherwise flag.

**2.1 `NeedsReviewSection` was NOT deleted (Task 1.3).**
The plan said to delete it. That contradicts the plan's own rule that off-surface entries
must reach the day view: the scale path still mints `pending` logs, and pending logs never
sync into the rows the day view reads. Deleting it would have hidden kitchen-scale entries —
re-creating the live incident the component was built for. Kept, rescoped to scale-origin
pending only. **Phase 5 (Task 5.6) verified this override was correct and made it permanent.**
The retirement was attempted and refused with proof: `LogFoodFromScale` still writes
`status: 'pending'`, and the quiet commit that would clear it gates on a composition being
*complete* (`grams !== null && density !== null`), so a weight placed with no density never
completes and its row waits indefinitely for a human. Retiring the section would have made
those rows unreachable — the original incident, restored. The heading text ("NEEDS REVIEW")
is still generic though the section is scale-only; see §6.

**2.2 The AI response was NOT restructured (Task 2.1).**
The plan proposed `{ dishes: [...], loose: [...] }`. The flat `items` array is consumed by
more than the happy path — the revision flow re-parses into the same shape and JSON-repair
logic wraps it. Instead each item carries an optional `dish` name and a pure mapper
synthesizes group rows. A response with no `dish` behaves exactly as before, and that is
pinned by a test.

**2.3 No new date helper in `HealthOperations` (Task 0.4).**
The plan said to copy a `localDateISO` helper. The class already receives `today`, wired to
a household-timezone date source. Using it avoided duplicated time logic.

**2.4 Rollups are computed on read, never stored (Task 2.2).**
A stored total on a group row goes stale the moment a child is edited. Group rows carry
zero nutrition; the bucket sum therefore counts each food exactly once with no special-casing.

**2.5 Auto-settle is read-time, not a job (Task 0.3).**
An entry older than three days *reads* as settled. Nothing mutates storage to achieve it, so
no scheduled job touches archived day files.

**2.6 Absent `settled` means settled (Task 0.1).**
Migration by defaulting: no backfill of hot or archive files, ever. Consequence: `settled`
must be written **verbatim** in every persistence path — a `?? null` or `?? false` anywhere
silently converts every pre-existing row to unsettled. Guarded by tests that construct rows
*omitting* the field, because a test that only passes `settled: false` cannot detect the bug
(`false ?? x` is `false`).

**2.7 A cross-instance cache guard was added beyond the review's requirement (Task 3.1).**
The reviewer accepted a per-component liveness guard and flagged the cross-instance case as
pre-existing. It was closed anyway: the next task wired the day view to that cache, and a
later phase adds a sidebar that can show the same day's data beside the main column — the
exact double-mount scenario. A known silent-data-corruption path should not be left open as
consumers start adopting it.

**2.8 An unwired scale refuses at the surface; it does not kill the boot (Task 5.6).**
When no head-of-household bot id resolves, the observation service is null. The considered
alternative was failing hard at boot, on the grounds that a silent no-op is worse than a
crash. Rejected: a fatal boot would take media, fitness and school down over a *nutrition*
configuration value, against the fail-soft posture everything adjacent to it uses. Instead
the surface declares `available()` and the use case returns `{ handled: true, ok: false,
error: 'SCALE_UNAVAILABLE' }`, so a scan is never acknowledged as applied. `available()` is
optional, so a store owning its own state is unaffected.
**Known limitation, deliberately accepted:** the refusal notice is *structurally
undeliverable*. It is painted by editing the live prompt, and there is no prompt when there
is no bot to have posted one. A person at the fridge gets a scanner beep; the only record is
in the logs. The words are kept so a future fridge-reachable surface has them.

**2.9 The observation read path validates `value`/`unit`, despite "no backfill" (Task 5.6).**
This program's migration rule is to default rather than backfill, so tightening a read path
normally risks rejecting rows already on disk. Here it does not: the data volume contains no
observation ledger at all — the scale path has never written a row in production — so there
was nothing to migrate and the fix was free. Without it a `value: NaN` row read back as
`complete: true` (because `NaN !== null`) and could drive the *unattended* commit. A row that
cannot satisfy its own `kind` is now skipped and warned, never thrown over and never removed
from the file. Consequence worth knowing: such a row also fails the archive partition, so it
stays a permanent hot-file resident — visible rather than swept away, which is the intent.

**2.10 Group rows are excluded from micro coverage on BOTH sides (Task 6.1).**
The plan specified `covered` = counted items carrying `microsSource`, `total` = counted
items. Taken literally, a dish header — which carries zero nutrition by design (2.4) and
can never carry provenance — would sit in the denominator forever, so a fully-covered day
of three dishes and nine children would report "based on 9 of 12 items" and imply missing
data that does not exist. Groups are filtered out of both counts. Pinned by a test.

**2.11 `microsSource: 'ai'` is conditional, not unconditional (Task 6.2).**
The plan said the mapper sets `'ai'`. It sets `'ai'` only when the model actually returned
micronutrient numbers. The stored shape defaults every micro to `0`, so stamping provenance
on a macros-only parse would assert a measurement that never happened — the exact
dishonesty the coverage caption exists to prevent. A measured `0` does count as data;
absence does not. The same rule governs what the catalog will accept as micro data.

**2.12 Two of the plan's Task 6.2 premises were already satisfied.**
The AI prompt already asks for `fiber/sugar/sodium/cholesterol` by name (shipped with Task
2.1), so no second prompt site was created. And `microsSource` was already threaded through
all four field whitelists (`validateFoodItem`, `dehydrateNutriListItem`, `saveMany`,
`NUTRITION_UPDATE_FIELDS`) by Tasks 0.1/0.2/5.5. Rather than assume that, an end-to-end
round-trip test now walks catalog entry → quickAdd → saveMany → YAML on disk → findByDate →
`getBudget().microCoverage`; deleting the field from the `saveMany` whitelist fails it.

**2.13 No goal tick and no over-goal segment on the macro bars (Task 6.3) — accepted.**
The plan asked for a tick marking the goal and a distinct over-goal segment. Neither was
built: the fill clamps at 100 %, so 300 / 150 g is visually identical to 151 / 150 g, and
only the recolour, the numbers beside the bar and the "over goal" in the accessible name
carry the overshoot. The product owner accepted the deviation rather than open design
surface this late in the program. Recorded so it reads as a decision, not an oversight.
(The accessible name does announce the true percentage — 200 %, not a clamped 100 % —
because a clamped spoken number is a false statement, which is a different question from
how much bar to paint.)

**2.14 One fold for the whole day, in a shared contract (Task 6.3 review, Q1).**
Task 6.3 shipped a COUNTED-folded macro bar row directly above `MacroFooter`, which summed
`day.items` unfiltered, and a new per-meal `P · C · F` that folded raw rows too — three
folds over the same data on one screen. Latent only because every live nutrilist row is
`accepted`, which is exactly the assumption `COUNTED` exists to not make. The predicate now
lives in `shared/contracts/nutrition/countedRows.mjs` and is imported verbatim by
`BudgetService` and by both Today components, so there is one definition rather than three
copies that can drift. Pinned by `today/sharedFold.test.jsx`, which builds a day holding one
row of every uncounted status and asserts all three surfaces report the same numbers.

**2.15 Micro provenance is per ROW, and the docs say so (Task 6.3 review, C1).**
`microsSource` is one flag for four micros. A capture answering `sodium` alone yields a row
that is fully "covered", so a watched fiber bar can render a confident `0 / 30 g` with the
caption correctly suppressed. The limit is now stated in the endstate doc rather than only
in this scratch file, and the caption reads "items with any micro data" so it stops implying
a per-micro count. Per-key provenance (four fields where there is one) is the real fix and
is not in this program's scope.

**2.16 The catalog gate is per KEY, not just per row (Task 6.3 review, C2).**
The original donation gate checked only that a row carried provenance — but the capture
mappers had already applied `?? 0`, so a partially-answered capture donated its structural
zeros as catalog readings, which every later quick-add of that food then inherited as
`'catalog'`, permanently and self-propagating. The mappers now carry only the micros the
model actually answered (`pickMicros` on the model's own item; the storage default moves to
the persistence boundary, where `FoodItem`/`validateFoodItem` already applied it anyway),
and `backfill` donates no micros at all because a stored row's per-key provenance is gone.

**2.17 A range reads the workout ledger ONCE, not once per day (Task 8.1).**
The plan said "workouts per day via the existing store call". `getWorkoutsForDate`
re-reads BOTH whole lifelog files (`lifelog/strava`, `lifelog/fitness`) on every call, so a
62-day range through it is 124 whole-file loads on a single request — the shape of the
defect that stalled the backend in Phase 7. `YamlHealthDatastore.getWorkoutsForRange` reads
each file once and returns the same per-day shape. `getBudget`'s per-date path is untouched.
Consequence: `getBudgetRange` requires that method on the injected health store and the
constructor does not check for it, so a fake that omits it fails at call time.

**2.18 Range validation lives in the service, not the route (Task 8.1).**
The plan put "validate dates, cap 62 days" at the endpoint. It is in
`BudgetService.getBudgetRange`, which makes it unit-testable and keeps one owner; the route
maps `RANGE_INVALID` → 400. The user-visible contract is unchanged. While writing it, a
latent `RangeError` surfaced on BOTH sides of the wire: `2026-08-32` parses to Invalid Date,
so the `toISOString()` round-trip these validators use *throws* rather than rejecting —
a 500 where a 400 was the entire point, and a crashed weight chip over one bad row on disk.
Both now guard `Number.isNaN(getTime())` first.

**2.19 The desktop sidebar's widgets are gated in JS, not hidden in CSS (Task 8.4).**
The plan said "on narrow viewports the aside contents that duplicate main-column widgets
are hidden via CSS, single source in JSX". Hiding still mounts, and mounting still fetches:
a phone would pull a month of budgets for a column it never draws. The JSX stays
single-source — one `<aside>`, one instance of each widget — and the CSS repositions that
same element into the second column at 1100px; the 30-day widgets' MOUNT is gated on a
`matchMedia` hook. That puts the breakpoint in two languages, so
`today/layout.contract.test.js` reads the COMPILED stylesheet and fails if the SCSS and JS
values ever disagree. Measured: 390px makes one `budget/range` request, 1440px makes two.
Also decided here: `MacroBarRow` is NOT duplicated into the aside. A second macro surface on
one screen is a second thing to keep in sync, and the bars already sit under the equation on
both viewports.

**2.20 One 30-day request feeds every sidebar widget (Task 8.4/8.5).**
`useApiResource`'s per-path generation cache dedupes a second page LOAD; it has no in-flight
registry, so two components mounting the same path in one render both issue a request. The
sidebar shows two 30-day surfaces, so `TodayView` owns the single fetch and hands `days`
down. Measured: adding the intake-vs-burn chart to the aside changed the Today page's
request count by zero. **This is a workaround, not a fix** — the next person who drops a
second `useBudgetRange` for the same window into a subtree gets a duplicate request with no
warning. The hook is where the real fix belongs.

**2.21 Progress's adherence bars ARE the sidebar's month block (Task 8.5).**
The plan only asked to move the 14-day effect onto the range endpoint. Reusing `MonthBlock`
also deleted `barHeightPx` — a fourth local copy of the bar arithmetic — leaving one
geometry module (`today/dayBars.js`) behind the week strip, the month block and the
adherence bars. And `ProgressView` finally has a test: it had none (see §6.13), which meant
the headline refactor of this task was initially **unfalsifiable** — breaking it back to the
14-parallel-request fan-out kept every test green. Highcharts is now stubbed and the network
shape is pinned. The same falsification pass caught a second inert assertion (a mutation
that counted gaps into the intake/burn scale was a no-op, because a gap row carries no
numbers at all); the real risk — holes diluting the AVERAGES — is now its own test. Both
were found only by falsifying, which is §5.2 earning its keep for the third phase running.

**2.22 `findByDate` was archive-blind — fixed at the STORE, not at five call sites (Phase 8 review, C1).**
A live production bug this program did not introduce but did surface. `findByDate`
read only the hot nutrilist file and matched `item.date` exactly; `findByDateRange`
also loads monthly archives and dates a row by `date ?? createdAt`. Once a day aged
past the 30-day retention window, the two disagreed about that same day. Verified on
the running container: `2026-07-30` answered `food: 0` and `count: 0` while the archive
held seven rows — 27 of 62 days divergent. The week strip (range) drew a real bar
beside an equation and a meal list that both said the person had eaten nothing, which
is precisely the F7.1 lie this phase exists to prevent, and the DAY was the wrong half.

**The root cause is that one store had two different day-resolution rules.**
`archiveOldItems` files a row by `date ?? createdAt` — so `findByDateRange` agreed with
the archiver and `findByDate` did not. A row filed by one predicate and looked up by a
narrower one is a row nobody can find. That is a defect in the primitive, not in its
callers, so the fix is a single private `#itemsInDayWindow` that both reads share.
Fixing five callers instead would have left the next caller to rediscover it.

Judged per call site before choosing the seam, because a blanket replace is not a
decision:
| Site | Verdict |
|---|---|
| `HealthOperations:98` day-view rows | Must be archive-aware — it is the other half of the user-visible bug. A correct `1,740 kcal` headline above an empty meal list is a *worse* lie than a consistent zero. |
| `HealthOperations:214` group siblings | Must match whatever the day view does, or editing a group on an archived day half-works. |
| `BudgetService:279` day equation | Must match the range. |
| `FoodCatalogService.backfill` | Its own contract says `daysBack = 90` while retention is 30, so it has always silently seen only the last 30 days. Archive-aware makes it do what it says. Costs more (it now parses archive months on days 31–90), accepted: it is a rare manual POST and correctness beats speed there. |
| `CoachingOrchestrator:32` | One date, in practice today. Inside retention no archive is touched at all, so this is free, and correct if the coach is ever asked about an old day. |

Nobody depended on the hot-file-only behaviour: the **write** path (`update`,
`findByUuid`, `remove*`, `updatePortion`) is separately hot-file-only and is unchanged.
Two consequences worth knowing. Archived rows are now **visible but not editable** — an
edit throws `NOT_FOUND` rather than silently succeeding, which is honest but is a new
reachable error; before, the row was invisible so nobody could try. And a lookup inside
the retention window still touches no archive, so the common case costs exactly what it
did (pinned by a test that spies on `readdirSync`).

**2.23 The bar keeps two denominators; the SENTENCE was the bug (Phase 8 review, I1).**
Bar height is `food / budget`; hue and status come from `budget − food + exercise`. On
live data Jul 24 at 115.5% is red and Jul 25 at 113.9% is green — near-identical heights,
opposite colours — and the accessible name read `"2040 of 1791 kcal, 114% of budget,
under budget"`, which contradicts itself. The product owner's ruling, adopted: **keep
both encodings, fix the words.** Collapsing hue onto the food-only denominator would
throw away exercise offset, which is a headline PRD theme — a day you ate 114% of budget
and trained off really is under. What is indefensible is asserting both halves with the
reconciling term absent. `barCellLabel` now always states intake against budget, the
exercise, and the outcome as one claim ("ate 2040 of 1791 kcal, 114% of budget, with 530
kcal exercise, 281 kcal left"), and says "with no exercise logged" rather than omitting
the term. The visible half gets a non-colour cue: a cell that ate past budget and still
finished under carries a capped top edge (`--offset`), so "a green bar above the
reference line" reads as a reconciled overshoot rather than a mistake.

**2.24 The F7.1 guard was vacuous and a reviewer broke it in one line (Phase 8 review, I2).**
`WeekStrip.test.jsx` asserted `querySelectorAll('.health-weekstrip__fill').length === 6`.
Counting ONE class cannot express "nothing is stacked": adding two segments under a
different class name left the suite green, and the phase's own F11 falsification passed
only because the break happened to reuse `__fill`. The guard is now structural — a bar
holds exactly one child whatever it is called, a gap holds none, and a bar box holds
exactly the reference line and the bar — and the reviewer's exact break now fails. The
same guard is applied to the month block. **The lesson generalises: a test for "X does
not exist" must not be written as a count of the things that do.**

**2.25 The capture use cases deliberately do NOT record a bucket (Task 9.1).**
`usageByBucket` needs the *resolved* meal. At the point where `LogFoodFromText`,
`LogFoodFromImage` and `LogFoodFromUPC` record catalog usage, the meal they hold is the
CLOCK's guess: each builds `meal.time` from `#getMealTimeFromHour` and then RETURNS
`mealTime`/`mealTimeExplicit` for `NutribotInputRouter#capture` to apply the precedence
(a spoken "for lunch", or the row the capture was launched from, beats the clock). Adding
`mealTime: nutriLog.meal.time` at those three call sites is a one-line change that looks
obviously right and would have written the pre-override bucket — permanently, as a count
on disk that no later correction can undo, in exactly the case §1 says matters most.
Refused. `FoodCatalogService.recordUsage` honours `foodItem.mealTime` when a caller can
supply one, and a caller that cannot advances no bucket history at all rather than
guessing. The seam where this *could* be done correctly is the input router, which is
where the precedence is applied; that is a bigger change than Task 9.1's scope.

**2.26 `backfill` was reading almost nothing, and this is what made 2.25 affordable.**
Backfill is the path that seeds bucket history from finished rows, whose `mealTime` IS the
resolved meal. It gated on `if (!item?.label) continue`, but the nutrilist has two row
shapes: `syncFromLog` rows key the name as `label`, `saveMany` rows as `item` — and on the
production file the `item`-shaped rows are the MAJORITY (39 vs 29, verified on the running
container). So the backfill silently skipped most of the history its own contract claims to
read, and — worth knowing — Phase 7's icon donation was riding on the same gate. Widened to
the name the store itself resolves (`name || item || label`, 'Unknown' excluded, which is
`#normalizeItem`'s own sentinel). Found only by the falsification pass: deleting the new
`mealTime` donation left every test green, which is what a decorative addition looks like.
**Consequence to know — and an earlier draft of this entry got it WRONG, so read this
rather than the git history.** It said `dehydrateNutriListItem` writes no `mealTime`, and
concluded the AI capture path could never contribute bucket history. That is false. The
capture path persists the RESOLVED meal:

- `NutribotInputRouter#resolveMealTime` (`services/NutribotInputRouter.mjs:136`) applies
  the precedence — explicit utterance > `bucket` param > clock — and saves it onto the log
  at `:85`, *before* `#commitCapture` at `:99`.
- `YamlNutriListDatastore.mjs:180` stamps `mealTime: nutriLog.meal?.time ?? null` in the
  `.map()` that consumes `dehydrateNutriListItem`'s output.
- `AcceptFoodLog.mjs:121` does the same on the `saveMany` path, with a comment naming the
  bug it fixed.

Both shipped 2026-09-02 (`c04603c73`, `ed128c05c`) and are ancestors of the deployed image.
**`mealTime` is absent from `dehydrateNutriListItem` BY DESIGN** — the `.map()` immediately
overrides it, and `saveMany` already carries `mealTime: item.mealTime ?? null` at `:257`.
Adding it there would be dead code that reads like a fix. Do not.

The 8-of-68 count is therefore a **history artifact, not a structural gap**. Measured on
the production hot file, per record:

| shape | carries `mealTime` | count | date range |
|---|---|---|---|
| `item` | yes | 8 | 2026-09-02 → 2026-09-03 |
| `item` | no | 31 | 2026-08-12 → 2026-08-31 |
| `label` | no | 29 | 2026-08-07 → 2026-08-27 |

A clean cutoff at the 2026-09-02 change: every row logged since carries its bucket, and
every row without one predates the fix. Bucket history accrues from every capture from now
on, which is what makes 2.25's refusal affordable — the conclusion of this entry is
unchanged, only the reasoning behind it is corrected.

**2.27 The retired PUT was checked by reading what it did, not by assuming it was dead.**
`AddCombobox` used to follow every quick-add with `PUT /nutrilist/{uuid} { mealTime }`.
Two things rode on it beyond moving the row: `updateNutritionItem` ratifies by DEFAULT
(`options.ratify !== false`), so the PUT was also what stamped `settled/settledBy/settledAt`
on a quick-added row; and it cascades a group's `mealTime` to its children. `quickAdd` now
writes the stamp itself (PRD F8.3), and a quick-added row is `kind: 'item'` with no
children, so the cascade had nothing to do. Deleting it also closes a live hole: when that
PUT failed, the combobox had already closed and the row was left in the CLOCK's bucket AND
unsettled. Per §5.4, the deletion was demonstrated rather than argued — the regression test
asserts that no request of ANY kind reaches the nutrilist endpoint, because counting
quickadd calls could not express "the second request is gone" (§2.24's lesson).

**2.28 `recordUsage` dates in UTC while `quickAdd` dates locally — flagged, not fixed.**
`FoodCatalogService.recordUsage` stamps `lastUsed` with `new Date(clock.now()).toISOString().slice(0,10)`;
`quickAdd` uses the local-date helper, because a naive ISO slice reads as tomorrow every
evening in this household's timezone (that fix, and its test, predate this phase). Both now
write `usageByBucket[bucket].lastUsed` too, so the same instant can be recorded a day apart
depending on which path ran. The effect is bounded — one day of recency decay at the
margin, on a 14-day half-life — and the divergence already applies to `entry.lastUsed`,
which the shipped global score reads. Changing it would alter ranking for every existing
entry on a path outside this task. Recorded for the whole-branch review.

**2.29 `backfill` is NOT idempotent — running it twice inflates every entry's score.**
Stated here rather than in a report's concerns list because learning that bucket history
seeds from `POST /nutrition/catalog/backfill` makes running it the obvious next move, and
this is what someone needs to know *before* they do. `backfill` calls `recordUsage` once
per stored row, and `recordUsage` unconditionally increments `useCount` and now also
`usageByBucket[bucket].count`. A second run over the same window therefore counts every
row again: the global score (`useCount / (1 + daysSince/30)`) and the per-bucket frequency
both inflate, and nothing detects or corrects it. It is a deliberate one-shot seeding
tool, not a reconcile. Widening its name gate (2.26) makes each run process ~2.3× as many
rows as before, so the inflation per accidental re-run is correspondingly larger. If it is
ever to become safe to re-run, it needs to reconcile against a per-row marker rather than
increment blindly — that is a real change, not a tweak, and it is not in this program.

**2.30 Editing a row's portion does not update the bucket's remembered quantity.**
`usageByBucket[bucket].quantity` is written at log time by `quickAdd` and by `backfill`.
`PUT /nutrilist/:uuid` — the edit sheet's grams/amount change — writes the row and never
touches the catalog entry, so correcting a portion after logging does not teach the
catalog anything. The next quick-add of that food in that bucket re-offers the OLD portion
until a backfill replays the corrected row. Accepted deliberately: the alternative is for
a row edit to reach back into the catalog, which coupling the edit path to the catalog
would make every portion tweak a catalog write, and the failure mode here is one stale
default that the person can edit again — not wrong data. Recorded so it reads as a
decision rather than an oversight.

**2.31 The group header a template writes carries zero nutrition, and the guard is an
invariant rather than a case list (Task 10.1).**
`instantiate` writes one `kind: 'group'` row plus core (and chosen variant) children. The
header's `calories/protein/carbs/fat` are spelled out as `0` rather than omitted, and the
test is a ROW-CONSERVATION assertion — every chosen component appears in exactly one row,
the row count is `components + 1`, and `sumCounted` over the whole set equals the component
sum — not an enumeration of shapes (process finding 5.3). Make the header carry the meal's
kcal and three tests fail, including the one that reads the numbers back off YAML through
`BudgetService`.

**2.32 `MIN_CORE_COMPONENTS = 2` is ours, not the PRD's (Task 10.3).**
The PRD names the window, the occurrence threshold and the two presence bands, but not a
minimum core size. Without one, "coffee, and whatever I ate with it" mines a proposal whose
core is a single food — which the quick-add list already offers, with an approval prompt
attached. Two is the floor, asserted as a literal and falsified in both directions.

**2.33 A component's numbers are the most recent REAL portion, never an average (Task 10.3).**
Averaging the observed rows produces a portion nobody ate. The miner carries the values from
the latest row it saw for that name inside the combo's occurrences, so an approved template
logs a quantity that actually happened.

**2.34 Mining anchors on frequent foods; the key is CORE-ONLY (Task 10.3).**
Each food occurring ≥6 times anchors a candidate, and the occurrences containing it are the
combo's occurrences. Two anchors inside one stack produce the same core set and therefore
the same key, so candidates dedup themselves without a clustering pass. The key excludes
variants deliberately: a smoothie whose fruit rotates must stay ONE combo, or the week the
rotation changes it would be proposed again — and a dismissal would stop matching, which is
the one thing a permanent dismissal cannot be allowed to do.

**2.35 Retiring `SavedMealsSheet` required moving two WRITE paths, which only driving it
found (Task 10.4).**
Parity was established by rendering both components side by side over the same meal and
asserting all five of the sheet's observables against the picker (process finding 5.4).
That much a careful reading might have predicted. What it would not have: `TodayView`'s
"Save as meal" (US-2.2) and `EntryEditSheet`'s "Save as meal" both **wrote saved meals** —
so with the sheet gone they would have kept writing to a file nothing lists, silently, with
a success toast. Both now write templates. The `copy-day-to-today` round trip keeps the
meals endpoints, because it creates, logs and deletes in one breath and nothing ever lists
what it makes. **The surface was replaceable; the things feeding it were not, and the
deletion was only safe once they moved.**

**2.36 Instantiating a template is NOT a quick-add (Task 10.4).**
A template picked from the combobox hands off to the picker rather than logging
immediately. PRD F6.1 says instantiating offers the variants, and quick-adding one would
silently log a single arrangement of a meal whose whole point is that part of it rotates. A
template with nothing to choose still logs on the first tap, so the one-tap path the saved
meals sheet had is preserved exactly where it applies.

**2.37 `TEMPLATE_SUGGEST_CAP = 3` is ours, like the core floor (Task 10.4).**
The zero-keystroke combobox list is capped at eight rows (Task 9.2's reasoning: it is the
only fetch with no user intent behind it). An unbounded template block inside that would
push a person's actual regulars off the list, so at most three templates are offered there.
A TYPED query is steered, so every match is shown. Written down here rather than only in a
task report because it is a user-visible behaviour constant, and this is the file that
travels.

**2.38 Micros and their provenance travel with a template (Task 10.4 review).**
The first cut of `snapshotComponent` carried only `calories/protein/carbs/fat`, so a meal
logged from a template came off disk with `fiber/sugar/sodium/cholesterol` at 0 and
`microsSource: null` — meaning **the same meal logged via a template was strictly less rich
than logging its foods one at a time**, and `BudgetService` counted every template row as
uncovered. That is not neutral honesty: it degrades the data Theme 4 had just spent a phase
collecting, and it would have lowered the coverage caption in the same commit that marked
Theme 4 delivered. Fixed rather than documented. Phase 6's rules are preserved exactly:
per KEY (`pickMicros`, so an unmeasured key is never written as a structural zero claiming
to be a reading), only from a **provenanced** source (no `microsSource` means the zeros are
structure and nothing is carried), and provenance without numbers is not provenance
(§2.11). The same rule is applied at all three producers — manual save, the miner, and the
instantiated child rows — and the end-to-end guard reads a template-logged row's coverage
back through the real YAML and `BudgetService`. Group headers stay clean and excluded from
both sides of the coverage fraction (§2.10).

**2.39 A template must log something (Task 10.4 review, M-2).**
An all-variant template with nothing toggled wrote a lone empty group row — zero calories,
no children — which every fold counts as nothing and every reader has to explain. No UI
*create* path can build such a template today, which is exactly why it needed a guard
rather than a note: the refusal belongs in the service (`TEMPLATE_NO_COMPONENTS` → 400),
and the picker's Log button is dead until the selection is non-empty.

**2.40 The viewed day travels with every capture (production defect, 2026-09-04).**
Reported: food added while looking at YESTERDAY appeared on TODAY. It was not a bug in one
route — *no* capture route accepted a date at all, and every service downstream computed
one from the server clock. The fix is the same shape as the meal-bucket seam already
shipped in Task 4.1: an optional `date` on the wire, threaded to the service, with **absent
meaning today** (§2.6 — never coerced to `null`, because a defaulted value would change
what an absent one means for Telegram, the coach and the scale, none of which send one).
Covered: quick-add, the typed sentence, voice, photo, barcode, the unknown-UPC custom-food
branch, and template instantiation. `createdAt`/`settledAt` stay real wall-clock instants —
only the LOGICAL date follows the view; backdating a row must not backdate the moment it
was entered.

Two details worth keeping:
- **Text and voice get an ANCHOR, not an override.** They already had an `asOfDate` seam
  (built for revisions, so a revision's prompt stays pinned to the original log's day). The
  viewed day reuses it, which makes "this morning" resolve against the day being looked at
  while a date the model computes *from* that anchor still wins. Passing the viewed day as
  `LogFoodFromText`'s existing `date` override would have done the opposite — flattened
  "yesterday" onto the viewed day. Image and barcode have no words to date anything from,
  so they take a plain `date`. Precedence order is unchanged and now uniform: what the
  person said > what the surface asked for > the clock.
- **The date validator is now shared and is not a regex.** Three routes regex-tested a date
  independently. A regex accepts `2026-02-31` (silently becomes March 3 — food on a day
  nobody named) and `2026-08-32` (Invalid Date, whose later `toISOString()` throws a
  RangeError and surfaces as a 500). `BudgetService` already had the correct check from
  Phase 8; it moved to `#domains/health/services/isoDate.mjs` and every date on the health
  router now goes through it. `DATE_PATTERN` is gone.

**2.41 A day that has already ended has no "current hour" (the bucket-default question).**
The quick bar defaulted its meal to `bucketForHour(new Date().getHours())` — the CURRENT
hour — on every day, including days that ended hours ago. Once the date follows the view,
keeping that is incoherent: it is the same "the app used now instead of where I am" mistake
the defect above is about, one field over.

Decided: **the clock speaks only for today. On any other day the target is that day's FIRST
meal, and the affordance says which day and meal it will hit** ("Quick add to Breakfast on
2026-09-03") so the guess is visible before the tap rather than inferred after it. Applied
at all four services that own this fallback — `FoodCatalogService.quickAdd`,
`TemplateService.instantiate`, `LogFoodFromImage`, `LogFoodFromUPC` — and in
`QuickCaptureBar`, via one shared `defaultBucketForDate`.

Why this and not the alternatives:
- *Keep the clock.* Rejected: 8:30pm names no meal on a day that ended at midnight. It is
  a guess dressed as a derivation, and it is the guess the user just complained about.
- *Infer from the day's existing rows* (land in the last bucket already filled). Rejected:
  genuinely better on average and impossible to predict — the same tap lands somewhere
  different depending on data the person cannot see. Predictability beats cleverness on a
  one-tap control.
- *Refuse to guess and force a picker.* Rejected as redundant: every meal row in `LogTable`
  already offers an exact target, so the quick bar is the convenience path. A visible,
  stable default plus one-tap move is cheaper than an extra step on every past-day capture.

A day is filled from the top, so its first meal is where catching up starts; and because
the web UI always sends an explicit bucket alongside a date, this floor is only ever
reached by a caller that sends a date without one.

**2.42 The post-boot feed-harvest hypothesis was FALSIFIED, so nothing was throttled.**
A lost voice memo (2026-09-04 16:25) was attributed to a post-boot readable-content harvest
saturating outbound HTTP: the container had restarted at 16:23:09 and 461
`webcontent.readable.upstream-error` events landed in 16:25–16:27, wrapped around all three
transcription attempts. Checked before acting on it, and it does not hold:
- The harvest is an **hourly `:25` cron**, not a boot job. It ran 23 more times in the same
  24h at the same volume (~230 errors per run, 6,953 total). `bootstrap.mjs` does define a
  `headlineHarvestJob`, but nothing invokes it.
- Its outbound concurrency is hard-capped at **3** in-flight fetches
  (`HeadlineService.mjs`, `CONCURRENCY = 3`), serial across sources. Three sockets do not
  saturate a household egress link.
- Process impact was real but small: event-loop **p99 rose from ~80–130 ms to 436–538 ms**
  across exactly those windows, while p50 stayed at the 20 ms idle floor.
- The failure signature points **upstream**: two ECONNRESETs at 15055 ms and 15142 ms — a
  near-identical 15 s cut, when our own timeout is 60 s — plus a 1226 ms ETIMEDOUT.
  Something in the path reset the connection; a starved local loop does not do that on a
  clock that precise.
Overlap is real and the cap is worth knowing about, but the evidence does not implicate the
harvest, so throttling it would have been a change made on a story. Deliberately not done.

---

## 3. Known divergences from the PRD (true only after later phases)

- **`rejected` is reachable, permanently — this is now settled, not pending.** Phase 5 was
  supposed to make it unreachable and instead proved the opposite by driving the path: put
  300g on the scale (a live prompt opens), answer nothing, put 500g on, and the first prompt
  is superseded with `status: 'rejected'`. It is written by the observation service, not by
  any discard, so the "discard = delete" decision above stands unchanged. The PRD's
  "`rejected` becomes unreachable" line was an assumption about a subsystem the PRD had not
  read; the code, not the PRD, is right. Treat `rejected` as a scale-only status meaning
  "a placement nobody answered, replaced by the next one".
- **Two hour→meal mappings coexist.** The quick-capture UI uses one (`<11/<15/<20`); a
  second (`5-12/12-17/17-21`) is used elsewhere. They do not conflict in practice *because
  every UI capture path sends an explicit meal*, so the server's precedence decides. They
  diverge only for callers that omit it (Telegram, scale, coach). Documented; do not
  "simplify" one away without re-checking those callers.

---

## 4. Out-of-band fixes (unrelated to this program, shipped to `main`)

**4.1 Client-supplied `userId` removed from two health endpoints** — `9b35e1c2e`, deployed.
`GET /longitudinal` and `GET /dashboard` accepted `?userId=` and passed it unvalidated into
per-user path resolution. Found while reviewing a new photo-serving route that had the same
shape (that one was caught before merge). No caller passed the parameter; deleting it was
preferable to sanitizing it. Verified live: three requests — no parameter, a traversal
attempt, another username — return byte-identical responses.

**4.2 Piano Games unlocked for non-learners** — `cc6b8f304`, deployed.
`useSchoolGameAccess` already had an escape hatch for household members School does not
track, and two of three call sites passed it. The Games screen did not, so it queried an
entitlement that has no item for a non-learner, resolved `indeterminate`, and failed closed.
Production logs showed both verdicts one second apart for the same user: `not_gated /
unlocked` from the menu, then `indeterminate / locked` from the Games screen. Fixed at the
one call site with a comment naming the incident, plus a regression test that fails without
the fix and two guard tests proving a real learner with unfinished work is still locked and
an unloaded roster still locks.

**4.3 The vitest gate was red on `main`, from four stale tests** — `11090ca6e`, `3286bcfa6`.
Found while checking a Phase 6 report that the gate "printed NEW failing file(s) and still
exited 0". The gate does no such thing (`scripts/gate-vitest.mjs:344-347` is an unconditional
`process.exit(1)`); the reading came from a *pipeline's* exit code. The failures were
therefore real and blocking, and none was a product defect:
- Two `PianoApp` suites mocked `../lib/api.mjs` without `DaylightMediaPath`, which `SoundPanel`
  calls at render time. The mock threw *during render*, the app mounted as an empty `<div />`,
  and it surfaced as nine "unable to find text" failures pointing at the queries — which is
  why it read as a routing bug.
- `fitness-timeline-pruning` restated `MAX_SERIES_LENGTH` as a literal `2000`; the real cap is
  `8640`. Pruning worked; the copy of the constant was wrong. Now imported, not restated.
- `PlanCreate`'s fake `Response` implemented only `json()` while the error path reads `text()`,
  so the component rendered `response.text is not a function` as its own alert.
Gate verified green afterwards: exit 0, "no new failures vs baseline", 12 failing files all in
the 12-entry baseline.

**4.4 A Dropbox conflicted copy had silently emptied a media folder.**
`voiceArt.test.js` asserts every instrument basename the module can name exists as a file, and
57 were missing. Cause: Dropbox resolved a directory conflict by creating
`instruments (KC Kern's conflicted copy 2026-09-03)` and leaving the canonical folder present
but **empty** — so the piano SoundPanel illustrations were broken in production with nothing
logging an error anywhere. Restored by copy (the conflicted copy left intact), ownership
corrected because `docker exec` writes as root into a user-owned tree.
**The point worth keeping:** an asset-existence test was the only thing in the entire pipeline
that could catch this. Every other gate was green over it, exactly as in §5.1.

---

## 5. Process findings worth keeping

**5.1 A gate must execute the thing it claims to check.**
An invalid Sass selector (`&--group&--thumb`) made the entire frontend unbuildable and
survived four task reviews. Nothing in the pipeline compiled stylesheets: jsdom tests do not,
the UI-token audit is a text scanner, and no real build ran on the branch. Every gate was
green over a branch that could not build. A pre-commit stylesheet build gate now compiles
every entrypoint; it was validated by reintroducing the exact bug and confirming it fails.

**5.2 Tests must be falsified, not merely written.**
The recurring defect in this program was not wrong production code — it was tests that could
not detect the bug they existed to prevent. Every task therefore requires: break the fix
deliberately, confirm the matching test fails, restore, report the result. This caught a
whitelist addition that was pure decoration, an absence-preservation test blind to the
regression it guarded, and a boundary that no test exercised.

**5.3 Prefer an invariant to a list of cases.**
Row rendering is guarded by "every input row appears exactly once in the output" rather than
by enumerated cases. It caught cycle handling that individually-written tests missed.

**5.4 A planned deletion is a hypothesis, not an instruction.**
Phase 5 was written to retire three things. Two of the three retirements were refused by the
implementer with proof and independently confirmed by driving the code — `rejected` is still
written, and the scale still mints `pending` rows the retired component was the only reader
for. Only the third (`CompositionStore`) was genuinely dead. A plan authored before the code
was read cannot know what is reachable; requiring a *driven* demonstration before any
deletion — not a call-graph trace, not an argument — is what caught both. Two of three
planned deletions in this phase would have removed live behaviour.

**5.5 Worktree environment gaps masquerade as repo defects.**
Test failures reported all run as "pre-existing missing packages" were an absent
`frontend/node_modules` in the worktree. Verify the environment before recording a repo-level
defect.

---

## 6. Deferred items (for the final whole-branch review to triage)

Recorded rather than silently dropped. None block their task; several are cheap.

1. `pathGenerations` in the shared fetch hook grows unbounded for paths that persistently
   fail — the only eviction site is a successful write. Low severity; **the code comment
   claiming it is bounded has been corrected**, which was the misleading part.
2. Gram-clamp edge cases in the group mapper are correct but unpinned by tests.
3. Dish grouping keys on exact string equality — an inconsistent model ("Smoothie" vs
   "smoothie") yields two sibling groups.
4. The "Unconfirmed" badge sits inside the row's tappable button, so it concatenates into
   that button's accessible name rather than being announced separately.
5. `NeedsReviewSection`'s heading still reads "NEEDS REVIEW" though it is scale-only.
6. `formatLoggedSummary`'s edge cases are unpinned (no formatter test file exists).
7. The barcode confirmation copy is tonally inconsistent with the new logged-summary line.
8. A capture rejection surfaces as an unhandled promise rejection; the placeholder still
   clears correctly.
9. `.health-meal__header-right` has no `flex-wrap` and now carries kcal text, three 44px
   buttons and an optional action button on one row — **needs a live narrow-viewport check**.
10. No defensive fallback if a response ever reported a move with no resolved meal
    ("Moved to undefined"). Currently unreachable by the server's own contract.
11. An empty group row can survive if only the group's own delete fails; it renders as a
    plain zero-nutrition row and the error tells the user to retry.
12. Two pre-existing changelog-voiced sentences remain in the Health reference doc.
13. `ProgressView.jsx` has no test file (it mounts Highcharts). Its new macro/watch-micro
    fields are covered indirectly: the shape rules they depend on live in the pure
    `progress/goalFields.js`, which is tested. The rendering itself is unpinned.
14. `microsSource` is one flag for all four micros. A model that returns sodium but omits
    fiber marks the row covered for both. Per-key provenance would need per-key fields;
    the single flag is what the stored shape can support today. **Now also documented in
    the endstate doc (§2.13) — it was wrong to leave a reachable dishonesty recorded only
    here while the reference doc implied the opposite.**
15. On the ACTIVE week-strip cell, the zero-day track colour equals the active-cell
    background, so the "a real track exists" cue that separates a zero day from a gap
    disappears on the most-looked-at cell. The `0` vs `—` readout and the dashed gap
    border still carry the distinction, so this is a weakened cue rather than a lie.
    Deferred deliberately (Phase 8 review, M2).
16. Archived nutrilist rows are readable but not editable: the write path is hot-file
    only, so an edit of a row older than 30 days throws `NOT_FOUND`. Honest, but a
    newly reachable error now that those rows are visible (see §2.22).
17. `/api/v1/health/weight` and `/api/v1/lifelog/weight` are **confirmed byte-identical**
    (same file, same rounding, 249 keys) — the only divergence mechanism is user
    resolution, inert while single-user. Recorded as a note, not an open risk.
18. Catalog entries created before the per-key gate landed may hold donated structural
    zeros (`fiber: 0` etc.) that quick-adds will keep inheriting as `'catalog'`. Nothing
    sweeps them; a fresh provenanced capture of the same food overwrites the keys it
    answers, but never clears one it does not.

---

## 7. Verification conventions used throughout

- Tests colocated under `backend/src/**` / `frontend/src/**` run under Vitest; anything under
  `tests/isolated|unit|integration/**` runs under Jest. A test in the wrong tree silently
  never runs in the gate that matters.
- jsdom cannot see layout. Touch-target sizes and visual placement are verified by reading
  the compiled stylesheet rule, never by an assertion that would pass vacuously.
- Reviews verify claims against the code rather than accepting a report, and reproduce at
  least one deliberate breakage per task.
