// "Play again" at an armed gate must not tear the session down first.
//
// This is a COMPONENT test on purpose. The family hook
// (`useAddressedBoardGame`) asks the gate too, and its own spec covers that —
// but the wrapper calls `resetAuthority()` BEFORE `resetSession()`, so a check
// that lives only inside the hook is reached too late. `resetAuthority` closes
// the finished session and mints a fresh checkpointed one, writing its id into
// `gaming:piano-checkers:active:{user}`; fail the challenge or leave, and that
// empty unplayed board is what the player comes back to. The hook spec
// structurally cannot see it, because the ordering bug is in the wrapper.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { replayGame } from '@shared-gaming/rulesets/checkers/engine.mjs';
import MatchGateContext from '../PianoKiosk/modes/Games/MatchGateContext.js';

const h = vi.hoisted(() => ({ reset: vi.fn(async () => {}), play: vi.fn() }));

vi.mock('./checkersApi.js', () => ({
  default: {
    readConfig: vi.fn(async () => null),
    readLadder: vi.fn(async () => null),
    requestMove: vi.fn(),
    saveGame: vi.fn(async () => null),
    archiveGame: vi.fn(async () => null),
    writeConfig: vi.fn(async () => null),
  },
}));

// A finished board, so the component renders its "Play again" affordance. The
// board itself is the real initial one — only the verdict is forced, because
// what is under test is what happens AFTER the game is over.
const FINISHED = {
  ...replayGame({ moves: [] }),
  status: { gameOver: true, winner: 1, draw: false },
};

vi.mock('./useCheckersAuthority.js', () => ({
  useCheckersAuthority: () => ({ state: FINISHED, moves: [], play: h.play, reset: h.reset }),
}));

const { default: PianoCheckers } = await import('./PianoCheckers.jsx');

function renderCheckers(matchGate) {
  const tree = <PianoCheckers activeNotes={new Map()} currentUser={{ id: 'ada' }} />;
  return render(
    matchGate === undefined
      ? tree
      : <MatchGateContext.Provider value={matchGate}>{tree}</MatchGateContext.Provider>,
  );
}

beforeEach(() => { h.reset.mockClear(); });

describe('PianoCheckers — play again at a match boundary', () => {
  it('asks the host and touches NOTHING when the gate is armed', () => {
    const requestRematch = vi.fn();
    const view = renderCheckers({ armed: true, requestRematch });
    fireEvent.click(view.getByText('Play again'));

    expect(requestRematch).toHaveBeenCalledTimes(1);
    // The authority is the thing that must not move: a reset here closes the
    // finished session and marks an empty one active before the child has
    // earned it.
    expect(h.reset).not.toHaveBeenCalled();
  });

  it('resets its own authority when no gate is mounted — the office screen is unchanged', () => {
    const view = renderCheckers(undefined);
    fireEvent.click(view.getByText('Play again'));
    expect(h.reset).toHaveBeenCalledTimes(1);
  });

  it('resets its own authority when the gate is present but unarmed', () => {
    const requestRematch = vi.fn();
    const view = renderCheckers({ armed: false, requestRematch });
    fireEvent.click(view.getByText('Play again'));
    expect(requestRematch).not.toHaveBeenCalled();
    expect(h.reset).toHaveBeenCalledTimes(1);
  });
});
