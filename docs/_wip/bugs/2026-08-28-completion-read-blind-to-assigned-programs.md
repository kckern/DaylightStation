# The completion read could not see assigned programs, so two children could never be gated

**Date:** 2026-08-28
**Found by:** field observation — a learner switched profiles on the piano kiosk
and the Games menu stayed open; then finished a piano lesson and nothing moved
**Status:** FIXED (`assignedPrograms: true`), with regression tests. One
consequence deliberately left open — see `## The divergence this creates`.
**Severity:** the schoolwork gate on piano games was structurally inoperative
for the two learners whose entire curriculum is assigned programs.

---

## What was observed

Two complaints on the same afternoon, which turned out to be one defect seen
from both sides.

1. On the piano kiosk's Games menu, switching the profile to a learner who had
   **not** finished the day's work left the Games menu open. Expected: a gated
   learner is bounced out.
2. Later, that learner **finished** his piano lesson on the kiosk — and the
   Portal still showed him as not done. The suspicion was that the completion
   event had failed to emit to `SchoolApp`.

Neither the kiosk nor the event pipeline was at fault. Both are the same
upstream blindness.

---

## The completion event fired perfectly

Worth settling first, because it was the initial suspicion. The full chain is in
the log store at 17:41:42, every link present:

```
17:41:42.487  evidence written    piano-lesson:alan:plex:695607, verified, completions: 1
17:41:42.662  school.piano-ceremony.satisfied    [backend]  courseId plex:695598, "Meet the Quarter Note"
17:41:42.854  school.scan.piano-lesson-complete  [FRONTEND, Portal UA]  "Piano done!"  tone: success
17:41:42.883  school.piano_lesson_hook.fired     [backend]  result: satisfied
```

That third line is `SchoolApp` on the Portal receiving the broadcast and
rendering the ceremony. The evidence file on disk confirms the write landed:

```yaml
evidenceId: piano-lesson:alan:plex:695607
verification: verified
learning: { subjectId: arts, courseId: plex:695598, unitId: '695598' }
measures: { engagements: 1, completions: 1 }
source: { surface: piano-kiosk, transport: playback }
```

**Nothing failed to emit.** What failed is that none of it moved the number
anybody was looking at.

---

## Root cause

`GetLearnerDayCompletion` asked `PlanProjection` for a narrower projection than
the agenda gets, and one of the three narrowing flags was `assignedPrograms: false`.

`PlanProjection` appends program enrollments — story time, flashcards, a piano
course — as plan entries, and **an appended entry becomes a SECTION, and a
section is the only thing a day can be judged against.** With the flag off, a
learner's programs contribute nothing.

Two of the four learners have plans that are *entirely* programs:

```yaml
# school/plans/learners/alan.yml
enrollments: []          # ← no courses at all
programs:
  - programId: story-time     target: 2   subject: english
  - programId: piano-course   courseId: plex:695598   subject: arts
```

So their day projected to **zero sections**. `resolveDayCompletion` folds zero
sections to `no_work_today` — and `useSchoolGameAccess` treats `no_work_today`
as an unlock, exactly as it treats `complete`:

```js
const UNLOCKED_STATES = new Set(['complete', 'no_work_today']);
```

Measured on prod before the fix:

| learner | plan shape | completion state | games |
|---|---|---|---|
| alan | programs only | `no_work_today` | **always unlocked** |
| soren | programs only | `no_work_today` | **always unlocked** |
| milo | course enrollments | `complete` | correctly gated |
| felix | course enrollments | `complete` | correctly gated |

Both observations follow directly:

- **Observation 1** — the kiosk was told he was unlocked, and behaved correctly.
  He could not have been gated on any day, by any amount of unfinished work.
- **Observation 2** — his completion state was byte-identical before and after
  the piano lesson, because the section that evidence would have served did not
  exist. Finishing the work had no observable effect anywhere.

The gate worked for Milo and Felix, which is why this survived to the field: the
two learners it was broken for are the two whose curriculum has no courses in it.

---

## It was a known deferral, and the deferral was the mistake

This was not an oversight. `GetLearnerDayCompletion`'s header named the exact
consequence and chose to postpone it:

> "appending assigned programs would add a flashcards or **piano-course**
> section that has to be finished first, so games unlock LATER. Both are
> household-visible changes to a reward a child can feel, in opposite
> directions, and neither belongs in a refactor. Deciding them is a separate,
> reviewable change to completion semantics."

