# Health Usability Program — Decision Log

Companion to `docs/superpowers/specs/2026-09-02-health-usability-prd.md` (requirements)
and `docs/superpowers/plans/2026-09-02-health-usability-program.md` (the 40-task plan).

This file records **decisions and their reasoning** — the things a diff cannot explain.
It exists because the execution ledger lives in a git-ignored scratch directory and would
otherwise be lost. Written during execution; entries are append-only.

Branch: `feat/health-usability`. Phases 0–5 complete at time of writing (28 of 40 tasks);
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

---

## 7. Verification conventions used throughout

- Tests colocated under `backend/src/**` / `frontend/src/**` run under Vitest; anything under
  `tests/isolated|unit|integration/**` runs under Jest. A test in the wrong tree silently
  never runs in the gate that matters.
- jsdom cannot see layout. Touch-target sizes and visual placement are verified by reading
  the compiled stylesheet rule, never by an assertion that would pass vacuously.
- Reviews verify claims against the code rather than accepting a report, and reproduce at
  least one deliberate breakage per task.
