// The same ordering guarantee as PianoCheckers.rematch.test.jsx, and here for
// the same reason: the wrapper's `restart` calls `resetAuthority()` FIRST, so a
// gate check that lives only inside `useAddressedBoardGame` is consulted after
// the finished session has already been closed and an empty one minted and
// marked active. See that file's header for the full account.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import MatchGateContext from '../PianoKiosk/modes/Games/MatchGateContext.js';

const h = vi.hoisted(() => ({ reset: vi.fn(async () => {}), play: vi.fn() }));

vi.mock('./connectFourApi.js', () => ({
  default: {
    readConfig: vi.fn(async () => null),
    readLadder: vi.fn(async () => null),
    requestMove: vi.fn(),
    writeConfig: vi.fn(async () => null),
    saveGame: vi.fn(async () => null),
    archiveGame: vi.fn(async () => null),
  },
}));

// Connect Four derives its whole game from the move list, so a finished board
// is stated the only honest way: as the moves that finish it. Player 1 stacks
// column 0 four deep while the opponent answers in column 1 — a real vertical
// win, replayed by the real engine.
const WINNING_MOVES = [0, 1, 0, 1, 0, 1, 0];

vi.mock('./useConnectFourAuthority.js', () => ({
  useConnectFourAuthority: () => ({ moves: WINNING_MOVES, play: h.play, reset: h.reset }),
}));

const { default: PianoConnectFour } = await import('./PianoConnectFour.jsx');

function renderConnectFour(matchGate) {
  const tree = <PianoConnectFour activeNotes={new Map()} currentUser={{ id: 'ada' }} />;
  return render(
    matchGate === undefined
      ? tree
      : <MatchGateContext.Provider value={matchGate}>{tree}</MatchGateContext.Provider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  h.reset.mockClear();
});

describe('PianoConnectFour — play again at a match boundary', () => {
  it('asks the host and touches NOTHING when the gate is armed', () => {
    const requestRematch = vi.fn();
    const view = renderConnectFour({ armed: true, requestRematch });
    fireEvent.click(view.getByText('Play again'));

    expect(requestRematch).toHaveBeenCalledTimes(1);
    expect(h.reset).not.toHaveBeenCalled();
  });

  it('resets its own authority when no gate is mounted — the office screen is unchanged', () => {
    const view = renderConnectFour(undefined);
    fireEvent.click(view.getByText('Play again'));
    expect(h.reset).toHaveBeenCalledTimes(1);
  });

  it('resets its own authority when the gate is present but unarmed', () => {
    const requestRematch = vi.fn();
    const view = renderConnectFour({ armed: false, requestRematch });
    fireEvent.click(view.getByText('Play again'));
    expect(requestRematch).not.toHaveBeenCalled();
    expect(h.reset).toHaveBeenCalledTimes(1);
  });
});
