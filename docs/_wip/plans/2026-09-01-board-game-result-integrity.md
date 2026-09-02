# Board Game Result Integrity Implementation Plan

**Status: EXECUTED 2026-09-01.** Merged to `main` as `bb5738ba3`. Recovered
after the original was lost — it was never committed, and `main`'s history was
rewritten concurrently by another session that same afternoon. This version
records what was planned *and* what actually happened, because the difference is
the useful part.

**Goal:** Close the three follow-ups left open by the Connect Four rematch loop —
a result must never be filed for a match this component did not play, never be
filed against a ladder rung that isn't known yet, and no future game may ship an
unguarded session resume.

**Background:** `docs/_wip/bugs/2026-09-01-connect-four-rematch-resumes-lost-game.md`

**One correction to the original plan's premise.** It described
`useAddressedBoardGame` as "the single place every ranked board game files its
result". That is wrong. Only `PianoCheckers` and `PianoConnectFour` use it.
Chess files through `PianoChessGame/useChessPersistenceLifecycle.js`, which has
its own one-shot, its own abandon archive, and takes `ladderLevel` as a prop —
so Tasks 1 and 2 below harden **two** games, not three. Task 3 does cover chess,
because it governs the authority hooks. Chess is tracked separately.

---

## Task 0 — Land the prerequisite fix

The `isResumableSession` guard (a session whose `header.status` is `complete` or
`abandoned` is never handed back to a player) had to be a commit before anything
could build on it.

**What actually happened:** a parallel session committed the same fix
independently while this was being staged, and its commit message contained a
child's real first name. The pre-commit PII guard scans diffs but not messages,
so it went through. That session later rewrote history to scrub it and added a
push-time guard. **Lesson worth keeping: in a shared checkout, check whether the
work you are about to commit has already landed.**

---

## Task 1 — Refuse to file a result this component never played

**Files:** `frontend/src/modules/Piano/game-platform/families/addressed-board/useAddressedBoardGame.js`,
`useAddressedBoardGame.result.test.jsx` (new), `useAddressedBoardGame.test.jsx` (corrected).

**The discriminator:** a match that played out in this component passes through
every ply but its last while `result` is still null. A transcript that arrived
already finished never does. Track the high-water mark of `moves.length`
observed while playable (`watchedPlies`); refuse when it falls short.

**Planned:** the tracker, the refusal, a warning, and a reset in `restart()`.

**What review changed, and why each mattered:**

1. **A refusal must not spend the one-shot.** The plan had the refusal set
   `savedRef`. `savedRef` means "this session's result has been FILED"; a
   refusal files nothing, so closing the one-shot meant the next genuinely-played
   game silently never filed.
2. **The same guard belongs on the unmount abandon archive** — otherwise a
   phantom refused on the save path just gets written as `completed: false`
   instead. Trading one junk row for another is not a fix.
3. **The existing restart test was pinning a bug.** Its sequence never passed
   through a playable render after `restart()`, so the two `saveGame` calls it
   asserted were a real loss plus a **duplicate under a fresh session id** — and
   the genuinely-played next game had never filed at all, before this branch.
4. **The `refusedRef` test was hollow.** Its rerenders passed the same `moves`
   array reference, so the save effect never re-ran and the repetition path was
   never entered. Mutation proved it: gutting the dedupe left the suite green.
5. **The warning cried wolf.** Every ordinary "Play again" on the non-gated path
   commits one stale-terminal render, so the incident-grade signal fired on a
   routine action.
6. **Final shape (`5c8ab0c9e`), and the best idea in the task:** rather than
   special-casing the rematch, make a **restart take effect at the next playable
   render** instead of immediately. The stale-terminal renders then fall through
   the `savedRef` early-return that already existed, an entire mode disappears
   from the state machine, and every surviving refusal is unambiguously an
   incident.

**Contract this establishes:** ONE PLY PER COMMIT. Both current consumers hold
to it because the engine's reply is dispatched from an effect keyed on committed
state. A future game that commits a player move and an engine reply in the same
render loses its results whole — pinned by a test named as a known limitation.

---

## Task 2 — Never file a result against an unknown ladder rung

**Files:** the same hook and its result test.

`level` is `ladder?.unlocked_through ?? config.default_level ?? 1`, and the
ladder arrives from an HTTP call fired at mount. `game.over` beat
`game.ladder-loaded` by ~150ms, which is why all 17 phantom records read
`level: 1` while the children were really on rung 7. Gate filing on the ladder
read having **answered** (not on it having succeeded), with a 5s fail-open.

**The regression this introduced, found by the implementer before review:**
deferring leaves `savedRef` false, so a component unmounting inside the window
ran the abandon cleanup, whose strict guard **refused a match played honestly to
the end** — no record at all. Reachable in production because the match gate
unmounts the game on "play again". Before the gate that scenario produced a
record at the wrong rung; after it, no record. Fixed by flushing a pending
result on the way out (`262de064d`).

**The critical bug review found in that flush (`a19f31dcb`):** the deferred
closure read `ranked`, the archive context and `userId` **live from refs** rather
than snapshotting them. `restart()` resets `rankedRef` to `true` before the
flush runs — so an offline practice game could file as `ranked: true`, advancing
the ladder on engine help, which is exactly what the hook's own comment forbids.
The trigger condition is a dead network, which is also what hangs the ladder read
in the first place. Fixed by snapshotting everything the filing needs into one
explicit object at the moment of deferral.

**Accepted, not fixed:** a deferred result reaches `registerCompletion` up to 5s
late, and the match gate's barrier then reads a `pendingRef` still holding the
*previous* match's settled promise — so it resolves immediately and looks
satisfied when it isn't, leaving `completedGames` briefly stale. Self-corrects.

---

## Task 3 — Make the resume guard impossible to forget

**File:** `frontend/src/modules/Piano/game-platform/host/sessionResumeGuard.test.js` (new).

One bug shipped three times because three hooks were copied from each other. A
source test asserts, **by name**, that every `use*Authority.js` hook in the Piano
tree calls `isResumableSession`. Named rather than counted, because a walk that
only counts loses coverage silently when a file moves.

**What the plan got wrong:** it specified `.includes('isResumableSession')`. That
does not bite — the import line and an explanatory comment both contain the bare
symbol, so gutting the call site left the test green. The check looks for a CALL.
The plan's Step 3 (deliberately break a hook and confirm the test fails) is what
caught this, and is the reason that step exists.

---

## Still open

- **Chess.** Not covered by Tasks 1 and 2. Being assessed separately.
- **Nothing is deployed.** The kiosk runs the build from the homeserver tree.
- **`gameChromeTokens.test.js`** fails on two raw hex colours in
  `boardGameCeremony.scss`. Pre-existing, unrelated, untouched throughout.

## What this plan would do differently next time

Every round of review found something real, and the two most valuable findings
were things no plan could have specified in advance: a test that was pinning a
bug as correct, and a guard that read state live which a sibling function reset
underneath it. Both surfaced because the implementer was asked to **mutation-test
every guard** — break it, confirm exactly one test fails, and confirm it is the
right one. That instruction is worth putting in the plan template rather than
discovering per-task.
