# Agenda and daily completion

The agenda is a projection, not a stored checklist. It is rebuilt from current
planning and evidence whenever School needs to preview, print, resolve a
subject ticket, or answer whether the learner is done for today.

## Compilation

```text
flat learner-work plan
        +
today's session outcomes
        +
read-only program status
        ↓
fixed-order subject sections
        ↓
one next action per subject
```

`planDailyAgenda` groups work into the nine School subjects plus `other`. The
visual subject order remains fixed even when timing changes priority. Within a
subject it chooses the best eligible entry using resumability, urgency, base
priority, dated-module rank, and stable authored order.

A section receives one obligation state:

| Obligation | Meaning |
| --- | --- |
| `obligated` | Healthy required work remains today |
| `served` | Passing curriculum evidence or the program's own daily evidence served the subject today |
| `excused` | The subject does not obligate today; the reason is retained |
| `faulted` | School cannot determine the required program or plan reliably |

Common excused reasons include elective-only work, already caught up, work that
opens later, optional dated-module backlog, temporary focus-day suppression,
and `not_a_school_day` — a weekend, holiday or vacation declared by the
enrollment's [school-day calendar](./timing-and-priority.md#7-the-school-day-calendar).
Catch-up remains excused even when its worksheet is already open.

**Optional enrollments.** Both courses and programs can be made optional with
`elective: true` on the assignment entry (`courses[]` or `programs[]`). An
optional entry is still offered on the agenda, but it never obligates the day:
a section holding only optional work is `excused · elective_only`, and it does
not hold back day completion or anything gated on it (piano games). Programs
honour the flag for every program type — the shared program-enrollment
validator keeps `elective: true` (and refuses a non-boolean), and
`assignedProgramPlan.mjs` carries it onto the program's agenda entry.

