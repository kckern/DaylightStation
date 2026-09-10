# The term grid — one verdict per school day

The status board draws each learner's term as a GitHub-style grid: seven rows
(Monday at the top, Sunday at the bottom), one column per week, one square per
study day, coloured by how the day went. An eighth row, drawn only when a
learner carries week-level work, holds one square per week.

| Colour | State | Meaning |
|---|---|---|
| green | `met` | every obligation the day asked was served |
| amber | `partial` | some of it |
| grey | `none` | none of it |
| blue | `exempt` | nothing was asked — the house was off, the course does not meet that day, or nothing was assigned |
| hollow | `unknown` | cannot say — not yet computed, a fault, or a program that keeps no history |

The reading streak wall on the living-room screen is the same object turned
ninety degrees (weeks as rows, counts shown). One layout function
(`School/shared/dayGrid`) draws both; judging stays with the domain that owns
the days.

## How a past day is judged

A day is **replayed**, not remembered. The learner's plan is projected as of
the middle of that study day, seeing only evidence stamped before the day's
window closed — work sessions by the instant their outcome was recorded,
attestations by when they were given, curriculum exceptions by when they were
decided or retracted — and only from programs that keep dated evidence. The
sections that come back are folded through the same completion rule the
piano-games gate reads, then through a fixed ladder:

1. a day after today, or not yet computed → `unknown / pending`
2. a fault (a program that would not answer, an unreachable lock) → `unknown / <fault>`, retried after six hours
3. nothing asked and every excuse is `no_history` → `unknown / no_history` — never blue: "cannot tell" is not "day off"
4. nothing asked, the household calendar says off → `exempt / household_calendar`
5. nothing asked, every course said not a school day → `exempt / not_a_school_day`
6. nothing asked, no sections → `exempt / no_work`
7. nothing asked, other excuses → `exempt / nothing_owed`
8. served everything asked → `met`; some → `partial`; none → `none`

Work done on an exempt day still reads `met`: the calendar never un-serves.

**Config is not versioned.** Editing a course, a schedule or an enrollment
re-colours the past. That is the school convention — rollups are derived,
never stored — and the reason the verdicts are recomputable rather than a
record.

Programs that keep only their current state (a flashcard deck's mastery, a
language ladder's position, a reel, the cube) cannot be replayed. On a past
day they are neither owed, served nor faulted; a day on which they were the
only assignment reads `unknown / no_history`. Programs that keep dated
evidence — the piano course, the book log, story time, surface dispatches —
answer for any day.

Today's square is the live completion read, the same call the games gate and
the completion bridge make, so the grid's rightmost cell and the
`school.day.complete` assertion cannot disagree.

## Week-level work

`cadence: weekly` on a program unit or an enrollment means the work is owed
once per Monday→Sunday week — the same week the fitness rings use. It is
offered every day until the program reports it done on any day of that week;
the day it was done reads `served`, the rest of the week reads
`excused: weekly_satisfied`. The eighth row folds those per week:
`met`, `partial`, `none` (a closed week with nothing done), `pending` (an open
one), or `exempt / no_weekly_work`.

The book-log shelf's `obligation.per: week` is **not** this. It is a trailing
seven-day window re-measured every day, and it maps to `cadence: daily` on
purpose; a test pins that so the two cannot be quietly conflated.

## The household calendar

`school.yml → calendar` takes the same shape as a syllabus `schedule`
(`except` / `also`, each a date or `{from, to}`). A day it names as off is
excused for every section, whatever each course's own schedule says, and
reads blue. It is applied inside the daily agenda, so the printed paper and
the grid can never disagree about a vacation. Weekends are ordinary days
unless a course or the calendar says otherwise. `daysOfWeek` is accepted but
not used by the household.

## The term

The term is one of the household's academic periods (`progress.academicPeriods`,
served by `GET /periods`) — the most specific one containing today.
`lifecycle.board.term: {from, to}` narrows the days the grid shows (the Fall
semester begins 1 August on paper; the board shows from 1 September) and never
widens them.

## The cache

`household/school/records/verdicts/<learnerId>/<termId>.yml` holds the
ladder's output per day with the ladder's version. It is a cache, not a
record: delete it and the next read rebuilds. Today and yesterday are
recomputed on read (held for a minute so the board can poll); older days are
served from the file and recomputed in the background only when missing,
stale-versioned or a fault whose retry is due — the read returns
`unknown / pending` for those until they are written.

- `GET /api/v1/school/lifecycle/learners/:id/term[?termId=]` — the grid's data: `days[]` from the term's first day to today, `weeks[]` for the whole term.
- `POST …/learners/:id/term/rebuild` `{from?, to?, force?, userId, pin}` — teacher-gated backfill.
- `school ops term <learner> [--grid]` and `school ops term-rebuild <learner|--all> --teacher ID --pin-env NAME [--force] [--apply]`.

A rebuild costs about a second per day for a learner with a piano course
(Plex is consulted per replay), so a term is a couple of minutes per learner,
once.
