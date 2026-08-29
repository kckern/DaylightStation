import { describe, expect, it } from 'vitest';
import { dailyChallengeLevel, resolveDailyEscalation, resolveLearnerPath } from './gateDailyEscalation.js';

const levels = Array.from({ length: 11 }, (_, index) => ({ id: `l${index}` }));

describe('daily PianoChallenge escalation', () => {
  it('uses a configurable nonlinear offset and a named capstone', () => {
    const config = resolveDailyEscalation({ enabled: true, capstoneAfter: 7, capstoneLevel: 'l10' });
    expect(dailyChallengeLevel({ levels, baseLevelId: 'l1', completedGames: 0, config }).level.id).toBe('l1');
    expect(dailyChallengeLevel({ levels, baseLevelId: 'l1', completedGames: 5, config }).level.id).toBe('l7');
    expect(dailyChallengeLevel({ levels, baseLevelId: 'l1', completedGames: 7, config }).level.id).toBe('l10');
  });

  it('never serves below the high-water floor already reached that study day', () => {
    const config = resolveDailyEscalation({ enabled: true });
    const result = dailyChallengeLevel({ levels, baseLevelId: 'l1', completedGames: 2, config, floorLevelId: 'l6' });
    expect(result.level.id).toBe('l6');
  });

  it('keeps the unfailable floor while selecting a learner-specific path', () => {
    expect(resolveLearnerPath(levels, ['l5', 'l2']).map((level) => level.id)).toEqual(['l0', 'l5', 'l2']);
  });
});
