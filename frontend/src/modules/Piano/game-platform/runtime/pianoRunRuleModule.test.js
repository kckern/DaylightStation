import { describe, expect, it } from 'vitest';
import { pianoRunRuleModule } from './pianoRunRuleModule.js';

const definition = { game_id: 'fixture', initial_phase: 'IDLE', active_phases: ['IDLE', 'PLAYING'], terminal_phases: ['COMPLETE'] };

describe('Piano native run RuleModule', () => {
  it('deterministically commits native state and terminal status', () => {
    const state = pianoRunRuleModule.createInitialState(definition, {});
    const playing = pianoRunRuleModule.handleCommand(state, { type: 'piano.run.sync', sequence: 0, phase: 'PLAYING', score: 10 }, definition, { logicalTime: 12 });
    const complete = pianoRunRuleModule.handleCommand(playing.state, { type: 'piano.run.sync', sequence: 1, phase: 'COMPLETE', score: 20 }, definition, { logicalTime: 13 });
    expect(playing.state).toMatchObject({ status: 'active', phase: 'PLAYING', score: 10 });
    expect(complete).toMatchObject({ status: 'complete', state: { phase: 'COMPLETE', score: 20 } });
  });

  it('fails closed for stale sequence and unknown phases', () => {
    const state = { ...pianoRunRuleModule.createInitialState(definition, {}), sequence: 2 };
    expect(pianoRunRuleModule.handleCommand(state, { type: 'piano.run.sync', sequence: 2, phase: 'PLAYING' }, definition, { logicalTime: 1 }).error.code).toBe('stale_native_state');
    expect(pianoRunRuleModule.handleCommand(state, { type: 'piano.run.sync', sequence: 3, phase: 'OTHER' }, definition, { logicalTime: 1 }).error.code).toBe('invalid_native_state');
  });
});
