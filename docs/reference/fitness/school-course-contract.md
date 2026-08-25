# School-owned Fitness course contract

School can now treat Fitness material as a normal course without taking
ownership of Fitness media or sensor records. The course, unit ordering,
scheduling, enrollment, and progress vocabulary belong to School. Plex items,
saved workouts, heart-rate/cadence streams, strength runs, and voice memos
remain Fitness-owned records. The boundary between them is an explicit
prepared attempt and an immutable assessment pointer.

This is infrastructure, not a current enrollment. No learner plan, syllabus,
or `pe-daily` configuration is created or changed by this feature.

## One authoring level

`school.fitness-course/v1` is one schema with optional detail. A minimal file
can name one Plex show and let the compiler derive modules and lessons. The
same file may progressively specify selection/grouping, warmups, drills,
cooldowns, voice reflection, saved workouts, and boolean success gates. These
are variations in one authoring model, not separate “simple” and “advanced”
authoring levels.

An authored course belongs at
`data/content/school/{subject}/{work}/work.yml`. For example:

```yaml
schema: school.fitness-course/v1
work: cycling-foundations
title: Cycling Foundations
subject: skills
grades: [upper]

source:
  adapter: plex
  showId: "700"

# Everything below source is optional. Without it, Plex seasons become School
# modules, episodes become lessons, and the default policy applies.
mapping:
  include: ["101", "102", "201"]
  groups:
    - module: foundations
      sourceIds: ["101", "102"]
    - module: intervals
      sourceIds: ["201"]

modules:
  - module: foundations
    title: Foundations
  - module: intervals
    title: Intervals

# This example is sequential. A scheduled course uses School's existing
# grammar instead: progression.mode: dated_modules, plus opensOn/closesOn on
# every module. Enrollment timing remains a syllabus/enrollment concern.
progression:
  module_order: fixed
  lesson_order: fixed
  mode: sequential

defaults:
  prepend:
    - id: warmup
      role: warmup
      kind: sensor-block
      durationSeconds: 180
  append:
    - id: reflection
      role: reflection
      kind: voice-reflection
  success:
    all:
      - metric: media.completion_ratio
        op: gte
        value: 0.8
      - metric: heart_rate.coverage_ratio
        op: gte
        value: 0.7
      - metric: cadence.average_rpm
        op: gte
        value: 70
```

The supported segment vocabulary is `plex-video`, `saved-workout`,
`sensor-block`, and `voice-reflection`, with the roles `warmup`, `main`,
`cooldown`, `drill`, and `reflection`.

Grouping and course-internal scheduling use School's existing vocabulary:
`progression.mode` may be `sequential`, `module_blocks`, or `dated_modules`.
For `dated_modules`, every declared module carries non-overlapping `opensOn`
and `closesOn` dates. Relative household scheduling (anchor, due date,
priority, flexibility, agenda blocks) deliberately remains on the School
syllabus `timingTemplate`, because it varies by enrollment rather than by
Fitness media. See [Enrollment](../school/enrollment.md) and
[Timing and priority](../school/timing-and-priority.md).

## Defaults and success criteria

The minimal Plex-only form defaults to two required gates:

- at least 50% media completion;
- trustworthy heart-rate coverage for at least 70% of the recorded session.

Missing required sensor evidence is a failed gate and produces
`needs_remediation`; it is never interpreted as zero effort or silently
waived. Policies support `all`, `any`, and `atLeast` combinations. Leaf gates
can use segment completion/order, media time/ratio, heart-rate coverage/range/
zone, cadence/RPM coverage/range, strength steps, and attributed voice-memo
presence/duration. The result is boolean with per-gate diagnostics—there is no
weighted “effort score.” Voice memos are checked only for attributed presence
and duration; transcript meaning is not graded.

## Runtime lifecycle

1. The Fitness source projection is compiled into an ordinary School work and
   ordinary School units. Each generated unit carries an `activity` descriptor
   with frozen course and policy revisions. A last-known-good projection keeps
   the curriculum readable during a provider outage.
2. A future normal School enrollment can select this work. Agenda, panel code,
   QR code, unit ordering, and course progress then come from the existing
   School enrollment/session machinery; there is no special PE enrollment
   type.
3. Opening the unit creates a normal School work session. Fitness freezes a
   prepared attempt before School broadcasts `fitness.launch` to the garage
   kiosk.
4. If the kiosk is busy, the kiosk asks before switching. Declining preserves
   the active Fitness session. Acceptance records
   `external_activity_dispatched` in School and only then loads the lesson.
5. Fitness owns execution and final persistence. When the player closes, the
   kiosk waits for the Fitness session’s final save, then asks Fitness to assess
   the frozen policy. Browser playback facts may supplement media coordination;
   heart rate, cadence, strength, and voice evidence are re-derived from the
   saved Fitness record.
6. Fitness persists the immutable assessment and publishes its id, revisions,
   verdict, and normalized measures. School validates the learner, unit, and
   revisions, appends `external_activity_assessed`, records verified learning
   evidence, and closes the normal School outcome. Passed outcomes advance the
   enrollment; remediation outcomes do not.

This differs from a `launch:` or daily program unit. Those are honor-close or
program-dispatch mechanisms. A Fitness course unit remains open until Fitness
returns evidence and School records the assessed outcome. It also does not
print a worksheet result receipt or play a worksheet-grading sound by default.

## Data ownership

| Owner | Durable responsibility |
| --- | --- |
| School | Authored course, generated School work/units, enrollment and schedule, work-session events, normalized learning evidence, course progress |
| Fitness | Prepared attempt snapshot, raw media/sensor/session records, strength and memo records, criteria diagnostics, immutable assessment |

Fitness attempt records live under
`data/household/fitness/school-attempts/`. Last-known-good School projections
live under `data/household/school/runtime/fitness-course-projections/`. The
projection is runtime cache, not a second authored course.
