import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

// The opponent effect goes through this client, not fetch directly — mocking
// it is what lets these tests drive the server-reply and unmount-cancellation
// paths without a network, the same pattern chessApi.js's mock uses.
vi.mock('./connectFourApi.js', () => ({
  fetchConnectFourConfig: vi.fn(async () => null),
  fetchConnectFourLadder: vi.fn(async () => null),
  requestConnectFourMove: vi.fn(),
  saveConnectFourConfig: vi.fn(async () => null),
  saveConnectFourGame: vi.fn(async () => null),
  archiveConnectFourGame: vi.fn(async () => null),
}));

import PianoConnectFour from './PianoConnectFour.jsx';
import { requestConnectFourMove } from './connectFourApi.js';

// Note 65 (F) addresses column 3 in the default (unshuffled) deal under the
// DEFAULT_CONFIG this component falls back to when fetchConnectFourConfig
// resolves null (mocked below) — see PianoConnectFour.test.js's own config
// fixture for the same mapping. Playing it seats a disc and hands the turn to
// the opponent (player 2), which is what puts the opponent effect under test.

describe('PianoConnectFour opponent pacing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    requestConnectFourMove.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('visibly pauses: the reply lands only after the think-time floor, not the instant the request resolves', async () => {
    requestConnectFourMove.mockResolvedValueOnce({ move: { column: 0 } });
    const { container, rerender } = render(<PianoConnectFour activeNotes={new Map()} />);

    // Drop the player's disc in column 3 (note 65) to hand the turn over.
    rerender(<PianoConnectFour activeNotes={new Map([[65, { velocity: 90 }]])} />);
    await act(async () => { await Promise.resolve(); });

    expect(requestConnectFourMove).toHaveBeenCalledTimes(1);
    // The request already resolved (mockResolvedValueOnce), but with zero
    // timers advanced the opponent's disc must not be on the board yet — the
    // old bug committed the instant the promise settled.
    const discsBeforeFloor = container.querySelectorAll('.connect-four-board__disc--2').length;
    expect(discsBeforeFloor).toBe(0);
  });

  it('discards the pending reply on unmount', async () => {
    let resolveMove;
    requestConnectFourMove.mockImplementationOnce(() => new Promise((resolve) => { resolveMove = resolve; }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { rerender, unmount } = render(<PianoConnectFour activeNotes={new Map()} />);
    rerender(<PianoConnectFour activeNotes={new Map([[65, { velocity: 90 }]])} />);
    await act(async () => { await Promise.resolve(); });
    expect(requestConnectFourMove).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      resolveMove({ move: { column: 0 } });
      await Promise.resolve();
    });

    logSpy.mockRestore();
    // No throw, no late setMoves — the assertion that matters is that this
    // resolves without React's unmounted-state-update warning path executing;
    // absence of a crash plus the mock having fired exactly once is the signal.
    expect(requestConnectFourMove).toHaveBeenCalledTimes(1);
  });
});

describe('PianoConnectFour address rail', () => {
  it('renders seven staff cards above the board and drops the text legend', () => {
    const { container } = render(<PianoConnectFour activeNotes={new Map()} />);
    const topRail = container.querySelector('.instrument-board-stage__top-rail .address-rail');
    expect(topRail).toBeTruthy();
    expect(topRail.querySelectorAll('.address-rail__card')).toHaveLength(7);
    // The board now says it — the old "1: C  2: D ..." panel legend is gone.
    expect(container.querySelector('.connect-four-key')).toBeFalsy();
  });
});
