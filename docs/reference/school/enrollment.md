# Enrollment, Syllabi, and Course Units — Design

> **Status:** **Designed, not built.** Nothing in section 4 onward exists yet.
>
> Sections 1–3 are different: they describe the system **as it is today**, and
> are accurate now. They are here because the design is a response to them —
> in particular to the fact that a substantial amount of curriculum structure
> is already authored on disk and read by no code at all.
>
> Parent reference: [`README.md`](./README.md) — §"An assigned course, not a
> catalog, is what prints" describes the assignment model this replaces.

---

## 1. What exists today

There is no enrollment entity. The intersection of a course and a learner is a
bare id in a list.

```yaml
# household/apps/school/assignments/{learnerId}.yml
learnerId: soren
courses: [the-elements-ted-gray]
units:   [language-daily]
assignedBy: elizabeth
updatedAt: 2026-08-01T...
```

Entries may be a bare string or an object, and the object form carries exactly
one customization: `elective`. `planner.mjs` normalizes both shapes
(`readAssignmentList`).

Assigning a course pulls in **every** published unit of that course, in
authored `sequence` order. There is no way to take part of a course.

### The customizations that exist, and where they live

Four concepts that belong to "this learner, this course" are spread across four
stores at three different grains:

| Concept | Where | Grain | Problem |
|---|---|---|---|
| Elective | `assignments/{learner}.yml` | learner × course | The only per-pair setting there is |
| Pass criteria | `pass-overrides` store | **unit, globally** | `percentFor(unitId)` takes no learner — one child's bar moves every child's |
| Pacing | `milestones` store | learner × unit | Hand-entered rows, unlinked to what is assigned |
| Completion override | `attestations` store | learner × unit | A grown-up vouches a unit was done off-book |

Pass criteria resolve at two call sites, `GradeSubmission` and
`CloseSessionOutcome`, both through `passOverrides.percentFor(unitId)`.

### Gating is a property of the course, not the assignment

`planner.mjs` computes the blocking unit over the **whole course**, regardless
of what was assigned — deliberately, so that assigning unit 2 alone cannot
smuggle a child past unit 1. Any design that lets a teacher take part of a
course must answer what happens to the sequence.

### The whole-school view is read-only

`SchoolMatrix` composes three unrelated reads client-side (all assignments, the
published unit catalog, the pass-override surface) and renders a learner ×
course grid of dots. It flags what no per-learner view can: a course nobody is
enrolled in, an assignment naming a course the catalog no longer publishes, and
units carrying an active pass-override. It cannot edit any of it.

---

## 2. The data is ahead of the code

Three separate cases where curriculum structure is authored on disk and no code
reads it. Each one matters to this design.

### 2.1 There is a course-unit layer, and it is invisible

The authored tree is three levels deep:

```
data/content/school/curriculum/science/the-elements-ted-gray/
  units/10-period-1/index.yml          <- schema: school.course-unit/v1
    lessons/elements-001-hydrogen/
      index.yml                        <- schema: school.unit/v1
      worksheet.yml                    <- schema: school.question-bank/v2
```

`school.course-unit/v1` carries `{unit, title, sequence, required,
overview_first, lesson_order}`. **No code reads this schema.** The lesson's own
`module:` / `moduleRole:` fields, which declare the same membership from the
other side, are parsed by `validateUnit` and dropped — they are absent from the
normalized unit it returns.

So the grouping a teacher would naturally slice on — "Period 1", "Pacific
Coast" — is already authored, already sequenced, already marked `required`, and
entirely unavailable to the planner.

### 2.2 The word "unit" means two things

What the authored tree calls a **lesson**, the code calls a **unit**. What the
authored tree calls a **unit**, the code has no name for.

`unitId` is persisted on every session event and every attempt record, and
appears at ~390 non-test code sites. Renaming it is a live-history migration and
is out of scope for this work. Any new layer therefore has to coexist with a
`unit` that means "lesson".

