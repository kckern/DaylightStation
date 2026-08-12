import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('../PianoKiosk/PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ connected: false, status: 'disconnected' }),
  usePianoMidiNotes: () => ({ activeNotes: new Map(), noteHistory: [] }),
}));

// The opponent effect goes through this client, not fetch directly, so mocking
// it is what lets the tests below drive the server-success / server-failure /
// unmount-cancellation paths without a network.
vi.mock('./chessApi.js', () => ({ requestOpponentMove: vi.fn() }));

import { PianoChessGame } from './PianoChessGame.jsx';
import { requestOpponentMove } from './chessApi.js';

const sourceOutlines = (container) => container.querySelectorAll('.chess-board__square--source').length;

describe('PianoChessGame chrome', () => {
  it('has no header of its own — the kiosk breadcrumb rail names the screen', () => {
    const { container } = render(<PianoChessGame onDeactivate={() => {}} />);
    expect(container.querySelector('.piano-chess__header')).toBeNull();
    expect(container.querySelector('.piano-chess__wordmark')).toBeNull();
  });

  it('carries the way back in the shared context rail instead of a Leave button', () => {
    const onDeactivate = vi.fn();
    const { container } = render(<PianoChessGame onDeactivate={onDeactivate} />);
    const rail = container.querySelector('.psc-rail');
    expect(rail).not.toBeNull();
    expect(rail.textContent).toContain('Games');
    expect(rail.textContent).toContain('Piano Chess');
    screen.getByText('▸ Games').click();
    expect(onDeactivate).toHaveBeenCalled();
  });
});

describe('PianoChessGame legality cues', () => {
  it('does not outline the movable pieces before the player has got anything wrong', () => {
    const { container } = render(<PianoChessGame />);
    expect(container.querySelectorAll('.chess-board__square').length).toBe(64);
    expect(sourceOutlines(container)).toBe(0);
  });

  it('stays quiet even with the source cue explicitly enabled — the cue is gated on a refusal, not on config', () => {
    const { container } = render(<PianoChessGame feedback={{ highlightSources: true }} />);
    expect(sourceOutlines(container)).toBe(0);
  });
});

// The opponent effect is the actual deliverable of the server-engine wiring:
// server-first, local-engine fallback, unmount cancellation, and correct
// request threading. All of it lives inside one effect, so it has to be
// exercised at the component level — unit tests on chessApi.js or commitMove
// in isolation can't catch a regression in the wiring itself.
//
// playerColor="b" is used throughout so the opponent (White) replies on mount
// without needing a simulated player move first — White is on move from the
// initial position, and the human is Black.
describe('PianoChessGame opponent effect', () => {
  const OPPONENT_DELAY_MS = 700;
  const moveSans = (container) => [...container.querySelectorAll('.piano-chess__move-san')].map((el) => el.textContent);

  beforeEach(() => {
    vi.useFakeTimers();
    requestOpponentMove.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('plays the server-supplied reply once the opponent delay elapses', async () => {
    requestOpponentMove.mockResolvedValueOnce({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
    const { container } = render(<PianoChessGame playerColor="b" seed={1} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS); });

    expect(requestOpponentMove).toHaveBeenCalledTimes(1);
    expect(moveSans(container)).toEqual(['e4']);
  });

  it('falls back to the bundled engine so a move still lands when the server has none', async () => {
    // chessApi.js (unit-tested separately) never rejects in production — on any
    // transport failure it catches and resolves null, which is the contract this
    // effect is written against. A resolved null is the faithful failure shape
    // to mock here, not a rejection the effect was never meant to catch.
    requestOpponentMove.mockResolvedValueOnce(null);
    const { container } = render(<PianoChessGame playerColor="b" seed={1} />);

    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS); });

    expect(requestOpponentMove).toHaveBeenCalledTimes(1);
    // The server produced nothing, yet a move landed — the only path that can
    // commit one here is the bundled `chooseMove` fallback.
    expect(moveSans(container).length).toBe(1);
    expect(moveSans(container)[0]).not.toBe('');
  });

  it('does not run the reply after unmount once a stale request resolves', async () => {
    // React 18 dropped the "state update on an unmounted component" console
    // warning, so a console.error spy can't tell a working `cancelled` guard
    // from a broken one — both look silent. `setGame` and the `opponent-replied`
    // log sit on consecutive lines in the effect, both gated by the same
    // `if (cancelled || !reply) return;`, and the logger's console transport
    // for 'info' goes through console.log (see Logger.js `devOutput`), so
    // spying there is a proxy for "did the post-unmount branch actually run."
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    let resolveMove;
    requestOpponentMove.mockImplementationOnce(() => new Promise((resolve) => { resolveMove = resolve; }));

    const { unmount } = render(<PianoChessGame playerColor="b" seed={1} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS); });
    expect(requestOpponentMove).toHaveBeenCalledTimes(1);

    unmount();

    // Resolve the in-flight request only after the component is gone.
    await act(async () => {
      resolveMove({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
      await Promise.resolve();
    });

    const repliedAfterUnmount = logSpy.mock.calls.some(
      ([message]) => typeof message === 'string' && message.includes('opponent-replied'),
    );
    expect(repliedAfterUnmount).toBe(false);
  });

  it('threads the active rung, a per-game id, and no userId for a guest', async () => {
    requestOpponentMove.mockResolvedValueOnce({ from: 'e2', to: 'e4', san: 'e4', engine: 'stockfish' });
    render(<PianoChessGame playerColor="b" seed={1} currentUser="guest" />);

    await act(async () => { await vi.advanceTimersByTimeAsync(OPPONENT_DELAY_MS); });

    expect(requestOpponentMove).toHaveBeenCalledWith(expect.objectContaining({
      rung: 'learner',
      gameId: expect.stringMatching(/^chess-\d+$/),
      userId: null,
    }));
  });
});
