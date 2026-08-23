# Student completion state machine — agenda done-ness

**Status:** design, not built. Written 2026-08-23 against `main`.

Related: [time-sensitive planning](../../reference/school/timing-and-priority.md),
[School overview](../../reference/school/README.md),
[dated modules](./2026-08-23-dated-modules-design.md) (a sibling design, owned
by a different workstream — see §0).

---

## 0. Scope and boundary with `dated_modules`

Children get a printed daily agenda, sectioned by subject. When a child
finishes their agenda for the day they are "done," which is meant to unlock
rewards elsewhere in the house (games on the piano kiosk, coins). Today there
is no learner-level "done" fact — only a per-section `servedToday` boolean
computed inside `planDailyAgenda` (`agenda.mjs:150`), a function whose job is
printing paper, not answering "is Milo done?" Nothing rolls it up, persists
it, or announces it.

This doc designs that roll-up: the **student completion state machine** — what
"done for today" means, how each agenda section resolves into it, where the
fact lives, and what it emits.

It explicitly does **not** design the `dated_modules` progression mode, its
per-module windows, `moduleSchedule`, or the `catch_up` timing state — that is
a separate, already-scoped workstream
([2026-08-23-dated-modules-design.md](./2026-08-23-dated-modules-design.md)).
Where this design needs an input from that one (whether a backlog entry is
"optional"), it takes the sibling doc's decision as a fixed contract and names
the interface explicitly (§7) rather than re-deciding it.

It also takes a narrower cut of "windowed work" than the household's original
ask. A due-Friday assignment that is its own standalone assigned unit already
works today (`planner.mjs:103-109`, `timingByStandaloneUnit`): it is offerable
across its whole window and stops being offered once passed. What this doc
adds for that case is only the **completion-calculus** side — does an item due
later this week count as obligated today (§1, rule 5). The other case named in
the original ask — a weekly item living *inside* a sequential course, which
would need the course to throttle its own unit-yield to one per period — is a
cursor-mechanics question and is out of scope here; §9 names it as a deferral.

## 1. The section-resolution table

The whole state machine collapses to one rule:

> A section is **obligated** only if it offers something the child can act on
> today *and* that offer has a same-day claim on them. Everything else is
> **excused**.

Obligation is evaluated over the section's **actionable non-elective
entries** as a set, not over the single `next` candidate `agenda.mjs` prints.
Candidate selection exists to pick ONE thing to hand a child; it is the wrong
question for "is this subject owed today," because priority ordering can let
a high-`basePriority` elective become `next` ahead of a required entry the
child never sees a ticket for, and evaluating obligation off `next` alone
would then silently excuse the required work.

**Actionable** means status `in_progress` or `available` (post-§2 fix, i.e.
excluding entries belonging to an unavailable program) — the same
candidacy-eligibility test `agenda.mjs` already applies, just not narrowed to
a single winner. `completed`, `locked`, `upcoming`, and `dormant` entries are
never actionable.

| # | Condition | Outcome | Reason |
|---|---|---|---|
| 1 | A **non-elective** entry in this subject passed today, or its program reports `doneToday` | `served` | — |
| 2 | `suppressed !== null` (a focus day deliberately took this subject off the plate) | `excused` | `suppressed_by_focus` |
| 3 | No actionable non-elective entry remains (nothing non-elective assigned at all, unavailable program, dormant, upcoming, locked-with-no-offer, or every non-elective entry already completed) | `excused` | `elective_only` \| `program_unavailable` \| `blocked_no_offer` \| `awaiting_grown_up` \| `opens_later` \| `caught_up` |
| 4 | Every actionable non-elective entry is optional backlog (the `dated_modules` `catch_up` contract, §7) | `excused` | `optional_backlog` |
| 5 | Every actionable non-elective entry is `available` with a `timing.target.dueOn` set and still outside its urgency lead window | `excused` | `not_due_yet` |
| 6 | Otherwise | **`obligated`** | — |

When more than one disqualifying condition could produce rule 3's reason (a
subject can hold both a dormant entry and a locked-with-no-remedy entry at
once), the reason follows this precedence: `elective_only` (no non-elective
entry exists at all) > `program_unavailable` (candidacy already excluded
these) > `blocked_no_offer` (`lockedRemedy`) > `awaiting_grown_up`
(`dormant`) > `opens_later` (`upcoming`) > `caught_up` (fallback — every
non-elective entry is `completed`, or is backlog-only work with nothing else
to explain the absence of a candidate). The middle four terms mirror
existing code order (`agenda.mjs:155-165`) rather than inventing a new
priority; `elective_only` and the `caught_up` fallback are new, added when
concretizing this table against a real subject holding only elective work,
and against a subject whose required course finished on an earlier day with
nothing new offered today.

