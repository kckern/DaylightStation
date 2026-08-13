# Enrollment and Syllabi — Design

> **Status:** Sections 1–3 describe `main` as of 2026-08-13 and are verified.
> Sections 4 onward are **designed, not built.**
>
> An earlier revision of this document was written against a branch ~174 commits
> behind `main` and got its central facts wrong — it proposed building an
> enrollment model that `main` had already shipped. This revision is written
> against `main` and is a delta on `school.course-enrollment/v1`, not a
> greenfield model.
>
> Parent reference: [`README.md`](./README.md)

---

## 1. Enrollment already exists, and the runtime honors it

`school.course-enrollment/v1` (`2_domains/school/curriculum/enrollment.mjs`) is a
per-learner, per-course record embedded in the assignment entry:

```yaml
# household/apps/school/assignments/felix.yml
learnerId: felix
courses:
  - math-fractions                          # bare string: no enrollment
  - courseId: young-peoples-atlas-us
    profile: upper
    enrollment:
      schema: school.course-enrollment/v1
      enrollmentId: enr-felix-young-peoples-atlas-us
      courseId: young-peoples-atlas-us
      profile: upper
      moduleOrder: [united-states, midwest, southwest, south, …]
      optionalModules: [bonus]
      lessonOrder:
        midwest: [atlas-us-p012-midwest, atlas-us-p100-south-dakota, …]
        …
```

`planner.mjs` reads it (`readAssignmentList` keeps `profile` and `enrollment`
off each entry) and uses it throughout gating:

- `optionalModules` — a module that unlocks with the opening module but never
  joins the serial chain;
- `moduleOrder` — every earlier module must complete before the next opens;
- `lessonOrder` — the enrollment's frozen order within a module wins over
  `sequence`;
- alongside the course's own `progression` policy: `required_opening_module`,
  `one_active_module`, `mode: sequential | module_blocks`.

`profile` reaches the issue path. `issueWorksheet` filters items by
`item.levels.includes(profile)` and seeds selection on
`{revision, learnerId, enrollmentId, lessonId}`, producing a **self-contained
worksheet instance** — "No later bank lookup is needed to grade it."

That last point matters to any design here: **policy is already snapshotted at
issue time** on the v2 path. Nothing needs inventing for in-flight protection.

### Courses author their own structure

`school.course/v2` `index.yml` carries `structure`, `modules[]`, `progression`,
`grading`, `printables`, and `profiles`:

```yaml
schema: school.course/v2
work: the-elements-ted-gray
progression: { mode: module_blocks, required_opening_module: foundations,
               one_active_module: true, module_order: fixed,
               lesson_order: shuffle_once }
profiles:
  lower: { question_count: 6,  visible_choices: [3, 4], multi_select: 0 }
  upper: { question_count: 10, visible_choices: [5],    multi_select: [1, 2] }
modules:
  - { module: foundations, title: Periodic Table Foundations }
  - { module: period-1,    title: Period 1 }
  …
```

---

## 2. The gap: nothing can create an enrollment

**`createCourseEnrollment` has zero production callers.** It is defined, unit
tested, and invoked by nothing. `felix.yml` above was hand-written — including a
58-entry `lessonOrder`.

Neither `profile` nor `enrollment` appears anywhere in the teacher console or in
`SetAssignments`. The console's assignments editor writes bare id lists of
courses and standalone units; the enrollment shape it would need to preserve is
invisible to it, which also means **editing assignments through the console
would drop a hand-authored enrollment on save.**

So the runtime is complete and the authoring path is a text editor.

Four things are genuinely absent:

| | State |
|---|---|
| A way to create or edit an enrollment | None — hand-authored YAML only |
| Scope: enrolling in *part* of a course | None — see §5, the planner assigns every course unit |
| Per-learner pass bar | None — `percentFor(unitId)` takes no learner |
| Terms / dating / pacing | None |

The per-learner bar is unchanged from the previous revision and remains the
clearest defect: `passOverrides.percentFor(unitId)` at `GradeSubmission.mjs:272`
and `CloseSessionOutcome.mjs:197` is learner-agnostic, so lowering one child's
bar lowers everyone's.

---

## 3. Authored-but-dead inventory

A recurring pattern on `main`: the authoring schema runs ahead of its consumer.
Four cases, all verified, all relevant to this design because each is a
customization that *looks* available and is not.