### 2.3 Level is authored at two grains and consumed at neither

```yaml
# unit index.yml
grades: [lower, upper]        # which LESSONS a level sees

# worksheet.yml
items:
  - id: oregon-capital
    levels: [lower]           # which ITEMS a level sees
  - id: oregon-evergreens
    levels: [upper]
  - id: oregon-statehood
    levels: [lower, upper]
```

`grades` survives `validateUnit` into the normalized unit, and nothing branches
on it. `item.levels` rides through untouched because `validateQuestionBank`
returns `items: raw.items` verbatim.

`lower` and `upper` are rungs 2 and 3 of the six-tier ladder in `grades.mjs`
(`early, lower, upper, middle, high, ap`), whose stated asymmetry applies here
too: **absence of a level tag means open to all; a present-but-unknown tag fails
closed.**

### 2.4 The banks carrying item levels cannot be loaded

161 worksheets declare `schema: school.question-bank/v2`:

```
 58  civilization/young-peoples-atlas-us
103  science/the-elements-ted-gray
```

`validateQuestionBank` accepts only `school.question-bank/v1` or an absent
schema, and expects `choices` where v2 writes `decoys`. No code anywhere in the
repo — backend, frontend, or CLI — handles `decoys` or accepts the v2 schema.

These files are staged content for a reader that does not exist. **Item-level
level filtering is blocked behind writing that reader**; lesson-level filtering
on `grades[]` is not.

---

## 3. Two courses worth keeping in mind

The design is shaped by two real cases.

**The Elements** — 118 elements across nine authored course units
(`00-foundations`, `10-period-1` … `80-superheavy-elements`). A learner does
periods 1 and 2 one year and the heavier elements later. One course, several
sittings, years apart.

**AP Calculus AB vs BC** — BC is not harder AB. It is AB plus series,
parametric and polar. One course, two different scopes.

These are the same axis: **scope**. The atlas `lower`/`upper` split is a
different axis entirely — the same Oregon page, an easier or harder question
drawn from it. That is **depth**. Scope and depth are orthogonal and both are
needed.

---

## 4. The model

```
course              authored body of lessons. Undated, stable.
  courseUnit          authored grouping. Undated, stable.
    unit (lesson)       the gradeable leaf.

syllabus            a dated subset of one course, plus policy.
                    term == null means it is a template.

enrollment          learner -> syllabus, plus per-learner deltas.
```

A syllabus is a *subset of a course*, with no learner in it. An enrollment is
the mapping of a learner to a syllabus. Dates live on the syllabus, because a
syllabus is always for a term.

### Templates are undated syllabi

A template and an instance differ by one field, so they are one entity. `term ==
null` means template; instantiating is clone-and-date.

```yaml
# household/apps/school/syllabi/elements.easy.yml
syllabusId: elements.easy
courseId: the-elements-ted-gray
term: null                                    # template
courseUnits: [00-foundations, 10-period-1, 20-period-2]
level: lower
passing: 80
pacing: { mode: flex }                        # shape, no dates
```

```yaml
# household/apps/school/syllabi/elements.easy.2026-fall.yml
syllabusId: elements.easy.2026-fall
derivedFrom: elements.easy
courseId: the-elements-ted-gray
term: 2026-fall
courseUnits: [00-foundations, 10-period-1, 20-period-2]
excludeUnits: [elements-002-helium]
level: lower
passing: 80
pacing:
  mode: flex
  from: 2026-09-08
  to:   2026-12-12
```

### Enrollment carries deltas only

```yaml
# household/apps/school/enrollments/{learnerId}.yml
learnerId: milo
enrollments:
  - syllabusId: elements.easy.2026-fall
    passing: 60
    level: upper
    addUnits:    [elements-118-oganesson]     # must resolve in the COURSE
    dropUnits:   [elements-002-helium]
    dropDeliverables:
      elements-001-hydrogen: [bank]           # do the worksheet, skip the quiz
    rev: 3
```

