# Day-off tiers

A household break is not all-or-nothing. Each break on the household calendar
(`school.yml → calendar.except`) names a **tier**, and the tier decides which
work still counts that day. Daily habits (scripture first) continue on a day at
home; a holiday can carry a short special activity; full exemption is kept for
when the family is away.

## The tiers

| Tier | Example | Still asked | Excused | Term grid when nothing was asked |
|---|---|---|---|---|
| `normal` | a named day run as school | everything, as an ordinary school day | — | (a school day) |
| `stay-home` | a federal holiday at home | the keep-list: scripture, story time / book log, flashcards, the language ladder, piano | worksheets, the after-school debrief, Green Week | violet `dayoff` |
| `enrichment` | a themed holiday | as stay-home, with one subject (`replaces`) swapped for a date-bound unit | as stay-home | violet `dayoff` |
| `major-holiday` | Christmas Day | scripture, plus the holiday's date-bound activity | everything else | violet `dayoff` |
| `away` | travelling | nothing | everything, scripture included | blue `exempt` |

A break with **no tier** behaves as `away`, exactly as every break did before
tiers existed. The app logs `school.calendar.untiered` at boot with the labels
of untagged breaks, so give every break an explicit tier, past ones included
(`away` reproduces their history).

Blue on the term grid therefore means one thing: the family was away. A tier day
that still asked for work reads `met` / `partial` / `none` like any day; one on
which nothing was left to ask reads `exempt / day_off`, drawn as a solid violet
square.

## Configuring the calendar

```yaml
calendar:
  except:
    - { from: "2026-11-11", to: "2026-11-11", label: Veterans Day, tier: stay-home }
    - { from: "2026-11-26", to: "2026-11-26", label: Thanksgiving, tier: major-holiday,
        assignment: holiday-thanksgiving }
    - { from: "2027-02-15", to: "2027-02-15", label: Presidents Day, tier: enrichment,
        replaces: civilization, assignment: holiday-presidents-day }
    - { from: "2026-12-28", to: "2026-12-31", label: Family trip, tier: away }
```

- `tier` — one of the five values. A misspelling invalidates the whole calendar
  (it then fails open: every day is a school day) and logs
  `school.calendar.invalid` naming the value.
- `replaces: <subject>` — `enrichment` only; one of the nine subject shelves.
- `assignment: <unitId>` — `enrichment` and `major-holiday` only; the date-bound
  unit that is the day's special. At boot the app checks it is a published unit
  whose `onDays` covers every day of the break (and, for enrichment, whose
  subject is the one `replaces` names), and logs
  `school.calendar.assignment-missing` if not, or if an enrichment or
  major-holiday break names no assignment at all. The day still works without it, as
  a stay-home day.
- `also` still wins over `except`: a makeup day inside a break is a school day
  and has no tier.

## Keep-lists: `dayOffTiers`

What each tier keeps is a list of selectors, each naming one curriculum
`subject` or one `program` id. The defaults:

| Tier | Keeps |
|---|---|
| `stay-home`, `enrichment` | `subject: scripture`, `program: story-time`, `program: book-log`, `program: flashcards`, `program: sentence-ladder`, `program: piano-course` |
| `major-holiday` | `subject: scripture` |
| `away` | nothing |

`school.yml → dayOffTiers` overrides them per tier. A configured tier replaces
that tier's list whole; a tier left out keeps its default:

```yaml
dayOffTiers:
  stay-home:
    keep:
      - subject: scripture
      - program: story-time
      - program: piano-course
```

An unknown tier key, a selector naming both or neither of `subject` and
`program`, or an unknown subject is an error: the whole block falls back to the
defaults (never to "keep everything") and `school.day-off-policy.invalid` is
logged. A date-bound unit is always kept, except on an `away` day.

A kept program is still subject to its own schedule: piano that meets Monday to
Friday is not owed on a Saturday inside the Christmas break. A tier never widens
a course's schedule.

## Date-bound units and placeholders

An enrichment or holiday activity is an ordinary unit with `onDays`:

```yaml
schema: school.unit/v1
unitId: holiday-thanksgiving
title: Thanksgiving activity
subject: scripture
onDays: ['2026-11-26']
placeholder: true          # remove once the activity is written
objectives: []
provenance: { source: Household, reviewState: approved }
```

