import { describe, it, expect } from 'vitest';
import { GAME_ACHIEVEMENT_RECORDED_EVENT, announceGameAchievement } from './gameAchievement.js';

describe('announceGameAchievement', () => {
  it('dispatches game-achievement-recorded with the source and detail', () => {
    const seen = [];
    const on = (e) => seen.push(e.detail);
    window.addEventListener('game-achievement-recorded', on);
    announceGameAchievement('x', { runId: 'r1' });
    window.removeEventListener('game-achievement-recorded', on);
    expect(GAME_ACHIEVEMENT_RECORDED_EVENT).toBe('game-achievement-recorded');
    expect(seen).toEqual([{ source: 'x', runId: 'r1' }]);
  });
});
