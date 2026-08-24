# Dated Modules — Handoff

**Written:** 2026-08-23; updated after merge into `main`.

**Status:** Runtime framework merged. The Come Follow Me course and lower/upper
syllabi are authored and domain-validated. Live Milo/Felix enrollment remains
pending because it requires explicit teacher authority.

**Merged branch:** `feat/school-dated-modules`
**Branch point:** `6347803bb` on `main`

## Read these first, in this order

1. `docs/_wip/plans/2026-08-23-dated-modules-design.md` — what and why
2. `docs/_wip/plans/2026-08-23-dated-modules-plan.md` — the ten tasks, TDD, with exact code
3. This file — final delivery status plus the historical execution notes

## Goal, in one paragraph

Come Follow Me is a **dated** course: 17 weekly modules each pinned to a real week, where being in sync is most of the value. Today's runtime only knows how to gate strictly (`module_blocks` + `one_active_module`), so a learner who skips a week is pinned to that week for the rest of the year. We are adding a `dated_modules` progression mode where the **clock** picks the current module, unfinished earlier modules stay available as catch-up ranked **newest-first**, and future modules never open early. Then enrolling Milo and Felix.

## Final delivery status

| Task | State |
| --- | --- |
| 1 — `evaluateDatedModule` in `timing.mjs` | ✅ `f4f7888fa`, review fixes `b86acd04f` |
| 1b — harden the date predicate | ✅ `699b722fb` |
| 2 — `workValidation` polices `dated_modules` | ✅ `af926cb8e` + review fixes in `10efe41a2` |
| 3 — `createCourseEnrollment` materializes `moduleSchedule` | ✅ `10efe41a2` |
| 4 — `EnrollLearner` passes modules + today | ✅ `10efe41a2` |
| 5 — planner stops gating across dated modules | ✅ `10efe41a2`; frozen membership fix `b165d96e4` |
| 6 — agenda honors `timingRank` | ✅ `10efe41a2` |
| 7 — full suite green, then author the CFM course | ✅ runtime and external course data validated |
| 8 — author two syllabi, enroll Milo and Felix | Syllabi ✅; live enrollments ⬜ |
| 9 — docs | ✅ canonical lifecycle references and this rollout status updated |

The remaining work is the teacher-authorized learner enrollment operation, not
runtime or content support.

## Historical mid-execution notes

Everything below records the earlier execution checkpoint. References to
“outstanding” runtime tasks or a “next action” are preserved as history; the
final table above is authoritative.

## How this was being executed

`superpowers:subagent-driven-development` — per task: a fresh implementer subagent, then a spec-compliance reviewer, then a code-quality reviewer, with fix loops between. It has been worth it; see "What the reviews actually caught."

Instruct implementers to **push back with evidence** rather than implement mechanically. That produced three of the four most valuable findings so far.

## Non-obvious things learned during execution

**Run vitest directly. Never `npm test -- --only=domain`** — it routes vitest files to Jest and 159 of 179 suites fail to load for reasons unrelated to any change.

```bash
cd .worktrees/dated-modules
npx vitest run tests/isolated/domain/school/ backend/src/2_domains/school --reporter=dot
```

Green as of `44e853938`: **79 files / 1829 tests**. The wider `backend/src/2_domains/school backend/src/3_applications/school tests/isolated/domain/school` sweep was **151 files / 2530 tests**.

**Pre-existing red that is NOT ours**, in the wider `tests/isolated` tree, varying run to run: ghostscript/laser-printer, `trigger.sideEffect`, `playlistSorter`, nutribot date suites, several Life JSX suites, and `curriculumPlanner.test.jsx` failing on `Cannot find module 'react'` (worktree node_modules resolution). Always confirm with `git stash` before attributing a failure to your change.

**`audit:layers` is red on `main` already** — `apps-success-false` 60 vs baseline 49, `domains-tojson` 74 vs 67. Verified at the branch point. Someone widened those patterns without updating baselines. Not this branch's, but it will block any gate that runs it.

**Two date traps, both real and both verified:**
- V8 **rolls over** an out-of-range day: `Date.parse('2026-11-31T00:00:00Z')` is valid and yields **Dec 1**. `2026-02-30` yields Mar 2. So the old `!Number.isNaN(Date.parse(...))` check let a typo'd date silently shift a week.
- `new Date('2026-13-01T00:00:00Z').toISOString()` **throws `RangeError`** rather than returning a comparable string. So a naive round-trip check crashes validation instead of collecting a readable error.

The hardened predicate guards both and now lives in `timing.mjs` as `export const isStudyDay`, imported by `workValidation.mjs`. **Do not write a second date predicate anywhere.**

**`progression.module_order` is required even for dated courses.** `workValidation.mjs:71-73` checks it unconditionally via `oneOf`, and `enrollment.mjs` still reads `policy.module_order` when freezing `moduleOrder`. An earlier draft of Task 7 said to delete it; that would have failed authoring with `module_order must be one of fixed|shuffle_once, got: undefined`. **Task 7 must write `module_order: fixed`.** Both docs are corrected.