| Authored | Validated by | Consumed by |
|---|---|---|
| `work.profiles.*` (`question_count`, `visible_choices`, `multi_select`) | `workValidation.mjs:220-223` | **Nothing.** `questionBankV2.profileSpec()` hardcodes `lower`/`upper` and `throw`s on any other value — a third profile is impossible despite being authorable |
| `work.grading.pass_percent` | `workValidation.mjs:129-141` | **Nothing.** The bar resolves `percentFor(unitId) ?? unit.passing.percent`; the course-level bar is never consulted |
| `school.course-unit/v1` (`units/<module>/index.yml`) | nothing | **Nothing.** `course/v2`'s `modules[]` plus lesson-side `module:`/`moduleRole:` won; these files are a third, dead representation |
| `unit.grades[]` | `unitValidation.mjs` | Displayed by `CurriculumBrowser.jsx:103-104`. Nothing *branches* on it |

`work.profiles` is the sharpest of these: the elements course authors exactly the
numbers `profileSpec` hardcodes, so it reads as working. It is a facade.

---

## 4. The model

**A syllabus is a saved, named, reusable set of arguments to
`createCourseEnrollment`.** Nothing about the enrollment record or the runtime
changes.

```js
createCourseEnrollment({ courseId, profile, units, policy })
//                        └──────── this is a syllabus ────────┘
//   → { schema, enrollmentId, courseId, profile,
//       moduleOrder, optionalModules, lessonOrder }
```

```yaml
# household/apps/school/syllabi/elements.periods-1-2.yml
syllabusId: elements.periods-1-2
title: The Elements — Periods 1 & 2
courseId: the-elements-ted-gray
modules: [foundations, period-1, period-2]   # subset; omit for the whole course
profile: lower
policy:                                       # overrides work.progression
  lesson_order: shuffle_once
passing: 60                                   # per-learner bar (§7)
term: 2026-fall                               # optional (§8)
```

Enrolling a learner calls `createCourseEnrollment` with the syllabus's course,
profile and policy, and with `units` filtered to the syllabus's modules. The
returned record is written onto the assignment entry exactly as today, plus
provenance:

```yaml
courses:
  - courseId: the-elements-ted-gray
    profile: lower
    syllabusId: elements.periods-1-2          # new: provenance
    enrolledAt: 2026-09-08T…                  # new
    enrollment: { schema: school.course-enrollment/v1, … }
```

### Materialization is a snapshot, by construction

`createCourseEnrollment` persists `lessonOrder` precisely so a `shuffle_once`
order cannot move under a learner. An enrollment is therefore a snapshot of the
syllabus at the moment of enrolling, and editing a syllabus does **not** reach
existing enrollments.

Re-materializing is an explicit per-enrollment action. It must warn: a re-shuffle
changes the order of lessons a learner has not yet reached, and re-materializing
a course mid-run is only safe if already-passed lessons keep their identity —
which they do, since `passedUnits` is keyed on `unitId` from session history and
is independent of the enrollment.

### Templates

A syllabus with no `term` is a template: the same record, not yet dated, used
only as an argument bundle. Enrolling from a template is legal — `term` never
reaches `createCourseEnrollment`. Terms matter only for grading windows (§8),
which is why nothing breaks when they are absent.

---

## 5. Scope subsetting needs two planner changes

This is the part with real work in it, and the previous revision missed it.

`createCourseEnrollment` **already supports subsetting** — it filters
`units` to the course and derives `moduleOrder`/`lessonOrder` from whatever it
is given, so passing a module subset produces a subset enrollment. The planner
then ignores it, in two distinct places.

**Membership comes from the catalog, not the enrollment** (`planner.mjs:90-95`):

```js
const members = catalog.filter((u) => u.courseId === id).sort(bySequence);
members.forEach((u) => { if (!wanted.has(u.unitId)) wanted.set(u.unitId, elective); });
```

Every published unit of an assigned course is wanted, whatever the enrollment
says. Fix: when the entry carries an enrollment, membership is the union of its
`lessonOrder` values plus its optional modules.

**Module completion is computed over the catalog** (`planner.mjs:137-138`):

```js
const passedModule = (moduleId) => siblings.filter((u) => u.module === moduleId)
  .every((u) => passedUnits.has(u.unitId));
```

`siblings` is every catalog unit in the course. So a module containing even one
lesson the learner is not enrolled in can never be "passed", and the next module
never opens. Fix: restrict `passedModule` to enrolled lessons.

Consequence for sequencing: **whole-module subsetting is nearly free once
membership is fixed; lesson-level exclusion within an included module is not
safe until `passedModule` is fixed too.** They should land together.

### The gating invariant

`planner.mjs:119-120` states the rule this design bends: *"a sequence is a
property of the curriculum, so assigning unit 2 alone cannot smuggle a child
past unit 1."* Honoring an enrollment subset **repeals that for enrolled
courses** — a syllabus of `[period-4]` alone has no blocker on its first lesson.

