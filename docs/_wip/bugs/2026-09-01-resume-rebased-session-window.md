# A mid-workout reload rebased the session and split its data three ways

**Date:** 2026-09-01
**Surface:** Fitness session recording (resume/hydration)
**Status:** Root cause fixed; two of three symptoms repaired, one irrecoverable
**Evidence session:** `20260901154746`

---

## What happened

One kiosk reload during a 94-minute workout produced a session that disagreed
with itself in three places at once:

| | recorded | actual |
|---|---|---|
| session window | 16:09:51 → 16:29:26 (20 min) | 15:47:43 → 17:21:16 (94 min) |
| Insanity media event | two halves, 0 min each | one play, 37 min |
| `<learner>:rings` series | 235 ticks, ends at 721 | ~1120 ticks, total 2002 |

Only the treasure-box total (2002) and the media events' absolute timestamps
came through whole. Everything indexed by tick, and the window itself, were
rebased to the moment of the reload.

## Root cause

`_hydrateFromSession` took the session's start from a numeric `startTime`:

```js
this.startTime = typeof sessionData.startTime === 'number' ? sessionData.startTime : now;
```

A **v3** record does not carry that field. `dehydrateSessionRecord` guards the
assignment on `!hasV3Session` — a v3 record carries its window as
`session.start`/`session.end` wall-clock strings instead. So every v3 resume
fell through to `now`, silently, and started a fresh timeline there.

The same fallback governed the resume gap, which defaulted to
`startTime + (durationMs || 0)` — also absent on v3, so the gap was measured
from `start + 0`.

Media events survived because they carry absolute epoch timestamps and never
consult the session window.

## Fixed

`FitnessSession._hydrateFromSession` now reads `session.start`/`session.end`
when the numeric fields are absent, and warns (`fitness.resume.window_unknown`)
before ever falling back to `now`, since that fallback discards history.

`PersistenceManager` also rejoins media halves at consolidation
(`rejoinSplitMedia`) — both halves are present there, because hydration restores
the prior events.

## Repaired on disk

- `fitness media pair-orphans` — rejoined the split play and folded the
  duplicate `summary.media` entries it left behind. 2 sessions in 314 had split
  halves; 3 had the duplicate summary entry.
- `fitness session repair-window` — restored the window. Only **1** session
  qualified, because the repair demands that the session id (which is its start
  time, written once and never rebased) agrees with the earliest event AND that
  the stored start is *later* than the id. Direction matters: an earlier stored
  start is a merge or a hand edit, and "repairing" it would move the start
  forward and discard real minutes — a 2026-02-03 session would have lost 18 of
  them to a looser rule.

## Not repairable

**The truncated ring series.** The ~74 minutes of ticks before the reload were
never persisted; there is nothing to restore them from. The surviving
authorities disagree for that session and will continue to:

- `treasureBox.totalRings` = 2002 — the whole workout, correct
- `summary.participants.<learner>.rings` = 721 — the post-reload segment only

The header reads the treasure box, so the number a person sees is right. The
per-participant figure understates, and is left alone rather than reconciled:
inventing 2002 there would assert a precision the data does not have.

## Adjacent finding, not investigated

A scan of 2,681 single-participant sessions found **19** where the participant's
ring total disagrees with the session total by more than 2%. They fail in *both*
directions — four 2026-03 sessions record participant rings against a session
total of 0, while others (including this one) record the opposite. That is at
least two more distinct defects, and a blanket reconciliation would bury them.
Worth its own pass.

## Left fragmented on purpose: `20260616185313`

The other session with orphaned halves carries **five** events under one
`contentId` (Mario Kart Arcade GP) — four with a `start` and no `end`, one with
an `end` and no `start`, and the first of them with an `end` that precedes its
own `start`.

`pair-orphans` declines it, correctly. Four open starts cannot be told apart:
either the game was played four times, or it survived four reloads in one
sitting, and the two readings differ by more than an hour of attributed time.
Joining the earliest start to the only close would invent a span longer than any
play the data can evidence, which is the failure the guard exists to prevent.

It stays fragmented until someone who remembers that evening can say which it
was. The end-before-start on the first event is a separate corruption and has
not been traced.
