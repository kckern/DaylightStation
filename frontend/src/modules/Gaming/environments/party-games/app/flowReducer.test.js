import { describe, it, expect } from 'vitest';
import { flowReducer, initialFlowState } from './flowReducer.js';

const CONFIG = { defaults: { timer_seconds: 12, mute: false }, team_presets: [], buzzers: [], sounds: { pack: 'classic' } };
const SETS = [{ id: 's1', title: 'Set One', valid: true }];
const TEAMS = [{ id: 'team_1', name: 'Kids', color: '#e6b325', slot: null, members: [] }];

function boot() {
  return flowReducer(initialFlowState, { type: 'BOOT_LOADED', config: CONFIG, sets: SETS });
}

describe('flowReducer', () => {
  it('starts loading, lands on set-picker after boot with no active session', () => {
    expect(initialFlowState.phase).toBe('loading');
    const s = boot();
    expect(s.phase).toBe('set-picker');
    expect(s.sets).toHaveLength(1);
  });

  it('walks the happy path: set → teams → bind → session → playing → results → again', () => {
    let s = boot();
    s = flowReducer(s, { type: 'PICK_SET', setId: 's1' });
    expect(s.phase).toBe('team-setup');
    s = flowReducer(s, { type: 'TEAMS_CONFIRMED', teams: TEAMS });
    expect(s.phase).toBe('buzzer-bind');
    expect(s.teams).toEqual(TEAMS);
    s = flowReducer(s, { type: 'BIND_DONE', bindings: { slot_3: 'team_1' } });
    expect(s.phase).toBe('playing');
    expect(s.buzzerBindings).toEqual({ slot_3: 'team_1' });
    s = flowReducer(s, { type: 'SESSION_CREATED', sessionId: 'gs_1' });
    expect(s.sessionId).toBe('gs_1');
    expect(s.phase).toBe('playing');
    s = flowReducer(s, { type: 'GAME_FINISHED' });
    expect(s.phase).toBe('results');
    s = flowReducer(s, { type: 'PLAY_AGAIN' });
    expect(s.phase).toBe('set-picker');
    expect(s.sessionId).toBe(null);
    expect(s.teams).toEqual(TEAMS); // teams are kept for the next game
  });

  it('BOOT_FAILED records the error', () => {
    const s = flowReducer(initialFlowState, { type: 'BOOT_FAILED', error: 'boom' });
    expect(s.error).toBe('boom');
  });
});