This is deliberate; partial enrollment is the point. It is not justified by
"a grown-up decided it" — assignment was already grown-up-gated
(`SetAssignments.mjs:55`) and the planner refuses to skip prerequisites anyway.
The honest justification is narrower: a *named, saved* syllabus is a curriculum
statement, which is the thing the invariant protects. The syllabus editor
should therefore warn when a module subset has a dangling front edge — modules
selected without their predecessors — rather than silently producing an
unblocked mid-course start.

---

## 6. Profiles must stop being hardcoded

Wiring `work.profiles` into `profileSpec` is a prerequisite for treating profile
as a syllabus field, for two reasons: `profileSpec` throws on any value that is
not `lower`/`upper`, and a course that authors different counts is silently
given the elements course's numbers.

The change is small — read the spec from the course record, keep the current
values as the fallback when a course authors none — but until it lands, "set the
level on a syllabus" is a two-valued switch, not a field.

---

## 7. Per-learner pass bar

Precedence, most specific first:

```
session stamp (already written at grading; issue-time on the v2 path)
  → enrollment.passing        (from the syllabus at materialization)
  → work.grading.pass_percent (course-level; currently dead, §3 — wired in wave 3)
  → unit.passing.percent
```

Materializing the bar onto the enrollment rather than resolving through the
syllabus at grade time keeps the snapshot property of §4 and means neither call
site needs to load a syllabus — they read the assignment record they already
have.

**The global per-unit override is retired**, not demoted (§11 Q1). It has never
been used — `pass-overrides.yml` does not exist in production — and its one
distinct job, fixing a unit's bar for *everyone*, is already served by editing
the unit YAML: curriculum lives in the bind-mounted data volume,
`YamlCurriculumDatastore` holds no cache, and the only School-side cache is a
5-minute TTL over bank *summaries* (`SchoolService.mjs:26`), not unit
definitions.

**Retirement and wiring `work.grading.pass_percent` must land in the same wave.**
Removing the override while the course-level bar is still unconsumed deletes a
rung and gains nothing — the elements course's authored `80` would still do
nothing and everything would fall through to `unit.passing.percent`.

---

## 8. Terms, grading, and pacing

`courseGradeFromSessions({ sessions, courseId, unitIds, window })` already
accepts a unit list and a date window, and treats `window: null` as all history.
A dated syllabus supplies both, which is what separates two sittings of one
course years apart — the Elements case — into two grades rather than one merged
figure.

Pacing beyond that (`self_paced`, `deadline`, `flex` with front/back-loading and
seasonal windows) is deferred. Note for whoever picks it up: flex ordering is not
a due-date feature — it reorders the effective lesson list, and on `main` that
order is **frozen into `lessonOrder` at materialization**. Flex pacing therefore
either feeds the materializer or requires a second ordering pass the current
design has nowhere to put.

---

## 9. Surface

`SchoolMatrix` becomes the way in rather than a read-only report: a cell is an
enrollment, a column header opens that course's syllabi.

```
The whole school                              [+ Enroll]

              elements     atlas      calc
  milo        P1-2 lower    --         --
  alan        P1-2 upper   US-W        AB
  soren       heavy upper   --         BC
  felix         --         US-E ⚠      --
              ▲ cell → enrollment drawer
  ▲ column header → that course's syllabi

  ⚠ felix × atlas: enrollment has no syllabusId (hand-authored)
  ! nobody enrolled in: writing-workshop
```

The drawer shows the materialized enrollment — module order, optional modules,
profile, bar — with **Re-materialize** and **Unenroll**, and flags drift from
its syllabus. Re-materialize refuses while any session on that course is open,
naming them (§11 Q5). Hand-authored enrollments without a `syllabusId` render as
first-class, flagged as unmanaged rather than treated as broken; `felix.yml` must
keep working untouched.

Below the grid, a per-learner list shows enrollments plus a separate
**Standalone** group for `assignments.units[]` — program and course-less units
that have no syllabus (§11 Q2).

`AssignmentsView` is the immediate hazard: it currently round-trips assignments
as bare id lists and would drop `enrollment`/`profile` on save. It must preserve
unknown entry fields before anything else here ships.

---

## 10. Sequencing