Plus one synthetic row, evaluated once per learner rather than per subject:
if `plan.errors` is non-empty (a parent-authored `courseId`/`unitId` typo that
`planLearnerWork` could not resolve into any entry — `planner.mjs:97-99,105`),
add a pseudo-section `{ subject: null, obligation: { state: 'excused',
reason: 'plan_error' } }`. This is a deliberate fail-open-for-the-child,
fail-visible-for-the-parent choice: a misconfigured plan must never cost a
kid their game night, but it must never be silently invisible either — it
always appears in the `excused` list the teacher console reads (§4).

### Why each rule is shaped this way

**Rule 1 counts non-elective passes only, and ignores the focus-day term.**
Two independent fixes bundled into one rule, because they're the same
category of bug (something other than the required course quietly serves the
subject):

- `agenda.mjs:144`'s `subjectPassedToday = list.some((e) =>
  passedTodayIds.has(e.unitId))` counts a pass on *any* entry, including
  electives. If a subject offers both a required course and a
  higher-priority elective (nothing stops an elective from having a higher
  `basePriority` than a required entry — `byEntryPriority` at `agenda.mjs:87`
  sorts on `timingPriority` alone, not on `elective`), a two-minute elective
  pass would serve the subject and excuse the required course indefinitely.
  Obligation must be checked against the subject's non-elective entries.
- `agenda.mjs:150` computes `servedToday` as `(subjectPassedToday ||
  programDone) && !(isFocus && candidatePasses < focusBudget(candidate))` —
  so a focus subject that has completed 1 of its 3 declared urgent blocks
  reads `false`. That term exists to keep printing more of the focus course
  today (the paper should still offer blocks 2 and 3); it must NOT be
  imported into obligation, or an urgent focus day would need three passes
  to satisfy one subject instead of one. Obligation is met at the first
  non-elective pass in the subject; the extra focus blocks stay offered but
  optional for completion.

**Rules 2 and 3 must precede rule 5 (they do, by table order), because both
force `next === null` and would otherwise be misread as "nothing due yet."**
`agenda.mjs:199-204`'s suppression pass and the unavailable-program path
(§2) both null out a section's offer for reasons that have nothing to do
with due dates; a `dormant` or `program_unavailable` section is not "not due
yet," it's "the child cannot act on this at all today," and the console
message must say so.

**Rule 4 is the interface with the sibling design.** Their doc states
explicitly that a closed-but-unfinished module "demotes from *the work* to
*optional catch-up*, and never gates." If a caught-up week doesn't gate the
*agenda*, it cannot gate *completion* either, or a CFM learner who finished
this week's work would be told they're not done because six stale weeks sit
in their backlog. See §7 for the specific signal this needs and why
`timingState` alone can't carry it.

**Rule 5 keys off the urgency window, not the due date itself.** The
alternative — obligate only on the due day — sounds right for "don't nag all
week," but it silently breaks under the existing focus-day machinery (see
below). Keying off `evaluateTiming`'s own `urgent` state instead means: quiet
while `available`, obligated once the parent-tunable `urgencyLeadDays`
brings it into range. A due-Friday assignment authored with
`urgencyLeadDays: 0` or `1` gets exactly the "quiet until Friday" behavior
the household asked for; the schema default of 7 (`timing.mjs:46`) is
correctly tuned for the Advent/Fourth-of-July courses it was designed for and
is left unchanged — assignment authors for short-fuse windowed work should
set `urgencyLeadDays` explicitly, and this is called out as an authoring note
rather than a schema change.

**Why the due-day-only alternative was rejected:** `agenda.mjs`'s focus-block
suppression pass (`agenda.mjs:189-207`) nulls a sibling subject's `next` the
moment an entry goes `urgent`, specifically so the urgent subject can claim
its extra blocks. If obligation only activated on the due day itself, then on
every day BEFORE the due day: the focus subject would be excused by rule 5
("not due yet") and the sibling subjects it suppressed would be excused by
rule 2 — **total obligation across the household would hit zero on exactly
the day the system is concentrating capacity onto a deadline.** Keying rule 5
off `urgent` instead of "is it the due day" closes this: once an entry is
urgent, it obligates, matching the day the suppression pass is actually
active.

## 2. A supporting fix: `agenda.mjs`'s `programUnavailable` scoping

Today, `agenda.mjs:153`:

```js
const next = !servedToday && !programUnavailable ? candidate : null;
```

`programUnavailable` is computed once per subject
(`statuses.some((s) => s.error === true)`, `agenda.mjs:140`) and, when true,
nulls the section's `next` unconditionally — even when the winning candidate
is an unrelated curriculum entry in the same subject as an erroring program.
A subject holding both a language program (erroring) and a math course (live)
currently loses its math ticket too, which is wrong for printing as well as
for completion: the child has real, actionable work and no way to start it.

The fix must exclude only entries belonging to an unavailable program from
candidacy, not gate the whole section's `next` on the subject-level flag —
gating on the flag alone is order-dependent (whichever entry wins priority)
and can still null out the curriculum entry if the erroring program entry
happens to outrank it:

```js
const unavailablePrograms = new Set(
  programs.filter((e) => programStatuses[e.program]?.error).map((e) => e.program),
);
const eligible = list.filter((e) => !(e.program && unavailablePrograms.has(e.program)));
const candidate = [...eligible.filter((e) => e.status === 'in_progress'), ...eligible.filter((e) => e.status === 'available')]
  .sort(byEntryPriority)[0] ?? null;