A day the whole household is off is excused for the same reason but under its
own name, `household_calendar`, so a surface can tell a family vacation apart
from a course that simply does not meet on Thursdays. It comes from
[the household calendar](./term-grid.md#the-household-calendar), which the
lifecycle validates once and hands to every surface that asks whether anyone was
asked to work that day — the agenda, the term grid, and the reading streak
wall — so none of them can judge Christmas differently.

**Teacher hold.** A unit whose open failure is past the retry cap, or has sat
unretried for three school days (see the
[failure policy](./failure-policy.md#a-childs-failed-work-two-retries-or-three-idle-days-then-a-grown-up)),
is never owed. It is still the work in hand, so it keeps blocking its successors,
but it is offered only when nothing else in its subject is, and then only as a
named line ("a grown-up will help with this one") with nothing printable behind
it. A section whose only open item is a hold is `excused · teacher_hold`. That
reason is checked ahead of the lock reasons, because the successors are locked
*because of* the hold. Other open or available work in the same subject is
still offered first and still obligates. Completion and the term grid read the
excuse like any other, so a held subject cannot keep the day, or Piano Games,
shut.

`not_a_school_day` is applied as an override after the ladder, so it never
downgrades a section that was already `served`, and the diagnostics below it
keep firing on a day that is off. The section still offers a `next`: the
obligation is excused, not forbidden.

## Focus days and chaining

Urgent timed work can request extra lesson blocks. Extra blocks may suppress
only lower-ranked flexible subjects. Protected work and anything already in
progress cannot be displaced. Passing one focus lesson may expose the next
prerequisite-safe lesson on the result receipt; School never pre-issues future
sequential work.

## Preview versus issuance

`GET /learners/:id/agenda` and `/agenda/preview` are side-effect free. They do
not mint sessions, tokens, access codes, or paper records. So is the launch-card
preview link, which opens the panel's own card for a learner and subject without
a code — see [operations](./operations.md#preview-a-launch-card).

Issuing/printing an agenda is the write path. For each offered curriculum
subject, `BuildAgenda` creates or reuses a work session and mints a
`subject_next` token. The token names learner plus subject—not a frozen unit—so
scanning old paper recomputes the honest next action. Program entries launch
their own surface and do not create curriculum work sessions.

The teacher workspace separates this into preview and dispatch. Preview renders
the same agenda PNG without state changes. Dispatch requires fresh teacher
confirmation and a durable idempotency key; the server reserves that key before
printing and persists the receipt. An identical retry returns the receipt. A
different payload or an indeterminate prior print returns 409, because a second
agenda is worse than requiring an operator to inspect the first attempt.

## The 4am study day

Agenda service, program daily status, teacher-today digest, and daily completion
share the same household-local 4am-to-4am boundary. A pass at 1am still belongs
to the previous evening's School day.

## Persisted reading activity

The v2 teacher-day learner row includes `readingActivity`, projected directly
from that learner's persisted book-event log with the requested study day and
the same household-local boundary. Progress/check-in events and effective
finishes count even when the book is not enrolled or present in the catalog.
Starting or setting aside a book does not count. A `reopened` event removes the
finish it corrects in append order while leaving independent progress intact.

An available shelf reports `status: ok` with `hasActivity`, `progressCount`,
`finishedCount`, and the number of distinct shelf items with evidence as
`bookCount`. A missing shelf is an available empty shelf. A damaged or
unreadable shelf reports `status: unavailable` and `hasActivity: null`, so a
read failure cannot be mistaken for no reading. The v1 teacher-today response
remains unchanged.

New shelf events carry a server-generated `recordedAt` as well as their
effective `at`. Backdated finishes are attributed by `at`; `recordedAt` records
when the write reached the server. Legacy events without `recordedAt` remain
valid. After a saved shelf mutation, the School event bus broadcasts
`{ event: 'book-log-changed', learnerId }` so readers can reload the whole
learner shelf; a broadcast failure is logged without changing the saved HTTP
result.

## Reading on the status board

The live board requests the teacher-day digest without a browser-derived date
and uses the response's household `studyDay` for learner agenda previews and
study-day event comparisons. Explicit day props still support historical
consumers. Each learner settles separately after the shared digest; weekly
rings load independently.

Available persisted `readingActivity` with `hasActivity: true` adds one
supplemental **Reading** circle, regardless of the number of events or books.
It appears even with zero required assignments or a failed plan read. Missing,
unavailable, or empty activity creates no credit. Supplemental circles affect
layout only: required totals, completed-required counts, daily gates, and
**Done for the day** remain unchanged.

Required program identity comes from agenda `entries[].program`, not the
shared English subject. Story time retains its own state and accessible label.
An unmet reading obligation can show partial `actual/target` progress alongside
the supplemental circle. Once a real reading obligation is met,
`BookLogProgramLauncher.status()` supplies `servedWork` for `book-log:shelf`,
so the required Reading circle remains visible after its next action disappears.
That completed required circle suppresses redundant supplemental credit.

The board remains static and noninteractive. It reloads on
`book-log-changed` for displayed learners without filtering by event date:
backdating and undo can change evidence on another day. Event payloads trigger
reads; they never supply optimistic credit. Returning from the shelf remounts
the board and reloads the same persisted sources.

## Persisted physical-education activity

The v2 teacher-day learner row also includes `fitnessActivity`, projected from
the fitness session log for the requested study day. Physical education is not
one of the nine subject shelves and is never assigned: there is no section, no
work-session, and no obligation behind it, so the only evidence is the workout
itself.

A learner is credited for a session two ways. The first is rings: the session
summary records `participants[learnerId].rings` above zero. Rings are computed
at session close and stored, so the projection is a field read rather than a
re-derivation, and requiring rings rather than bare membership in
`participants` keeps a stray heart-rate strap from awarding one child credit
for another's workout.

The second is time, and it exists for the youngest riders. Rings scale with
effort, so a preschooler can spend twenty real minutes on a bike and score
zero; a participant whose `zoneMinutes` total at least ten minutes across all
zones is credited whatever the rings say. Ten minutes still excludes a strap
put on and taken off. `rings: null` means no ring data was recorded and earns
nothing on its own, but does not bar credit on time.

A session belongs to the study day its **start** falls in — the rule the weekly
ring measure already uses — so a late-evening workout is credited once, on the
day it began. The digest reads the roster's day once, across the study day and
its successor, because sessions are stored by date rather than by learner.

An available session log reports `status: ok` with `hasActivity`, the day's
`rings` total, and `sessionCount`. A day credited entirely on time reports
`hasActivity: true` with `rings: 0`, and the circle's label then says only that
fitness is done rather than claiming a ring count it did not earn. A day with no qualifying workout is an
available quiet day, not an outage. A failed read, or no session log wired at
all, reports `status: unavailable` with `hasActivity: null`, so an outage
cannot be mistaken for a child who did not exercise. The v1 teacher-today
response remains unchanged.

## The status board card

Each learner's card is four cells, left to right: who, today, coins, days.

**Today.** A big number of how many assignments are left, set before the
subject pins. A finished day shows one green check mark in its place. There is
no segmented bar; the number is the progressbar for screen readers ("N of M
done"). A rest day keeps "No school today".

**Coins.** A fixed-width column so the figures line up down every card. Silver
is the big figure: the learner's earnings so far this week from the roster
earnings preview (`GET /api/v1/earnings/preview`; see
`__docs/reference/economy/economy.md`). It is a preview: PayoutService mints
its earned lines into the ledger only while the economy catalog is `live`.
Gold is smaller beneath it: the wallet's `balances.gold`
(`GET /api/v1/economy/users/:id/wallet`), which grows when the Sunday week
close converts unspent silver.
Gems are a third line only once earned or pending. A faded `+N` hangs after a
number for what is still possible; it is decoration only, and the figure's one
spoken name carries it ("27 silver this week, 5 more possible"). There are no
captions; icons carry the meaning and each figure is an image whose name says
it. A wallet or roster read that comes back not-ok is logged
(`status-board.wallet-failed` / `status-board.earnings-failed`).

**Days.** Last week (dimmer) above this week, seven squares each, today
outlined, weekday letters above. The ring count with its ring icon sits
beneath. Both rows come from the term read. Tapping them opens the learner's
full term in a read-only popup — the one tappable thing on a panel board
(`__docs/reference/school/term-grid.md`).
A pinned `day` anchors the two rows on that day, not on the term read's own
`today`.

One roster read prices every card. It runs beside the plans, never blocking
them, on the board's refresh timer, on visibility, and after every school,
scan, or ring event, since that work is what moves the figures. Each figure
appears when its own read lands ("0" and "not loaded" are different facts), a
failed re-read keeps what is shown, and a learner the preview cannot price
(every line "can't tell") shows no silver figure. The snapshot cache keeps the
figures with the week they price, so last week's total is never painted as
this week's. Cards stay in roster order; the economy never ranks.

## The coin window

The coin cell on a card is a native button (so keyboard and OK reach it). It
opens that learner's bank screen directly; there is no popup between. Opening it
starts no tracked work (it logs `status-board.bank-open`), and the Portal wires it
to the same bank launch the bank strip's chips use, with the learner already
known so no face picker is shown. The cell is a plain figure, not a button, when
the board has no `onOpenBank` or the learner has no coin figure yet. Its spoken
name carries the week: "<name>'s bank, N silver this week".

The bank screen (`bank/BankScreen.jsx`) has three tabs, History (the default),
How to earn and How to spend; Back returns to the board. History shows:

1. The balances: silver (with when it becomes gold), gold and gems.
2. "This week, not yet paid": the same weekly silver the card shows, its earned
   lines, and "+N more possible" (`bank/BankLedger.jsx`, `UnpaidWeek`). It is
   hidden when the figure prices another week.
3. The ledger as a table grouped by day, newest first, with the columns icon,
   amount, description (source word, then label) and the balance after
   (`LedgerTable`). Wording and grouping are `bank/bankScreenModel.js`
   (`historyByDay`, `ledgerEntry`), read from the bank's structured fields; see
   "The bank" in `__docs/reference/economy/economy.md`.

Data: `GET /api/v1/economy/users/:id/bank` plus the roster earnings read, both
refreshed on this learner's `school` events. A failed bank read shows "The bank
is napping" and no numbers; before coins are live the screen says "Coins start
soon". The screen has its own idle exit. Log events are `economy.bank.*`
(`opened`, `tab-changed`, `unavailable`, `earnings-failed`, `idle-exit`).

## The coin ceremony

When a child's coin figure rises, a short "+N" pop appears over the board.

**What is celebrated.** The coin column's weekly silver (the earnings preview),
not the bank balance. The pop reads `+N` large, `<total> this week` smaller, the
child's face and name, and the standard silver `CoinIcon`.

**What counts as a rise.** The same learner's silver going up between two
network reads of the same week (`coinCeremonyModel.observeEarnings`). Not
celebrated: the board-cache seed and the first network read after mount (both
are baselines, so a reload never replays an old rise); a change of week; a drop;
no change; a learner off the roster. A learner missing from one read keeps their
baseline. The baseline advances even while the ceremony is disabled.

**Bursts.** A rise waits `coalesceWindowMs` before it shows, and further rises
for that learner merge into it (the gains add). A rise for the child already on
screen updates that pop in place and restarts its clock. Different children
queue and show one at a time.

**Where and how long.** Over the board pane only, never the keypad, so a child
typing a code is never blocked; below the narrow breakpoint the board pane is
hidden and so is the ceremony. It auto-dismisses after `durationMs`; a tap, or
OK once tabbed to, dismisses it early. It never takes focus. Motion is one enter
and one exit, with none under `prefers-reduced-motion`; the cards themselves
still do not move.

**Sound.** The coin cue plays once per pop (not per merge): `coin.mp3` on the
media mount at `school/_ux/coin.mp3` by default, resolved through
`DaylightMediaPath`. It rides the screen's master volume (volume times
`getEffectiveMaster()`), a muted master plays nothing, and the audio element is
primed muted from the first touch or key on the page, because a kiosk browser
refuses sound before a gesture. See the School runbook, "Coin ceremony sound".

**Config.** The screen YAML's optional `school.coinCeremony` block, read by
the Portal with the rest of the screen config:

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` turns the pop and its sound off |
| `sound` | `school/_ux/coin.mp3` | media-relative path; `''` or `none` is silent |
| `volume` | `0.8` | 0 to 1, before the master volume |
| `durationMs` | `3500` | 1000 to 15000 |
| `coalesceWindowMs` | `1500` | 0 to 10000 |

**Logs.** `status-board.coin-rise`, `status-board.coin-ceremony.shown`,
`.dismissed` (reason `tap` or `timeout`), `.dropped` (learner left the roster),
and the sound's `school.coin_cue.play` / `.rejected` / `.muted`.

## Physical education on the status board

Available `fitnessActivity` with `hasActivity: true` adds one supplemental
**Fitness** circle carrying the `physical-education` subject icon, however many
sessions or rings the day held. Like the Reading circle it affects layout only:
required totals, completed-required counts, daily gates, and **Done for the
day** are unchanged, so a workout can never finish a day of school work and
school work can never hide a workout.

The circle has no other state. It is never pending, because a wall panel should
not nag a child to go and exercise, and never amber, because nothing marks a
workout wrong. On a day with no qualifying session it is simply absent.

Fitness therefore appears twice on a card, deliberately: the ring chip in the
readout is the week's cumulative count, the circle is today's yes or no. The
board needs no new subscription for it — closing a session prompts the
`fitness.weekly-rings` State Gate producer, and the board re-reads the rings
and that learner's card on that gate's events.

## A day off on the status board

When every planned section is excused and at least one because the day is
`not_a_school_day` (weekend, holiday, vacation), `summarize` returns
`restDay: {optionalCount}` and the card says **No school today** instead of
"No plan to show". When `optionalCount > 0` it adds **Scan your card for
extra work**: a card scan prints the agenda, and a rest-day agenda still
carries every optional lesson with its code (the obligation is excused, not
forbidden).

- Excused work is still never a disc and never counts toward the number left.
  Work a child actually does on a day off appears as usual (sessions,
  served work, reading, fitness), and the rest-day copy sits under any
  supplemental pins while `total` is 0.
- One obligated section makes it a school day: no rest-day copy.
  `optional_backlog` / `elective_only` sections beside a `not_a_school_day`
  one don't spoil it.
- A pinned past day (`day` prop) says **No school** with no hint, since a scan
  prints today's agenda.
- A failed plan read keeps "No plan to show": the board can't tell a day
  off from missing data.

Added 2026-09-26, after a child at the Portal on a Saturday read "No plan to
show" as "nothing to do" while flashcards were waiting.

## How the status board loads and refreshes

The board paints from a localStorage snapshot of the last board it showed
(`status/boardCache.js`, key `daylight.school.status-board.v1`), then re-reads
everything. The snapshot is a paint cache, not a source of truth: each card is
replaced in place as its read lands, and a card that has data never goes back
to a skeleton. Skeletons appear only on a cold browser, and at the study-day
rollover: when the digest names a different `studyDay` than the snapshot, every
card's discs are dropped (yesterday's greens must not stand in for today) while
the day squares and ring count stay until their own reads replace them.

Refreshes are scoped to what changed:

| Trigger | Re-reads |
| --- | --- |
| Mount, 5-minute poll (visible tab only) | Every learner + rings |
| `omr` scan event naming a learner | That learner (digest, plan, term) |
| `omr` scan event naming nobody | Every learner |
| `school` event (`session-issued`, `story-read`, …) | That learner |
| `fitness.weekly-rings` State Gate event | Rings + that learner |

The coin read (`refreshCoins`) also feeds the coin ceremony; the cache seed never
does. A failed re-read keeps what the card already shows; only a card with nothing on
it falls back to the plan-less summary or no day squares. A per-learner
generation counter drops a slow read that a newer one has overtaken.

## Learner-day completion

Completion folds section obligations and planner faults into four states:

| State | Meaning |
| --- | --- |
| `incomplete` | At least one healthy required section remains |
| `complete` | Required work existed and every obligation was served |
| `no_work_today` | The healthy plan created no obligation today |
| `indeterminate` | A plan or required-program fault prevents a trustworthy answer |

This projection is never persisted as a mutable done flag. The endpoint is
read-only and `no-store`. Piano Games unlocks only for an identified learner in
`complete` or `no_work_today`; Guest, transport failure, and `indeterminate`
remain locked. Earned-reward consumers may require `complete` specifically.

The completion bridge publishes an initial observation after startup and later
state transitions. Event consumers must be idempotent by learner and study
date. See [completion and rewards](./completion-and-rewards.md).