| Wave | Contents |
|---|---|
| **0** | `AssignmentsView` preserves `profile`/`enrollment`/unknown fields on save. Pure bug fix, independently shippable, **blocks everything else** — editing assignments through the console today deletes a hand-authored enrollment. |
| **1** | Syllabus store + validator; `EnrollLearner` use case calling `createCourseEnrollment`; API behind `TeacherGate` with the `baseUpdatedAt` stale-save guard; matrix cell editor and drawer (re-materialize with the open-session refusal of §4, unenroll); standalone-units group (§11 Q2); report-card multi-enrollment guard (§11 Q4). Whole-course syllabi only. |
| **2** | Scope: the two `planner.mjs` fixes in §5, module subsetting, dangling-front-edge warning. Plus §11 Q6 — extend `course/v2` `modules[]`, migrate the 17 `course-unit/v1` files, delete them. |
| **3** | `work.profiles` wired into `profileSpec` (§6); per-learner pass bar (§7); `work.grading.pass_percent` consulted **and** the global override retired, together (§7). |
| **4** | Terms and grading windows (§8); per-enrollment report cards; then pacing. |

Two placements are deliberate. **Q6 is in wave 2, not filed as cleanup**: per-module
`lesson_order` is an *input* to materialization ordering, so it belongs with the
subsetting work rather than after it. **The report-card guard is in wave 1, not
wave 4**: a second enrollment in one course becomes possible the moment enrolling
does.

---

## 11. Resolved decisions

These were open in the previous revision. All six are settled; the evidence for
each is recorded because it is the kind that goes stale.

**Q1 — Global pass-override: retire it.** `pass-overrides.yml` has never existed
in production, so there is nothing to migrate. Its one distinct job is better
served by editing the unit YAML (§7). Retirement spans ~29 references across 9
files, including `SchoolMatrix`'s ⚑ overridden-course flag and one `kind` in the
audit-trail feed. Must ship with `work.grading.pass_percent` being wired (§7).

**Q2 — Standalone units: unchanged.** `assignments.units[]` holds work belonging
to no course — live usage is a single entry, felix's `language-daily`, a program
unit with daily cadence. Programs cannot have a syllabus by construction. They
stay on the assignment record and appear in the learner's enrollment list as a
separate *Standalone* group, never in the grid, which is course × learner.

**Q3 — Syllabus deletion: safe by construction.** Because materialization is a
snapshot (§4), an enrollment is self-contained and `syllabusId` is provenance
only. Deleting a syllabus breaks nothing at runtime; the enrollment becomes
*unmanaged* — the same state felix's hand-authored one is already in. Archive
rather than hard-delete, so the drawer can still name where an enrollment came
from.

**Q4 — Report cards: keep courseId keying, add a guard.** Per-enrollment rows
are deferred to wave 4, when terms make `courseGradeFromSessions`' `window`
real and the frozen `school.report-card/v1` schema can be migrated once rather
than twice. Meanwhile a period containing sessions from two enrollments of one
course is *flagged*, so the merge is visible rather than a silent average of two
unrelated scopes.

**Q5 — Re-materialization: refuse while any session is open.** Blocked until
open sessions on that course are closed or abandoned, naming them, with
`markSessionAbandoned` as the escape. Passed work is never at risk regardless —
`passedUnits` is keyed on `unitId` from session history and is independent of
the enrollment — but an open session on a lesson leaving the enrollment would
strand, and this codebase has been bitten by that class of ghost before.

**Q6 — `school.course-unit/v1`: fold into `course/v2`, then delete.** Not
cleanup. The 17 files carry `sequence`, `required`, `overview_first` and
per-module `lesson_order`, while `modules[]` accepts only
`{module, title, media?}` (`workValidation.mjs:171-190`) and
`progression.lesson_order` is course-*wide*. The elements course sets
`shuffle_once` course-wide while `units/00-foundations/index.yml` asks for
`sequence` — so the "start here" overview module is authored to stay in order
and is being shuffled. No live damage yet (nobody is enrolled in elements).
Extend `modules[]` with the missing fields, migrate the 17 files, delete them.

### Still genuinely open

- **Terms.** §8 assumes a syllabus may carry one, but no academic-period link is
  designed. Wave 4.
- **Pacing.** `self_paced` / `deadline` / `flex` are named in §8 and designed
  nowhere. Flex ordering has no home in the current model, since order is frozen
  into `lessonOrder` at materialization.

---

## 12. Related

- [`README.md`](./README.md) — the School subsystem map.
- [`authoring/work-config.md`](./authoring/work-config.md) — `school.course/v2`,
  including `progression` and `profiles`.
- [`authoring/content-layout.md`](./authoring/content-layout.md) — where
  curriculum content lives on disk.
- [`print-documents.md`](./print-documents.md) — the rev-pinning discipline the
  v2 worksheet instance path follows.
