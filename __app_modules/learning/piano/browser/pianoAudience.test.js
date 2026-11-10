import { describe, it, expect } from 'vitest';
import { pianoAudience } from './pianoAudience.js';

describe('pianoAudience', () => {
  it('declares the current player for the activity', () => {
    expect(pianoAudience({ id: 'player-a', name: 'Player A' }, 'lesson'))
      .toEqual({ activity: 'lesson', people: [{ id: 'player-a', name: 'Player A', role: 'player', guest: false }] });
    expect(pianoAudience({ id: 'player-a', name: 'Player A' }, 'game').activity).toBe('game');
  });
  it('a guest is declared unnamed; nobody is null', () => {
    expect(pianoAudience({ id: 'guest', name: 'Guest' }, 'lesson').people[0]).toEqual({ id: 'guest', name: null, role: 'player', guest: true });
    expect(pianoAudience(null, 'lesson')).toBeNull();
  });
});
