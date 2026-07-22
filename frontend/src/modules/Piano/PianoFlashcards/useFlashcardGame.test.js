import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFlashcardGame } from './useFlashcardGame.js';

const makeNotes = (...notes) => new Map(notes.map(n => [n, { velocity: 100, timestamp: 0 }]));

// One root, two qualities: every card is a C chord, and the no-repeat rule
// guarantees the card after a C major is a C minor (and vice versa).
const CHORD_CONFIG = {
  score_per_card: 10,
  user_start_levels: { kckern: 'Chords' },
  levels: [
    { name: 'Notes', complexity: 'single', note_range: [60, 72], score_to_advance: 100 },
    { name: 'Chords', card_type: 'chord', qualities: ['major', 'minor'], roots: ['C'], score_to_advance: 100 },
  ],
};

const voicing = (card) => (card.quality === 'major' ? [48, 52, 55] : [48, 51, 55]);

describe('useFlashcardGame — chord levels', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function start(config = CHORD_CONFIG, user = 'kckern') {
    const hook = renderHook(
      ({ notes }) => useFlashcardGame(notes, config, user),
      { initialProps: { notes: new Map() } },
    );
    act(() => hook.result.current.startGame());
    return hook;
  }

  it('starts at the per-user level and deals a chord card', () => {
    const { result } = start();
    expect(result.current.level).toBe(1);
    expect(result.current.currentCard.type).toBe('chord');
    expect(result.current.currentCard.rootName).toBe('C');
  });

  it('scores a first-try correct chord', () => {
    const hook = start();
    act(() => hook.rerender({ notes: makeNotes(...voicing(hook.result.current.currentCard)) }));
    expect(hook.result.current.cardStatus).toBe('hit');
    expect(hook.result.current.score).toBe(10);
  });

  it('flags a complete chord over the wrong bass as a miss', () => {
    const hook = start();
    const card = hook.result.current.currentCard;
    // First inversion: third in the bass (E or Eb under C-G)
    const third = card.quality === 'major' ? 52 : 51;
    act(() => hook.rerender({ notes: makeNotes(third - 12, 60, 67) }));
    expect(hook.result.current.cardStatus).toBe('miss');
  });

  it('does NOT judge a new card against notes still held from the previous hit', () => {
    const hook = start();
    const firstCard = hook.result.current.currentCard;
    const held = makeNotes(...voicing(firstCard));

    act(() => hook.rerender({ notes: held }));
    expect(hook.result.current.cardStatus).toBe('hit');

    // Advance to the next card while STILL HOLDING the previous chord. The next
    // card is the other quality, so the held notes would read as wrong.
    act(() => vi.advanceTimersByTime(500));
    const secondCard = hook.result.current.currentCard;
    expect(secondCard.quality).not.toBe(firstCard.quality);
    expect(hook.result.current.cardStatus).toBe(null); // not judged while held over

    // Release everything, then play the new card — must count as a FIRST-TRY hit.
    act(() => hook.rerender({ notes: new Map() }));
    act(() => hook.rerender({ notes: makeNotes(...voicing(secondCard)) }));
    expect(hook.result.current.cardStatus).toBe('hit');
    expect(hook.result.current.score).toBe(20);
  });

  it('selectLevel jumps levels and resets score and card', () => {
    const hook = start(CHORD_CONFIG, null); // no user → starts at level 0
    expect(hook.result.current.level).toBe(0);
    act(() => hook.rerender({ notes: makeNotes(...hook.result.current.currentCard.pitches) }));
    expect(hook.result.current.score).toBe(10);

    act(() => hook.result.current.selectLevel(1));
    expect(hook.result.current.level).toBe(1);
    expect(hook.result.current.score).toBe(0);
    expect(hook.result.current.currentCard.type).toBe('chord');
  });
});
