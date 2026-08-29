import { describe, expect, it } from 'vitest';
import { managedAddressingAt } from './managedAddressing.js';

const config = {
  enabled: true,
  users: { milo: { vocabulary: 'staff' }, felix: { vocabulary: 'chords' } },
};

describe('managed game addressing pressure', () => {
  it('keeps each learner in one configured vocabulary while daily and turn pressure rise', () => {
    expect(managedAddressingAt(config, { learnerId: 'milo' }).vocabulary).toBe('staff');
    expect(managedAddressingAt(config, { learnerId: 'felix' }).vocabulary).toBe('chords');
    const later = managedAddressingAt(config, { learnerId: 'milo', completedGames: 2, completedPlayerMoves: 2 });
    expect(later.vocabulary).toBe('staff');
    expect(later.managed.stage).toBe(4);
  });

  it('saturates safely at the hardest stage and can disable either pressure axis', () => {
    expect(managedAddressingAt(config, { learnerId: 'felix', completedGames: 99, completedPlayerMoves: 99 }).managed.stage).toBe(5);
    expect(managedAddressingAt(config, { learnerId: 'milo', completedGames: 6 }).texture).toBe('dyad');
    const fixed = managedAddressingAt({
      ...config, dailyEscalation: { enabled: false }, turnEscalation: { enabled: false },
    }, { learnerId: 'felix', completedGames: 9, completedPlayerMoves: 9 });
    expect(fixed.managed.stage).toBe(0);
  });
});
