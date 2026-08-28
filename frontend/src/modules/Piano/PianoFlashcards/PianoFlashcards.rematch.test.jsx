// Flashcards' SECOND door into a match: the level chip.
//
// The chip renders in every phase, COMPLETE included, and `selectLevel` zeroes
// the score and deals a fresh card — a new run. With ~nine configured levels,
// alternating any two from a finished run is an endless supply of matches that
// never passes the gate. Gating the any-key replay alone left that wide open.
//
// It is not simply "gate the chip" though: while the run is untouched the chip
// is settings, not a replay. A child who lands on the wrong level has to be
// able to fix it without being asked to play a scale, and swapping levels
// before answering anything yields no extra play — there is still exactly one
// run in flight. The boundary is the first ANSWER.
//
// This test goes through the LEVEL PICKER rather than the replay button, which
// useMatchRematch.test.jsx already covers.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MatchGateContext from '../PianoKiosk/modes/Games/MatchGateContext.js';

const h = vi.hoisted(() => ({
  phase: 'COMPLETE', attempts: [{ hit: true }], selectLevel: vi.fn(), startGame: vi.fn(),
}));

vi.mock('../../../lib/logging/singleton.js', () => ({
  getChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn(async () => ({})),
  DaylightAPIText: vi.fn(async () => ''),
}));
vi.mock('./useFlashcardGame.js', () => ({
  useFlashcardGame: () => ({
    phase: h.phase, attempts: h.attempts, selectLevel: h.selectLevel, startGame: h.startGame,
    score: 0, scoreNeeded: 10, level: 0, levelConfig: { name: 'Middle C', card_type: 'note' },
    currentCard: null, cardStatus: null, targets: null, accuracy: 0,
  }),
}));

const { PianoFlashcards } = await import('./PianoFlashcards.jsx');

const GAME_CONFIG = {
  levels: [
    { name: 'Middle C', card_type: 'note' },
    { name: 'Treble steps', card_type: 'note' },
    { name: 'Triads', card_type: 'chord' },
  ],
};

function renderFlashcards(matchGate) {
  const tree = <PianoFlashcards activeNotes={new Map()} gameConfig={GAME_CONFIG} />;
  return render(
    matchGate === undefined
      ? tree
      : <MatchGateContext.Provider value={matchGate}>{tree}</MatchGateContext.Provider>,
  );
}

/** Open the level chip and choose a level that is not the current one. */
function chooseLevel(name) {
  fireEvent.click(screen.getByText(/^Level 1$/));
  fireEvent.click(screen.getByText(name));
}

beforeEach(() => {
  h.phase = 'COMPLETE';
  h.attempts = [{ hit: true }];
  h.selectLevel.mockClear();
  h.startGame.mockClear();
});

describe('Piano Flashcards — a match reached through the level chip', () => {
  it('gates a level change from a finished run — the endless-alternation loop', () => {
    const requestRematch = vi.fn();
    renderFlashcards({ armed: true, requestRematch });
    chooseLevel('Triads');

    expect(requestRematch, 'the level chip started a run without the gate').toHaveBeenCalledTimes(1);
    expect(h.selectLevel, 'a new run was dealt behind the gate').not.toHaveBeenCalled();
  });

  it('gates a level change mid-run once the child has answered something', () => {
    const requestRematch = vi.fn();
    h.phase = 'PLAYING';
    renderFlashcards({ armed: true, requestRematch });
    chooseLevel('Triads');

    expect(requestRematch).toHaveBeenCalledTimes(1);
    expect(h.selectLevel).not.toHaveBeenCalled();
  });

  it('lets an untouched run change level freely — that is settings, not a replay', () => {
    // No attempts yet: the child landed on the wrong level and is fixing it.
    // Swapping now yields no extra play, so it must not cost a challenge.
    const requestRematch = vi.fn();
    h.phase = 'PLAYING';
    h.attempts = [];
    renderFlashcards({ armed: true, requestRematch });
    chooseLevel('Triads');

    expect(requestRematch).not.toHaveBeenCalled();
    expect(h.selectLevel).toHaveBeenCalledWith(2);
  });

  it('changes level directly outside the kiosk, where there is no gate', () => {
    renderFlashcards(undefined);
    chooseLevel('Triads');
    expect(h.selectLevel).toHaveBeenCalledWith(2);
  });
});
