import { describe, it, expect } from 'vitest';
import { hostButtons } from './hostView.js';

describe('hostButtons', () => {
  it('round-intro → start', () => {
    expect(hostButtons({ phase: 'round-intro' })).toEqual([
      { label: 'Start round', command: { type: 'START_ROUND' }, tone: 'primary' },
    ]);
  });
  it('clue unrevealed → reveal + timeout; revealed → back to board', () => {
    const un = hostButtons({ phase: 'clue', revealed: false }).map((b) => b.command.type);
    expect(un).toEqual(['REVEAL', 'TIMEOUT']);
    const rev = hostButtons({ phase: 'clue', revealed: true }).map((b) => b.command.type);
    expect(rev).toEqual(['RETURN_TO_BOARD']);
  });
  it('judging → correct/wrong, plus reveal when hidden', () => {
    const hidden = hostButtons({ phase: 'judging', revealed: false }).map((b) => b.command.type);
    expect(hidden).toEqual(['REVEAL', 'JUDGE', 'JUDGE']);
    const shown = hostButtons({ phase: 'judging', revealed: true });
    expect(shown.map((b) => b.command.type)).toEqual(['JUDGE', 'JUDGE']);
    expect(shown[0].command.correct).toBe(true);
    expect(shown[1].command.correct).toBe(false);
  });
  it('final phases and unknown/empty', () => {
    expect(hostButtons({ phase: 'final-category' })[0].command.type).toBe('START_ROUND');
    expect(hostButtons({ phase: 'final-clue' })[0].command.type).toBe('REVEAL');
    expect(hostButtons({ phase: 'board' })).toEqual([]);
    expect(hostButtons(null)).toEqual([]);
  });
});