- It may be standalone (assigned through a learner's `standaloneWork`) or carry a
  `courseId` inside an existing course. Either way it sits outside the course's
  sequence: it never locks the next lesson, is never locked by an earlier one,
  joins the course even when the frozen `lessonOrder` does not list it, and is
  absent from the plan on every other day (never backlog, never `dormant`).
- On its day it displaces the other entries of its subject. On an enrichment day
  that is the swap; on a major holiday with a scripture-subject activity, the
  activity is the day's scripture item and the weekday lesson it displaced stays
  in the plan as backlog.
- `placeholder: true` lets the unit stand with no bank, document or media yet.
  A placeholder never displaces the lesson beside it and is offered only when
  its section has nothing real to offer, in which case the section is
  `excused · placeholder`. So a holiday works before its activity is written: on
  Thanksgiving the scripture lesson is still asked while its scripture-subject
  activity is a stub. Add the content and drop the flag when it is written; from
  then on it displaces as above.

See [content layout](./authoring/content-layout.md#date-bound-and-placeholder-units).

## Weekend scripture

The older learners do scripture every day. Their scripture enrollment's
`schedule.daysOfWeek` includes 6 and 7, and the enrollment carries
`weekend: backlog-then-review` (also accepted on the syllabus and snapshotted on
enrollment), with `weekendFrom: YYYY-MM-DD`, the first day it applies. Before
that day a weekend is judged as it always was, so a replayed past Saturday is
never re-coloured. The policy needs a course with dated modules (it reads each
week's opening day); elsewhere it is refused. On Saturday and Sunday the section
owes **one** item:

1. **Backlog** — the oldest undone lesson of any week already open, oldest week
   first.
2. **Review** — with no backlog, a re-sit of the current week's least recently
   passed lesson (`review: true` on the agenda entry). No new lesson is authored
   for it.
3. **Never advance** — a lesson from a week that has not opened is never offered.

A lesson on teacher hold is never the weekend item: it needs a grown-up, so it
excuses the section as on a weekday (`teacher_hold`).

The weekday lessons keep their schedule. A weekend item is owed (`obligated`)
even when it is backlog, which a weekday excuses as `optional_backlog`. An
`away` day excuses weekend scripture like everything else.

## Coins and gems

- **Green Week** stays a five-part gem over the weekday school days. Weekend
  days never count toward or against it, and a stay-home, enrichment,
  major-holiday or away weekday drops out of the count, future ones included (the
  economy reads `week.excusedDays` and each day's `greenWeek` flag from the
  school evidence). A `normal`-tier break counts.
- **Weekly Scripture coin** (`section-week` on scripture) counts all seven days.
  A missed, settled Saturday or Sunday loses it; on Saturday payday, with
  Saturday scripture asked, the line waits for Sunday (unless Sunday itself is
  excused). A learner whose weekend is not a scripture day is paid Saturday as
  before. A weekday sheet never promises this coin for a subject the learner's
  latest weekend asked for (`week.weekendSubjects`), since the weekend still
  counts.

See [economy](../economy/economy.md).

## On the status board

`GET .../agenda/preview?format=json` carries `dayOff: {tier, label}`. The Portal
status board names the day:

| Tier | Line |
|---|---|
| `stay-home`, `enrichment` | `<label> — stay-home day` |
| `major-holiday` | `<label> — holiday` |
| `away` | `<label> — no school` |
| `normal` | nothing extra |

A day with kept work shows its discs and the name line under them; a day with
nothing owed shows only the name line, plus "Scan your card for extra work" when
optional work is on the agenda. See
[A day off on the status board](./agenda-and-completion.md#a-day-off-on-the-status-board).

## Adding a holiday

1. Add the break to `school.yml → calendar.except` with `label` and `tier`.
2. For `enrichment` or `major-holiday`, author a date-bound unit (`onDays` = the
   break's dates; for enrichment, `subject` = `replaces`), with
   `placeholder: true` until the activity is written, and assign it to the
   learners who should do it (`standaloneWork`, or inside a course they take).
   Name it in the break's `assignment`.
3. Write `school.yml` through the container (never `sed -i`) and restart the app;
   the file is read at boot.
4. Check the boot log for `school.calendar.untiered`,
   `school.calendar.assignment-missing` and `school.day-off-policy.invalid`, then
   preview a learner's agenda for the date
   (`GET /api/v1/school/lifecycle/learners/<id>/agenda/preview?studyDay=<date>&format=json`)
   and confirm `dayOff` and the kept sections.
