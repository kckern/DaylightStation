import { describe, expect, it } from 'vitest';
import { projectHostPhase } from './gameLifecycle.js';

describe('piano game host lifecycle projection', () => {
  it('normalizes shared phases and maps game-owned terminal phases', () => {
    expect(projectHostPhase('PLAYING')).toBe('playing');
    expect(projectHostPhase('GAME_OVER', { GAME_OVER: 'result' })).toBe('result');
    expect(projectHostPhase('unknown')).toBe('ready');
  });
});