Deltas go **both ways**. An enrollment may add something that is in the course
but not in the syllabus, and may drop something the syllabus includes. An `add`
naming something outside the course is refused by name — the same referential
honesty `SetAssignments` already applies to ghost course ids.

A lesson can carry several deliverables at once: `validateUnit` requires *at
least one* of `bank`, `document`, `media`, `review`, not exactly one. So
dropping one deliverable while keeping another is expressible.

### Both stores follow the assignment store's posture

Per-learner and per-syllabus YAML, atomic write-beside-and-rename, a serialized
write chain, refusal to overwrite a file that is currently corrupt, and an
append-only history file alongside. Parent-editable by hand, like the
assignments file it replaces.

---

## 5. Class diagram

Legend: **✓** exists · **~** authored, read by nothing · **+** new.

```
════ AUTHORED CONTENT ═══════════ data/content/school/curriculum/ ════════════

  ✓ CurriculumCatalog
      listUnitSummaries() · listUnits()
      │ 1..*
      ▼
  ⚠ Course                        NO ENTITY — courseId is a string field on
      courseId                    units; "a course" is units grouped by it
      │ 1..*
      ▼
  ~ CourseUnit                    school.course-unit/v1
      unit, title, sequence,      ── read by zero code today
      required, lesson_order
      │ 1..*
      ▼
  ✓ Unit  ("lesson" in the data)  school.unit/v1
      unitId, title, subject,
      courseId, sequence,
      grades[]                    ── authored, never consumed
      passing{percent}, retry{variants}
      │
      ├──0..1──▶ ✓ QuestionBank   school.question-bank/v1
      │             items[].levels[]  ── only in v2 banks, which no code reads
      ├──0..1──▶ ✓ PrintDocument  print/<id>@<rev>, rev-pinned at issue
      ├──0..1──▶ ✓ Media
      └──0..1──▶ ✓ Review

════ PLANNING ═══════════════════ household/apps/school/ ═════════════════════

  + Syllabus                      term == null ⇒ template
      syllabusId, courseId, term, derivedFrom
      courseUnits[], excludeUnits[]
      level, passing
      pacing{ mode, from, to, windows[] }
      │ 1 ──────────▶ 0..*
      ▼
  + Enrollment
      learnerId, syllabusId, rev
      addCourseUnits[] addUnits[]
      dropCourseUnits[] dropUnits[]
      dropDeliverables{}
      level, passing                (override | inherit)
      │
      └──1──▶ ✓ Learner  (household roster)

  ┌──────────────────────────────────────────────────────────────┐
  │ + resolveEnrollment()   pure, no I/O                         │
  │     syllabus scope ± enrollment deltas → level → bar         │
  │     ⇒ { unitIds[], byUnit{passing, deliverables}, level }    │
  └──────────────────────────────────────────────────────────────┘

════ RUNTIME ═════════════════════════════════════════════════════════════════

  ✓ Session                       append-only events
      sessionId, unitId
    + policyStamp{ syllabusId, syllabusRev, enrollmentRev,
                   level, passingPercent }        stamped at ISSUE
      │
      ├──*──▶ ✓ Artifact          issuedArtifacts[]
      │         + `voided` event → reissue under current policy
      ├──*──▶ ✓ Attempt           itemId, given, correct, transport, bankRev
      └──1──▶ ✓ Outcome           evaluated against the STAMPED bar

════ GRADING ═════════════════════════════════════════════════════════════════

  ✓ courseGradeFromSessions({ sessions, courseId, unitIds, window })
      best-of-per-unit, then mean across attempted units
      │  ← already takes unitIds[] and a date window
      ▼
  + EnrollmentGrade = courseGradeFromSessions(
                        unitIds: resolveEnrollment(...).unitIds,
                        window:  syllabus.pacing.from..to )
      │ 1..*
      ▼
  ✓ ReportCard                    per learner per period
```

