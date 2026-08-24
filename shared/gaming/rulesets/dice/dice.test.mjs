import { describe, expect, it } from 'vitest';
import { diceRuleModule } from './index.mjs';

const definition = { id: 'fixture-dice', default_notation: '1d6' };

describe('dice ruleset', () => {
  it('commits deterministic outcomes and rejects presentation bumps', () => {
    const state = diceRuleModule.createInitialState(definition, {});
    const first = diceRuleModule.handleCommand(state, { type: 'dice.roll', notation: '2d20+3' }, definition, { seed: 42, revision: 0 });
    const replay = diceRuleModule.handleCommand(state, { type: 'dice.roll', notation: '2d20+3' }, definition, { seed: 42, revision: 0 });
    expect(first.state.outcome).toEqual(replay.state.outcome); expect(first.events[0].type).toBe('dice.outcome.committed');
    expect(diceRuleModule.handleCommand(first.state, { type: 'controller.bump' }, definition, { seed: 42 })).toMatchObject({ error: { code: 'illegal_command' } });
    expect(diceRuleModule.handleCommand(first.state, { type: 'dice.roll', notation: 'not-dice' }, definition, { seed: 42 })).toMatchObject({ error: { code: 'invalid_dice_notation' } });
  });
  it('fails definition validation for invalid mounted notation', () => {
    expect(diceRuleModule.validateDefinition({ default_notation: '1d1' })).toMatchObject({ valid: false });
  });
});
