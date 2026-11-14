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
placeholder: true          # no instructions yet; see below
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
- **Placeholder = no instructions.** A date-bound unit whose `description`
  (its instructions) is empty after trimming, and which has no bank, document,
  media, review, program, launch or activity, is a placeholder whatever its
  `placeholder` flag says. One with instructions is a **real assignment that
  counts toward the day**, content or not, even if a hand-edited file still
  says `placeholder: true`. (A unit with real content keeps an explicit
  `placeholder: true` only while it has no instructions.) The validator, the
  console's writes and the console's read all use the same rule
  (`isPlaceholderUnit` in `domain/curriculum/unitValidation.mjs`).
- A placeholder never displaces the lesson beside it and is offered only when
  its section has nothing real to offer, in which case the section is
  `excused · placeholder`. So a holiday works before its activity is written: on
  Thanksgiving the scripture lesson is still asked while its scripture-subject
  activity is a stub. Once it has instructions it displaces as above and is owed.
  An instructions-only activity has nothing to scan or submit: a grown-up marks
  it done with an attestation ("I verify this was done"), which the planner
  honours as a pass.
- Stub text is instructions. A description such as "A placeholder until it is
  written" makes the unit count; leave the description out (or blank the
  instructions in the panel) to keep it a placeholder.

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

**The weekend item is the whole day.** On a weekend that asks for it, every
other section is excused (`not_a_school_day`) *and offers nothing*: no card on
the printed agenda, no session opened, no disc on the status board, no `next`
in the preview — before or after the scripture item is done, save the
Saturday catch-up below. (Printed beside
the scripture card, a Saturday civilization or piano card read as owed work.)
Work actually done stays served, and a course that explicitly schedules the
weekend (`daysOfWeek` with 6 or 7) is still owed — that is configuration, not
a default. A learner without weekend scripture keeps the old rest-day sheet:
nothing owed, every optional lesson printed with its code. So does an `away`
weekend, which asks for nothing.

**Saturday catch-up** (2026-11-14). The one exception: on Saturday, once the
weekend item is settled (served, or excused by a hold), a daily program the
learner missed on a school weekday this week is offered again — optional,
never owed, with the "Catch-up" rail on the printed card. A weekday is missed
when the program's own schedule met it, the household calendar did not take it
off (a keeping tier counts it only if its keep-list keeps the program), and the
program did not report it done (a grown-up's day bypass counts as done). The
section carries `backfill: {missedDays}` and `catchUp: true`.

- **Programs only.** A past weekday's verdict is settled, so a late curriculum
  lesson changes nothing; a weekly gem such as "Flashcards on 4 days" counts the
  Saturday day, because its week runs Monday to Sunday.
- **Sunday stays scripture-only.**
- A learner without weekend scripture already sees Saturday's optional offers;
  those that backfill a missed day gain the same label.
- The evidence is a replay: on a live Saturday build `collectProgramStatuses`
  asks each replayable daily program about Monday–Friday and attaches
  `status.weekdays = {weekFrom, doneOn}` (`domain/saturdayCatchUp.mjs` turns it
  into missed days). A replayed past Saturday or a future preview does not fold.
  A replay failure logs `school.program-status.weekday-fold-failed` and offers
  nothing.

**Settled is not performed.** A program can report a day done with nobody
having played — a piano co-progress lock, a grown-up's day bypass, a teacher
excusal (`excused: true` on the program status). On a day that asks for the
section that settles it; on a day that does not (a weekend, a household day
off, a section a tier drops) the section stays excused with the day's reason,
so it never reaches the term grid or the coins as served. Real play on a day
off still serves.

**Previewing a coming day.** `GET .../agenda/preview?studyDay=` for a day after
today never borrows today's program results: a replayable launcher is asked
about that day, any other keeps its live next lesson with nothing marked done.
(Before 2026-11-11 a debrief finished today showed as Saturday's "done".)

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

From the teacher console: **Operations → Days off** (see
[the teacher reference](./teacher.md#days-off)).

1. **Edit days off → Add a break**: name, dates, kind of day. For *Away* alone,
   **Add an away trip** is one step.
2. For *Enrichment* pick the subject it replaces; for *Enrichment* or
   *Holiday* write the activity's title and instructions and tick who does it.
   The panel writes the date-bound unit at
   `content/school/<subject>/holiday-activities/units/holiday-<name>.yml`
   (`onDays` = the break's dates) and names it in the break's `assignment`.
   With instructions the activity counts; with none it is written
   `placeholder: true`. The panel says which next to the activity — **Counts**
   or **Placeholder — add instructions to make it count** — in the list and
   while editing.
3. **Save.** The change is live at once — no restart. A save is refused when
   `school.yml` changed since the panel loaded it, when it would change what a
   day before today meant, or when a keep-list change would re-judge yesterday.
   Every save backs `school.yml` up to `household/school/backups/` first.

By hand (still supported): add the break to `school.yml → calendar.except`
with `label` and `tier`, author the date-bound unit as above, assign it, write
`school.yml` through the container (never `sed -i`) and restart the app — a
hand edit is read at boot (or on the next console save, which re-reads the
file and refuses if it changed since the panel loaded).

Either way, check the log for `school.calendar.untiered`,
`school.calendar.assignment-missing` and `school.day-off-policy.invalid`
(`school.calendar.updated` / `school.calendar.save-refused` for console saves),
then preview a learner's agenda for the date
(`GET /api/v1/school/lifecycle/learners/<id>/agenda/preview?studyDay=<date>&format=json`)
and confirm `dayOff` and the kept sections.

### What a written activity is

An activity counts as soon as its instructions are non-empty: the panel writes
the title and instructions (`description`) and drops `placeholder`. It is owed
on its day like any lesson (on a major holiday it is the day's scripture item),
and a grown-up attests it done. An activity saved with blank instructions stays
`placeholder: true` and the day works as described under *Date-bound units and
placeholders* above. Giving it a bank or document is still an authoring step.