---

## 6. Resolution

One pure domain function, no I/O, in the shape of the other `2_domains/school`
policy modules:

```
resolveEnrollment({ course, courseUnits, lessons, syllabus, enrollment })
  → { unitIds[], byUnit: { passing, deliverables }, level, errors[] }
```

```
    syllabus.courseUnits        expanded to lessons, course order
  - syllabus.excludeUnits
  + enrollment.addCourseUnits   expanded
  + enrollment.addUnits         must resolve in the COURSE
  - enrollment.dropCourseUnits  expanded
  - enrollment.dropUnits

  per lesson: deliverables = {bank, document, media, review}
            - enrollment.dropDeliverables[unitId]

  level   = enrollment.level   ?? syllabus.level
  passing = enrollment.passing ?? syllabus.passing
                               ?? global pass-override
                               ?? unit.passing.percent
```

**Gating closes over the effective set.** Excluding period 3 makes period 4's
blocker the last included lesson of period 2. This is a deliberate departure
from today's whole-course gating, and it is safe for the same reason today's
rule is safe: the exclusion is an explicit grown-up decision, not something a
child can reach.

**Level filters at both grains.** A lesson is included when `unit.grades` is
absent or contains the level; an item is included when `item.levels` is absent
or contains it. Absence is open-to-all, present-but-unknown fails closed.

---

## 7. Edits are effective-forward

An enrollment or syllabus edit never rewrites the terms of work already in a
child's hands.

The mechanism already exists at the wrong moment. `GradeSubmission` stamps
`passingPercent` onto the `graded` event, and `CloseSessionOutcome` prefers that
stamp over the live value — *the bar cannot move under a kid who has already
been graded.* But the stamp lands at grading, so a worksheet printed Monday
under an 80% bar and graded Friday after the bar moved to 60% is graded at 60%.

**The stamp moves to issue time and widens** to `{syllabusId, syllabusRev,
enrollmentRev, level, passingPercent}`. The existing `graded`-time stamp stays
as the fallback for sessions issued before this exists.

```
Mon  issue   → session stamps { passingPercent: 80, level: lower, rev: 7 }
Wed  teacher lowers the bar to 60                        → rev 8
Fri  grade   → uses the stamped 80, not 60
```

To apply a change to work already issued, the teacher acts on that session: a
new `voided` event, legal from `issued`, returns the session to re-issuable, and
the next issue happens under current policy. This is the recall path that does
not exist today — `reprinted` deliberately reuses the original artifact.

Content drift is a separate, already-solved problem and is not re-solved here:
print documents are rev-pinned at issue via `print/<id>@<rev>`, the screen path
stamps `bankContentRev` on every attempt, and `RegradeBankAttempts` re-runs
grading over recorded attempts when an answer key was genuinely wrong.

### A syllabus edit reaches everyone in that syllabus

Enrollments resolve against the syllabus's current state; there is no per-
enrollment pin. Editing a term's syllabus changes it for everyone enrolled in
that term, which is the point of the shared layer. In-flight work stays
protected by the issue-time stamp, so the change lands on the next thing issued.

---

## 8. Grading

Enrollment grading is a call-site change, not a new engine.
`courseGradeFromSessions` already accepts a `unitIds[]` list and a
`{startsAt, endsAt}` window — precisely what a dated syllabus provides. The
grade for an enrollment is that function called with the resolved effective unit
set and the syllabus's date window.

This is the strongest structural argument for dating the syllabus: the existing
grade projection was already shaped for it.

**Transcript honesty is an open point.** Two learners can pass the same lesson
at 80% having answered different item sets, if one is enrolled at `lower` and
the other at `upper`. The level is stamped on the session, so a report card
*can* distinguish them; whether it should is undecided.

---

## 9. Pacing

Three modes, all of which are properties of a dated syllabus:

| Mode | Meaning |
|---|---|
| `self_paced` | No dates. Only "what's next" — today's planner behavior. |
| `deadline` | Everything done by a fixed date: a scheduled test, an AP exam. |
| `flex` | A window plus weighting — seasonal content, front-loaded or back-loaded units. |

`flex` is not only a due-date feature. Front-loading, back-loading and seasonal
scoping **reorder the effective lesson list**, and ordering is owned by the same
resolution step that produces that list. Today's ordering is required-before-
elective, then course sequence, then the order the parent wrote them
(`planner.mjs`). A time-aware term is an addition to that comparator.

Milestone generation — spreading the effective list across the window into the
existing milestone rows, which already derive status on read and let enrichment
days excuse lateness — is deferred. The existing hand-entered milestones keep
working unchanged until it lands.

---

## 10. Surface

The whole-school grid becomes the way in, rather than a read-only report.

```
The whole school                              [+ Enroll]

              elements    atlas     calc
  milo        P1-2 lo      --        --
  alan        P1-2 up     US-W       AB
  soren       heavy up     --        BC
  felix         --        US-E       --
              ▲ cell = enrollment → editor drawer
  ▲ column header = that course's syllabi

  ! nobody enrolled in: writing-workshop
  ! alan × atlas names a courseUnit the syllabus dropped
```

A cell shows the syllabus and level rather than a dot. A column header opens
that course's syllabi, including its templates. The per-learner assignments
panel is replaced by that learner's enrollment list. The existing
zero-enrollment and dead-reference flags carry forward, joined by a flag for a
syllabus naming a course unit that no longer exists.

---

## 11. Migration

Each existing `assignments/{learnerId}.yml`:

- every entry in `courses` becomes a generated `<courseId>.full` syllabus
  covering all of that course's course units, plus an enrollment for the learner;
- `units` (standalone, including program units) migrate verbatim onto the
  enrollment record;
- the `elective` flag is preserved per entry.

A course with no authored `school.course-unit/v1` files degrades to one implicit
course unit holding every lesson, so no existing course needs re-authoring
before this works.

---

## 12. Sequencing

| Wave | Contents |
|---|---|
| 1 | Course-unit reader; syllabus + enrollment stores; `resolveEnrollment`; lesson-level level filtering on `grades[]`; per-learner pass bar; issue-time stamping and `voided`; the matrix editor. |
| 1a | A `school.question-bank/v2` reader — schema acceptance, `decoys` → `choices`, v2 `answers` for `multi_select`, `levels` passthrough. **Prerequisite for item-level level filtering**; without it the atlas and elements banks cannot be loaded at all. |
| 2 | Pacing: `deadline` burn-down, `flex` ordering, milestone generation over the effective list. |

---

## 13. Open questions

1. **Template link.** When a template is edited, do syllabi instantiated from it
   follow? Snapshot-at-instantiation is the safer default and keeps a template
   edit from reshaping a running term; a live link gives real reuse. Undecided.
2. **Pacing mode in wave 1.** Whether the pacing fields are defined in wave 1
   (parsed and validated, only `self_paced` behaving) so that wave 2 needs no
   schema migration, or left out entirely.
3. **Global pass-override precedence.** The table in §6 places it below the
   syllabus. A global override is arguably a deliberate everyone-statement that
   should outrank a syllabus default. Also open: whether it survives at all once
   the bar is settable per enrollment.
4. **`Course` as a read model.** Making course units real probably requires a
   thin course entity, since `courseId` is currently only a grouping convention
   with no object behind it.
5. **Transcript honesty across levels** — §8.

---

## 14. Related

- [`README.md`](./README.md) — the School subsystem map; §"An assigned course,
  not a catalog, is what prints" is the model this replaces.
- [`authoring/content-layout.md`](./authoring/content-layout.md) — where
  curriculum content lives on disk.
- [`print-documents.md`](./print-documents.md) — the rev-pinning discipline
  reused here for issue-time stamping.