**9 of the 15 live courses declare `structure.shape: modules` with no `modules[]` array** — derived modules is the dominant authoring pattern. Task 2 therefore added a guard: `mode: dated_modules` with no `modules[]` is refused. Without it, flipping CFM to dated while leaving modules derived would have produced a course with an empty calendar that validated completely clean. This is the single most likely way Task 7 could have failed silently.

**`ICurriculumCatalog.getWork(id)` already exists** (`ports/ICurriculumCatalog.mjs:89`) and `schoolLifecycle.mjs:794` already injects that catalog as `curriculum`. Task 4 needs no port or adapter change.

**A syllabus carries `profile`** (`syllabus.mjs:64-69`), and `EnrollLearner` has no override. Task 8 therefore needs **two** syllabus files, `-lower` for Milo and `-upper` for Felix, matching their atlas enrollments. Both are written out in the plan.

**`syllabus.mjs` refuses a `modules:` key** — scope subsetting is not built. Do not add one.

## The decisions behind the design — do not silently revisit

| Question | Decision |
| --- | --- |
| Missed week | Open catch-up, no expiry. Never deleted, never `dormant`. |
| Daily pick | Current week first; when complete, the same block falls back to backlog. One block/day. |
| Backlog order | **Newest first**, by `closesOn` descending. |
| Week complete | All five day-lessons. Stubs roll into the backlog honestly. |
| Working ahead | Never. Future weeks stay `upcoming`. |
| Date source | Authored per-module on the course; snapshotted onto the enrollment at enroll time. |
| Enrolled mid-course | Weeks that closed before the enrollment date are not assigned at all — not backlog. |

Stale weeks sink and in practice are never worked. That is intended: nothing is deleted, it just stops winning slots, which is why no expiry knob and no parent chore exist.

`catch_up` is a **`timingState`, not a `status`** — status stays `available` so `agenda.mjs` keeps offering it. `PLAN_STATUSES` does not change. The `dormant` distinction is the whole point: `dormant` means a grown-up must intervene, and dated backlog must never reach it.

## What the reviews actually caught (why to keep the ceremony on Tasks 3, 4, 5, 7, 8)

- The plan's own proposed `isDay` one-liner was defective — it threw `RangeError` on an impossible month. The implementer refused it and produced a guarded version.
- The plan's Task 2 test fixture could never have validated: `grading` is required, and `module_order` is checked unconditionally.
- The design doc's CFM manifest was invalid as written (missing `module_order`), which would have broken Task 7.
- The empty-calendar hole above.

Three of those four came from an implementer pushing back, not from a reviewer.

## Task 2 quality review — three fixes outstanding (~18 lines + 2 tests)

Verdict was "good work, ship it after issues 1-3". No critical issues. The core judgment calls were confirmed correct: the predicate is shared not cloned, the overlap sort copies rather than mutating `raw.modules`, and a single `2026-11-31` typo in a real fixture produces exactly one precise error with no cascade.

**Issue 1 (important) — a typo in the MODE produces 17 errors blaming the DATES.**
`workValidation.mjs:199` treats "not `dated_modules`" as "definitely undated", so an unrecognized mode falls into the stray-window branch. With `mode: dated-modules` (hyphen — the likeliest hand-authoring slip) a 17-week manifest yields seventeen lines telling the author to delete their dates, and one line about the mode, last. The advice is backwards. Fix is to gate the stray-window branch on a *positively recognized* undated mode:

```js
const mode = raw.progression?.mode;
const isDated = mode === 'dated_modules';
// An unrecognized mode is already reported by the progression block below.
// Don't also tell the author their dates are stray — the dates are probably
// right and the mode is the typo.
const isUndated = mode === 'sequential' || mode === 'module_blocks';
…
} else if (isUndated && (isPresent(m.opensOn) || isPresent(m.closesOn))) {
```

This matters directly for Task 7, which hand-authors that manifest.

**Issue 2 (important) — the mode check bypasses the file's own `oneOf` helper.** `workValidation.mjs:252-254` enumerates the three modes twice (array + message string) and its error has no `got:` value — exactly what an author with `dated-modules` needs to see. Add `const MODES = [...]` near `ORDERING:62`, route through `oneOf`, and add `MODES` to `WORK_ENUMS:319` where every other enum is exported.

**Issue 3 (important) — design constraint 4 has zero test coverage.** `module_order` staying required for dated courses holds only incidentally via pre-existing line 250. The `dated()` fixture always supplies it, so a future "dated courses don't need an order" simplification would pass the suite. Three-line test.

**Minor items (8 of them) — defer to Task 7**, when a real 17-week manifest is in front of you and message quality can be judged for real. Highlights: include the actual dates in the overlap message; address window errors by slug as well as index (`modules[1] ("w45").closesOn …`); two different date-comparison idioms fifteen lines apart (`>` vs `localeCompare`); and several tests match a bare `/opensOn/` against the joined error list, which would also match the issue-1 message they most need to be distinguished from.

## Next action

Apply Task 2 quality issues 1-3, then start Task 3. Task 3's plan section was rewritten late in the session and is clean; its riskiest part is that `createCourseEnrollment` has a local `const modules` that collides with the new `modules` parameter — rename the local to `publishedModules` and let the atlas tests catch any miss.

Task 5 is the one to slow down on: it changes `blockerFor`, `unlockedBy`, adds per-module rank computation, and changes the sort. Everything downstream depends on it.
