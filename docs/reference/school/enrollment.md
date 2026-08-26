# Enrollment and syllabi

> **Current state:** whole-course enrollment is built. A teacher can enroll,
> re-materialize, or unenroll a learner from the School matrix or lifecycle API.
> Syllabi can be stored and archived through the API, but there is no syllabus
> authoring UI; new syllabus YAML is authored by hand. Module-subset enrollment,
> per-learner pass bars, and per-enrollment report-card rows remain unbuilt.

Related: [planning](./planning.md),
[timing and priority](./timing-and-priority.md), and
[progress and reporting](./progress-and-reporting.md).

## The three records

These records are related but not interchangeable:

| Record | Meaning | Authority |
| --- | --- | --- |
| Course | Published curriculum: units, modules, progression, profiles, grading, printables | `data/content/school/` |
| Syllabus | Reusable teacher-authored arguments for enrolling in one course | `data/household/school/plans/syllabi/` |
| Enrollment | Frozen realization of that syllabus for one learner | Learner assignment record |

A syllabus is a template. An enrollment is the runtime contract. Editing or
archiving a syllabus never silently changes an existing learner.

There is a fourth shape that is NOT a course enrollment: a **program** — an
enrollment with `courseId: null`, living in `assignment.programs[]`, whose
evidence and progress belong to a registered `IProgramLauncher` rather than to
any published curriculum. `story-time` is the plainest example (a daily count,
no units at all). See [School programs](./programs.md).

## Enrollment v2

An enrolled course is an object in the learner's `courses` assignment list:

```yaml
courses:
  - courseId: come-follow-me-ot-2026
    profile: lower
    syllabusId: come-follow-me-ot-2026-lower
    enrolledAt: '2026-08-23T20:00:00.000Z'
    enrollment:
      schema: school.course-enrollment/v2
      enrollmentId: enr_milo_come_follow_me
      courseId: come-follow-me-ot-2026
      profile: lower
      progression:
        mode: dated_modules
        module_order: fixed
        lesson_order: shuffle_once
        module_number_start: 35
      moduleOrder: [w35-aug24, w36-aug31]
      optionalModules: []
      lessonOrder:
        w35-aug24: [cfm-w35-mon, cfm-w35-tue]
        w36-aug31: [cfm-w36-mon, cfm-w36-tue]
      moduleSchedule:
        w35-aug24: { opensOn: '2026-08-24', closesOn: '2026-08-30' }
        w36-aug31: { opensOn: '2026-08-31', closesOn: '2026-09-06' }
      display:
        courseTitle: Come Follow Me — Old Testament 2026
        courseShortTitle: Come Follow Me
        modules:
          w35-aug24: { number: 35, title: 'Aug 24–30 · Psalms 49–86', shortTitle: 'Psalms 49–86' }
          w36-aug31: { number: 36, title: 'Aug 31–Sep 6 · Psalms 102–150', shortTitle: 'Psalms 102–150' }
```

`createCourseEnrollment` snapshots:

- the effective progression policy;
- the learner profile;
- module membership and order;
- optional modules;
- the once-only lesson order inside every module;
- dated module windows, when the course uses `dated_modules`.
- learner-facing course/module titles, compact titles, and displayed numbers.

That snapshot prevents later catalog edits from reordering an active learner or
moving their calendar or silently relabeling their existing course. A module
may author an explicit `number`; otherwise `module_number_start` is added to
its position in the complete authored module list, so a later mid-course
enrollment does not restart numbering at one. Legacy v1 enrollments remain readable. A v1 enrollment
with `moduleSchedule` is treated as `dated_modules`, because the schedule itself
is durable evidence of the original policy.

## Syllabus shape

The built whole-course syllabus shape is:

```yaml
schema: school.syllabus/v1
syllabusId: come-follow-me-ot-2026-lower
title: Come Follow Me — Old Testament 2026 (lower)
courseId: come-follow-me-ot-2026
profile: lower
policy:
  lesson_order: shuffle_once
```

A syllabus may also carry a `timingTemplate`; see
[timing and priority](./timing-and-priority.md). The current syllabus validator
does not accept a `modules` subset, a per-learner passing threshold, or a term
that creates a separate grading scope. Those are future model changes, not
hidden YAML features.

## Runtime behavior

The planner takes membership from the frozen `lessonOrder` when an enrollment
has one. It falls back to the live catalog only for a legacy bare course
assignment. This matters for a dated mid-course enrollment: modules omitted at
enrollment do not reappear later as upcoming work or inflate progress totals.

The profile reaches worksheet issuance. The issued worksheet stores its own
selected questions, order, answer mapping, learner, enrollment, and curriculum
revision. Grading therefore reads the issued snapshot rather than a potentially
changed question bank.

## Enroll, re-materialize, and unenroll

`EnrollLearner` reads the syllabus and course, creates enrollment v2, and writes
the rich course entry through the assignment store. The write is protected by
`TeacherGate` and the assignment revision stale-save guard.

Re-materialization explicitly creates a new snapshot from the current syllabus
and course. It refuses while the learner has any open session in that course;
otherwise an active worksheet could refer to a lesson removed by the new
snapshot. Passed history remains safe because it is keyed by stable `unitId`.

Unenrollment removes the current plan entry. It does not delete sessions,
attempts, issued worksheets, feedback, assignment history, or report-card
evidence.

CLI writes are dry-run unless `--apply` is present:

```bash
SCHOOL_PIN=... node cli/school.mjs ops enroll learner3 \
  --syllabus come-follow-me-ot-2026-lower \
  --teacher kckern --pin-env SCHOOL_PIN

SCHOOL_PIN=... node cli/school.mjs ops rematerialize learner3 \
  --syllabus come-follow-me-ot-2026-lower \
  --teacher kckern --pin-env SCHOOL_PIN --apply
```

## Assignment history and reporting

Every assignment change appends a history record with `recordedAt`. Report
cards use that history rather than pretending the current assignment was in
force for the whole period. Removing a course today does not erase work done
earlier in the period.

Current report cards are keyed by `courseId`, not `enrollmentId`. If two
syllabi for the same course occur in one academic period, the report card emits
a `multiple-enrollments` warning rather than silently presenting the merged
number as one clean enrollment grade. Per-enrollment report-card rows remain
future work.

## Known limitations

- New syllabi require hand-authored YAML or direct API use.
- The enrollment surface is whole-course; module-subset authoring is not live.
- Course profiles are still constrained by the existing worksheet profile
  implementation.
- Passing thresholds are unit-level plus household pass overrides; they are not
  snapshotted per learner.
- Academic periods scope reports, but an enrollment does not yet own a term or
  independent grading window.
