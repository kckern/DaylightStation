# Connect Four hands the child back the game they just lost, forever

**Date:** 2026-09-01
**Reported by:** Learner A — "I kept trying to play but it just kept saying you lose"
**Surface:** Piano kiosk (yellow-room tablet), Games → Connect Four
**Affected:** `learner-a` (2026-09-01, 10 phantom losses), `learner-b` (2026-08-31, 7 phantom losses)
**Status:** root cause found, fixed, regression test added, phantom records scrubbed.

---

## What the child saw

A finished, lost board that would not go away. Pressing a key raised the match
gate, he played a scale, passed it — and landed back on the *same* lost board,
with the same "Mew wins — the four red discs are lit up". Ten times. Leaving to
the game picker and coming back produced the same lost board. The only escape
was to open a different game.

Two episodes, 2h20m apart, on one stale board:

| Time (UTC) | What happened |
|---|---|
| 17:58:16 | Enters Connect Four, passes the gate, plays a real game |
| 18:03:28 | **Real** loss, 32 plies, level 7 — the last honest event in this story |
| 18:03:49 | Remount → `game.over loss plies:32` **0.5s after mount** |
| 18:03:51 | Any-key → `piano.game-rematch` → gate → scale → pass |
| 18:04:06 | Remount → same 32-ply loss. Repeat ×6 through 18:08 |
| 18:08:11 | Gives up, exits to Side Scroller |
| 20:21–20:25 | Comes back. Same ply-32 ghost. Four more times. Gives up. |

Learner C played a clean Connect Four game at 19:42 in between, because the stale
state is keyed per user.

## Root cause

Connect Four's transcript is not component state. It lives in a checkpointed
local authority, and the live session id is kept in
`localStorage['gaming:piano-connect-four:active:<userId>']`. Every mount
**resumes** that id (`useConnectFourAuthority.js`, `start({ fresh: false })`).
That is right for a reload mid-match; it was never guarded against a *finished*
session.

The only code that clears the index is `reset()`. At a gated match boundary,
`reset()` never runs — deliberately. Both `useMatchRematch` (`host/useMatchRematch.js`)
and `useAddressedBoardGame.restart` return early when `gate.armed`, on a premise
stated in their own comments:

> "the host unmounts the game and mounts the challenge, and the next match
> arrives as a REMOUNT with fresh state of its own"

For a game whose transcript is in `localStorage`, the second half of that
sentence is false. The remount re-resumed the terminal session, so:

1. `replayGame({ moves })` produced the finished, lost board;
2. `result` was non-null on the first render, so `useAddressedBoardGame`'s
   save effect fired and filed the loss **again**, ranked;
3. the result overlay said the opponent won;
4. any key → `requestRematch()` → gate → pass → remount → back to (1).

`useAnyKeyToContinue` fires at most once per enable, so between remounts the
board was completely inert — a key press did nothing visible at all. That is the
"stuck" part of "stuck in a loop".

### Corroborating detail: the phantom losses are filed at the wrong rung

`game.over` fires ~150ms *before* `game.ladder-loaded` resolves, so every
phantom report carried `level: 1` while the child's real ladder position was
level 7. That is the on-disk fingerprint of a phantom record.

### Blast radius: all three checkpointed board games

`useChessAuthority.js` and `useCheckersAuthority.js` are the same hook with a
different ruleset — same index key shape, same unguarded resume. The regression
test added with this fix failed for all three before the change. Only Connect
Four has damaged data, but chess and checkers were one gated rematch away.

## Fix

`isResumableSession(session)` in
`frontend/src/modules/Gaming/platform/authority/createCheckpointedLocalAuthority.js`
— a session whose `header.status` is `complete` or `abandoned` is not something
a player can be handed back. The kernel refuses every command on a terminal
session (`runtime.mjs`: "Session … is complete"), so a resumed one was not even
playable; a fresh game is the only honest answer.

All three hooks now consult it before adopting a resumed session, and drop the
stale index entry when they don't.

Regression test: `frontend/src/modules/Piano/game-platform/host/matchBoundaryResume.test.jsx`
— four cases. Connect Four is driven through the real production path (play a
real winning line, unmount, mount again); chess reaches checkmate by fool's
mate; checkers asserts the same invariant against a terminal session left in the
index. The fourth pins the half of the contract the fix must not break: an
**unfinished** board still comes back on the next mount.

## Data damage

17 phantom records, identified by the signature `completed < 13s after its own
session id was minted`, all `level: 1, ranked: true`, all Connect Four:

| User | Date | Records | Transcript |
|---|---|---|---|
| `learner-a` | 2026-09-01 | 10 | the same 32-move loss |
| `learner-b` | 2026-08-31 | 7 | the same 16-move loss |

Each has a matching entry in `household/gaming/log/connect-four/<day>/`.

**The ladders do not need repair.** Rebuilding each child's `series` from their
real records only yields five losses either way — both genuinely have a losing
streak in their recent honest history. Removing the phantoms changes the record
count and the archive, not either child's ladder position.

Separately worth noting: `learner-b` sits at `unlocked_through: 1` with five real
losses. That is difficulty tuning, not this bug.

### Scrub, 2026-09-01

All 17 records and their 17 archive entries deleted on prod. `learner-a`'s Sept 1
now holds exactly one Connect Four game — the real 18:03:29 loss — and the
2026-08-31 archive day is empty, correct, because every entry in it was a
phantom (`learner-b`'s real 16-move game was 2026-08-29). Ladders untouched.
Copies of all 34 files are in `/tmp/c4-phantom-backup` on the homeserver until
its next reboot.

## Follow-ups

1. **`game.over` races `ladder-loaded`.** Every terminal report is filed with
   whatever `level` happens to be resolved at that instant, which is `1` on a
   fresh mount. A result should not be recorded before the ladder it is being
   recorded against is known.
2. **The "fresh mount" premise is undocumented and load-free.** Three separate
   comments assert that a remount gives a game fresh state. Nothing enforces it.
   A game that persists anything across mounts silently breaks the match gate;
   `isResumableSession` fixes the three that exist, not the next one.
3. **A phantom result is silent.** Ten ranked losses were written for one game
   with no warning anywhere. `useAddressedBoardGame` could refuse to file a
   result for a match whose first render was already terminal, and log it.
