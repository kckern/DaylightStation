import { describe, expect, it } from 'vitest';
import { managedAddressingAt } from './managedAddressing.js';

const config = {
  enabled: true,
  users: { user_4: { vocabulary: 'staff' }, user_3: { vocabulary: 'chords' } },
};

const staffAt = (completedGames, over = {}) => managedAddressingAt(
  { ...config, ...over },
  { learnerId: 'user_4', completedGames },
);

describe('managed game addressing pressure', () => {
  it('keeps each learner in one configured vocabulary while daily pressure rises', () => {
    expect(managedAddressingAt(config, { learnerId: 'user_4' }).vocabulary).toBe('staff');
    expect(managedAddressingAt(config, { learnerId: 'user_3' }).vocabulary).toBe('chords');
    const later = managedAddressingAt(config, { learnerId: 'user_4', completedGames: 2 });
    expect(later.vocabulary).toBe('staff');
    expect(later.managed.stage).toBe(2);
  });

  it('saturates safely at the hardest stage and can disable the daily climb', () => {
    expect(managedAddressingAt(config, { learnerId: 'user_3', completedGames: 99 }).managed.stage).toBe(5);
    const fixed = managedAddressingAt(
      { ...config, dailyEscalation: { enabled: false } },
      { learnerId: 'user_3', completedGames: 9 },
    );
    expect(fixed.managed.stage).toBe(0);
  });

  // THE DEFECT THIS MODULE EXISTS TO NOT REPEAT.
  //
  // A stage used to be added per completed player move, so a game that opened
  // on single treble naturals was asking for four-note dyads on a chromatic
  // board by move six — 69 refusals against 7 moves in the session that found
  // it. The pressure a game starts with is the pressure it finishes with.
  it('does not move inside a game: nothing but completedGames can raise the stage', () => {
    const opening = staffAt(1);
    // Every shape a caller might still be passing from the old signature.
    for (const extra of [
      { completedPlayerMoves: 1 }, { completedPlayerMoves: 40 }, { ply: 60 }, { moves: 99 },
    ]) {
      const later = managedAddressingAt(config, { learnerId: 'user_4', completedGames: 1, ...extra });
      expect(later).toEqual(opening);
    }
  });

  it('walks texture x material: single, then accidentals, then dyads, then triads', () => {
    expect(staffAt(0)).toMatchObject({ texture: 'single', x: { tier: 2 }, y: { tier: 2 } });
    expect(staffAt(1)).toMatchObject({ texture: 'single', x: { tier: 3 }, y: { tier: 3 } });
    expect(staffAt(2)).toMatchObject({ texture: 'dyad', x: { tier: 2 }, y: { tier: 2 } });
    expect(staffAt(3)).toMatchObject({ texture: 'dyad', x: { tier: 3 }, y: { tier: 3 } });
    expect(staffAt(4)).toMatchObject({ texture: 'triad', x: { tier: 2 }, y: { tier: 2 } });
    expect(staffAt(5)).toMatchObject({ texture: 'triad', x: { tier: 3 }, y: { tier: 3 } });
    expect(staffAt(99)).toMatchObject({ texture: 'triad', x: { tier: 3 } });
  });

  // Reading harder and moving around more are different demands, and the
  // household wants the second one on from the first game rather than arriving
  // as a surprise partway up the path.
  it('holds the cadence steady across every stage of the path', () => {
    for (const games of [0, 1, 2, 3, 4, 5]) {
      expect(staffAt(games)).toMatchObject({
        shuffle: 'each_turn',
        x: { order: 'shuffled' },
        y: { order: 'shuffled' },
      });
    }
  });

  it('takes the cadence from config, key by key, without touching the path', () => {
    const still = staffAt(2, { cadence: { shuffle: 'never', order: 'sequential' } });
    expect(still).toMatchObject({
      shuffle: 'never', x: { order: 'sequential' }, y: { order: 'sequential' },
      texture: 'dyad', // the path is unchanged by the cadence
    });
    // One key stated leaves the other on the house default.
    expect(staffAt(2, { cadence: { shuffle: 'each_game' } }))
      .toMatchObject({ shuffle: 'each_game', x: { order: 'shuffled' } });
  });

  it('applies the cadence to the chord path too', () => {
    const chords = managedAddressingAt(
      { ...config, cadence: { shuffle: 'never', order: 'sequential' } },
      { learnerId: 'user_3', completedGames: 0 },
    );
    expect(chords).toMatchObject({ vocabulary: 'chords', shuffle: 'never', x: { order: 'sequential' } });
    expect(chords.x.tier).toBe(0); // rung 8's own tier survives
  });

  it('starts a learner further along when the household says so', () => {
    const started = managedAddressingAt(
      { ...config, users: { user_4: { vocabulary: 'staff', startStage: 2 } } },
      { learnerId: 'user_4', completedGames: 1 },
    );
    expect(started.managed.stage).toBe(3);
    expect(started.texture).toBe('dyad');
  });

  it('is off for a learner with no vocabulary, a disabled learner, or a disabled household', () => {
    expect(managedAddressingAt({ ...config, enabled: false }, { learnerId: 'user_4' })).toBeNull();
    expect(managedAddressingAt(config, { learnerId: 'nobody' })).toBeNull();
    expect(managedAddressingAt(
      { ...config, users: { user_4: { vocabulary: 'staff', enabled: false } } },
      { learnerId: 'user_4' },
    )).toBeNull();
  });
});
