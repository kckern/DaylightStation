# Chess: an opponent's move was accepted, lost, and never asked for again

**Date:** 2026-09-18
**Surface:** piano kiosk — chess board game
**Reported from:** live observation at the piano, then the log store

A learner played `c4` (ply 7). The opponent computed a legal reply, `Qxd4`.
The board never advanced. For the next ten minutes every square he touched
came back `not_your_turn` at ply 7, while the rail told him *"Your opponent is
thinking."* He changed `opponent_delay_ms` nine times, toggled fullscreen twice
and pressed the same two squares over and over. Then he left the game:
`chess.history.archived {"ended_by": "left", "moves": 7, "completed": false}`.

---

## What the logs say happened

| time (UTC) | event |
|---|---|
| 01:39:18.799 | `chess.move {color: w, ply: 7, san: c4}` |
| 01:39:19.682 | `chess.move.requested` — the opponent turn goes out |
| 01:39:52.051 | `opponent-replied {san: "Qxd4", engine: "homegrown"}` |
| — | **no `chess.move` for ply 8, ever** |
| 01:39:53.031 | `chess.rejected {ply: 7, reason: unrecognised_chord}` |
| 01:40:23 → 01:44:10 | `pickup` → `chess.rejected {ply: 7, reason: not_your_turn}`, repeatedly |
| 01:49:50 | `chess.history.archived {ended_by: left, moves: 7}` |

The turn before it, ply 6, is the control: `opponent-replied` at 01:38:59.044
followed by `chess.move {ply: 6, san: Qxd5}` 193ms later. The difference is one
missing log line, and that line is the board advancing.

---

## What is established

**The move was accepted by the authority.** Every refusal path in
`shared/gaming/kernel/runtime.mjs` THROWS — idempotency conflict, revision
conflict, terminal session, and `if (!result || result.error) throw new
GamingKernelError('rule_rejected', ...)`. The chess ruleModule returns
`{error: {code: 'illegal_move'}}`, which the kernel converts to a throw. A
throw would have rejected `commitAuthorityMove`, rejected `onReply`, and been
logged by `useOpponentReply` as `opponent-reply-commit-failed`. There are zero
such rows. And `opponent-replied` is logged *after* `setGame`, so the await
resolved.

**So `setGame` was called with a ply-8 state and the board did not keep it.**

**The stall is permanent by construction.** `useOpponentReply`'s effect depends
on `[enabled, resetKey]`. When a reply is consumed without advancing the board,
neither changes, so the turn is never requested again. `opponentError` is only
set on the `unrecoverable` branch (no legal move), so the Retry button that
already exists at `PianoChessGame.jsx` stays hidden. The one control that could
have saved the game was invisible for exactly the failure that needed it.

**The rewind left no trace by design.** `chess.move` is logged from
`useChessAddressingProgress`, whose effect opens with

```js
if (cursor.gameId !== gameId || game.history.length < cursor.length) { …; return; }
```

— a silent branch. A board that goes 7 → 8 → 7 logs nothing going in and
nothing coming out.

## What is NOT established — the root cause is open

Which writer lost the ply-8 state. Four hypotheses were tested against the
evidence and all four are eliminated:

1. **The request stalled and a guard fired.** No — `OPPONENT_STALL_MS` would
   have logged `opponent-stalled`; zero rows, and `opponent-replied` only logs
   on the success path.
2. **The kernel refused silently.** No — every refusal throws (above).
3. **`projectAuthority`'s deps churn each turn and re-projected a stale
   session.** No — `scheme` in its dep list is a PROP with a default, not the
   per-turn shuffled scheme (`schemeForPly` is applied inside state), so its
   identity is stable across turns.
4. **The authority was re-keyed mid-game and resumed a stale checkpoint.** No —
   `lockedUser` comes from `useChessSessionIdentity`, whose session is state
   initialised once and changed only by `beginNextGame`, so `indexKey` and
   `start` are stable within a game.

Three `setGame` writers are live around an opponent reply and none of them
records the ply it wrote. Closing this needs instrumentation, not another
reading of the same files — which is what the fix below adds.

---

## Fix

**The board gets its own watchdog.** `useOpponentReply` guards a request that
never settles; nothing guarded a request that settled, committed, and still
left the board on the opponent's turn. `useChessOpponentTurn` now keys a timer
on the ply the opponent owes (`OPPONENT_WAKE_MS`, 20s — longer than the think
ceiling plus `OPPONENT_STALL_MS`, the longest an honest turn can take). It
re-asks once on its own, which ends most stalls before a child notices, and
then reports `opponent-board-stalled` and exposes the state.

**The wake control is on screen when it is needed.** A `Wake <opponent> up`
button renders on `opponentStalled` rather than on `opponentError`, so it is
present for the failure that never sets an error. It bumps the same reply nonce
`retryOpponent` does — a changed `resetKey` re-runs the reply effect — and logs
`opponent-woken` so a child having to press it is a countable event.

**The rail stops lying.** `promptFor` says "Your opponent has gone quiet. Wake
them up to carry on." once stalled, instead of continuing to assert thinking.

**A rewind announces itself.** The silent branch now logs
`chess.history-rewound {from, to, gameId}` when the SAME game's history
shrinks — a new game still resets the cursor quietly, and a takeback has its
own event. The next occurrence will name itself instead of being reconstructed
by hand.

## Follow-up

`opponent-board-stalled` and `chess.history-rewound` are the two rows to watch.
One without the other says the reply never arrived; both together say the reply
arrived and was overwritten, which is the open question above and would finally
localise it.
