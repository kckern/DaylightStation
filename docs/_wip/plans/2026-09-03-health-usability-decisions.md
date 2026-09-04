# Health Usability Program — Decision Log

Companion to `docs/superpowers/specs/2026-09-02-health-usability-prd.md` (requirements)
and `docs/superpowers/plans/2026-09-02-health-usability-program.md` (the 40-task plan).

This file records **decisions and their reasoning** — the things a diff cannot explain.
It exists because the execution ledger lives in a git-ignored scratch directory and would
otherwise be lost. Written during execution; entries are append-only.

Branch: `feat/health-usability`. Phases 0–6 complete at time of writing (28 of 40 tasks).

---

## 1. Product decisions (confirmed by the product owner)

These deliberately reverse behavior the shipped app had. They are recorded here because a
future reader will otherwise read them as regressions.

| Decision | Reasoning |
|---|---|
| Unsettled entries **count** in the calorie equation immediately | The pending queue's "doesn't count until accepted" rule made the equation lie between capture and review. The unsettled cue plus one-tap editing is the safety valve instead. |
| "Coach never auto-accepts" retired | Coach-logged food now lands unsettled and counting like every other capture. Editability replaces the gate. |
| The pending Accept/Revise/Discard queue retired **across all transports** | Web, Telegram and the coach share one lifecycle. Two review models over one data set was the underlying defect. |
| Discard = delete; `rejected` becomes unreachable *(pending Phase 5)* | See §3 — the scale sweep still writes `rejected`, so this is true only after the bridge is replaced. |
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
pending only. **Phase 5 (Task 5.6) retires it properly.**

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

**2.8 Group rows are excluded from micro coverage on BOTH sides (Task 6.1).**
The plan specified `covered` = counted items carrying `microsSource`, `total` = counted
items. Taken literally, a dish header — which carries zero nutrition by design (2.4) and
can never carry provenance — would sit in the denominator forever, so a fully-covered day
of three dishes and nine children would report "based on 9 of 12 items" and imply missing
data that does not exist. Groups are filtered out of both counts. Pinned by a test.

**2.9 `microsSource: 'ai'` is conditional, not unconditional (Task 6.2).**
The plan said the mapper sets `'ai'`. It sets `'ai'` only when the model actually returned
micronutrient numbers. The stored shape defaults every micro to `0`, so stamping provenance
on a macros-only parse would assert a measurement that never happened — the exact
dishonesty the coverage caption exists to prevent. A measured `0` does count as data;
absence does not. The same rule governs what the catalog will accept as micro data.

**2.10 Two of the plan's Task 6.2 premises were already satisfied.**
The AI prompt already asks for `fiber/sugar/sodium/cholesterol` by name (shipped with Task
2.1), so no second prompt site was created. And `microsSource` was already threaded through
all four field whitelists (`validateFoodItem`, `dehydrateNutriListItem`, `saveMany`,
`NUTRITION_UPDATE_FIELDS`) by Tasks 0.1/0.2/5.5. Rather than assume that, an end-to-end
round-trip test now walks catalog entry → quickAdd → saveMany → YAML on disk → findByDate →
`getBudget().microCoverage`; deleting the field from the `saveMany` whitelist fails it.

**2.11 No goal tick and no over-goal segment on the macro bars (Task 6.3) — accepted.**
The plan asked for a tick marking the goal and a distinct over-goal segment. Neither was
built: the fill clamps at 100 %, so 300 / 150 g is visually identical to 151 / 150 g, and
only the recolour, the numbers beside the bar and the "over goal" in the accessible name
carry the overshoot. The product owner accepted the deviation rather than open design
surface this late in the program. Recorded so it reads as a decision, not an oversight.
(The accessible name does announce the true percentage — 200 %, not a clamped 100 % —
because a clamped spoken number is a false statement, which is a different question from
how much bar to paint.)

**2.12 One fold for the whole day, in a shared contract (Task 6.3 review, Q1).**
Task 6.3 shipped a COUNTED-folded macro bar row directly above `MacroFooter`, which summed
`day.items` unfiltered, and a new per-meal `P · C · F` that folded raw rows too — three
folds over the same data on one screen. Latent only because every live nutrilist row is
`accepted`, which is exactly the assumption `COUNTED` exists to not make. The predicate now
lives in `shared/contracts/nutrition/countedRows.mjs` and is imported verbatim by
`BudgetService` and by both Today components, so there is one definition rather than three
copies that can drift. Pinned by `today/sharedFold.test.jsx`, which builds a day holding one
row of every uncounted status and asserts all three surfaces report the same numbers.

**2.13 Micro provenance is per ROW, and the docs say so (Task 6.3 review, C1).**
`microsSource` is one flag for four micros. A capture answering `sodium` alone yields a row
that is fully "covered", so a watched fiber bar can render a confident `0 / 30 g` with the
caption correctly suppressed. The limit is now stated in the endstate doc rather than only
in this scratch file, and the caption reads "items with any micro data" so it stops implying
a per-micro count. Per-key provenance (four fields where there is one) is the real fix and
is not in this program's scope.

**2.14 The catalog gate is per KEY, not just per row (Task 6.3 review, C2).**
The original donation gate checked only that a row carried provenance — but the capture
mappers had already applied `?? 0`, so a partially-answered capture donated its structural
zeros as catalog readings, which every later quick-add of that food then inherited as
`'catalog'`, permanently and self-propagating. The mappers now carry only the micros the
model actually answered (`pickMicros` on the model's own item; the storage default moves to
the persistence boundary, where `FoodItem`/`validateFoodItem` already applied it anyway),
and `backfill` donates no micros at all because a stored row's per-key provenance is gone.

---

## 3. Known divergences from the PRD (true only after later phases)

- **`rejected` is not yet unreachable.** The scale's session-end sweep still writes it when
  an unanswered composition prompt is superseded. Documented accurately rather than
  aspirationally; Phase 5 must verify and update.
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

**5.4 Worktree environment gaps masquerade as repo defects.**
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
15. Catalog entries created before the per-key gate landed may hold donated structural
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