const next = !servedToday ? candidate : null;
```

A subject whose only entries are the unavailable program (the existing
tested case, `tests/isolated/domain/school/agenda.test.mjs:63-75`) still
yields `candidate === null` and therefore `next === null` — unchanged
behavior for that case, confirmed no existing test asserts the broader
whole-section-blanks-on-any-program-error behavior this fix narrows.

This is a small, targeted change to `planDailyAgenda`, in scope here because
completion's rule 3 depends on it: without it, a subject with a partially
broken program would read `excused (program_unavailable)` even while holding
real, obligated curriculum work.

## 3. Data model: the `obligation` field

`planDailyAgenda` gains one field per section, computed inline where the
supporting facts already exist (`subjectPassedToday`, `candidatePasses`,
`programStatuses`, the full `list` — not derivable from `next` alone):

```js
obligation: {
  state: 'served' | 'excused' | 'obligated',
  reason: string | null,   // populated only when state === 'excused'
}
```

This field is placement-load-bearing: it must be computed inside
`planDailyAgenda`, not reconstructed later from the emitted `section` shape.
Rule 1's non-elective/pre-focus test needs locals that don't survive into the
section object as printed (`subjectPassedToday`, `candidatePasses`), and a
later reconstruction attempt breaks silently the moment `programUnavailable`
or suppression has already nulled `next` — exactly the cases obligation most
needs to get right.

## 4. `completion.mjs` — pure roll-up

New domain module, same house style as `timing.mjs` / `accessGate.mjs`: no
I/O, no clock reads, no persistence.

```js
export function resolveDayCompletion({ sections, planErrors = [] }) {
  const pseudo = planErrors.length
    ? [{ subject: null, obligation: { state: 'excused', reason: 'plan_error' } }]
    : [];
  const all = [...sections, ...pseudo];
  const excused = all
    .filter((s) => s.obligation.state === 'excused')
    .map((s) => ({ subject: s.subject, reason: s.obligation.reason }));

  if (all.some((s) => s.obligation.state === 'obligated')) return { state: 'incomplete', excused };
  if (all.some((s) => s.obligation.state === 'served')) return { state: 'complete', excused };
  return { state: 'no_work_today', excused };
}
```

Three states, deliberately not a boolean:

- **`incomplete`** — at least one subject holds actionable, non-elective,
  same-day-owed work.
- **`complete`** — nothing is owed, and at least one non-elective pass (or
  program `doneToday`) happened today.
- **`no_work_today`** — nothing is owed and nothing was served: an empty or
  fully-excused plan (a Saturday, a learner ahead of every course, a plan
  that errored on every entry). Exists specifically so an empty/broken plan
  cannot read as `complete`, and so consumers can tell "finished real work"
  apart from "had nothing to do" (§6).

`excused` is always returned, regardless of state — a `complete` day can
still carry an `awaiting_grown_up` entry for a dormant subject, and that
must reach the teacher console even though it didn't block the child.

Purely derived, no persistence, no latch: completion is recomputed on every
read from the same inputs `BuildAgenda` already reads, and it can flip
between states within a day (e.g. new work unlocking at 4pm reopens
`complete → incomplete`). This was an explicit choice, not an oversight: a
latch would let an already-earned unlock survive a later problem, but it
would also mean a grown-up who adds urgent work mid-day can't have it count
until tomorrow. The risk a latch would guard against — a transient launcher
error revoking an earned unlock — is instead closed structurally: rule 3
excuses `program_unavailable` rather than treating it as newly obligated, so
a flapping launcher cannot flip a `complete` day back to `incomplete`.

## 5. Application layer

### `GetLearnerDayCompletion` (new use case)

Reads the same inputs `BuildAgenda` already reads (assignment, units,
sessions, program statuses) via `planLearnerWork` + `planDailyAgenda`, then
calls `resolveDayCompletion`. A separate use case, not a method on
`BuildAgenda`, because completion is a status read — called far more often
than paper is printed (every kiosk unlock check vs. once per scan) — and must
never trigger `BuildAgenda`'s side effects (`ensureSession`, token minting).
`BuildAgenda` may call this internally to decorate its own return value
rather than duplicating the fold.

No caching or memoization layer: the read cost is identical to what
`BuildAgenda` already pays per build today, and adding a cache ahead of a
demonstrated hot path is scope this design doesn't need.

### `CloseSessionOutcome` gains one new publish (small, additive)

Verified against the just-landed Glossika integration
(`f1d40e127`, `feat(school): integrate Glossika daily study`): no bus event
exists today for "a session settled." `CloseSessionOutcome` has no
`eventBus` dependency; the only live School bus topic,
`school.language.day-complete` (`LanguageStudyService.mjs:183`), is an
upstream dispatch trigger consumed by `CloseLanguageDay`, not a
settled-fact notification. `CloseLanguageDay.mjs:64` funnels every language
day through the same `closeSessionOutcome.execute(...)` ordinary curriculum
closes use, so the fix is one new optional dependency on
`CloseSessionOutcome`, following the existing optional-degrade pattern
(`reviewQueue = null`, etc.):

```js
constructor({ /* existing deps */, eventBus = null } = {}) { /* ... */ }
```

and one unconditional `this.#eventBus?.publish('school.session.outcome-recorded',
{ learnerId, sessionId, unitId, result, at: nowIso })` call inside `#settle`,
regardless of pass/fail — a fail settle won't move any section's
`obligation`, so the bridge's own transition-only guard (below) filters it
out for free; no need to special-case it here. This covers curriculum and
language uniformly: the bridge subscribes to exactly this one topic and
never needs to know `CloseLanguageDay` exists.

