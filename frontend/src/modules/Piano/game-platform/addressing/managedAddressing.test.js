import { describe, expect, it } from 'vitest';
import { managedAddressingAt } from './managedAddressing.js';

const config = {
  enabled: true,
  users: { user_4: { vocabulary: 'staff' }, user_3: { vocabulary: 'chords' } },
};

describe('managed game addressing pressure', () => {
  it('keeps each learner in one configured vocabulary while daily and turn pressure rise', () => {
    expect(managedAddressingAt(config, { learnerId: 'user_4' }).vocabulary).toBe('staff');
    expect(managedAddressingAt(config, { learnerId: 'user_3' }).vocabulary).toBe('chords');
    const later = managedAddressingAt(config, { learnerId: 'user_4', completedGames: 2, completedPlayerMoves: 2 });
    expect(later.vocabulary).toBe('staff');
    expect(later.managed.stage).toBe(4);
  });

  it('saturates safely at the hardest stage and can disable either pressure axis', () => {
    expect(managedAddressingAt(config, { learnerId: 'user_3', completedGames: 99, completedPlayerMoves: 99 }).managed.stage).toBe(5);
    expect(managedAddressingAt(config, { learnerId: 'user_4', completedGames: 6 }).texture).toBe('dyad');
    const fixed = managedAddressingAt({
      ...config, dailyEscalation: { enabled: false }, turnEscalation: { enabled: false },
    }, { learnerId: 'user_3', completedGames: 9, completedPlayerMoves: 9 });
    expect(fixed.managed.stage).toBe(0);
  });
});
