/**
 * A FINISHED GAME MUST NEVER COME BACK ON THE NEXT MOUNT.
 *
 * The three checkpointed board games (chess, checkers, connect four) each keep
 * their transcript in a local authority and remember the live session id under
 * `gaming:piano-<game>:active:<user>`. Every mount resumes that id. The index
 * exists so a reload mid-match hands the player back the board they were on —
 * which is right, and which this file does not disturb.
 *
 * What it does pin down is the OTHER case. At a gated match boundary the game
 * deliberately resets nothing: `useMatchRematch` asks the host, the host
 * remounts the game, and the comments in both that hook and
 * `useAddressedBoardGame` state the premise plainly — "the next match arrives
 * as a REMOUNT with fresh state of its own". For a game whose transcript is in
 * localStorage rather than in component state, that premise was false: the
 * remount resumed the TERMINAL session and the child was handed back the game
 * they had just lost. `useAddressedBoardGame` then saw a non-null result on
 * first render and filed the same loss again, ranked.
 *
 * On 2026-09-01 that cost one child ten phantom ranked losses and ten scale
 * challenges paid to re-enter the same lost board — see
 * docs/_wip/bugs/2026-09-01-connect-four-rematch-resumes-lost-game.md.
 *
 * Connect Four is driven the whole way through the real production path (play a
 * real winning line, unmount, mount again). Chess and checkers assert the same
 * invariant against a session left terminal in the index, which is the state
 * every path — game over, close, an interrupted reset — leaves behind.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { checkersDefinition, checkersRuleModule } from '@shared-gaming/rulesets/checkers/index.mjs';
import { createCheckpointedLocalAuthority } from '../../../Gaming/platform/authority/createCheckpointedLocalAuthority.js';
import { useConnectFourAuthority } from '../../PianoConnectFour/useConnectFourAuthority.js';
import { useCheckersAuthority } from '../../PianoCheckers/useCheckersAuthority.js';
import { useChessAuthority, RESUME_MAX_IDLE_MS } from '../../PianoChessGame/useChessAuthority.js';

const USER = 'test-user';
const ACTOR = 'piano-player';

// Player 1 stacks column 0 four deep while the opponent answers in column 1 —
// a real vertical connect four, adjudicated by the real engine.
const CONNECT_FOUR_WIN = [0, 1, 0, 1, 0, 1, 0];
// Fool's mate: the shortest real checkmate there is.
const FOOLS_MATE = [
  { from: 'f2', to: 'f3' }, { from: 'e7', to: 'e5' },
  { from: 'g2', to: 'g4' }, { from: 'd8', to: 'h4' },
];

beforeEach(() => { window.localStorage.clear(); });

describe('a gated rematch never resumes the finished game', () => {
  it('connect four: the lost board does not come back on the next mount', async () => {
    const first = renderHook(() => useConnectFourAuthority({ userId: USER }));
    await waitFor(() => expect(first.result.current.state).toBeTruthy());

    for (const column of CONNECT_FOUR_WIN) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await first.result.current.play(column); });
    }
    expect(first.result.current.state.status.gameOver).toBe(true);
    expect(first.result.current.moves).toHaveLength(CONNECT_FOUR_WIN.length);

    // The gated boundary: the host remounts the game and the game itself resets
    // NOTHING. Whatever the next mount reads is what the child is handed.
    first.unmount();
    const second = renderHook(() => useConnectFourAuthority({ userId: USER }));
    await waitFor(() => expect(second.result.current.state).toBeTruthy());

    expect(second.result.current.moves).toEqual([]);
    expect(second.result.current.state.status.gameOver).toBe(false);
  });

  // The other half of the contract, and the reason the index exists at all: a
  // match still in progress MUST survive a remount. A guard that threw away
  // every stored session would pass the three tests above and quietly cost a
  // child their game on any reload.
  it('connect four: an unfinished board DOES come back on the next mount', async () => {
    const first = renderHook(() => useConnectFourAuthority({ userId: USER }));
    await waitFor(() => expect(first.result.current.state).toBeTruthy());
    await act(async () => { await first.result.current.play(3); });
    await act(async () => { await first.result.current.play(4); });

    first.unmount();
    const second = renderHook(() => useConnectFourAuthority({ userId: USER }));
    await waitFor(() => expect(second.result.current.state).toBeTruthy());

    expect(second.result.current.moves).toEqual([3, 4]);
  });

  it('checkers: a terminal session in the index is not resumed', async () => {
    const first = renderHook(() => useCheckersAuthority({ userId: USER }));
    await waitFor(() => expect(first.result.current.state).toBeTruthy());

    const indexKey = `gaming:piano-checkers:active:${USER}`;
    const sessionId = window.localStorage.getItem(indexKey);
    expect(sessionId).toBeTruthy();
    // Same ruleset, definition and namespace as the hook's own authority, so
    // this is the hook's session being finished, not a lookalike.
    await createCheckpointedLocalAuthority({
      ruleset: checkersRuleModule, definition: checkersDefinition, namespace: 'gaming:piano-checkers',
    }).close(sessionId);

    first.unmount();
    const second = renderHook(() => useCheckersAuthority({ userId: USER }));
    await waitFor(() => expect(second.result.current.state).toBeTruthy());

    expect(window.localStorage.getItem(indexKey)).not.toBe(sessionId);
    expect(second.result.current.moves).toEqual([]);
  });

  it('chess: a checkmated game does not come back on the next mount', async () => {
    const first = renderHook(() => useChessAuthority({ userId: USER, seed: 1 }));
    await waitFor(() => expect(first.result.current.ready).toBe(true));

    for (const move of FOOLS_MATE) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await first.result.current.move(move); });
    }
    expect(first.result.current.session.header.status).toBe('complete');

    first.unmount();
    const second = renderHook(() => useChessAuthority({ userId: USER, seed: 1 }));
    await waitFor(() => expect(second.result.current.ready).toBe(true));

    expect(second.result.current.session.header.status).toBe('active');
    expect(second.result.current.session.state.history).toEqual([]);
  });
  it('chess: an unfinished game resumes after a short break', async () => {
    const first = renderHook(() => useChessAuthority({ userId: USER, seed: 1 }));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => { await first.result.current.move(FOOLS_MATE[0]); });
    first.unmount();

    const second = renderHook(() => useChessAuthority({ userId: USER, seed: 1 }));
    await waitFor(() => expect(second.result.current.ready).toBe(true));
    expect(second.result.current.session.state.history).toHaveLength(1);
  });

  // 2026-09-27: a month-old game came back on the office display. The window is
  // now the SERVER's: a checkpoint older than the whole resume window, with the
  // server confirming it has no copy, is set aside. (The 2026-10-09 rule — idle
  // past six hours discards — is gone: it destroyed the only copy of a game.)
  it('chess: an unfinished game older than the whole server window starts fresh', async () => {
    const confirmedNone = async () => ({ game: null, window_days: 3 });
    const first = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: confirmedNone }));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => { await first.result.current.move(FOOLS_MATE[0]); });
    first.unmount();

    const realNow = Date.now;
    Date.now = () => realNow() + 4 * 24 * 3600e3;
    try {
      const second = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: confirmedNone }));
      await waitFor(() => expect(second.result.current.ready).toBe(true));
      expect(second.result.current.session.state.history).toEqual([]);
    } finally {
      Date.now = realNow;
    }
  });

  it('chess: a checkpoint idle past six hours is KEPT when the server cannot confirm a copy', async () => {
    const unreachable = async () => null;
    const first = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: unreachable }));
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => { await first.result.current.move(FOOLS_MATE[0]); });
    first.unmount();

    const realNow = Date.now;
    Date.now = () => realNow() + RESUME_MAX_IDLE_MS + 60000;
    try {
      const second = renderHook(() => useChessAuthority({ userId: USER, seed: 1, fetchResumable: unreachable }));
      await waitFor(() => expect(second.result.current.ready).toBe(true));
      expect(second.result.current.session.state.history).toHaveLength(1);
    } finally {
      Date.now = realNow;
    }
  });
});