### `SchoolCompletionBridge` (new, same shape as `DoNowSchoolBridge`)

Subscribes to `school.session.outcome-recorded` (above), recomputes via
`GetLearnerDayCompletion`, and publishes `school.completion.changed`
**only on an actual state transition** (never on every recompute, so a
flapping launcher or a rapid sequence of passes doesn't spam the bus).
Payload:

```js
{ learnerId, state, previousState, at }
```

Following `DoNowSchoolBridge`'s established pattern: an explicit discriminator
on the inbound event (not shape-matching), and ownership verified by a real
lookup before acting.

Completion truth never depends on the bridge having fired — exactly the
constraint the Glossika design states for its own `servedToday` reads
(§5.4 of that doc): any consumer can call `GetLearnerDayCompletion` directly
at any time and get the same answer the bridge would have published. The
event is a push convenience for subscribers that don't want to poll, never
the source of truth.

## 6. Consumer contract

Documented here; each consumer enforces it independently, since they are
separate subsystems this design does not own:

| Consumer | Honors |
|---|---|
| Piano-kiosk games unlock | `complete` **or** `no_work_today` |
| Coins / economy reward | `complete` **only** |
| Teacher console "today" view | reads `excused` regardless of state |

The `no_work_today` branch on the games unlock is deliberate, not a
loophole: without it, a learner who has finished every assigned course reads
`caught_up` on every subject → all excused, nothing served → perpetual
`no_work_today` → permanently locked out of the reward a peer doing one
lesson a day earns nightly. Restricting coins to `complete` only closes the
matching farm case: nobody earns money for a day with nothing assigned.

The `caught_up` reason surfacing in `excused` is itself an actionable signal
for the console — "Milo has run out of assigned work" — distinct from
`awaiting_grown_up`, which means a plan entry is frozen and blocking
progress.

## 7. Contract with the `dated_modules` design

Rule 4 needs a signal that a non-elective entry is optional backlog, and that
signal must be **durable against an open session**. The obvious candidate,
`next.timingState === 'catch_up'`, is not safe: `planner.mjs:262`
re-evaluates timing with `inProgress: true` the moment a session is open, and
`timing.mjs:172` unconditionally returns `state: 'in_progress'` regardless of
what the underlying timing record says. A child who has *started* a backlog
worksheet would read `in_progress`, miss rule 4, and fall through to rule 6 —
obligated — which directly contradicts the sibling design's "never gates."

What this design needs from that one: a field that survives the in-progress
overwrite — e.g. a `next.timing?.mode === 'catch_up'` (or equivalent) set at
materialization time and never touched by `evaluateTiming`'s `inProgress`
branch, or confirmation that `timingRank > 0` is preserved through it. This is
raised as an open dependency to resolve with that workstream before either
side ships, not assumed.

## 8. Deferrals

- **Course-internal windowed throttling.** A weekly assignment living inside
  a sequential course (rather than as standalone work) needs the course to
  cap its own unit-yield per period so passing Monday's item doesn't unlock
  next week's on Tuesday. This is cursor mechanics, not completion calculus,
  and is out of scope here (§0).
- **`missed_target` and `dueOn` rendering.** Both are produced by
  `evaluateTiming` today and consumed nowhere — no document, no frontend
  surface. Rule 6 (fall-through obligation) already covers a `missed_target`
  candidate correctly for completion purposes (it keeps `status: 'available'`
  and reaches candidacy), so completion does not depend on this being fixed.
  Worth a follow-up so a parent can actually see "aspirational target missed"
  on paper, but it's presentation work, not state-machine work.

## 9. Tests

**Domain (`completion.test.mjs`):**
1. Each of the 6 rules in isolation, using hand-built section fixtures.
2. Cram-day case: an urgent focus entry plus its suppressed siblings still
   yields `incomplete` overall (not a false `complete`/`no_work_today` from
   zero obligated sections).
3. Elective-farming: a same-day elective pass does not serve a subject whose
   required entry is untouched.
4. `plan.errors` non-empty → `plan_error` pseudo-section present in
   `excused`, and does not by itself force `incomplete`.
5. All-subjects-`caught_up` → `no_work_today`, not `complete`.
6. A dormant subject's reason (`awaiting_grown_up`) appears in `excused` even
   on an otherwise `complete` day.
7. A subject holding only elective entries (no non-elective entry assigned at
   all) excuses with `elective_only`.
8. A subject whose required course finished on an earlier day, with nothing
   new offered today, excuses with `caught_up` — and this reads `complete`
   or `no_work_today` overall (per the consumer contract, §6), never
   `incomplete`.

**Domain (`agenda.test.mjs` additions):** the `programUnavailable` scoping
fix (§2) — a subject with an erroring program AND a live curriculum
candidate offers the curriculum candidate as `next`; the existing
program-only-error test (`agenda.test.mjs:63-75`) continues to pass
unmodified.

**Application (`GetLearnerDayCompletion.test.mjs`):** produces the same
`obligation`/completion result `BuildAgenda` would compute for identical
inputs — no drift between the print path and the read path.

**Application (`CloseSessionOutcome.test.mjs` addition):** `#settle`
publishes `school.session.outcome-recorded` when an `eventBus` is supplied,
on both pass and fail, and is a no-op (no throw) when `eventBus` is omitted.

**Application (`SchoolCompletionBridge.test.mjs`):** publishes only on an
actual state transition, not on every recompute; idempotent under a
duplicate upstream event (mirroring `DoNowSchoolBridge`'s ownership-filter
test style); fires correctly for a language-day settle routed through
`CloseLanguageDay` as well as an ordinary curriculum close, since both funnel
through the same `CloseSessionOutcome#settle`.

**Cross-workstream:** once §7's durable signal exists on the `dated_modules`
side, one integration-style test: a CFM learner with a completed current
week and a non-empty backlog reads `complete`, not `incomplete`.
