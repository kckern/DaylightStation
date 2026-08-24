import { describe, expect, it } from 'vitest';
import { connectFourDefinition, connectFourRuleModule } from './index.mjs';

describe('connect-four RuleModule', () => {
  it('owns deterministic transcripts for context-native surfaces', () => {
    const state = connectFourRuleModule.createInitialState(connectFourDefinition, {});
    const first = connectFourRuleModule.handleCommand(state, { type: 'connect-four.play', column: 3 });
    expect(first.state).toMatchObject({ moves: [3], turn: 2, lifecycle_status: 'active' });
    expect(first.events[0]).toMatchObject({ type: 'connect-four.disc-dropped', column: 3, player: 1 });
  });
});