The reasoning is sound for a refactor. What it missed is that `false` was not a
neutral holding position — it was itself a household-visible behaviour, and the
worse one. A refactor that preserves behaviour byte-for-byte still ships a
decision when the preserved behaviour is wrong.

---

## The fix

`assignedPrograms: true` in `GetLearnerDayCompletion.execute()`.

**Safe there because that use case has launchers.** Composition wires it with
the full `launchers` map, so an appended program entry fans out to a real
status rather than an empty one.

Direction of change, stated plainly: **games now unlock LATER** for a learner
who holds a program. That is the intent. A reward gate that cannot see a child's
only assignment is not a lenient gate; it is not a gate.

### Regression tests

`tests/isolated/application/school/getLearnerDayCompletion.test.mjs` had no
programs-only case at all — every existing test gave the learner `courses`.
Two added, pinning both directions:

- a learner whose only work is an **unfinished** program → `incomplete`, and
  explicitly *not* `no_work_today`
- the same learner once it is **done** → `complete`

Both were verified to FAIL against the old flag before the fix was restored —
`expected 'no_work_today' not to be 'no_work_today'`. A gate that is always
closed would be as wrong as one always open, which is why the second test exists.

---

## The divergence this creates (deliberate, not yet closed)

`CloseSessionOutcome` — the worksheet receipt — passes the same three flags, and
its comment claimed the two together were "the household's one canonical notion
of a finished day, the same one that gates the piano-games unlock." **That is no
longer true**, and it cannot simply be flipped to match:

that use case is wired with **no launchers** and pins `programStatuses: []`, so
appending program entries there would make every program subject look
permanently unserved and no receipt would ever say "done".

The divergence has a direction. The receipt now sees FEWER sections, so it is
the more **optimistic** of the two. Concretely: a child can finish a worksheet,
get a receipt saying they are done for the day, and still find piano games
locked because a program they have not finished is invisible to the receipt and
visible to the gate.

That is the safe direction — nothing unlocks early — but it is an inconsistency
a child can notice. Closing it means wiring `CloseSessionOutcome` with launchers
so it can honestly fan out, which is a larger change than this one. The comment
at its `#projectPlan` now says so rather than asserting a parity that has lapsed.

---

## Two things this did NOT fix

1. **A gated learner is still not bounced out of Games.** `Games.jsx:42-58`
   renders a lock panel *in place* and never navigates. Switch to a gated child
   while deep in `/piano/games/chess` and you stay on that URL reading "Games are
   locked". The original request was a bounce to the main menu; that is still
   unimplemented, and is now reachable for the first time — before this fix,
   these two learners could never reach the locked state at all.

2. **`school.piano-progress.record-failed` storms on every backend boot.**
   ~35 error-level lines per learner (milo, felix), all of the form
   `School learning evidence 'piano-lesson:milo:plex:676039' conflicts with its
   first write`. A boot-time backfill re-writing evidence that already exists
   and losing an idempotency check — ~70 error lines per restart, drowning the
   log store. Pre-existing and unrelated to this defect, but it should not stay.

---

## Observability added

The kiosk-side hook logged **only on read failure**, so a successful read that
*unlocked* games left no trace — the exact case that mattered here. Nothing in
the store could say whether the gate had been consulted, what it answered, or
for whom.

`piano.school-access.verdict` (`learnerId`, `state`, `unlocked`) now fires on
every change of verdict, edge-triggered so the 15-second refresh does not write
~240 lines an hour per kiosk. `state` is the field that earns its place:
`no_work_today` and `complete` both unlock, and telling them apart is the
difference between "they finished" and "the gate cannot see their work".

**A hazard found while adding it, worth recording.** The first version of that
call sat inside the fetch's `try` — the same `try` whose `catch` sets
`status: 'error'`, which *locks* games. A logger that threw (a transport not yet
ready, a child logger missing a level) would have locked a child out of a reward
they had earned, for a reason having nothing to do with them. It is wrapped now.
The suite did not catch it because the test's logger double carried only `warn`;
that double now carries both levels the hook uses. **A logging call must never
be able to change the answer it is observing** — and instrumentation added in a
hurry is exactly where that rule gets broken.
